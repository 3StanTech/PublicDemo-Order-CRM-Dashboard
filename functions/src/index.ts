import { initializeApp } from 'firebase-admin/app'
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore'
import { setGlobalOptions } from 'firebase-functions/v2'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import * as logger from 'firebase-functions/logger'
import { PRODUCT_CATALOG, setRuntimeCatalogSettings } from '../../src/domain/catalog.ts'
import type { OrderItemDraft, ProductSlug, ThermalBagDraft } from '../../src/domain/contracts.ts'
import { priceOrder } from '../../src/domain/pricing.ts'
import { PricingError } from '../../src/domain/pricing-error.ts'
import {
  ORDER_DASHBOARD_SETTINGS_KEY,
  parseDashboardSettings,
  type DashboardSettings,
} from '../../src/features/settings/settings-store.ts'

setGlobalOptions({ region: 'asia-southeast1', maxInstances: 1 })

initializeApp()
const db = getFirestore()

/** Largest thermal-bag fee the Function will try to explain (₱10,000). */
const MAX_BAG_FEE_CENTAVOS = 1_000_000

const slugByProductName: ReadonlyMap<string, ProductSlug> = new Map(
  Object.values(PRODUCT_CATALOG).map((product) => [product.name, product.slug]),
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function centavosOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

/** Rebuilds the engine input for one stored order item, as the order editor does. */
function toItemDraft(item: unknown): OrderItemDraft {
  if (!isRecord(item) || !isRecord(item.modifiers)) {
    throw new PricingError('UNKNOWN_PRODUCT', 'Order item must be an object with modifiers')
  }
  const slug = typeof item.productName === 'string' ? slugByProductName.get(item.productName) : undefined
  if (!slug) throw new PricingError('UNKNOWN_PRODUCT', 'Order item names an unknown product')
  const { level, powder, sweetness } = item.modifiers
  return {
    productSlug: slug,
    quantity: item.quantity as number,
    modifiers: {
      level: level as OrderItemDraft['modifiers']['level'],
      powder: powder as OrderItemDraft['modifiers']['powder'],
      ...(sweetness === undefined ? {} : { sweetness: sweetness as OrderItemDraft['modifiers']['sweetness'] }),
    },
  }
}

/**
 * Stored orders keep only the aggregate thermal-bag fee (`deliveryFeeCentavos`),
 * not the bags themselves. Find the bag set covering the fewest cups that adds
 * up to that fee at the visitor's current prices; the engine then prices those
 * bags and checks they cover no more cups than the order holds. A fee no bag
 * set can explain prices as no bags, so the totals disagree.
 */
function bagsForFee(fee: number | null, prices: DashboardSettings['thermalBagPrices']): ThermalBagDraft[] {
  if (fee === null || fee === 0 || fee > MAX_BAG_FEE_CENTAVOS) return []
  const sizes = [1, 2, 3, 4] as const
  const fewestCups = new Array<number>(fee + 1).fill(Number.POSITIVE_INFINITY)
  const lastBag = new Array<number>(fee + 1).fill(0)
  fewestCups[0] = 0
  for (let amount = 1; amount <= fee; amount += 1) {
    for (const size of sizes) {
      const price = prices[size]
      if (price > 0 && price <= amount && fewestCups[amount - price] + size < fewestCups[amount]) {
        fewestCups[amount] = fewestCups[amount - price] + size
        lastBag[amount] = size
      }
    }
  }
  if (!Number.isFinite(fewestCups[fee])) return []
  const bags: ThermalBagDraft[] = []
  for (let amount = fee; amount > 0; amount -= prices[lastBag[amount] as 1 | 2 | 3 | 4]) {
    bags.push({ coveredCupCount: lastBag[amount] })
  }
  return bags
}

/**
 * Prices synchronously under the visitor's catalog. The engine reads a
 * module-level runtime catalog, so set, price and reset happen with no await in
 * between; concurrent runs on the same instance cannot interleave here.
 */
function serverTotal(order: Record<string, unknown>, items: unknown, settings: DashboardSettings): number | null {
  setRuntimeCatalogSettings(settings)
  try {
    if (!Array.isArray(items)) throw new PricingError('UNKNOWN_PRODUCT', 'Order must include an items array')
    const thermalBags = bagsForFee(centavosOrNull(order.deliveryFeeCentavos), settings.thermalBagPrices)
    return priceOrder({ items: items.map(toItemDraft), thermalBags }).totals.totalCentavos
  } catch (error) {
    if (error instanceof PricingError) return null
    throw error
  } finally {
    setRuntimeCatalogSettings(null)
  }
}

function sameTimestamp(a: unknown, b: Timestamp | null): boolean {
  return a instanceof Timestamp && b ? a.isEqual(b) : a === b
}

/**
 * Events can arrive late or out of order. Inside one transaction the Function
 * re-reads the order as it is now and acts only when this event still describes
 * it: an older write never overwrites a newer verification, and a stale delete
 * never clears the verification of a recreated order.
 */
export const verifyOrderTotal = onDocumentWritten(
  { document: 'demos/{uid}/orders/{orderId}', memory: '256MiB', timeoutSeconds: 10 },
  async (event) => {
    const { uid, orderId } = event.params
    const orderRef = db.doc(`demos/${uid}/orders/${orderId}`)
    const verificationRef = db.doc(`demos/${uid}/verifications/${orderId}`)
    const settingRef = db.doc(`demos/${uid}/settings/${ORDER_DASHBOARD_SETTINGS_KEY}`)
    const after = event.data?.after
    const data = after?.exists ? after.data() : undefined
    const removed = !data || data.deleted === true

    const outcome = await db.runTransaction(async (tx) => {
      const [currentDoc, existing, settingDoc] = await Promise.all([
        tx.get(orderRef),
        tx.get(verificationRef),
        removed ? Promise.resolve(undefined) : tx.get(settingRef),
      ])
      const current = currentDoc.data()
      const currentLive = current !== undefined && current.deleted !== true

      if (removed) {
        if (currentLive) return 'stale'
        if (!existing.exists) return 'nothing-to-clear'
        tx.delete(verificationRef)
        return 'cleared'
      }

      const orderUpdatedAt = data.updatedAt instanceof Timestamp ? data.updatedAt : null
      if (!currentLive || !sameTimestamp(current.updatedAt, orderUpdatedAt)) return 'stale'

      const settingData = settingDoc?.data()
      const storedValue =
        settingData && settingData.deleted !== true && isRecord(settingData.setting) ? settingData.setting.value : undefined
      const settings = parseDashboardSettings(storedValue)

      const order = isRecord(data.order) ? data.order : {}
      const serverTotalCentavos = serverTotal(order, data.items, settings)
      const clientTotalCentavos = centavosOrNull(data.clientTotalCentavos)
      // The app displays order.totalCentavos, so it must agree too.
      const match =
        serverTotalCentavos !== null &&
        serverTotalCentavos === clientTotalCentavos &&
        serverTotalCentavos === centavosOrNull(order.totalCentavos)

      const previous = existing.data()
      const unchanged =
        previous !== undefined &&
        previous.serverTotalCentavos === serverTotalCentavos &&
        previous.clientTotalCentavos === clientTotalCentavos &&
        previous.match === match &&
        sameTimestamp(previous.orderUpdatedAt, orderUpdatedAt)
      if (unchanged) return 'unchanged'

      tx.set(verificationRef, {
        serverTotalCentavos,
        clientTotalCentavos,
        match,
        orderUpdatedAt,
        verifiedAt: FieldValue.serverTimestamp(),
      })
      return match ? 'match' : 'mismatch'
    })

    logger.info('verifyOrderTotal', { uid, orderId, outcome })
  },
)
