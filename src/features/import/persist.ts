import { getRuntimeCatalog } from '../../domain/catalog'
import { priceOrder } from '../../domain/pricing'
import type { ProductSlug } from '../../domain/contracts'
import type { StorageAdapter, StoredCustomer, StoredOrder, StoredOrderItem, StoredProduct } from '../../data/types'
import type { ImportDraft } from './types'
import { validateDraft } from './parser'
import { withCupNames } from './cup-names'
import { ensureCatalogProducts } from '../../data/ensure-catalog-products'

function id(): string { return crypto.randomUUID() }
function now(): string { return new Date().toISOString() }

export async function confirmImportDraft(adapter: StorageAdapter, draft: ImportDraft): Promise<StoredOrder> {
  const validation = validateDraft(draft)
  if (validation.errors.length > 0 || validation.totalCentavos === null || !draft.customerName) {
    throw new Error(`Cannot confirm an invalid draft: ${validation.errors.join('; ')}`)
  }
  const [customers, productByName] = await Promise.all([adapter.listCustomers(), ensureCatalogProducts(adapter)])
  const matched = draft.matchedCustomerId ? customers.find((customer) => customer.id === draft.matchedCustomerId) : undefined
  const timestamp = now()
  const customer: StoredCustomer = matched
    ? (matched.name === draft.customerName ? matched : await adapter.updateCustomer(matched.id, { name: draft.customerName }))
    : await adapter.createCustomer({ id: id(), name: draft.customerName, phone: null, createdAt: timestamp, updatedAt: timestamp })
  const priced = priceOrder({
    customer: { name: draft.customerName },
    items: draft.items.map((item) => ({ productSlug: item.productSlug! as ProductSlug, quantity: item.quantity!, modifiers: { level: item.level!, powder: item.powder!, ...(item.sweetness ? { sweetness: item.sweetness } : {}) } })),
    thermalBags: draft.thermalBags.map((bag) => ({ coveredCupCount: bag.coveredCupCount! })),
  })
  const orderId = id()
  // `priced.items` is index-aligned with `draft.items`, so cup names are zipped
  // back on here: the pricing engine rebuilds modifiers and would drop them.
  const items: StoredOrderItem[] = priced.items.map((item, index) => {
    const product: StoredProduct | undefined = productByName.get(getRuntimeCatalog()[item.productSlug].name)
    if (!product) throw new Error(`Storage is missing the catalog product ${item.productName}`)
    return {
      id: id(), orderId, productId: product.id, productName: item.productName, quantity: item.quantity,
      modifiers: withCupNames(item.modifiers, draft.items[index]?.cupNames), unitPriceCentavos: item.unitPriceCentavos, lineTotalCentavos: item.lineTotalCentavos,
      createdAt: timestamp, updatedAt: timestamp,
    }
  })
  // StorageAdapter persists the aggregate order and all of its items together (LocalAdapter's createOrder contract).
  return adapter.createOrder({
    id: orderId, customerId: customer.id, status: 'new', items,
    subtotalCentavos: priced.totals.itemsSubtotalCentavos,
    deliveryFeeCentavos: priced.totals.thermalBagsTotalCentavos,
    totalCentavos: priced.totals.totalCentavos,
    deliveryDate: draft.deliveryDate, paymentReceived: false, rawSource: draft.rawSource,
    addressSnapshot: draft.address, notes: draft.notes, routePosition: null,
    paidAt: null, deliveredAt: null,
    createdAt: timestamp, updatedAt: timestamp,
  })
}
