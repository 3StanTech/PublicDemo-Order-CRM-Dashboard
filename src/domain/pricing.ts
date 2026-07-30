import {
  getRuntimeCatalog,
  getRuntimeLevelUpcharges,
  getRuntimePowderUpcharges,
  getRuntimeThermalBagPrices,
} from './catalog'
import type {
  DrinkModifiers,
  MoneyCentavos,
  OrderDraft,
  PricedOrderItem,
  OrderItemDraft,
  OrderTotals,
  Powder,
  PricedOrder,
  MenuProduct,
  ProductSlug,
  ThermalBag,
  ThermalBagDraft,
} from './contracts'
import { assertMoneyCentavos } from './money'
import { PricingError } from './pricing-error'

function fail(code: PricingError['code'], message: string): never {
  throw new PricingError(code, message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function addCentavos(...amounts: readonly MoneyCentavos[]): MoneyCentavos {
  const total = amounts.reduce((sum, amount) => sum + amount, 0)
  assertMoneyCentavos(total, 'computed money')
  return total
}

function multiplyCentavos(unitPrice: MoneyCentavos, quantity: number): MoneyCentavos {
  const total = unitPrice * quantity
  assertMoneyCentavos(total, 'computed money')
  return total
}

function getProduct(slug: unknown): MenuProduct {
  const catalog = getRuntimeCatalog()
  if (typeof slug !== 'string' || !(slug in catalog)) {
    return fail('UNKNOWN_PRODUCT', `Unknown product: ${String(slug)}`)
  }

  return catalog[slug as ProductSlug]
}

function validateQuantity(quantity: unknown): asserts quantity is number {
  if (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity <= 0) {
    fail('INVALID_QUANTITY', 'Quantity must be a positive integer')
  }
}

function validateModifiers(product: MenuProduct, modifiers: unknown): asserts modifiers is DrinkModifiers {
  if (!isRecord(modifiers)) {
    fail('UNKNOWN_MODIFIER_OPTION', 'Modifiers must be an object')
  }

  const { level, powder, sweetness } = modifiers
  const levelUpcharges = getRuntimeLevelUpcharges(product.family)
  const powderUpcharges = getRuntimePowderUpcharges()

  if (typeof level !== 'number' || !(level in levelUpcharges)) {
    fail('UNKNOWN_MODIFIER_OPTION', `Unknown ${product.family} level: ${String(level)}`)
  }

  if (typeof powder !== 'string' || !(powder in powderUpcharges)) {
    fail('UNKNOWN_MODIFIER_OPTION', `Unknown powder: ${String(powder)}`)
  }

  if (sweetness !== undefined) {
    if (typeof sweetness !== 'string' || !['none', 'light', 'regular', 'extra'].includes(sweetness)) {
      fail('UNKNOWN_MODIFIER_OPTION', `Unknown sweetness: ${String(sweetness)}`)
    }

    if (product.flavor !== 'plain') {
      fail('INVALID_MODIFIER_COMBINATION', `${product.name} does not allow a sweetness selection`)
    }
  }
}

function priceItem(draft: OrderItemDraft): PricedOrderItem {
  if (!isRecord(draft)) {
    fail('UNKNOWN_PRODUCT', 'Order item must be an object')
  }

  const product = getProduct(draft.productSlug)
  validateQuantity(draft.quantity)
  validateModifiers(product, draft.modifiers)

  const levelUpcharge = getRuntimeLevelUpcharges(product.family)[draft.modifiers.level]
  const powderUpcharge = getRuntimePowderUpcharges()[draft.modifiers.powder as Powder]
  const unitPriceCentavos = addCentavos(product.basePriceCentavos, levelUpcharge, powderUpcharge)

  return {
    productSlug: product.slug,
    productName: product.name,
    quantity: draft.quantity,
    modifiers: {
      level: draft.modifiers.level,
      powder: draft.modifiers.powder as Powder,
      ...(draft.modifiers.sweetness === undefined ? {} : { sweetness: draft.modifiers.sweetness }),
    },
    unitPriceCentavos,
    lineTotalCentavos: multiplyCentavos(unitPriceCentavos, draft.quantity),
    unitPriceBreakdown: [
      { label: 'Base price', amountCentavos: product.basePriceCentavos },
      { label: `${product.family === 'matcha' ? 'Matcha' : 'Hojicha'} level ${draft.modifiers.level}`, amountCentavos: levelUpcharge },
      { label: draft.modifiers.powder === 'yumeno' ? 'Yumeno powder' : 'MK Isuzu powder', amountCentavos: powderUpcharge },
    ],
  }
}

function priceThermalBag(draft: ThermalBagDraft): ThermalBag {
  const thermalBagPrices = getRuntimeThermalBagPrices()
  if (!isRecord(draft) || !Number.isSafeInteger(draft.coveredCupCount) || !(draft.coveredCupCount in thermalBagPrices)) {
    return fail('INVALID_THERMAL_BAG', 'A thermal bag must explicitly cover 1, 2, 3, or 4 cups')
  }

  const coveredCupCount = draft.coveredCupCount as 1 | 2 | 3 | 4
  return { coveredCupCount, priceCentavos: thermalBagPrices[coveredCupCount] }
}

/**
 * Calculates catalog pricing from product and modifier selections only.
 * Any caller-provided total or price fields on the draft are intentionally ignored.
 */
export function priceOrder(draft: OrderDraft): PricedOrder {
  if (!isRecord(draft) || !Array.isArray(draft.items)) {
    fail('UNKNOWN_PRODUCT', 'Order draft must include an items array')
  }

  const items = draft.items.map(priceItem)
  const thermalBags = (draft.thermalBags ?? []).map(priceThermalBag)
  const itemCupCount = items.reduce((count, item) => count + item.quantity, 0)
  const coveredCupCount = thermalBags.reduce((count, bag) => count + bag.coveredCupCount, 0)

  if (coveredCupCount > itemCupCount) {
    fail('THERMAL_BAGS_EXCEED_CUPS', 'Thermal bags cannot cover more cups than the order contains')
  }

  const totals: OrderTotals = {
    itemsSubtotalCentavos: addCentavos(...items.map((item) => item.lineTotalCentavos)),
    thermalBagsTotalCentavos: addCentavos(...thermalBags.map((bag) => bag.priceCentavos)),
    totalCentavos: 0,
  }
  totals.totalCentavos = addCentavos(totals.itemsSubtotalCentavos, totals.thermalBagsTotalCentavos)

  return { items, thermalBags, totals }
}
