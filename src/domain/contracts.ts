export type EntityId = string

/** Monetary values are always whole Philippine centavos. */
export type MoneyCentavos = number

export type OrderStatus =
  | 'new'
  | 'paid'
  | 'delivered'
  | 'cancelled'

export type ProductSlug =
  | 'matcha-latte'
  | 'strawberry-matcha'
  | 'salted-maple-matcha'
  | 'hojicha-latte'
  | 'strawberry-hojicha'
  | 'salted-maple-hojicha'

export type DrinkFamily = 'matcha' | 'hojicha'
export type ProductFlavor = 'plain' | 'strawberry' | 'salted_maple'
export type Milk = 'oat_milk'
export type Powder = 'yumeno' | 'mk_isuzu'
export type Sweetness = 'none' | 'light' | 'regular' | 'extra'
export type MatchaLevel = 1 | 2 | 3
export type HojichaLevel = 1 | 2 | 3
export type DrinkLevel = MatchaLevel | HojichaLevel

export type ModifierGroup = 'matcha_level' | 'hojicha_level' | 'powder' | 'sweetness'

/**
 * The persisted product record intentionally remains flat because the current
 * products table stores only these administrative fields.  `MenuProduct` is
 * the separate, closed catalog that pricing reads.
 */
export type Product = {
  id: EntityId
  name: string
  priceCentavos: MoneyCentavos
  active: boolean
}

/** Normalized, authoritative product definition used by the pricing engine. */
export type MenuProduct = {
  slug: ProductSlug
  name: string
  family: DrinkFamily
  flavor: ProductFlavor
  milk: Milk
  basePriceCentavos: MoneyCentavos
  modifierGroups: readonly ModifierGroup[]
}

export type DrinkModifiers = {
  level: DrinkLevel
  powder: Powder
  /** Omit this field for drinks without a requested sweetness. */
  sweetness?: Sweetness
}

/**
 * A caller may include old UI/LLM price fields, but pricing never reads them.
 * They are intentionally `unknown` to prevent them becoming a trusted money API.
 */
export type OrderItemDraft = {
  productSlug: ProductSlug
  quantity: number
  modifiers: DrinkModifiers
  priceCentavos?: unknown
  unitPriceCentavos?: unknown
  lineTotalCentavos?: unknown
}

export type ThermalBagDraft = {
  coveredCupCount: number
  priceCentavos?: unknown
}

export type Customer = {
  id: EntityId
  name: string
  phone: string | null
  createdAt: string
}

export type CustomerDraft = {
  name: string
  phone?: string | null
}

export type OrderDraft = {
  customer?: CustomerDraft
  items: readonly OrderItemDraft[]
  thermalBags?: readonly ThermalBagDraft[]
  /** These values are non-authoritative and deliberately ignored by the engine. */
  subtotalCentavos?: unknown
  totalCentavos?: unknown
}

export type PriceComponent = {
  label: string
  amountCentavos: MoneyCentavos
}

/**
 * A placed order records the selected product and modifiers, but never makes
 * caller-supplied price fields authoritative.  Persistence refines the two
 * price fields to validated centavos after the pricing engine has calculated
 * them.
 */
export type OrderItem = {
  id: EntityId
  productId: EntityId
  productName: string
  quantity: number
  modifiers: DrinkModifiers
  unitPriceCentavos: unknown
  lineTotalCentavos: unknown
}

/** Normalized itemized result produced by the pricing engine. */
export type PricedOrderItem = {
  productSlug: ProductSlug
  productName: string
  quantity: number
  modifiers: DrinkModifiers
  unitPriceCentavos: MoneyCentavos
  lineTotalCentavos: MoneyCentavos
  unitPriceBreakdown: readonly PriceComponent[]
}

export type ThermalBag = {
  coveredCupCount: 1 | 2 | 3 | 4
  priceCentavos: MoneyCentavos
}

export type OrderTotals = {
  itemsSubtotalCentavos: MoneyCentavos
  thermalBagsTotalCentavos: MoneyCentavos
  totalCentavos: MoneyCentavos
}

export type PricedOrder = {
  items: readonly PricedOrderItem[]
  thermalBags: readonly ThermalBag[]
  totals: OrderTotals
}

/** A persisted order aggregates priced order items for operational use. */
export type Order = {
  id: EntityId
  customerId: EntityId
  status: OrderStatus
  items: OrderItem[]
  subtotalCentavos: MoneyCentavos
  deliveryFeeCentavos: MoneyCentavos
  totalCentavos: MoneyCentavos
  createdAt: string
  updatedAt: string
}
