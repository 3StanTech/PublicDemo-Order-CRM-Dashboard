import type { StorageAdapter } from '../../data/types'

/**
 * Deletes a customer safely with LocalAdapter storage.
 *
 * Orders reference customers by id with no automatic cascade on the
 * customer side. This helper deletes the customer's orders first —
 * `adapter.deleteOrder` already removes each order's items — and only then
 * deletes the customer row.
 */
export async function deleteCustomerCascade(adapter: StorageAdapter, customerId: string): Promise<void> {
  const orders = await adapter.listOrders()
  const customerOrders = orders.filter((order) => order.customerId === customerId)
  for (const order of customerOrders) await adapter.deleteOrder(order.id)
  await adapter.deleteCustomer(customerId)
}
