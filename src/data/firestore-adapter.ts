/*
 * Firestore document shapes written by this adapter (contract shared with
 * firestore.rules and the verifyOrderTotal function). Every path sits under
 * demos/{uid}; `updatedAt` is always serverTimestamp().
 *
 *   demos/{uid}                     { createdAt, updatedAt, docs, last }
 *       docs = delta docs ever created (lifetime cap 300; reset keeps it; the client never deletes the profile)
 *       last = "<collection>/<docId>" of the delta doc the latest increment counted, e.g. "orders/abc-123"
 *   demos/{uid}/orders/{orderId}    { deleted: false, order, items, clientTotalCentavos, updatedAt }
 *       order  = the StoredOrder record without `items` (exactly as LocalAdapter stores it)
 *       items  = that order's StoredOrderItem records (≤ 20), same field names as LocalAdapter
 *       clientTotalCentavos = order.totalCentavos, the pricing engine's total set by every writer
 *   demos/{uid}/customers/{id}      { deleted: false, customer, updatedAt }   customer = StoredCustomer
 *   demos/{uid}/settings/{docId}    { deleted: false, setting, updatedAt }    setting = Setting record
 *       docId = setting.key with ':' replaced by '.' (e.g. settings/order_dashboard_settings)
 *   tombstone (any of the three)    { deleted: true, updatedAt }   a deleted seed or visitor record
 *   demos/{uid}/verifications/{orderId}  written by the function only; read here for the UI chip
 *
 * Write discipline the rules enforce: a create of a delta doc is one batch that
 * also raises demos/{uid}.docs by exactly 1 and sets `last` to that doc (one new
 * delta doc per batch; the first such batch creates the profile with docs 1), and
 * an update of a delta doc lands at least 1 s after that doc's previous write.
 *
 * Client-side guarantees: unsent writes are mirrored to localStorage (keyed by
 * uid) and replayed after sign-in on the next load; no order commits while a
 * settings write is pending (the function prices orders with saved settings);
 * order-item edits are validated as a whole order before anything is queued.
 */
import {
  collection,
  doc,
  getDocsFromServer,
  increment,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  type DocumentData,
  type QuerySnapshot,
  type Unsubscribe,
} from 'firebase/firestore'
import { demoCustomers, demoModifierGroups, demoOrders, demoProducts, demoSettings } from '../demo/seed'
import { getFirebase, signInVisitor } from './firebase'
import { applyDeltas, compareIds, resolveRecord, type Delta } from './overlay'
import type {
  ModifierGroup,
  Setting,
  StorageAdapter,
  StorageChange,
  StorageCollection,
  StorageEntityByCollection,
  StorageUnsubscribe,
  StoredCustomer,
  StoredOrder,
  StoredOrderItem,
  StoredProduct,
} from './types'

/** Delta collections under demos/{uid}. */
type DeltaCollection = 'orders' | 'customers' | 'settings'
type DeltaRecord = { orders: StoredOrder; customers: StoredCustomer; settings: Setting }

/** Synchronisation state for the UI (loading, banner with retry). */
export type SyncStatus =
  | { state: 'connecting' }
  | { state: 'ready' }
  | { state: 'error'; kind: 'connect' | 'listen' | 'write'; error: Error }

/** What the "Server-verified" chip should show for one order. */
export type OrderVerificationState =
  /** A sample order the visitor never changed, or a deleted one: show no chip. */
  | { status: 'none' }
  /** Saved but not yet checked; `since` is epoch ms (the UI hides the chip after ~20 s). */
  | { status: 'checking'; since: number }
  | {
      status: 'verified' | 'mismatch'
      serverTotalCentavos: number | null
      clientTotalCentavos: number | null
      /** Epoch ms, or null when unknown. */
      verifiedAt: number | null
    }

type Verification = {
  serverTotalCentavos: number | null
  clientTotalCentavos: number | null
  match: boolean
  orderUpdatedAt: number | null
  verifiedAt: number | null
}

type PendingWrite = {
  coll: DeltaCollection
  key: string
  delta: Delta<DeltaRecord[DeltaCollection]>
  version: number
  changedAt: number
  failed: boolean
}

const MAX_DELTA_DOCS = 300
const MAX_ORDER_ITEMS = 20
/** Coalesces multi-step edits (delete items, add items, update order) into one write. */
const DEBOUNCE_MS = 300
/** Rules require ≥ 1 s between writes to one document; wait from the acknowledgement. */
const DOC_WRITE_GAP_MS = 1100
const CONNECT_TIMEOUT_MS = 20_000
const DELTA_COLLECTIONS: DeltaCollection[] = ['orders', 'customers', 'settings']
const SETTING_DOC_ID = /^[a-z0-9_.-]{1,64}$/
const PENDING_STORAGE_PREFIX = 'cafe-oms-demo:pending:'
const LIMIT_MESSAGE = `This demo saves up to ${MAX_DELTA_DOCS} changes per visitor, and you have reached that limit.`

type StoredPendingWrite = Pick<PendingWrite, 'coll' | 'key' | 'delta' | 'changedAt'>

/** Unsent writes from a previous page load; anything malformed is discarded. */
function readStoredPending(uid: string): StoredPendingWrite[] {
  const storageKey = PENDING_STORAGE_PREFIX + uid
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('Malformed pending writes')
    return parsed.filter((entry): entry is StoredPendingWrite =>
      isRecord(entry)
      && DELTA_COLLECTIONS.includes(entry.coll as DeltaCollection)
      && typeof entry.key === 'string'
      && typeof entry.changedAt === 'number'
      && isRecord(entry.delta)
      && (entry.delta.deleted === true || (entry.delta.deleted === false && isRecord(entry.delta.record))))
  } catch {
    try { localStorage.removeItem(storageKey) } catch { /* storage unavailable */ }
    return []
  }
}

function writeStoredPending(uid: string, writes: StoredPendingWrite[]): void {
  try {
    const storageKey = PENDING_STORAGE_PREFIX + uid
    if (writes.length === 0) localStorage.removeItem(storageKey)
    else localStorage.setItem(storageKey, JSON.stringify(writes))
  } catch { /* storage unavailable or full: the in-memory queue still flushes */ }
}

/** Checks a whole order against the rules' limits before anything is queued. */
function validateOrder(order: StoredOrder): void {
  if (order.items.length > MAX_ORDER_ITEMS) throw new Error(`An order can hold at most ${MAX_ORDER_ITEMS} items in the demo.`)
  if (!Number.isInteger(order.totalCentavos) || order.totalCentavos < 0) throw new Error('Order total must be whole, non-negative centavos.')
}

function timestamp(): string { return new Date().toISOString() }
function clone<T>(value: T): T { return structuredClone(value) }
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function toError(reason: unknown, fallback: string): Error {
  return reason instanceof Error ? reason : new Error(fallback)
}

/** Settings documents are keyed by the setting key; ':' is not a valid ID character. */
export function settingDocId(key: string): string {
  const id = key.replace(/:/g, '.')
  if (!SETTING_DOC_ID.test(id)) throw new Error(`Setting key "${key}" cannot be saved in the demo.`)
  return id
}

function keyOf<C extends DeltaCollection>(coll: C, record: DeltaRecord[C]): string {
  return coll === 'settings' ? settingDocId((record as Setting).key) : record.id
}

/** Key-order-independent JSON, so Firestore's map ordering never looks like a change. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function millis(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return value
  if (typeof value === 'string') { const parsed = Date.parse(value); return Number.isNaN(parsed) ? null : parsed }
  if (isRecord(value) && typeof value.toMillis === 'function') return (value.toMillis as () => number)()
  return null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function sortItems(items: StoredOrderItem[]): StoredOrderItem[] {
  return [...items].sort((a, b) => compareIds(a.id, b.id))
}

/**
 * Storage owns paidAt/deliveredAt; client-supplied values on write are discarded
 * (except INSERT coalesce of an already-set value when status requires one).
 * Same rules as LocalAdapter's applyOrderLifecycleTimestamps.
 */
function applyOrderLifecycleTimestamps(
  next: StoredOrder,
  previous: StoredOrder | null,
): Pick<StoredOrder, 'paidAt' | 'deliveredAt'> {
  const now = timestamp()
  if (previous === null) {
    switch (next.status) {
      case 'new':
        return { paidAt: null, deliveredAt: null }
      case 'paid':
        return { paidAt: next.paidAt ?? now, deliveredAt: null }
      case 'delivered':
        return { paidAt: next.paidAt ?? now, deliveredAt: next.deliveredAt ?? now }
      case 'cancelled':
        return { paidAt: next.paidAt, deliveredAt: null }
      default:
        return { paidAt: next.paidAt ?? null, deliveredAt: next.deliveredAt ?? null }
    }
  }

  const enteringPaid = previous.status !== 'paid' && next.status === 'paid'
  const enteringDelivered = previous.status !== 'delivered' && next.status === 'delivered'
  const enteringCancelled = previous.status !== 'cancelled' && next.status === 'cancelled'

  if (enteringPaid) return { paidAt: previous.paidAt ?? now, deliveredAt: null }
  if (enteringDelivered) return { paidAt: previous.paidAt ?? now, deliveredAt: previous.deliveredAt ?? now }
  if (enteringCancelled) return { paidAt: previous.paidAt, deliveredAt: null }
  return { paidAt: previous.paidAt, deliveredAt: previous.deliveredAt }
}

/** Firestore payload (without updatedAt) for a delta. */
function toPayload(coll: DeltaCollection, delta: Delta<DeltaRecord[DeltaCollection]>): DocumentData {
  if (delta.deleted) return { deleted: true }
  switch (coll) {
    case 'orders': {
      const { items, ...order } = delta.record as StoredOrder
      return { deleted: false, order, items, clientTotalCentavos: order.totalCentavos }
    }
    case 'customers':
      return { deleted: false, customer: delta.record }
    case 'settings':
      return { deleted: false, setting: delta.record }
  }
}

/** Parses a delta document; returns null for a malformed one (ignored). */
function fromDocument(coll: DeltaCollection, data: DocumentData): Delta<DeltaRecord[DeltaCollection]> | null {
  if (data.deleted === true) return { deleted: true }
  switch (coll) {
    case 'orders':
      if (!isRecord(data.order) || !Array.isArray(data.items)) return null
      return { deleted: false, record: { ...(data.order as Omit<StoredOrder, 'items'>), items: sortItems(data.items as StoredOrderItem[]) } }
    case 'customers':
      return isRecord(data.customer) ? { deleted: false, record: data.customer as StoredCustomer } : null
    case 'settings':
      return isRecord(data.setting) ? { deleted: false, record: data.setting as Setting } : null
  }
}

function notAvailable(): never {
  throw new Error('Not available in the demo.')
}

/**
 * StorageAdapter over the browser-generated seed plus the visitor's saved
 * changes in Firestore. Reads never wait for the network: the seed renders at
 * once and deltas merge in when sign-in and the first server query finish.
 * Writes wait for `ready`, apply optimistically in memory, then flush to
 * Firestore through a queue that respects the rules' write discipline.
 *
 * One shared instance serves every page (`FirestoreAdapter.instance()`);
 * `close()` therefore keeps it running.
 */
export class FirestoreAdapter implements StorageAdapter {
  private static shared: FirestoreAdapter | null = null

  static instance(): FirestoreAdapter {
    FirestoreAdapter.shared ??= new FirestoreAdapter()
    return FirestoreAdapter.shared
  }

  private uid: string | null = null
  private generation = 0
  private unsubscribers: Unsubscribe[] = []
  private synced = new Set<string>()
  private connectTimer: ReturnType<typeof setTimeout> | undefined

  private readonly server: { [C in DeltaCollection]: Map<string, Delta<DeltaRecord[C]>> } = {
    orders: new Map(), customers: new Map(), settings: new Map(),
  }
  /** Per order: server updatedAt (ms, estimated while pending) and whether a write is unacknowledged. */
  private readonly orderMeta = new Map<string, { updatedAt: number | null; pendingWrite: boolean }>()
  private readonly verifications = new Map<string, Verification>()
  private readonly knownDocs = new Set<string>()
  private profileExists = false
  private profileDocs = 0

  private readonly pending = new Map<string, PendingWrite>()
  private readonly laneFreeAt = new Map<string, number>()
  /** Delta docs whose latest snapshot still carries this tab's unacknowledged writes. */
  private readonly unconfirmed = new Set<string>()
  private writeVersion = 0
  private draining = false
  private drainTimer: ReturnType<typeof setTimeout> | undefined
  private drainAt = Infinity
  private resetting = false
  /** Set when the page is being hidden: flush without the debounce. */
  private urgent = false
  /**
   * Order-item edits in progress, per order. Item operations change this draft
   * only; `updateOrder` (or a short timer) validates and queues the whole order
   * in one step, so a rejected edit never leaves a partial order queued.
   */
  private readonly itemDrafts = new Map<string, { record: StoredOrder; timer: ReturnType<typeof setTimeout> }>()

  private readonly listeners = new Set<(change: StorageChange) => void>()
  private readonly statusListeners = new Set<(status: SyncStatus) => void>()
  private readonly verificationListeners = new Map<string, Set<(state: OrderVerificationState) => void>>()
  private status: SyncStatus = { state: 'connecting' }

  private readyPromise!: Promise<void>
  private resolveReady: () => void = () => undefined
  private rejectReady: (error: Error) => void = () => undefined
  private readySettled = false

  private constructor() {
    this.startConnect()
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => this.flushNow())
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.flushNow() })
    }
  }

  /** Sends queued writes now (page hidden or closing); localStorage still covers a lost flush. */
  private flushNow(): void {
    if (this.resetting) return
    for (const orderId of [...this.itemDrafts.keys()]) this.flushDraft(orderId)
    if (this.pending.size === 0) return
    this.urgent = true
    void this.drain()
  }

  // ---- Sync surface for the UI ------------------------------------------------

  /** Resolves once the visitor's saved changes have loaded from the server; writes wait for it. */
  get ready(): Promise<void> { return this.readyPromise }

  get syncStatus(): SyncStatus { return this.status }

  /** Listens to sync status changes (connecting → ready, or error with a retry). */
  subscribeSyncStatus(listener: (status: SyncStatus) => void): StorageUnsubscribe {
    this.statusListeners.add(listener)
    return () => { this.statusListeners.delete(listener) }
  }

  /** The sync-error event: fires whenever loading, listening or saving fails. */
  onSyncError(listener: (error: Error, kind: 'connect' | 'listen' | 'write') => void): StorageUnsubscribe {
    return this.subscribeSyncStatus((status) => { if (status.state === 'error') listener(status.error, status.kind) })
  }

  /** Retries after a sync error: reconnects if loading failed, then re-sends unsaved changes. */
  retrySync(): void {
    if (!this.readySettled || this.status.state === 'error' && this.status.kind !== 'write') {
      this.startConnect()
    } else {
      this.setStatus({ state: 'ready' })
    }
    for (const write of this.pending.values()) write.failed = false
    this.scheduleDrain(0)
  }

  /** Current verification state of one order. */
  verificationFor(orderId: string): OrderVerificationState {
    const local = this.pending.get(`orders/${orderId}`)
    if (local) return local.delta.deleted ? { status: 'none' } : { status: 'checking', since: local.changedAt }
    const delta = this.server.orders.get(orderId)
    if (!delta || delta.deleted) return { status: 'none' }
    const meta = this.orderMeta.get(orderId)
    const updatedAt = meta?.updatedAt ?? null
    const since = updatedAt ?? Date.now()
    if (meta?.pendingWrite) return { status: 'checking', since }
    const verification = this.verifications.get(orderId)
    if (!verification || verification.orderUpdatedAt === null || (updatedAt !== null && verification.orderUpdatedAt < updatedAt)) {
      return { status: 'checking', since }
    }
    return {
      status: verification.match ? 'verified' : 'mismatch',
      serverTotalCentavos: verification.serverTotalCentavos,
      clientTotalCentavos: verification.clientTotalCentavos,
      verifiedAt: verification.verifiedAt,
    }
  }

  /** Calls `listener` now and whenever the order's verification state may have changed. */
  subscribeVerification(orderId: string, listener: (state: OrderVerificationState) => void): StorageUnsubscribe {
    const set = this.verificationListeners.get(orderId) ?? new Set()
    set.add(listener)
    this.verificationListeners.set(orderId, set)
    listener(this.verificationFor(orderId))
    return () => {
      set.delete(listener)
      if (set.size === 0) this.verificationListeners.delete(orderId)
    }
  }

  /**
   * Deletes every delta document of this visitor (batches of ≤ 500) and drops
   * unsaved changes. The profile and its counter stay; verification documents
   * are removed by the function when their orders are deleted.
   */
  async clearVisitorData(): Promise<void> {
    // Lock first: startup replay and late edits are refused until the reset ends.
    this.resetting = true
    await this.readyPromise.catch(() => undefined)
    for (const draft of this.itemDrafts.values()) clearTimeout(draft.timer)
    this.itemDrafts.clear()
    // Kept aside so a failed reset leaves the visitor's unsent edits queued.
    const unsent = new Map(this.pending)
    this.pending.clear()
    clearTimeout(this.drainTimer)
    this.drainTimer = undefined
    this.drainAt = Infinity
    let cleared = false
    try {
      while (this.draining) await new Promise((resolve) => setTimeout(resolve, 50))
      const uid = await signInVisitor()
      const { db } = getFirebase()
      const profile = doc(db, 'demos', uid)
      const refs = (await Promise.all(DELTA_COLLECTIONS.map((coll) => getDocsFromServer(collection(profile, coll)))))
        .flatMap((snapshot) => snapshot.docs.map((document) => document.ref))
      for (let start = 0; start < refs.length; start += 500) {
        const batch = writeBatch(db)
        for (const ref of refs.slice(start, start + 500)) batch.delete(ref)
        await batch.commit()
      }
      cleared = true
      // Anything queued meanwhile targeted the deleted data: nothing is re-sent.
      this.pending.clear()
      for (const draft of this.itemDrafts.values()) clearTimeout(draft.timer)
      this.itemDrafts.clear()
      writeStoredPending(uid, [])
    } finally {
      this.resetting = false
      if (!cleared) {
        for (const [docKey, write] of unsent) if (!this.pending.has(docKey)) this.pending.set(docKey, write)
        // A reconnect during the reset skipped the replay; catch up now.
        if (this.status.state === 'ready') this.restorePending()
        this.scheduleDrain(0)
      }
    }
  }

  // ---- Connection --------------------------------------------------------------

  private newReadyPromise(): void {
    this.readySettled = false
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    // Callers that never await `ready` must not see an unhandled rejection.
    this.readyPromise.catch(() => undefined)
  }

  private startConnect(): void {
    this.teardown()
    const generation = ++this.generation
    if (this.readySettled || !this.readyPromise) this.newReadyPromise()
    this.setStatus({ state: 'connecting' })
    this.connectTimer = setTimeout(() => {
      if (generation === this.generation && this.status.state === 'connecting') {
        this.fail('connect', new Error('Your saved changes could not be loaded. Check your connection and try again.'))
      }
    }, CONNECT_TIMEOUT_MS)
    void this.connect(generation)
  }

  private teardown(): void {
    clearTimeout(this.connectTimer)
    for (const unsubscribe of this.unsubscribers) unsubscribe()
    this.unsubscribers = []
    this.synced.clear()
    for (const coll of DELTA_COLLECTIONS) this.server[coll].clear()
    this.orderMeta.clear()
    this.verifications.clear()
    this.knownDocs.clear()
  }

  private async connect(generation: number): Promise<void> {
    try {
      const uid = await signInVisitor()
      if (generation !== this.generation) return
      this.uid = uid
      const { db } = getFirebase()
      const profile = doc(db, 'demos', uid)
      const onError = (error: unknown) => {
        if (generation === this.generation) this.fail(this.readySettled ? 'listen' : 'connect', toError(error, 'Sync stopped.'))
      }

      this.unsubscribers.push(onSnapshot(profile, { includeMetadataChanges: true }, (snapshot) => {
        const data = snapshot.data({ serverTimestamps: 'estimate' })
        this.profileExists = snapshot.exists()
        this.profileDocs = typeof data?.docs === 'number' ? data.docs : 0
        if (!snapshot.metadata.fromCache) this.markSynced(generation, 'profile')
      }, onError))

      for (const coll of DELTA_COLLECTIONS) {
        this.unsubscribers.push(onSnapshot(collection(profile, coll), { includeMetadataChanges: true }, (snapshot) => {
          this.applySnapshot(coll, snapshot)
          if (!snapshot.metadata.fromCache) this.markSynced(generation, coll)
        }, onError))
      }

      this.unsubscribers.push(onSnapshot(collection(profile, 'verifications'), (snapshot) => {
        for (const change of snapshot.docChanges()) {
          const id = change.doc.id
          if (change.type === 'removed') this.verifications.delete(id)
          else {
            const data = change.doc.data({ serverTimestamps: 'estimate' })
            this.verifications.set(id, {
              serverTotalCentavos: numberOrNull(data.serverTotalCentavos),
              clientTotalCentavos: numberOrNull(data.clientTotalCentavos),
              match: data.match === true,
              orderUpdatedAt: millis(data.orderUpdatedAt),
              verifiedAt: millis(data.verifiedAt),
            })
          }
          this.notifyVerification(id)
        }
      }, onError))
    } catch (error) {
      if (generation === this.generation) this.fail('connect', toError(error, 'Sign-in failed.'))
    }
  }

  private markSynced(generation: number, name: string): void {
    if (generation !== this.generation) return
    this.synced.add(name)
    if (this.synced.size < DELTA_COLLECTIONS.length + 1) return
    if (this.status.state === 'ready') return
    clearTimeout(this.connectTimer)
    this.restorePending()
    if (this.readySettled) this.newReadyPromise()
    this.readySettled = true
    this.resolveReady()
    this.setStatus({ state: 'ready' })
    this.scheduleDrain(0)
  }

  /** Replays writes a previous page load queued but did not send (once server state is known). */
  private restorePending(): void {
    if (this.uid === null || this.resetting) return
    for (const stored of readStoredPending(this.uid)) {
      const docKey = `${stored.coll}/${stored.key}`
      if (this.pending.has(docKey) || this.serverHas(stored)) continue
      const before = this.recordFor(stored.coll, stored.key)
      this.pending.set(docKey, { ...stored, version: ++this.writeVersion, failed: false })
      this.emitDiff(stored.coll, before, this.recordFor(stored.coll, stored.key))
      if (stored.coll === 'orders') this.notifyVerification(stored.key)
    }
    this.persistPending()
  }

  /** True when the server already holds this write (acknowledged before its mirror entry was removed). */
  private serverHas(stored: StoredPendingWrite): boolean {
    const onServer = this.server[stored.coll].get(stored.key)
    if (!onServer || this.unconfirmed.has(`${stored.coll}/${stored.key}`)) return false
    if (onServer.deleted || stored.delta.deleted) return onServer.deleted && stored.delta.deleted
    const record = stored.coll === 'orders'
      ? { ...(stored.delta.record as StoredOrder), items: sortItems((stored.delta.record as StoredOrder).items) }
      : stored.delta.record
    return stableStringify(record) === stableStringify(onServer.record)
  }

  /** Mirrors the unsent queue to localStorage so a reload cannot lose a saved change. */
  private persistPending(): void {
    if (this.uid === null) return
    writeStoredPending(this.uid, [...this.pending.values()].map(({ coll, key, delta, changedAt }) => ({ coll, key, delta, changedAt })))
  }

  private fail(kind:'connect' | 'listen' | 'write', error: Error): void {
    if (kind === 'connect' && !this.readySettled) {
      this.readySettled = true
      this.rejectReady(error)
    }
    this.setStatus({ state: 'error', kind, error })
  }

  private setStatus(status: SyncStatus): void {
    this.status = status
    for (const listener of this.statusListeners) listener(status)
  }

  private applySnapshot(coll: DeltaCollection, snapshot: QuerySnapshot): void {
    for (const change of snapshot.docChanges({ includeMetadataChanges: true })) {
      const id = change.doc.id
      const before = this.recordFor(coll, id)
      if (change.type === 'removed') {
        this.server[coll].delete(id)
        this.knownDocs.delete(`${coll}/${id}`)
        this.unconfirmed.delete(`${coll}/${id}`)
        if (coll === 'orders') this.orderMeta.delete(id)
      } else {
        const data = change.doc.data({ serverTimestamps: 'estimate' })
        const delta = fromDocument(coll, data)
        this.knownDocs.add(`${coll}/${id}`)
        const docKey = `${coll}/${id}`
        const local = change.doc.metadata.hasPendingWrites
        if (local) this.unconfirmed.add(docKey)
        else this.unconfirmed.delete(docKey)
        // The rules' per-document write gap counts from the server's last write. Only a
        // confirmed timestamp counts (a pending one is a local estimate), and the wait is
        // capped at one gap from now so clock skew cannot stretch it.
        const updatedAt = local ? null : millis(data.updatedAt)
        if (updatedAt !== null) {
          const now = Date.now()
          const serverFree = Math.min(updatedAt + DOC_WRITE_GAP_MS, now + DOC_WRITE_GAP_MS)
          this.laneFreeAt.set(docKey, Math.max(this.laneFreeAt.get(docKey) ?? 0, serverFree))
        }
        if (delta) (this.server[coll] as Map<string, typeof delta>).set(id, delta)
        if (coll === 'orders') this.orderMeta.set(id, { updatedAt: millis(data.updatedAt), pendingWrite: change.doc.metadata.hasPendingWrites })
      }
      this.emitDiff(coll, before, this.recordFor(coll, id))
      if (coll === 'orders') this.notifyVerification(id)
    }
  }

  // ---- Effective state (seed + deltas) -------------------------------------------

  private deltas<C extends DeltaCollection>(coll: C): Map<string, Delta<DeltaRecord[C]>> {
    const merged = new Map(this.server[coll] as Map<string, Delta<DeltaRecord[C]>>)
    for (const write of this.pending.values()) {
      if (write.coll === coll) merged.set(write.key, write.delta as Delta<DeltaRecord[C]>)
    }
    if (coll === 'orders') {
      for (const [orderId, draft] of this.itemDrafts) merged.set(orderId, { deleted: false, record: draft.record as DeltaRecord[C] })
    }
    return merged
  }

  private seedFor<C extends DeltaCollection>(coll: C): readonly DeltaRecord[C][] {
    const seeds: { [K in DeltaCollection]: readonly DeltaRecord[K][] } = { orders: demoOrders, customers: demoCustomers, settings: demoSettings }
    return seeds[coll]
  }

  private records<C extends DeltaCollection>(coll: C): DeltaRecord[C][] {
    return applyDeltas(this.seedFor(coll), this.deltas(coll), (record) => keyOf(coll, record))
  }

  private recordFor<C extends DeltaCollection>(coll: C, key: string): DeltaRecord[C] | null {
    return resolveRecord(this.seedFor(coll), this.deltas(coll), key, (record) => keyOf(coll, record))
  }

  private orders(): StoredOrder[] {
    return this.records('orders').map((order) => ({ ...order, items: sortItems(order.items) }))
  }

  // ---- Change events -------------------------------------------------------------

  private emit<C extends StorageCollection>(collection: C, operation: StorageChange['operation'], entity: StorageEntityByCollection[C]): void {
    const change = { collection, operation, entity } as StorageChange
    for (const listener of this.listeners) listener(clone(change))
  }

  private emitDiff<C extends DeltaCollection>(coll: C, before: DeltaRecord[C] | null, after: DeltaRecord[C] | null): void {
    if (before === null && after === null) return
    if (before !== null && after !== null && stableStringify(before) === stableStringify(after)) return
    const operation = before === null ? 'insert' : after === null ? 'delete' : 'update'
    this.emit(coll, operation, (after ?? before) as StorageEntityByCollection[C])
  }

  private notifyVerification(orderId: string): void {
    const set = this.verificationListeners.get(orderId)
    if (!set || set.size === 0) return
    const state = this.verificationFor(orderId)
    for (const listener of set) listener(state)
  }

  // ---- Write queue ---------------------------------------------------------------

  private async beforeWrite(): Promise<void> {
    if (this.resetting) throw new Error('Your demo data is being reset.')
    await this.readyPromise
  }

  /** Records a delta optimistically and schedules its flush. */
  private stage<C extends DeltaCollection>(coll: C, key: string, delta: Delta<DeltaRecord[C]>): void {
    // An edit that passed beforeWrite before a reset started must not land during it.
    if (this.resetting) throw new Error('Your demo data is being reset.')
    const docKey = `${coll}/${key}`
    if (!delta.deleted && coll === 'orders') validateOrder(delta.record as StoredOrder)
    this.assertCapacity(docKey)
    this.pending.set(docKey, {
      coll, key, delta: clone(delta) as PendingWrite['delta'], version: ++this.writeVersion, changedAt: Date.now(), failed: false,
    })
    // Synchronous, before the save resolves: a reload replays it.
    this.persistPending()
    if (coll === 'orders') this.notifyVerification(key)
    this.scheduleDrain(DEBOUNCE_MS)
  }

  /** Throws when a new delta document would pass the lifetime cap of the visitor's profile. */
  private assertCapacity(docKey: string): void {
    if (this.knownDocs.has(docKey) || this.pending.has(docKey)) return
    let creates = 0
    for (const [pendingKey] of this.pending) if (!this.knownDocs.has(pendingKey)) creates += 1
    if (this.profileDocs + creates >= MAX_DELTA_DOCS) throw new Error(LIMIT_MESSAGE)
  }

  /**
   * Applies an order-item change to the order's draft. The resulting order is
   * validated first; a rejected change discards the whole draft (the order
   * reverts to its last queued state) and nothing is queued.
   */
  private editItems(order: StoredOrder, items: StoredOrderItem[]): void {
    if (this.resetting) throw new Error('Your demo data is being reset.')
    const record: StoredOrder = { ...order, items: sortItems(items) }
    try {
      validateOrder(record)
      this.assertCapacity(`orders/${order.id}`)
    } catch (error) {
      this.discardDraft(order.id)
      throw error
    }
    const existing = this.itemDrafts.get(order.id)
    if (existing) clearTimeout(existing.timer)
    // Edits that never reach updateOrder are queued on their own after the debounce.
    this.itemDrafts.set(order.id, { record, timer: setTimeout(() => this.flushDraft(order.id), DEBOUNCE_MS) })
  }

  private discardDraft(orderId: string): void {
    const draft = this.itemDrafts.get(orderId)
    if (!draft) return
    clearTimeout(draft.timer)
    const before = this.recordFor('orders', orderId)
    this.itemDrafts.delete(orderId)
    this.emitDiff('orders', before, this.recordFor('orders', orderId))
  }

  /** Clears a draft once its order is queued (or deleted). */
  private dropDraft(orderId: string): void {
    const draft = this.itemDrafts.get(orderId)
    if (!draft) return
    clearTimeout(draft.timer)
    this.itemDrafts.delete(orderId)
  }

  private flushDraft(orderId: string): void {
    const draft = this.itemDrafts.get(orderId)
    if (!draft) return
    try {
      this.stage('orders', orderId, { deleted: false, record: draft.record })
      this.dropDraft(orderId)
    } catch (error) {
      this.discardDraft(orderId)
      this.fail('write', toError(error, 'A change could not be saved.'))
    }
  }

  private scheduleDrain(delay: number): void {
    const at = Date.now() + delay
    if (this.drainTimer !== undefined && this.drainAt <= at) return
    clearTimeout(this.drainTimer)
    this.drainAt = at
    this.drainTimer = setTimeout(() => {
      this.drainTimer = undefined
      this.drainAt = Infinity
      void this.drain()
    }, Math.max(0, delay))
  }

  /**
   * Flushes due writes one at a time (each create must see the previous counter).
   * Orders wait while any settings write is pending: the function prices an
   * order with the visitor's saved settings, so those must land first.
   */
  private async drain(): Promise<void> {
    if (this.draining || this.uid === null || this.status.state === 'connecting' || this.resetting) return
    this.draining = true
    try {
      for (;;) {
        const settingsPending = [...this.pending.values()].some((write) => write.coll === 'settings')
        let next: PendingWrite | null = null
        let nextAt = Infinity
        for (const [docKey, write] of this.pending) {
          if (write.failed || (write.coll === 'orders' && settingsPending)) continue
          const laneFree = this.laneFreeAt.get(docKey) ?? 0
          const at = this.urgent ? laneFree : Math.max(write.changedAt + DEBOUNCE_MS, laneFree)
          if (at < nextAt) { nextAt = at; next = write }
        }
        if (!next) {
          if (this.pending.size === 0) this.urgent = false
          return
        }
        const wait = nextAt - Date.now()
        if (wait > 0) { this.scheduleDrain(wait); return }
        await this.commit(next)
      }
    } finally {
      this.draining = false
    }
  }

  private async commit(write: PendingWrite): Promise<void> {
    const docKey = `${write.coll}/${write.key}`
    const { db } = getFirebase()
    const profile = doc(db, 'demos', this.uid as string)
    const batch = writeBatch(db)
    const isCreate = !this.knownDocs.has(docKey)
    batch.set(doc(profile, write.coll, write.key), { ...toPayload(write.coll, write.delta), updatedAt: serverTimestamp() })
    if (isCreate) {
      // `last` names the one delta document this increment counts (rules check it).
      if (this.profileExists) batch.update(profile, { docs: increment(1), last: docKey, updatedAt: serverTimestamp() })
      else batch.set(profile, { createdAt: serverTimestamp(), updatedAt: serverTimestamp(), docs: 1, last: docKey })
    }
    try {
      await batch.commit()
      this.knownDocs.add(docKey)
      if (isCreate) this.profileExists = true
      if (this.pending.get(docKey)?.version === write.version) {
        this.pending.delete(docKey)
        this.persistPending()
      }
    } catch (error) {
      if (this.pending.get(docKey)?.version === write.version) write.failed = true
      this.fail('write', toError(error, 'A change could not be saved.'))
    } finally {
      this.laneFreeAt.set(docKey, Date.now() + DOC_WRITE_GAP_MS)
      if (write.coll === 'orders') this.notifyVerification(write.key)
    }
  }

  // ---- StorageAdapter: products and modifier groups (seed only, read-only) ---------

  listProducts = async (): Promise<StoredProduct[]> => clone([...demoProducts].sort((a, b) => compareIds(a.id, b.id)))
  getProduct = async (id: string): Promise<StoredProduct | null> => clone(demoProducts.find((product) => product.id === id) ?? null)
  createProduct = async (): Promise<StoredProduct> => notAvailable()
  updateProduct = async (): Promise<StoredProduct> => notAvailable()
  deleteProduct = async (): Promise<void> => notAvailable()

  listModifierGroups = async (): Promise<ModifierGroup[]> => clone([...demoModifierGroups].sort((a, b) => compareIds(a.id, b.id)))
  getModifierGroup = async (id: string): Promise<ModifierGroup | null> => clone(demoModifierGroups.find((group) => group.id === id) ?? null)
  createModifierGroup = async (): Promise<ModifierGroup> => notAvailable()
  updateModifierGroup = async (): Promise<ModifierGroup> => notAvailable()
  deleteModifierGroup = async (): Promise<void> => notAvailable()

  // ---- Customers ---------------------------------------------------------------------

  async listCustomers(): Promise<StoredCustomer[]> { return clone(this.records('customers')) }
  async getCustomer(id: string): Promise<StoredCustomer | null> { return clone(this.recordFor('customers', id)) }

  async createCustomer(customer: StoredCustomer): Promise<StoredCustomer> {
    await this.beforeWrite()
    const saved = clone(customer)
    this.stage('customers', saved.id, { deleted: false, record: saved })
    this.emit('customers', 'insert', saved)
    return clone(saved)
  }

  async updateCustomer(id: string, patch: Partial<Omit<StoredCustomer, 'id' | 'createdAt'>>): Promise<StoredCustomer> {
    await this.beforeWrite()
    const current = this.recordFor('customers', id)
    if (!current) throw new Error(`customers record ${id} does not exist.`)
    const next: StoredCustomer = { ...current, ...patch, updatedAt: timestamp() }
    this.stage('customers', id, { deleted: false, record: next })
    this.emit('customers', 'update', next)
    return clone(next)
  }

  async deleteCustomer(id: string): Promise<void> {
    await this.beforeWrite()
    const existing = this.recordFor('customers', id)
    if (!existing) return
    this.stage('customers', id, { deleted: true })
    this.emit('customers', 'delete', existing)
  }

  // ---- Orders (items embedded in the order document) ----------------------------------

  async listOrders(): Promise<StoredOrder[]> { return clone(this.orders()) }

  async getOrder(id: string): Promise<StoredOrder | null> {
    const order = this.recordFor('orders', id)
    return order ? clone({ ...order, items: sortItems(order.items) }) : null
  }

  async createOrder(order: StoredOrder): Promise<StoredOrder> {
    await this.beforeWrite()
    const lifecycle = applyOrderLifecycleTimestamps(order, null)
    const saved: StoredOrder = clone({ ...order, ...lifecycle, items: sortItems(order.items) })
    this.stage('orders', saved.id, { deleted: false, record: saved })
    for (const item of saved.items) this.emit('orderItems', 'insert', item)
    this.emit('orders', 'insert', saved)
    return clone(saved)
  }

  async updateOrder(id: string, patch: Partial<Omit<StoredOrder, 'id' | 'createdAt'>>): Promise<StoredOrder> {
    await this.beforeWrite()
    const current = this.recordFor('orders', id)
    if (!current) throw new Error(`orders record ${id} does not exist.`)
    // Items change only through the order-item methods (LocalAdapter parity);
    // `current` already includes any item draft, so the order, its items and the
    // recalculated total are validated and queued together here.
    const merged: StoredOrder = { ...current, ...patch, items: current.items, updatedAt: timestamp() }
    const next: StoredOrder = { ...merged, ...applyOrderLifecycleTimestamps(merged, current) }
    try {
      this.stage('orders', id, { deleted: false, record: next })
    } catch (error) {
      this.discardDraft(id)
      throw error
    }
    this.dropDraft(id)
    this.emit('orders', 'update', next)
    return clone({ ...next, items: sortItems(next.items) })
  }

  async deleteOrder(id: string): Promise<void> {
    await this.beforeWrite()
    const existing = this.recordFor('orders', id)
    if (!existing) return
    this.stage('orders', id, { deleted: true })
    this.dropDraft(id)
    for (const item of existing.items) this.emit('orderItems', 'delete', item)
    this.emit('orders', 'delete', existing)
  }

  async listOrderItems(orderId?: string): Promise<StoredOrderItem[]> {
    const items = sortItems(this.records('orders').flatMap((order) => order.items))
    return clone(orderId ? items.filter((item) => item.orderId === orderId) : items)
  }

  async getOrderItem(id: string): Promise<StoredOrderItem | null> {
    return (await this.listOrderItems()).find((item) => item.id === id) ?? null
  }

  async createOrderItem(item: StoredOrderItem): Promise<StoredOrderItem> {
    await this.beforeWrite()
    const order = this.recordFor('orders', item.orderId)
    if (!order) throw new Error(`orders record ${item.orderId} does not exist.`)
    const saved = clone(item)
    this.editItems(order, [...order.items.filter((existing) => existing.id !== saved.id), saved])
    this.emit('orderItems', 'insert', saved)
    return clone(saved)
  }

  async updateOrderItem(id: string, patch: Partial<Omit<StoredOrderItem, 'id' | 'createdAt'>>): Promise<StoredOrderItem> {
    await this.beforeWrite()
    const current = await this.getOrderItem(id)
    const order = current ? this.recordFor('orders', current.orderId) : null
    if (!current || !order) throw new Error(`orderItems record ${id} does not exist.`)
    // An item stays inside its order's document.
    const next: StoredOrderItem = { ...current, ...patch, orderId: current.orderId, updatedAt: timestamp() }
    this.editItems(order, order.items.map((item) => item.id === id ? next : item))
    this.emit('orderItems', 'update', next)
    return clone(next)
  }

  async deleteOrderItem(id: string): Promise<void> {
    await this.beforeWrite()
    const current = await this.getOrderItem(id)
    const order = current ? this.recordFor('orders', current.orderId) : null
    if (!current || !order) return
    this.editItems(order, order.items.filter((item) => item.id !== id))
    this.emit('orderItems', 'delete', current)
  }

  // ---- Settings ------------------------------------------------------------------------

  async listSettings(): Promise<Setting[]> { return clone(this.records('settings')) }

  async getSetting(key: string): Promise<Setting | null> {
    return clone(this.records('settings').find((setting) => setting.key === key) ?? null)
  }

  async setSetting(setting: Setting): Promise<Setting> {
    await this.beforeWrite()
    const current = await this.getSetting(setting.key)
    const saved: Setting = clone({ ...setting, id: current?.id ?? setting.id, updatedAt: timestamp() })
    this.stage('settings', settingDocId(saved.key), { deleted: false, record: saved })
    this.emit('settings', current ? 'update' : 'insert', saved)
    return clone(saved)
  }

  async deleteSetting(key: string): Promise<void> {
    await this.beforeWrite()
    const existing = await this.getSetting(key)
    if (!existing) return
    this.stage('settings', settingDocId(key), { deleted: true })
    this.emit('settings', 'delete', existing)
  }

  // ---- Subscription ----------------------------------------------------------------------

  subscribe(listener: (change: StorageChange) => void): StorageUnsubscribe {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** The instance is shared by every page, so closing keeps it (and its listeners' owners) running. */
  async close(): Promise<void> {}
}
