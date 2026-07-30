import { LocalAdapter, resetLocalAdapterMemoryForTests } from '../../../src/data/local-adapter'
import type { StorageAdapter, StoredCustomer, StoredOrder, StoredOrderItem } from '../../../src/data/types'

const createdAt = '2026-07-10T01:00:00.000Z'

const customers: StoredCustomer[] = [
  { id: 'customer-ana', name: 'Ana', phone: '09170000001', createdAt, updatedAt: createdAt },
  { id: 'customer-bea', name: 'Bea', phone: '09170000002', createdAt, updatedAt: createdAt },
  { id: 'customer-cara', name: 'Cara', phone: '09170000003', createdAt, updatedAt: createdAt },
]

function item(id: string, orderId: string, productName: StoredOrderItem['productName'], quantity: number, level: 1 | 2 | 3, powder: 'yumeno' | 'mk_isuzu', unitPriceCentavos: number): StoredOrderItem {
  return {
    id,
    orderId,
    productId: `product-${productName.toLowerCase().replaceAll(' ', '-')}`,
    productName,
    quantity,
    modifiers: { level, powder },
    unitPriceCentavos,
    lineTotalCentavos: unitPriceCentavos * quantity,
    createdAt,
    updatedAt: createdAt,
  }
}

const orders: StoredOrder[] = [
  {
    id: 'order-ana-0712', customerId: 'customer-ana', status: 'delivered', deliveryDate: '2026-07-12', paymentReceived: true,
    items: [item('item-ana-matcha-0712', 'order-ana-0712', 'Matcha Latte', 2, 1, 'yumeno', 20000), item('item-ana-hojicha-0712', 'order-ana-0712', 'Strawberry Hojicha', 1, 2, 'yumeno', 22000)],
    subtotalCentavos: 62000, deliveryFeeCentavos: 0, totalCentavos: 62000, rawSource: 'fixture', addressSnapshot: 'Makati City', notes: null, routePosition: null, paidAt: '2026-07-12T00:30:00.000Z', deliveredAt: '2026-07-12T01:00:00.000Z', createdAt: '2026-07-12T01:00:00.000Z', updatedAt: createdAt,
  },
  {
    id: 'order-ana-0715', customerId: 'customer-ana', status: 'delivered', deliveryDate: '2026-07-15', paymentReceived: true,
    items: [item('item-ana-matcha-0715', 'order-ana-0715', 'Matcha Latte', 1, 2, 'yumeno', 22500)],
    subtotalCentavos: 22500, deliveryFeeCentavos: 0, totalCentavos: 22500, rawSource: 'fixture', addressSnapshot: 'Makati City', notes: null, routePosition: null, paidAt: '2026-07-15T00:30:00.000Z', deliveredAt: '2026-07-15T01:00:00.000Z', createdAt: '2026-07-15T01:00:00.000Z', updatedAt: createdAt,
  },
  {
    id: 'order-bea-0715', customerId: 'customer-bea', status: 'delivered', deliveryDate: '2026-07-15', paymentReceived: true,
    items: [item('item-bea-maple-0715', 'order-bea-0715', 'Salted Maple Matcha', 1, 3, 'mk_isuzu', 33000)],
    subtotalCentavos: 33000, deliveryFeeCentavos: 0, totalCentavos: 33000, rawSource: 'fixture', addressSnapshot: 'Quezon City', notes: null, routePosition: null, paidAt: '2026-07-15T01:00:00.000Z', deliveredAt: '2026-07-15T02:00:00.000Z', createdAt: '2026-07-15T02:00:00.000Z', updatedAt: createdAt,
  },
  {
    id: 'order-cara-0716', customerId: 'customer-cara', status: 'cancelled', deliveryDate: '2026-07-16', paymentReceived: true,
    items: [item('item-cara-hojicha-0716', 'order-cara-0716', 'Hojicha Latte', 2, 1, 'yumeno', 18000)],
    subtotalCentavos: 36000, deliveryFeeCentavos: 0, totalCentavos: 36000, rawSource: 'fixture', addressSnapshot: 'Pasig City', notes: null, routePosition: null, paidAt: '2026-07-16T00:30:00.000Z', deliveredAt: null, createdAt: '2026-07-16T01:00:00.000Z', updatedAt: createdAt,
  },
]

async function clearSeed(adapter: StorageAdapter): Promise<void> {
  await Promise.all((await adapter.listOrders()).map((order) => adapter.deleteOrder(order.id)))
  await Promise.all((await adapter.listCustomers()).map((customer) => adapter.deleteCustomer(customer.id)))
}

export async function createInsightsFixture(): Promise<StorageAdapter> {
  resetLocalAdapterMemoryForTests()
  const adapter = await LocalAdapter.create()
  await clearSeed(adapter)
  for (const customer of customers) await adapter.createCustomer(customer)
  for (const order of orders) await adapter.createOrder(order)
  return adapter
}
