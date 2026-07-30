import type {
  ModifierGroup,
  Setting,
  StoredCustomer,
  StoredItemModifiers,
  StoredOrder,
  StoredOrderItem,
  StoredProduct,
} from '../data/types'
import type {
  DrinkModifiers,
  DrinkLevel,
  OrderStatus,
  Powder,
  ProductSlug,
  Sweetness,
} from '../domain/contracts'
import { priceOrder } from '../domain/pricing'

const catalogAt = '2026-01-01T00:00:00.000Z'

export const demoProducts: StoredProduct[] = [
  { id: '10000000-0000-4000-8000-000000000001', name: 'Matcha Latte', priceCentavos: 20000, active: true, createdAt: catalogAt, updatedAt: catalogAt },
  { id: '10000000-0000-4000-8000-000000000002', name: 'Strawberry Matcha', priceCentavos: 22000, active: true, createdAt: catalogAt, updatedAt: catalogAt },
  { id: '10000000-0000-4000-8000-000000000003', name: 'Salted Maple Matcha', priceCentavos: 22000, active: true, createdAt: catalogAt, updatedAt: catalogAt },
  { id: '10000000-0000-4000-8000-000000000004', name: 'Hojicha Latte', priceCentavos: 18000, active: true, createdAt: catalogAt, updatedAt: catalogAt },
  { id: '10000000-0000-4000-8000-000000000005', name: 'Strawberry Hojicha', priceCentavos: 20000, active: true, createdAt: catalogAt, updatedAt: catalogAt },
  { id: '10000000-0000-4000-8000-000000000006', name: 'Salted Maple Hojicha', priceCentavos: 20000, active: true, createdAt: catalogAt, updatedAt: catalogAt },
]

const matchaIds = demoProducts.slice(0, 3).map((product) => product.id)
const hojichaIds = demoProducts.slice(3).map((product) => product.id)

export const demoModifierGroups: ModifierGroup[] = [
  { id: '20000000-0000-4000-8000-000000000001', name: 'Matcha level', appliesToProductIds: matchaIds, options: [{ id: 'l1', label: 'L1 · 5g', priceCentavos: 0, default: true }, { id: 'l2', label: 'L2', priceCentavos: 2500 }, { id: 'l3', label: 'L3', priceCentavos: 5000 }], allowsMultiple: false, createdAt: catalogAt, updatedAt: catalogAt },
  { id: '20000000-0000-4000-8000-000000000002', name: 'Hojicha level', appliesToProductIds: hojichaIds, options: [{ id: 'l1', label: 'L1 · 6g', priceCentavos: 0, default: true }, { id: 'l2', label: 'L2', priceCentavos: 2000 }, { id: 'l3', label: 'L3', priceCentavos: 4000 }], allowsMultiple: false, createdAt: catalogAt, updatedAt: catalogAt },
  { id: '20000000-0000-4000-8000-000000000003', name: 'Powder', appliesToProductIds: demoProducts.map((product) => product.id), options: [{ id: 'yumeno', label: 'Yumeno', priceCentavos: 0, default: true }, { id: 'mk-isuzu', label: 'MK Isuzu', priceCentavos: 6000 }], allowsMultiple: false, createdAt: catalogAt, updatedAt: catalogAt },
  { id: '20000000-0000-4000-8000-000000000004', name: 'Sweetness', appliesToProductIds: [demoProducts[0].id, demoProducts[3].id], options: [{ id: 'none', label: 'None', priceCentavos: 0 }, { id: 'light', label: 'Light', priceCentavos: 0 }, { id: 'regular', label: 'Regular', priceCentavos: 0, default: true }, { id: 'extra', label: 'Extra', priceCentavos: 0 }], allowsMultiple: false, createdAt: catalogAt, updatedAt: catalogAt },
  { id: '20000000-0000-4000-8000-000000000005', name: 'Thermal bag', appliesToProductIds: demoProducts.map((product) => product.id), options: [{ id: 'one-cup', label: '1 cup', priceCentavos: 2500 }, { id: 'two-cups', label: '2 cups', priceCentavos: 3000 }, { id: 'three-four-cups', label: '3–4 cups', priceCentavos: 3500 }], allowsMultiple: false, createdAt: catalogAt, updatedAt: catalogAt },
  { id: '20000000-0000-4000-8000-000000000006', name: 'Milk', appliesToProductIds: demoProducts.map((product) => product.id), options: [{ id: 'oat-milk', label: 'Oat milk', priceCentavos: 0, default: true }], allowsMultiple: false, createdAt: catalogAt, updatedAt: catalogAt },
]

const productBySlug: Record<ProductSlug, StoredProduct> = {
  'matcha-latte': demoProducts[0],
  'strawberry-matcha': demoProducts[1],
  'salted-maple-matcha': demoProducts[2],
  'hojicha-latte': demoProducts[3],
  'strawberry-hojicha': demoProducts[4],
  'salted-maple-hojicha': demoProducts[5],
}

/** Open delivery days: Sun, Tue, Wed, Thu, Fri (matches the Today board). */
const DELIVERY_DAYS = new Set([0, 2, 3, 4, 5])

/** Deterministic PRNG — Mulberry32. Not Math.random(), so seed shape is stable. */
function createRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function asDateInput(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

function relevantDeliveryDate(now = new Date()): string {
  const next = new Date(now)
  while (!DELIVERY_DAYS.has(next.getDay())) next.setDate(next.getDate() + 1)
  return asDateInput(next)
}

function addDays(dateInput: string, days: number): string {
  const date = new Date(`${dateInput}T12:00:00`)
  date.setDate(date.getDate() + days)
  return asDateInput(date)
}

function previousDeliveryDates(fromDate: string, count: number): string[] {
  const dates: string[] = []
  let cursor = new Date(`${fromDate}T12:00:00`)
  while (dates.length < count) {
    cursor.setDate(cursor.getDate() - 1)
    if (DELIVERY_DAYS.has(cursor.getDay())) dates.push(asDateInput(cursor))
  }
  return dates
}

/** ISO timestamp inside the 08:00–09:00 Asia/Manila-style local delivery window. */
function windowTimestamp(dateInput: string, minuteOffset: number): string {
  const hour = 8
  const minute = Math.max(0, Math.min(59, minuteOffset))
  const second = (minuteOffset * 7) % 60
  // +08:00 explicitly: the window is 08:00–09:00 Manila time, not UTC. Writing it
  // as `Z` renders the run as a 4 PM delivery on a Manila clock.
  return `${dateInput}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}.000+08:00`
}

function uuid(prefix: number, index: number): string {
  return `${String(prefix).padStart(8, '0')}-0000-4000-8000-${String(index).padStart(12, '0')}`
}

type ItemSpec = {
  productSlug: ProductSlug
  quantity: number
  modifiers: DrinkModifiers
  cupNames?: string[]
}

type OrderBuildSpec = {
  id: string
  customerId: string
  status: OrderStatus
  deliveryDate: string
  items: ItemSpec[]
  thermalBagCups: 1 | 2 | 3 | 4
  address: string
  notes: string | null
  routePosition: number | null
  createdAt: string
  paidAt: string | null
  deliveredAt: string | null
}

export function buildPricedOrder(spec: OrderBuildSpec): { order: StoredOrder; items: StoredOrderItem[] } {
  const priced = priceOrder({
    items: spec.items.map((item) => ({
      productSlug: item.productSlug,
      quantity: item.quantity,
      modifiers: item.modifiers,
    })),
    thermalBags: [{ coveredCupCount: spec.thermalBagCups }],
  })

  const orderIndex = Number(spec.id.slice(-12))
  const items: StoredOrderItem[] = priced.items.map((pricedItem, index) => {
    const source = spec.items[index]
    const product = productBySlug[pricedItem.productSlug]
    const modifiers: StoredItemModifiers = {
      ...pricedItem.modifiers,
      ...(source.cupNames && source.cupNames.length > 0 ? { cupNames: source.cupNames } : {}),
    }
    return {
      id: uuid(5, orderIndex * 10 + index + 1),
      orderId: spec.id,
      productId: product.id,
      productName: pricedItem.productName,
      quantity: pricedItem.quantity,
      modifiers,
      unitPriceCentavos: pricedItem.unitPriceCentavos,
      lineTotalCentavos: pricedItem.lineTotalCentavos,
      createdAt: spec.createdAt,
      updatedAt: spec.createdAt,
    }
  })

  const order: StoredOrder = {
    id: spec.id,
    customerId: spec.customerId,
    status: spec.status,
    items,
    subtotalCentavos: priced.totals.itemsSubtotalCentavos,
    deliveryFeeCentavos: priced.totals.thermalBagsTotalCentavos,
    totalCentavos: priced.totals.totalCentavos,
    deliveryDate: spec.deliveryDate,
    paymentReceived: spec.status === 'paid' || spec.status === 'delivered',
    rawSource: 'demo',
    addressSnapshot: spec.address,
    notes: spec.notes,
    routePosition: spec.routePosition,
    paidAt: spec.paidAt,
    deliveredAt: spec.deliveredAt,
    createdAt: spec.createdAt,
    updatedAt: spec.createdAt,
  }

  return { order, items }
}

function lifecycleFor(
  status: OrderStatus,
  deliveryDate: string,
  rng: () => number,
  previousPaidAt?: string | null,
): { paidAt: string | null; deliveredAt: string | null } {
  const paidMinute = 5 + Math.floor(rng() * 25)
  const deliveredMinute = paidMinute + 10 + Math.floor(rng() * 20)
  switch (status) {
    case 'new':
      return { paidAt: null, deliveredAt: null }
    case 'paid':
      return { paidAt: windowTimestamp(deliveryDate, paidMinute), deliveredAt: null }
    case 'delivered':
      return {
        paidAt: previousPaidAt ?? windowTimestamp(deliveryDate, paidMinute),
        deliveredAt: windowTimestamp(deliveryDate, Math.min(55, deliveredMinute)),
      }
    case 'cancelled':
      return {
        paidAt: previousPaidAt ?? (rng() > 0.5 ? windowTimestamp(deliveryDate, paidMinute) : null),
        deliveredAt: null,
      }
    default:
      return { paidAt: null, deliveredAt: null }
  }
}

type CustomerSeed = {
  name: string
  phone: string | null
  address: string
  /** Target historical order count (before today-board assignments). */
  orderWeight: number
}

const CUSTOMER_SEEDS: CustomerSeed[] = [
  { name: 'Lorenzo Bautista', phone: '09171234001', address: '12 Scout Tobias St, Quezon City', orderWeight: 5 },
  { name: 'Bianca Mendoza', phone: '09181234002', address: '88 Jupiter St, Makati', orderWeight: 4 },
  { name: 'Carlos Villanueva', phone: '09191234003', address: '45 Maginhawa St, Quezon City', orderWeight: 6 },
  { name: 'Daphne Ocampo', phone: '09201234004', address: '7 Perea St, Makati', orderWeight: 3 },
  { name: 'Enrico Salazar', phone: '09211234005', address: '210 Tomas Morato Ave, Quezon City', orderWeight: 5 },
  { name: 'Faye Dela Cruz', phone: '09221234006', address: '33 Kalayaan Ave, Quezon City', orderWeight: 4 },
  { name: 'Gabriel Tan', phone: '09231234007', address: '19 Legazpi St, Makati', orderWeight: 3 },
  { name: 'Helena Quiroz', phone: null, address: '56 Sikatuna Village, Quezon City', orderWeight: 2 },
  { name: 'Ivan Pascual', phone: '09251234009', address: '4 Polaris St, Makati', orderWeight: 1 },
  { name: 'Julia Navarrete', phone: '09261234010', address: '91 Anonas St, Quezon City', orderWeight: 4 },
  { name: 'Kevin Alonzo', phone: '09271234011', address: '15 Mabini St, Makati', orderWeight: 1 },
  { name: 'Lara Espinosa', phone: '09281234012', address: '72 Xavierville Ave, Quezon City', orderWeight: 5 },
  { name: 'Marco Ignacio', phone: '09291234013', address: '28 Dela Rosa St, Makati', orderWeight: 3 },
  { name: 'Nina Cordero', phone: '09301234014', address: '6 Teacher\'s Village East, Quezon City', orderWeight: 2 },
]

const SLUGS: ProductSlug[] = [
  'matcha-latte',
  'strawberry-matcha',
  'salted-maple-matcha',
  'hojicha-latte',
  'strawberry-hojicha',
  'salted-maple-hojicha',
]

const SWEETNESS: Sweetness[] = ['none', 'light', 'regular', 'extra']
const POWDERS: Powder[] = ['yumeno', 'mk_isuzu']
const LEVELS: DrinkLevel[] = [1, 2, 3]
const CUP_NAME_POOL = ['Ana', 'Ben', 'Cora', 'Diego', 'Ella', 'Felix', 'Gia', 'Hiro']

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!
}

function modifiersFor(slug: ProductSlug, level: DrinkLevel, powder: Powder, sweetness?: Sweetness): DrinkModifiers {
  const product = productBySlug[slug]
  const isPlain = product.name === 'Matcha Latte' || product.name === 'Hojicha Latte'
  if (isPlain) {
    return { level, powder, sweetness: sweetness ?? 'regular' }
  }
  return { level, powder }
}

function randomItem(rng: () => number, force?: Partial<ItemSpec>): ItemSpec {
  const productSlug = force?.productSlug ?? pick(rng, SLUGS)
  const quantity = force?.quantity ?? (1 + Math.floor(rng() * 2))
  const level = force?.modifiers?.level ?? pick(rng, LEVELS)
  const powder = force?.modifiers?.powder ?? pick(rng, POWDERS)
  const isPlain = productSlug === 'matcha-latte' || productSlug === 'hojicha-latte'
  const sweetness = force?.modifiers?.sweetness ?? (isPlain ? pick(rng, SWEETNESS) : undefined)
  return {
    productSlug,
    quantity,
    modifiers: modifiersFor(productSlug, level, powder, sweetness),
    ...(force?.cupNames ? { cupNames: force.cupNames } : {}),
  }
}

function thermalForCups(cupCount: number): 1 | 2 | 3 | 4 {
  if (cupCount <= 1) return 1
  if (cupCount === 2) return 2
  if (cupCount === 3) return 3
  return 4
}

function buildSeedDataset(now = new Date()) {
  const rng = createRng(0x47454c4c) // 'GELL'
  const today = relevantDeliveryDate(now)
  const historyDates = previousDeliveryDates(today, 18) // ~6 weeks of open days

  const customers: StoredCustomer[] = CUSTOMER_SEEDS.map((seed, index) => {
    const created = windowTimestamp(addDays(today, -40 - index), 10 + index)
    return {
      id: uuid(3, index + 1),
      name: seed.name,
      phone: seed.phone,
      createdAt: created,
      updatedAt: created,
    }
  })

  const orders: StoredOrder[] = []
  const orderItems: StoredOrderItem[] = []
  let orderSeq = 1

  const pushOrder = (spec: Omit<OrderBuildSpec, 'id'>) => {
    const id = uuid(4, orderSeq++)
    const built = buildPricedOrder({ ...spec, id })
    orders.push(built.order)
    orderItems.push(...built.items)
  }

  // —— Today board: 7 orders mixing new / paid / delivered ——
  // Lorenzo: new (e2e advances this one)
  pushOrder({
    customerId: customers[0].id,
    status: 'new',
    deliveryDate: today,
    items: [
      {
        productSlug: 'matcha-latte',
        quantity: 2,
        modifiers: { level: 1, powder: 'yumeno', sweetness: 'regular' },
        cupNames: ['Lorenzo', 'Mikael'],
      },
    ],
    thermalBagCups: 2,
    address: CUSTOMER_SEEDS[0].address,
    notes: 'Leave with lobby guard.',
    routePosition: 1,
    createdAt: windowTimestamp(today, 2),
    ...lifecycleFor('new', today, rng),
  })

  // Bianca: paid (e2e cancels this one)
  pushOrder({
    customerId: customers[1].id,
    status: 'paid',
    deliveryDate: today,
    items: [
      { productSlug: 'strawberry-hojicha', quantity: 1, modifiers: { level: 2, powder: 'yumeno' } },
      { productSlug: 'hojicha-latte', quantity: 1, modifiers: { level: 1, powder: 'mk_isuzu', sweetness: 'light' } },
    ],
    thermalBagCups: 2,
    address: CUSTOMER_SEEDS[1].address,
    notes: null,
    routePosition: 2,
    createdAt: windowTimestamp(today, 3),
    ...lifecycleFor('paid', today, rng),
  })

  // Carlos: delivered
  pushOrder({
    customerId: customers[2].id,
    status: 'delivered',
    deliveryDate: today,
    items: [
      {
        productSlug: 'salted-maple-matcha',
        quantity: 4,
        modifiers: { level: 3, powder: 'yumeno' },
        cupNames: ['Carlos', 'Tessa', 'Noah', 'Ivy'],
      },
    ],
    thermalBagCups: 4,
    address: CUSTOMER_SEEDS[2].address,
    notes: 'Office reception, 12th floor.',
    routePosition: 3,
    createdAt: windowTimestamp(today, 1),
    ...lifecycleFor('delivered', today, rng),
  })

  // Daphne: new
  pushOrder({
    customerId: customers[3].id,
    status: 'new',
    deliveryDate: today,
    items: [{ productSlug: 'matcha-latte', quantity: 1, modifiers: { level: 2, powder: 'mk_isuzu', sweetness: 'extra' } }],
    thermalBagCups: 1,
    address: CUSTOMER_SEEDS[3].address,
    notes: null,
    routePosition: 4,
    createdAt: windowTimestamp(today, 4),
    ...lifecycleFor('new', today, rng),
  })

  // Enrico: paid
  pushOrder({
    customerId: customers[4].id,
    status: 'paid',
    deliveryDate: today,
    items: [
      { productSlug: 'strawberry-matcha', quantity: 1, modifiers: { level: 1, powder: 'yumeno' } },
      { productSlug: 'salted-maple-hojicha', quantity: 2, modifiers: { level: 3, powder: 'mk_isuzu' } },
    ],
    thermalBagCups: 3,
    address: CUSTOMER_SEEDS[4].address,
    notes: 'Call on arrival.',
    routePosition: 5,
    createdAt: windowTimestamp(today, 5),
    ...lifecycleFor('paid', today, rng),
  })

  // Faye: delivered
  pushOrder({
    customerId: customers[5].id,
    status: 'delivered',
    deliveryDate: today,
    items: [{ productSlug: 'hojicha-latte', quantity: 2, modifiers: { level: 2, powder: 'yumeno', sweetness: 'none' }, cupNames: ['Faye', 'Sam'] }],
    thermalBagCups: 2,
    address: CUSTOMER_SEEDS[5].address,
    notes: null,
    routePosition: 6,
    createdAt: windowTimestamp(today, 0),
    ...lifecycleFor('delivered', today, rng),
  })

  // Gabriel: new multi-cup with names
  pushOrder({
    customerId: customers[6].id,
    status: 'new',
    deliveryDate: today,
    items: [
      {
        productSlug: 'matcha-latte',
        quantity: 3,
        modifiers: { level: 3, powder: 'yumeno', sweetness: 'light' },
        cupNames: ['Gabe', 'Pat', 'Rina'],
      },
      { productSlug: 'strawberry-matcha', quantity: 1, modifiers: { level: 2, powder: 'mk_isuzu' } },
    ],
    thermalBagCups: 4,
    address: CUSTOMER_SEEDS[6].address,
    notes: 'Ring the blue gate.',
    routePosition: 7,
    createdAt: windowTimestamp(today, 6),
    ...lifecycleFor('new', today, rng),
  })

  // —— Historical ~40 orders over preceding open days ——
  // Ensure modifier coverage with a few fixed showcase orders first.
  const coverage: Array<{ customerIndex: number; dateIndex: number; item: ItemSpec; bag: 1 | 2 | 3 | 4; status: OrderStatus }> = [
    { customerIndex: 0, dateIndex: 1, item: { productSlug: 'matcha-latte', quantity: 1, modifiers: { level: 1, powder: 'yumeno', sweetness: 'none' } }, bag: 1, status: 'delivered' },
    { customerIndex: 1, dateIndex: 2, item: { productSlug: 'matcha-latte', quantity: 1, modifiers: { level: 2, powder: 'yumeno', sweetness: 'light' } }, bag: 1, status: 'delivered' },
    { customerIndex: 2, dateIndex: 3, item: { productSlug: 'matcha-latte', quantity: 1, modifiers: { level: 3, powder: 'mk_isuzu', sweetness: 'regular' } }, bag: 1, status: 'delivered' },
    { customerIndex: 3, dateIndex: 4, item: { productSlug: 'hojicha-latte', quantity: 1, modifiers: { level: 1, powder: 'yumeno', sweetness: 'extra' } }, bag: 1, status: 'delivered' },
    { customerIndex: 4, dateIndex: 5, item: { productSlug: 'hojicha-latte', quantity: 1, modifiers: { level: 2, powder: 'mk_isuzu', sweetness: 'none' } }, bag: 1, status: 'delivered' },
    { customerIndex: 5, dateIndex: 6, item: { productSlug: 'hojicha-latte', quantity: 1, modifiers: { level: 3, powder: 'yumeno', sweetness: 'light' } }, bag: 1, status: 'delivered' },
    { customerIndex: 7, dateIndex: 7, item: { productSlug: 'strawberry-matcha', quantity: 2, modifiers: { level: 1, powder: 'mk_isuzu' }, cupNames: ['Helen', 'Jun'] }, bag: 2, status: 'delivered' },
    { customerIndex: 9, dateIndex: 8, item: { productSlug: 'salted-maple-matcha', quantity: 1, modifiers: { level: 2, powder: 'yumeno' } }, bag: 1, status: 'cancelled' },
    { customerIndex: 11, dateIndex: 9, item: { productSlug: 'strawberry-hojicha', quantity: 3, modifiers: { level: 3, powder: 'mk_isuzu' }, cupNames: ['Lara', 'Oli', 'Pia'] }, bag: 3, status: 'delivered' },
    { customerIndex: 12, dateIndex: 10, item: { productSlug: 'salted-maple-hojicha', quantity: 1, modifiers: { level: 1, powder: 'yumeno' } }, bag: 1, status: 'cancelled' },
  ]

  for (const entry of coverage) {
    const deliveryDate = historyDates[entry.dateIndex] ?? historyDates[0]!
    const life = lifecycleFor(entry.status, deliveryDate, rng)
    pushOrder({
      customerId: customers[entry.customerIndex].id,
      status: entry.status,
      deliveryDate,
      items: [entry.item],
      thermalBagCups: entry.bag,
      address: CUSTOMER_SEEDS[entry.customerIndex].address,
      notes: entry.status === 'cancelled' ? 'Customer cancelled the morning of.' : null,
      routePosition: null,
      createdAt: windowTimestamp(deliveryDate, 3),
      ...life,
    })
  }

  // Fill remaining history to ~40 more beyond today (today has 7; coverage 10; need ~30 more → total ~47)
  const targetHistory = 40
  let historyCount = coverage.length
  let guard = 0
  while (historyCount < targetHistory && guard < 200) {
    guard++
    const customerIndex = Math.floor(rng() * customers.length)
    // Prefer customers with higher orderWeight
    const weight = CUSTOMER_SEEDS[customerIndex].orderWeight
    if (rng() > weight / 6) continue

    const deliveryDate = pick(rng, historyDates)
    // Older dates mostly delivered; recent history can be paid rarely
    const ageBias = historyDates.indexOf(deliveryDate) / historyDates.length
    let status: OrderStatus = 'delivered'
    if (ageBias < 0.15 && rng() < 0.08) status = 'cancelled'
    else if (ageBias < 0.2 && rng() < 0.1) status = 'paid'
    else status = 'delivered'

    const itemCount = 1 + Math.floor(rng() * 2)
    const items: ItemSpec[] = []
    for (let i = 0; i < itemCount; i++) {
      const item = randomItem(rng)
      if (item.quantity >= 3 && rng() > 0.5) {
        item.cupNames = CUP_NAME_POOL.slice(0, item.quantity)
      }
      items.push(item)
    }
    const cupCount = items.reduce((sum, item) => sum + item.quantity, 0)
    // Force bag tier variety
    let bag = thermalForCups(cupCount)
    if (historyCount % 7 === 0) bag = 1
    else if (historyCount % 7 === 1) bag = 2
    else if (historyCount % 7 === 2) bag = cupCount >= 3 ? 3 : 2

    // Clamp bag to not exceed cups (pricing engine enforces this)
    if (bag > cupCount) bag = thermalForCups(cupCount)

    const life = lifecycleFor(status, deliveryDate, rng)
    pushOrder({
      customerId: customers[customerIndex].id,
      status,
      deliveryDate,
      items,
      thermalBagCups: bag,
      address: CUSTOMER_SEEDS[customerIndex].address,
      notes: rng() > 0.85 ? 'Text when nearby.' : null,
      routePosition: null,
      createdAt: windowTimestamp(deliveryDate, Math.floor(rng() * 8)),
      ...life,
    })
    historyCount++
  }

  // Ensure Ivan (index 8) and Kevin (index 10) have exactly one order each if under-served
  for (const singleIndex of [8, 10]) {
    const count = orders.filter((order) => order.customerId === customers[singleIndex].id).length
    if (count === 0) {
      const deliveryDate = historyDates[singleIndex % historyDates.length]!
      const life = lifecycleFor('delivered', deliveryDate, rng)
      pushOrder({
        customerId: customers[singleIndex].id,
        status: 'delivered',
        deliveryDate,
        items: [randomItem(rng, { quantity: 1 })],
        thermalBagCups: 1,
        address: CUSTOMER_SEEDS[singleIndex].address,
        notes: null,
        routePosition: null,
        createdAt: windowTimestamp(deliveryDate, 4),
        ...life,
      })
    }
  }

  // Ensure Helena (null phone, index 7) has at least one order
  if (!orders.some((order) => order.customerId === customers[7].id)) {
    const deliveryDate = historyDates[2 % historyDates.length]!
    const life = lifecycleFor('delivered', deliveryDate, rng)
    pushOrder({
      customerId: customers[7].id,
      status: 'delivered',
      deliveryDate,
      items: [randomItem(rng)],
      thermalBagCups: 1,
      address: CUSTOMER_SEEDS[7].address,
      notes: null,
      routePosition: null,
      createdAt: windowTimestamp(deliveryDate, 5),
      ...life,
    })
  }

  // Final integrity: every order must have a parseable delivery date and lifecycle stamps.
  for (const order of orders) {
    if (!order.deliveryDate || Number.isNaN(Date.parse(`${order.deliveryDate}T12:00:00`))) {
      throw new Error(`Seed produced invalid deliveryDate on ${order.id}: ${String(order.deliveryDate)}`)
    }
    for (const field of ['createdAt', 'updatedAt', 'paidAt', 'deliveredAt'] as const) {
      const value = order[field]
      if (value != null && Number.isNaN(Date.parse(value))) {
        throw new Error(`Seed produced invalid ${field} on ${order.id}: ${value}`)
      }
    }
  }

  const settings: Setting[] = [
    {
      id: '60000000-0000-4000-8000-000000000001',
      key: 'business',
      value: { name: 'Gelly Café (demo)', currency: 'PHP', timezone: 'Asia/Manila' },
      createdAt: catalogAt,
      updatedAt: catalogAt,
    },
  ]

  return {
    customers,
    orders,
    orderItems,
    settings,
    todayDeliveryDate: today,
  }
}

const dataset = buildSeedDataset()

export const demoCustomers: StoredCustomer[] = dataset.customers
export const demoOrders: StoredOrder[] = dataset.orders
export const demoOrderItems: StoredOrderItem[] = dataset.orderItems
export const demoSettings: Setting[] = dataset.settings
/** Delivery date used for today's board seed orders (computed at module load). */
export const demoTodayDeliveryDate: string = dataset.todayDeliveryDate

/** Rebuild seed data from a given "now" — useful for tests. */
export function generateDemoSeed(now = new Date()) {
  return buildSeedDataset(now)
}
