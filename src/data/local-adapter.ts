import { openDB, type IDBPDatabase } from 'idb'
import { demoCustomers, demoModifierGroups, demoOrderItems, demoOrders, demoProducts, demoSettings } from '../demo/seed'
import type { ModifierGroup, Setting, StorageAdapter, StorageChange, StorageCollection, StorageEntityByCollection, StorageUnsubscribe, StoredCustomer, StoredOrder, StoredOrderItem, StoredProduct } from './types'

type LocalRecord = StoredProduct | ModifierGroup | StoredCustomer | StoredOrder | StoredOrderItem | Setting
type StoreName = StorageCollection

/** IndexedDB database name — also used by demo reset. */
export const LOCAL_DATABASE_NAME = 'gelly-order-dashboard'
const stores: StoreName[] = ['products', 'modifierGroups', 'customers', 'orders', 'orderItems', 'settings']
const memoryStores = new Map<StoreName, Map<string, LocalRecord>>()

function timestamp(): string { return new Date().toISOString() }
function clone<T>(value: T): T { return structuredClone(value) }
function collectionForStore(store: StoreName): StoreName { return store }

/**
 * Storage owns paidAt/deliveredAt; client-supplied values on write are discarded
 * (except INSERT coalesce of an already-set value when status requires one).
 */
function applyOrderLifecycleTimestamps(
  next: StoredOrder,
  previous: StoredOrder | null,
): Pick<StoredOrder, 'paidAt' | 'deliveredAt'> {
  const now = timestamp()
  if (previous === null) {
    // INSERT rules
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
        // LocalAdapter is permissive for invalid statuses (parity divergence vs Postgres).
        return { paidAt: next.paidAt ?? null, deliveredAt: next.deliveredAt ?? null }
    }
  }

  // UPDATE rules — columns are trigger-owned; client-supplied values discarded
  const enteringPaid = previous.status !== 'paid' && next.status === 'paid'
  const enteringDelivered = previous.status !== 'delivered' && next.status === 'delivered'
  const enteringCancelled = previous.status !== 'cancelled' && next.status === 'cancelled'

  if (enteringPaid) {
    return { paidAt: previous.paidAt ?? now, deliveredAt: null }
  }
  if (enteringDelivered) {
    return { paidAt: previous.paidAt ?? now, deliveredAt: previous.deliveredAt ?? now }
  }
  if (enteringCancelled) {
    return { paidAt: previous.paidAt, deliveredAt: null }
  }
  // any other update — preserve old values (ignore client patch of paidAt/deliveredAt)
  return { paidAt: previous.paidAt, deliveredAt: previous.deliveredAt }
}

export class LocalAdapter implements StorageAdapter {
  private readonly database: IDBPDatabase | null
  private readonly channel: BroadcastChannel | null

  private constructor(database: IDBPDatabase | null, channel: BroadcastChannel | null) {
    this.database = database
    this.channel = channel
    this.channel?.addEventListener('message', this.receiveBroadcast)
  }

  static async create(): Promise<LocalAdapter> {
    const database = typeof indexedDB === 'undefined' ? null : await openDB(LOCAL_DATABASE_NAME, 1, {
      upgrade(db) { for (const store of stores) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'id' }) },
    })
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(LOCAL_DATABASE_NAME)
    const adapter = new LocalAdapter(database, channel)
    await adapter.seedIfEmpty()
    return adapter
  }

  private readonly listeners = new Set<(change: StorageChange) => void>()
  private closed = false

  private receiveBroadcast = (event: MessageEvent<StorageChange>): void => {
    if (!this.closed && event.data?.collection && event.data.entity) this.notify(event.data)
  }

  private async seedIfEmpty(): Promise<void> {
    if ((await this.listProducts()).length > 0) return
    for (const product of demoProducts) await this.put('products', product, false)
    for (const group of demoModifierGroups) await this.put('modifierGroups', group, false)
    for (const customer of demoCustomers) await this.put('customers', customer, false)
    for (const item of demoOrderItems) await this.put('orderItems', item, false)
    for (const order of demoOrders) await this.put('orders', order, false)
    for (const setting of demoSettings) await this.put('settings', setting, false)
  }

  private async values<C extends StoreName>(store: C): Promise<StorageEntityByCollection[C][]> {
    if (this.database) return (await this.database.getAll(store)).map(clone) as StorageEntityByCollection[C][]
    const entries = memoryStores.get(store) ?? new Map<string, LocalRecord>()
    memoryStores.set(store, entries)
    return [...entries.values()].map(clone) as StorageEntityByCollection[C][]
  }

  private async get<C extends StoreName>(store: C, id: string): Promise<StorageEntityByCollection[C] | null> {
    const value = this.database ? await this.database.get(store, id) : memoryStores.get(store)?.get(id)
    return value ? clone(value) as StorageEntityByCollection[C] : null
  }

  private async put<C extends StoreName>(store: C, entity: StorageEntityByCollection[C], announce = true, operation: 'insert' | 'update' = 'insert'): Promise<StorageEntityByCollection[C]> {
    const saved = clone(entity)
    if (this.database) await this.database.put(store, saved)
    else {
      const entries = memoryStores.get(store) ?? new Map<string, LocalRecord>()
      entries.set(saved.id, saved)
      memoryStores.set(store, entries)
    }
    if (announce) this.emit({ collection: collectionForStore(store), operation, entity: saved })
    return clone(saved)
  }

  private async remove<C extends StoreName>(store: C, id: string): Promise<StorageEntityByCollection[C] | null> {
    const existing = await this.get(store, id)
    if (!existing) return null
    if (this.database) await this.database.delete(store, id)
    else memoryStores.get(store)?.delete(id)
    this.emit({ collection: collectionForStore(store), operation: 'delete', entity: existing })
    return existing
  }

  private emit(change: StorageChange): void {
    if (this.closed) return
    this.notify(change)
    this.channel?.postMessage(change)
  }

  private notify(change: StorageChange): void { for (const listener of this.listeners) listener(clone(change)) }
  private async update<C extends StoreName>(store: C, id: string, patch: Partial<Omit<StorageEntityByCollection[C], 'id' | 'createdAt'>>): Promise<StorageEntityByCollection[C]> {
    const current = await this.get(store, id)
    if (!current) throw new Error(`${store} record ${id} does not exist.`)
    const next = { ...current, ...patch, updatedAt: timestamp() } as StorageEntityByCollection[C]
    return this.put(store, next, true, 'update')
  }

  listProducts = (): Promise<StoredProduct[]> => this.values('products')
  getProduct = (id: string): Promise<StoredProduct | null> => this.get('products', id)
  createProduct = (entity: StoredProduct): Promise<StoredProduct> => this.put('products', entity)
  updateProduct = (id: string, patch: Partial<Omit<StoredProduct, 'id' | 'createdAt'>>): Promise<StoredProduct> => this.update('products', id, patch)
  deleteProduct = async (id: string): Promise<void> => { await this.remove('products', id) }

  listModifierGroups = (): Promise<ModifierGroup[]> => this.values('modifierGroups')
  getModifierGroup = (id: string): Promise<ModifierGroup | null> => this.get('modifierGroups', id)
  createModifierGroup = (entity: ModifierGroup): Promise<ModifierGroup> => this.put('modifierGroups', entity)
  updateModifierGroup = (id: string, patch: Partial<Omit<ModifierGroup, 'id' | 'createdAt'>>): Promise<ModifierGroup> => this.update('modifierGroups', id, patch)
  deleteModifierGroup = async (id: string): Promise<void> => { await this.remove('modifierGroups', id) }

  listCustomers = (): Promise<StoredCustomer[]> => this.values('customers')
  getCustomer = (id: string): Promise<StoredCustomer | null> => this.get('customers', id)
  createCustomer = (entity: StoredCustomer): Promise<StoredCustomer> => this.put('customers', entity)
  updateCustomer = (id: string, patch: Partial<Omit<StoredCustomer, 'id' | 'createdAt'>>): Promise<StoredCustomer> => this.update('customers', id, patch)
  deleteCustomer = async (id: string): Promise<void> => { await this.remove('customers', id) }

  async listOrders(): Promise<StoredOrder[]> {
    const [orders, items] = await Promise.all([this.values('orders'), this.values('orderItems')])
    return orders.map((order) => ({ ...order, items: items.filter((item) => item.orderId === order.id) }))
  }
  async getOrder(id: string): Promise<StoredOrder | null> {
    const order = await this.get('orders', id)
    if (!order) return null
    return { ...order, items: await this.listOrderItems(id) }
  }
  async createOrder(order: StoredOrder): Promise<StoredOrder> {
    for (const item of order.items) await this.put('orderItems', item)
    const lifecycle = applyOrderLifecycleTimestamps(order, null)
    return this.put('orders', { ...order, ...lifecycle })
  }
  async updateOrder(id: string, patch: Partial<Omit<StoredOrder, 'id' | 'createdAt'>>): Promise<StoredOrder> {
    const current = await this.get('orders', id)
    if (!current) throw new Error(`orders record ${id} does not exist.`)
    const merged = { ...current, ...patch, updatedAt: timestamp() } as StoredOrder
    const lifecycle = applyOrderLifecycleTimestamps(merged, current)
    return this.put('orders', { ...merged, ...lifecycle }, true, 'update')
  }
  async deleteOrder(id: string): Promise<void> {
    for (const item of await this.listOrderItems(id)) await this.remove('orderItems', item.id)
    await this.remove('orders', id)
  }

  async listOrderItems(orderId?: string): Promise<StoredOrderItem[]> {
    const items = await this.values('orderItems')
    return orderId ? items.filter((item) => item.orderId === orderId) : items
  }
  getOrderItem = (id: string): Promise<StoredOrderItem | null> => this.get('orderItems', id)
  createOrderItem = (entity: StoredOrderItem): Promise<StoredOrderItem> => this.put('orderItems', entity)
  updateOrderItem = (id: string, patch: Partial<Omit<StoredOrderItem, 'id' | 'createdAt'>>): Promise<StoredOrderItem> => this.update('orderItems', id, patch)
  deleteOrderItem = async (id: string): Promise<void> => { await this.remove('orderItems', id) }

  listSettings = (): Promise<Setting[]> => this.values('settings')
  async getSetting(key: string): Promise<Setting | null> { return (await this.listSettings()).find((setting) => setting.key === key) ?? null }
  async setSetting(setting: Setting): Promise<Setting> {
    const current = await this.getSetting(setting.key)
    return this.put('settings', { ...setting, id: current?.id ?? setting.id, updatedAt: timestamp() }, true, current ? 'update' : 'insert')
  }
  async deleteSetting(key: string): Promise<void> { const setting = await this.getSetting(key); if (setting) await this.remove('settings', setting.id) }

  subscribe(listener: (change: StorageChange) => void): StorageUnsubscribe {
    if (this.closed) throw new Error('Storage adapter is closed.')
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.listeners.clear()
    this.channel?.removeEventListener('message', this.receiveBroadcast)
    this.channel?.close()
    this.database?.close()
  }
}

export function resetLocalAdapterMemoryForTests(): void { memoryStores.clear() }
