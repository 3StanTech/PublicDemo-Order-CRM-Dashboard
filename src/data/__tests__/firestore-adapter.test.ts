import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * In-memory stand-in for the Firestore calls the adapter makes. Listeners are
 * fired by the test (`syncFromServer`), so startup timing is under its control.
 */
type Ref = { path: string }
type Op = { type: 'set' | 'update' | 'delete'; path: string }
type Listener = (snapshot: unknown) => void

const fake = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  listeners: new Map<string, Listener>(),
  errorListeners: new Map<string, (error: Error) => void>(),
  commits: [] as Op[][],
  /** Rejects the next commit (a save the server refuses). */
  failNextCommit: false,
}))

vi.mock('../firebase', () => ({
  getFirebase: () => ({ db: { path: '' } }),
  signInVisitor: () => Promise.resolve('visitor-1'),
}))

vi.mock('firebase/firestore', () => {
  const join = (parent: Ref, segments: string[]): Ref => ({ path: [parent.path, ...segments].filter(Boolean).join('/') })
  return {
    doc: (parent: Ref, ...segments: string[]) => join(parent, segments),
    collection: (parent: Ref, ...segments: string[]) => join(parent, segments),
    serverTimestamp: () => ({ serverTimestamp: true }),
    increment: (n: number) => ({ increment: n }),
    onSnapshot: (ref: Ref, ...args: unknown[]) => {
      const [next, error] = args.filter((arg) => typeof arg === 'function')
      fake.listeners.set(ref.path, next as Listener)
      fake.errorListeners.set(ref.path, error as (error: Error) => void)
      return () => { fake.listeners.delete(ref.path); fake.errorListeners.delete(ref.path) }
    },
    getDocsFromServer: async (ref: Ref) => ({
      docs: [...fake.docs.keys()]
        .filter((path) => path.startsWith(`${ref.path}/`) && !path.slice(ref.path.length + 1).includes('/'))
        .map((path) => ({ ref: { path } })),
    }),
    writeBatch: () => {
      const ops: (Op & { data?: Record<string, unknown> })[] = []
      return {
        set: (ref: Ref, data: Record<string, unknown>) => { ops.push({ type: 'set', path: ref.path, data }) },
        update: (ref: Ref, data: Record<string, unknown>) => { ops.push({ type: 'update', path: ref.path, data }) },
        delete: (ref: Ref) => { ops.push({ type: 'delete', path: ref.path }) },
        commit: async () => {
          if (fake.failNextCommit) {
            fake.failNextCommit = false
            throw new Error('PERMISSION_DENIED')
          }
          for (const op of ops) {
            if (op.type === 'delete') fake.docs.delete(op.path)
            else fake.docs.set(op.path, { ...fake.docs.get(op.path), ...op.data })
          }
          fake.commits.push(ops.map(({ type, path }) => ({ type, path })))
        },
      }
    },
  }
})

const uid = 'visitor-1'
const profilePath = `demos/${uid}`
const mirrorKey = `cafe-oms-demo:pending:${uid}`
const createdAt = '2026-07-16T10:00:00.000Z'
const orderId = '70000000-0000-4000-8000-000000000003'
const order = {
  id: orderId, customerId: '70000000-0000-4000-8000-000000000001', status: 'new', items: [], subtotalCentavos: 0,
  deliveryFeeCentavos: 0, totalCentavos: 0, deliveryDate: '2026-07-16', paymentReceived: false, rawSource: 'test',
  addressSnapshot: null, notes: null, routePosition: null, paidAt: null, deliveredAt: null, createdAt, updatedAt: createdAt,
}

function snapshot(docs: { id: string; data: Record<string, unknown> }[], pendingPaths: Set<string>, prefix: string) {
  return {
    metadata: { fromCache: false },
    docs: docs.map(({ id }) => ({ id })),
    docChanges: () => docs.map(({ id, data }) => ({
      type: 'added', doc: { id, data: () => data, metadata: { hasPendingWrites: pendingPaths.has(prefix + id) } },
    })),
  }
}

/**
 * Fires the first server snapshot of every listener from the fake's documents (makes the adapter ready).
 * `pendingPaths` marks documents whose snapshot still carries unacknowledged local writes.
 */
function syncFromServer(pendingPaths = new Set<string>()): void {
  const profile = fake.docs.get(profilePath)
  fake.listeners.get(profilePath)?.({ metadata: { fromCache: false }, exists: () => profile !== undefined, data: () => profile })
  for (const coll of ['orders', 'customers', 'settings', 'verifications']) {
    const prefix = `${profilePath}/${coll}/`
    const docs = [...fake.docs].filter(([path]) => path.startsWith(prefix)).map(([path, data]) => ({ id: path.slice(prefix.length), data }))
    fake.listeners.get(`${profilePath}/${coll}`)?.(snapshot(docs, pendingPaths, prefix))
  }
}

async function freshAdapter() {
  vi.resetModules()
  const { FirestoreAdapter } = await import('../firestore-adapter')
  const adapter = FirestoreAdapter.instance()
  await vi.advanceTimersByTimeAsync(0)
  return adapter
}

const orderWrites = () => fake.commits.flat().filter((op) => op.type !== 'delete' && op.path.includes('/orders/'))

describe('FirestoreAdapter unsent-write replay', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fake.docs.clear()
    fake.listeners.clear()
    fake.errorListeners.clear()
    fake.commits.length = 0
    fake.failNextCommit = false
    // Recent Node versions shadow jsdom's localStorage with an unconfigured one.
    const items = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => { items.set(key, value) },
      removeItem: (key: string) => { items.delete(key) },
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('does not re-send a previous load\'s unsent write after a reset started during startup', async () => {
    fake.docs.set(profilePath, { docs: 1 })
    fake.docs.set(`${profilePath}/customers/c-1`, { deleted: true, updatedAt: 0 })
    localStorage.setItem(mirrorKey, JSON.stringify([{ coll: 'orders', key: orderId, delta: { deleted: false, record: order }, changedAt: 0 }]))
    const adapter = await freshAdapter()

    // The first server snapshots arrive while the reset is already under way.
    const reset = adapter.clearVisitorData()
    syncFromServer()
    await reset
    window.dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(5_000)

    expect(fake.docs.has(`${profilePath}/customers/c-1`)).toBe(false)
    expect(orderWrites()).toEqual([])
    expect(localStorage.getItem(mirrorKey)).toBeNull()
  })

  it('drops a replayed write the server already acknowledged', async () => {
    const { items, ...stored } = order
    fake.docs.set(profilePath, { docs: 1 })
    fake.docs.set(`${profilePath}/orders/${orderId}`, { deleted: false, order: stored, items, clientTotalCentavos: 0, updatedAt: Date.now() })
    localStorage.setItem(mirrorKey, JSON.stringify([{ coll: 'orders', key: orderId, delta: { deleted: false, record: order }, changedAt: Date.now() - 100 }]))
    const adapter = await freshAdapter()

    syncFromServer()
    await adapter.ready
    await vi.advanceTimersByTimeAsync(5_000)

    expect(orderWrites()).toEqual([])
    expect(localStorage.getItem(mirrorKey)).toBeNull()
  })

  it('waits out the write gap from the server\'s last write before replaying a changed record', async () => {
    const { items, ...stored } = order
    fake.docs.set(profilePath, { docs: 1 })
    fake.docs.set(`${profilePath}/orders/${orderId}`, { deleted: false, order: stored, items, clientTotalCentavos: 0, updatedAt: Date.now() })
    const changed = { ...order, notes: 'Leave at the gate' }
    localStorage.setItem(mirrorKey, JSON.stringify([{ coll: 'orders', key: orderId, delta: { deleted: false, record: changed }, changedAt: Date.now() - 1_000 }]))
    const adapter = await freshAdapter()

    syncFromServer()
    await adapter.ready
    await vi.advanceTimersByTimeAsync(500)
    expect(orderWrites()).toEqual([])

    await vi.advanceTimersByTimeAsync(1_000)
    expect(orderWrites()).toEqual([{ type: 'set', path: `${profilePath}/orders/${orderId}` }])
    expect(localStorage.getItem(mirrorKey)).toBeNull()
  })

  it('refuses an edit that was already under way when a reset started', async () => {
    const { items, ...stored } = order
    fake.docs.set(profilePath, { docs: 1 })
    fake.docs.set(`${profilePath}/orders/${orderId}`, { deleted: false, order: stored, items, clientTotalCentavos: 0, updatedAt: Date.now() - 5_000 })
    const adapter = await freshAdapter()
    syncFromServer()
    await adapter.ready

    // The edit passes its ready check, then the reset starts before it is staged.
    const edit = adapter.updateOrder(orderId, { notes: 'Leave at the gate' })
    const reset = adapter.clearVisitorData()
    await expect(edit).rejects.toThrow('being reset')
    await reset
    window.dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(5_000)

    expect(fake.docs.has(`${profilePath}/orders/${orderId}`)).toBe(false)
    expect(orderWrites()).toEqual([])
    expect(localStorage.getItem(mirrorKey)).toBeNull()
  })

  it('keeps a replay entry while the matching snapshot is still an unacknowledged local write', async () => {
    const { items, ...stored } = order
    const path = `${profilePath}/orders/${orderId}`
    fake.docs.set(profilePath, { docs: 1 })
    fake.docs.set(path, { deleted: false, order: stored, items, clientTotalCentavos: 0, updatedAt: Date.now() })
    localStorage.setItem(mirrorKey, JSON.stringify([{ coll: 'orders', key: orderId, delta: { deleted: false, record: order }, changedAt: Date.now() - 100 }]))
    const adapter = await freshAdapter()

    syncFromServer(new Set([path]))
    await adapter.ready

    // Kept, but not sent while the persisted original is still unacknowledged.
    expect(localStorage.getItem(mirrorKey)).toContain(orderId)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(orderWrites()).toEqual([])

    // The original is acknowledged: the matching replay entry is dropped, not re-sent.
    fake.listeners.get(`${profilePath}/orders`)?.({
      metadata: { fromCache: false },
      docChanges: () => [{ type: 'modified', doc: { id: orderId, data: () => fake.docs.get(path), metadata: { hasPendingWrites: false } } }],
    })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(orderWrites()).toEqual([])
    expect(localStorage.getItem(mirrorKey)).toBeNull()
  })

  it('sends a changed replay entry only after the unacknowledged original is confirmed', async () => {
    const { items, ...stored } = order
    const path = `${profilePath}/orders/${orderId}`
    fake.docs.set(profilePath, { docs: 1 })
    fake.docs.set(path, { deleted: false, order: stored, items, clientTotalCentavos: 0, updatedAt: Date.now() })
    const changed = { ...order, notes: 'Leave at the gate' }
    localStorage.setItem(mirrorKey, JSON.stringify([{ coll: 'orders', key: orderId, delta: { deleted: false, record: changed }, changedAt: Date.now() - 1_000 }]))
    const adapter = await freshAdapter()

    syncFromServer(new Set([path]))
    await adapter.ready
    await vi.advanceTimersByTimeAsync(5_000)
    expect(orderWrites()).toEqual([])

    fake.listeners.get(`${profilePath}/orders`)?.({
      metadata: { fromCache: false },
      docChanges: () => [{ type: 'modified', doc: { id: orderId, data: () => ({ ...fake.docs.get(path), updatedAt: Date.now() }), metadata: { hasPendingWrites: false } } }],
    })
    await vi.advanceTimersByTimeAsync(500)
    expect(orderWrites()).toEqual([])
    await vi.advanceTimersByTimeAsync(1_000)
    expect(orderWrites()).toEqual([{ type: 'set', path }])
  })

  it('caps the wait at one write gap when the server timestamp is ahead of the local clock', async () => {
    const { items, ...stored } = order
    const path = `${profilePath}/orders/${orderId}`
    fake.docs.set(profilePath, { docs: 1 })
    fake.docs.set(path, { deleted: false, order: stored, items, clientTotalCentavos: 0, updatedAt: Date.now() + 60_000 })
    const changed = { ...order, notes: 'Leave at the gate' }
    localStorage.setItem(mirrorKey, JSON.stringify([{ coll: 'orders', key: orderId, delta: { deleted: false, record: changed }, changedAt: Date.now() - 1_000 }]))
    const adapter = await freshAdapter()

    syncFromServer()
    await adapter.ready
    await vi.advanceTimersByTimeAsync(2_000)
    expect(orderWrites()).toEqual([{ type: 'set', path }])
  })

  it('sends a deferred replay once its rejected original is removed', async () => {
    const { items, ...stored } = order
    const path = `${profilePath}/orders/${orderId}`
    fake.docs.set(profilePath, { docs: 1 })
    fake.docs.set(path, { deleted: false, order: stored, items, clientTotalCentavos: 0, updatedAt: Date.now() - 5_000 })
    localStorage.setItem(mirrorKey, JSON.stringify([{ coll: 'orders', key: orderId, delta: { deleted: false, record: order }, changedAt: Date.now() - 1_000 }]))
    const adapter = await freshAdapter()

    syncFromServer(new Set([path]))
    await adapter.ready
    await vi.advanceTimersByTimeAsync(5_000)
    expect(orderWrites()).toEqual([])

    // The persisted original create is rejected and rolled back.
    fake.docs.delete(path)
    fake.listeners.get(`${profilePath}/orders`)?.({
      metadata: { fromCache: false },
      docChanges: () => [{ type: 'removed', doc: { id: orderId, data: () => undefined, metadata: { hasPendingWrites: false } } }],
    })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(orderWrites()).toEqual([{ type: 'set', path }])
  })

  it('does not drop a deferred replay on a cache-only confirmation', async () => {
    const path = `${profilePath}/orders/${orderId}`
    fake.docs.set(profilePath, { docs: 1 })
    fake.docs.set(path, { deleted: true, updatedAt: Date.now() - 5_000 })
    localStorage.setItem(mirrorKey, JSON.stringify([{ coll: 'orders', key: orderId, delta: { deleted: true }, changedAt: Date.now() - 1_000 }]))
    const adapter = await freshAdapter()

    syncFromServer(new Set([path]))
    await adapter.ready
    fake.listeners.get(`${profilePath}/orders`)?.({
      metadata: { fromCache: true },
      docChanges: () => [{ type: 'modified', doc: { id: orderId, data: () => fake.docs.get(path), metadata: { hasPendingWrites: false } } }],
    })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(orderWrites()).toEqual([{ type: 'set', path }])
  })

  it('keeps the retry banner for a rejected save until the save is retried', async () => {
    const { items, ...stored } = order
    const path = `${profilePath}/orders/${orderId}`
    fake.docs.set(profilePath, { docs: 1 })
    fake.docs.set(path, { deleted: false, order: stored, items, clientTotalCentavos: 0, updatedAt: Date.now() - 5_000 })
    const adapter = await freshAdapter()
    syncFromServer()
    await adapter.ready

    fake.failNextCommit = true
    await adapter.updateOrder(orderId, { notes: 'Leave at the gate' })
    await vi.advanceTimersByTimeAsync(2_000)
    expect(adapter.syncStatus).toMatchObject({ state: 'error', kind: 'write' })

    // An unrelated server snapshot must not hide the failure.
    fake.listeners.get(`${profilePath}/customers`)?.({
      metadata: { fromCache: false },
      docs: [],
      docChanges: () => [],
    })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(adapter.syncStatus).toMatchObject({ state: 'error', kind: 'write' })
    expect(orderWrites()).toEqual([])

    adapter.retrySync()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(orderWrites()).toEqual([{ type: 'set', path }])
    expect(adapter.syncStatus).toEqual({ state: 'ready' })
  })

  it('emits removals and restored sample records when a reconnect finds them gone', async () => {
    const { demoCustomers } = await import('../../demo/seed')
    const sample = demoCustomers[0]
    const added = { ...sample, id: 'c-added', name: 'Added visitor customer' }
    fake.docs.set(profilePath, { docs: 2 })
    fake.docs.set(`${profilePath}/customers/c-added`, { deleted: false, customer: added, updatedAt: Date.now() - 5_000 })
    fake.docs.set(`${profilePath}/customers/${sample.id}`, { deleted: true, updatedAt: Date.now() - 5_000 })
    const adapter = await freshAdapter()
    syncFromServer()
    await adapter.ready
    expect((await adapter.listCustomers()).map((customer) => customer.id)).toContain('c-added')
    expect((await adapter.listCustomers()).map((customer) => customer.id)).not.toContain(sample.id)

    const changes: { operation: string; id: string }[] = []
    adapter.subscribe((change) => changes.push({ operation: change.operation, id: (change.entity as { id: string }).id }))

    // Listening fails; meanwhile both documents are deleted (e.g. a reset in another tab).
    fake.errorListeners.get(`${profilePath}/customers`)?.(new Error('unavailable'))
    expect(adapter.syncStatus).toMatchObject({ state: 'error', kind: 'listen' })
    fake.docs.delete(`${profilePath}/customers/c-added`)
    fake.docs.delete(`${profilePath}/customers/${sample.id}`)

    adapter.retrySync()
    await vi.advanceTimersByTimeAsync(0)
    // The previous state stays visible until the replacement snapshots load.
    expect((await adapter.listCustomers()).map((customer) => customer.id)).toContain('c-added')
    expect(changes).toEqual([])

    syncFromServer()
    await vi.advanceTimersByTimeAsync(0)
    expect(adapter.syncStatus).toEqual({ state: 'ready' })
    const ids = (await adapter.listCustomers()).map((customer) => customer.id)
    expect(ids).not.toContain('c-added')
    expect(ids).toContain(sample.id)
    expect(changes).toEqual(expect.arrayContaining([
      { operation: 'delete', id: 'c-added' },
      { operation: 'insert', id: sample.id },
    ]))
    expect(changes).toHaveLength(2)
  })
})
