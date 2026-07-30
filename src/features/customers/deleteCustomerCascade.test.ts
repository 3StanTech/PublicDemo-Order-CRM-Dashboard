import { describe, expect, it } from 'vitest'
import { LocalAdapter, resetLocalAdapterMemoryForTests } from '../../data/local-adapter'
import type { StorageAdapter, StoredOrder } from '../../data/types'
import { demoCustomers, demoOrders } from '../../demo/seed'
import { deleteCustomerCascade } from './deleteCustomerCascade'

/** Wraps an adapter to record the sequence of deleteOrder/deleteCustomer calls, without changing behavior. */
function withCallLog(adapter: StorageAdapter, log: string[]): StorageAdapter {
  return new Proxy(adapter, {
    get(target, property, receiver) {
      if (property === 'deleteOrder') {
        return async (id: string) => { log.push(`deleteOrder:${id}`); return target.deleteOrder(id) }
      }
      if (property === 'deleteCustomer') {
        return async (id: string) => { log.push(`deleteCustomer:${id}`); return target.deleteCustomer(id) }
      }
      return Reflect.get(target, property, receiver)
    },
  })
}

describe('deleteCustomerCascade', () => {
  it('deletes every order belonging to the customer before deleting the customer row (FK-safety)', async () => {
    resetLocalAdapterMemoryForTests()
    const adapter = await LocalAdapter.create()
    const customerId = demoCustomers[0].id
    const customerOrderIds = demoOrders.filter((order) => order.customerId === customerId).map((order) => order.id)
    expect(customerOrderIds.length).toBeGreaterThan(0)

    const log: string[] = []
    await deleteCustomerCascade(withCallLog(adapter, log), customerId)

    const deleteCustomerIndex = log.indexOf(`deleteCustomer:${customerId}`)
    expect(deleteCustomerIndex).toBeGreaterThan(-1)
    for (const orderId of customerOrderIds) {
      const deleteOrderIndex = log.indexOf(`deleteOrder:${orderId}`)
      expect(deleteOrderIndex).toBeGreaterThan(-1)
      expect(deleteOrderIndex).toBeLessThan(deleteCustomerIndex)
    }

    await adapter.close()
  })

  it('leaves no orphan orders, order_items, or customer row after deletion', async () => {
    resetLocalAdapterMemoryForTests()
    const adapter = await LocalAdapter.create()
    const customerId = demoCustomers[0].id
    const customerOrderIds = demoOrders.filter((order) => order.customerId === customerId).map((order) => order.id)

    await deleteCustomerCascade(adapter, customerId)

    expect(await adapter.getCustomer(customerId)).toBeNull()
    const remainingOrders = await adapter.listOrders()
    expect(remainingOrders.some((order: StoredOrder) => order.customerId === customerId)).toBe(false)
    const remainingItems = await adapter.listOrderItems()
    for (const orderId of customerOrderIds) {
      expect(remainingItems.some((item) => item.orderId === orderId)).toBe(false)
    }
    // Other customers and their orders are untouched.
    expect(await adapter.getCustomer(demoCustomers[1].id)).not.toBeNull()

    await adapter.close()
  })

  it('deletes a customer with no orders without error', async () => {
    resetLocalAdapterMemoryForTests()
    const adapter = await LocalAdapter.create()
    const createdAt = new Date().toISOString()
    const emptyCustomer = await adapter.createCustomer({
      id: '70000000-0000-4000-8000-000000000099',
      name: 'Empty Test Customer',
      phone: null,
      createdAt,
      updatedAt: createdAt,
    })
    expect(demoOrders.some((order) => order.customerId === emptyCustomer.id)).toBe(false)
    expect((await adapter.listOrders()).some((order) => order.customerId === emptyCustomer.id)).toBe(false)

    await expect(deleteCustomerCascade(adapter, emptyCustomer.id)).resolves.toBeUndefined()
    expect(await adapter.getCustomer(emptyCustomer.id)).toBeNull()

    await adapter.close()
  })
})
