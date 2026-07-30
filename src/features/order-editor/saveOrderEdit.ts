import { getRuntimeCatalog } from '../../domain/catalog'
import { priceOrder } from '../../domain/pricing'
import type { ProductSlug } from '../../domain/contracts'
import type { StorageAdapter, StoredOrder, StoredOrderItem, StoredProduct } from '../../data/types'
import { validateDraft } from '../import/parser'
import { withCupNames } from '../import/cup-names'
import { ensureCatalogProducts } from '../../data/ensure-catalog-products'
import type { ImportDraft } from '../import/types'

function id(): string { return crypto.randomUUID() }
function now(): string { return new Date().toISOString() }

/**
 * Re-prices an edited draft through the pricing engine and persists it onto
 * an existing order.
 *
 * Item reconciliation deliberately goes through the granular order-item ops
 * (delete every existing order_item, then create the newly priced ones)
 * instead of passing a whole new item collection into `updateOrder`'s patch
 * argument. LocalAdapter only merges scalar fields onto the `orders` record,
 * and `listOrders` rebuilds the item collection from the separate
 * `orderItems` store. Patching the item collection through `updateOrder`
 * alone would silently leave stale rows. Going through
 * `listOrderItems`/`deleteOrderItem`/`createOrderItem` keeps storage correct.
 *
 * The order's `id`, `customerId`, `status`, `paymentReceived`, `createdAt`,
 * and `rawSource` are preserved untouched — only pricing-derived and
 * draft-editable scalar fields are updated.
 */
export async function saveOrderEdit(adapter: StorageAdapter, order: StoredOrder, draft: ImportDraft): Promise<StoredOrder> {
  const validation = validateDraft(draft)
  if (validation.errors.length > 0 || validation.totalCentavos === null) {
    throw new Error(`Cannot save an invalid draft: ${validation.errors.join('; ')}`)
  }

  const productByName = await ensureCatalogProducts(adapter)

  const priced = priceOrder({
    items: draft.items.map((item) => ({
      productSlug: item.productSlug! as ProductSlug,
      quantity: item.quantity!,
      modifiers: { level: item.level!, powder: item.powder!, ...(item.sweetness ? { sweetness: item.sweetness } : {}) },
    })),
    thermalBags: draft.thermalBags.map((bag) => ({ coveredCupCount: bag.coveredCupCount! })),
  })

  const timestamp = now()
  const newItems: StoredOrderItem[] = priced.items.map((item, index) => {
    const product: StoredProduct | undefined = productByName.get(getRuntimeCatalog()[item.productSlug].name)
    if (!product) throw new Error(`Storage is missing the catalog product ${item.productName}`)
    return {
      id: id(), orderId: order.id, productId: product.id, productName: item.productName, quantity: item.quantity,
      modifiers: withCupNames(item.modifiers, draft.items[index]?.cupNames), unitPriceCentavos: item.unitPriceCentavos, lineTotalCentavos: item.lineTotalCentavos,
      createdAt: timestamp, updatedAt: timestamp,
    }
  })

  const existingItems = await adapter.listOrderItems(order.id)
  for (const item of existingItems) await adapter.deleteOrderItem(item.id)
  for (const item of newItems) await adapter.createOrderItem(item)

  const updated = await adapter.updateOrder(order.id, {
    subtotalCentavos: priced.totals.itemsSubtotalCentavos,
    deliveryFeeCentavos: priced.totals.thermalBagsTotalCentavos,
    totalCentavos: priced.totals.totalCentavos,
    deliveryDate: draft.deliveryDate,
    addressSnapshot: draft.address,
    notes: draft.notes,
  })

  return { ...updated, items: newItems }
}
