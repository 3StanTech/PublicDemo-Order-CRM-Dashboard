import { getRuntimeCatalog } from '../../domain/catalog'
import type { StoredOrder } from '../../data/types'
import type { ImportDraft } from '../import/types'
import { blankItem } from './order-draft-helpers'
import { normalizeCupNames } from '../import/cup-names'

function id(): string { return crypto.randomUUID() }

function productSlugByName(): Record<string, string> {
  return Object.fromEntries(Object.values(getRuntimeCatalog()).map((product) => [product.name, product.slug]))
}

/**
 * Builds a blank, empty-cart draft for manual order entry. Reuses the same
 * `blankItem` helper the extracted editor uses so a fresh order always opens
 * with one editable drink row, matching the import workflow's starting shape.
 */
export function blankImportDraft(deliveryDate: string | null = null): ImportDraft {
  return {
    id: id(),
    rawSource: 'manual-entry',
    customerName: null,
    matchedCustomerId: null,
    items: [blankItem()],
    thermalBags: [],
    deliveryDate,
    address: null,
    notes: null,
    sourceConfidence: null,
    unresolvedFields: [],
    sameAsLastTime: false,
  }
}

/**
 * Maps a persisted order back into an editable draft for the shared editor.
 *
 * LIMITATION: thermal bags are not individually persisted on a `StoredOrder`
 * — only the aggregate `deliveryFeeCentavos` survives. There is no way to
 * reconstruct how many bags of which size produced that total, so an
 * edited/repeated draft always starts with an EMPTY `thermalBags` list. The
 * owner re-adds bags in the editor if the order still needs them; we
 * intentionally do not fabricate bag entries from the delivery fee.
 */
export function storedOrderToImportDraft(order: StoredOrder, customerName: string | null): ImportDraft {
  const slugByName = productSlugByName()
  return {
    id: id(),
    rawSource: order.rawSource,
    customerName,
    matchedCustomerId: order.customerId,
    items: order.items.map((item) => ({
      id: id(),
      productSlug: slugByName[item.productName] ?? null,
      quantity: item.quantity,
      level: item.modifiers.level,
      powder: item.modifiers.powder,
      ...(item.modifiers.sweetness ? { sweetness: item.modifiers.sweetness } : {}),
      ...(normalizeCupNames(item.modifiers.cupNames).length > 0 ? { cupNames: normalizeCupNames(item.modifiers.cupNames) } : {}),
    })),
    thermalBags: [],
    deliveryDate: order.deliveryDate,
    address: order.addressSnapshot,
    notes: order.notes,
    sourceConfidence: null,
    unresolvedFields: [],
    sameAsLastTime: false,
  }
}
