import { describe, expect, it, beforeEach } from 'vitest'
import { createStorageAdapter } from '../adapter'
import { LocalAdapter, resetLocalAdapterMemoryForTests } from '../local-adapter'
import type { StoredCustomer, StoredOrder, StoredOrderItem } from '../types'

const createdAt = '2026-07-16T10:00:00.000Z'
const customer: StoredCustomer = { id: '70000000-0000-4000-8000-000000000001', name: 'Test Customer', phone: '09170000000', createdAt, updatedAt: createdAt }
const item: StoredOrderItem = { id: '70000000-0000-4000-8000-000000000002', orderId: '70000000-0000-4000-8000-000000000003', productId: '10000000-0000-4000-8000-000000000001', productName: 'Matcha Latte', quantity: 1, modifiers: { level: 1, powder: 'yumeno', sweetness: 'regular' }, unitPriceCentavos: 20000, lineTotalCentavos: 20000, createdAt, updatedAt: createdAt }
const order: StoredOrder = { id: item.orderId, customerId: customer.id, status: 'new', items: [item], subtotalCentavos: 20000, deliveryFeeCentavos: 2500, totalCentavos: 22500, deliveryDate: '2026-07-16', paymentReceived: false, rawSource: 'test', addressSnapshot: null, notes: null, routePosition: null, paidAt: null, deliveredAt: null, createdAt, updatedAt: createdAt }

describe('LocalAdapter', () => {
  beforeEach(() => resetLocalAdapterMemoryForTests())

  it('always resolves createStorageAdapter to a LocalAdapter instance', async () => {
    const adapter = await createStorageAdapter()
    expect(adapter).toBeInstanceOf(LocalAdapter)
    expect(await adapter.listProducts()).toHaveLength(6)
    expect(await adapter.listCustomers()).not.toHaveLength(0)
    expect(await adapter.listOrders()).not.toHaveLength(0)
    await adapter.close()
  })

  it('persists customer, order, items, and settings across adapter recreation', async () => {
    const first = await LocalAdapter.create()
    await first.createCustomer(customer)
    await first.createOrder(order)
    await first.setSetting({ id: '70000000-0000-4000-8000-000000000004', key: 'dispatch_cutoff', value: '17:00', createdAt, updatedAt: createdAt })
    await first.close()

    const second = await LocalAdapter.create()
    expect(await second.getCustomer(customer.id)).toMatchObject({ name: 'Test Customer' })
    expect(await second.getOrder(order.id)).toMatchObject({ totalCentavos: 22500, items: [{ id: item.id }] })
    expect(await second.getOrderItem(item.id)).toMatchObject({ lineTotalCentavos: 20000 })
    expect(await second.getSetting('dispatch_cutoff')).toMatchObject({ value: '17:00' })
    await second.updateOrder(order.id, { status: 'paid', paymentReceived: true })
    await second.updateOrderItem(item.id, { quantity: 2, lineTotalCentavos: 40000 })
    await second.setSetting({ id: 'ignored-on-update', key: 'dispatch_cutoff', value: '18:00', createdAt, updatedAt: createdAt })
    expect(await second.getOrder(order.id)).toMatchObject({ status: 'paid', paymentReceived: true })
    expect(await second.getOrderItem(item.id)).toMatchObject({ quantity: 2 })
    expect(await second.getSetting('dispatch_cutoff')).toMatchObject({ value: '18:00' })
    await second.deleteSetting('dispatch_cutoff')
    expect(await second.getSetting('dispatch_cutoff')).toBeNull()
    await second.deleteOrder(order.id)
    expect(await second.getOrderItem(item.id)).toBeNull()
    await second.deleteCustomer(customer.id)
    expect(await second.getCustomer(customer.id)).toBeNull()
    await second.close()
  })

  it('emits typed changes and stops after unsubscribe', async () => {
    const adapter = await LocalAdapter.create()
    const changes: string[] = []
    const unsubscribe = adapter.subscribe((change) => changes.push(`${change.collection}:${change.operation}`))
    await adapter.createCustomer(customer)
    await adapter.updateCustomer(customer.id, { name: 'Updated Customer' })
    unsubscribe()
    await adapter.deleteCustomer(customer.id)
    expect(changes).toEqual(['customers:insert', 'customers:update'])
    await adapter.close()
  })
})
