import type { StoredOrder } from '../../data/types'
import { compareOrderRecency, isNonCancelled } from '../customers/customer-stats'

export type PeriodTotal = { period: string; cups: number; revenueCentavos: number }
export type TopDrink = { name: string; quantity: number }
export type BusinessInsights = {
  cups: number
  recognizedRevenueCentavos: number
  daily: PeriodTotal[]
  weekly: PeriodTotal[]
  topDrinks: TopDrink[]
  repeatRate: number
}

function addPeriod(map: Map<string, PeriodTotal>, period: string, order: StoredOrder): void {
  const current = map.get(period) ?? { period, cups: 0, revenueCentavos: 0 }
  current.cups += order.items.reduce((sum, item) => sum + item.quantity, 0)
  if (order.paymentReceived) current.revenueCentavos += order.totalCentavos
  map.set(period, current)
}

export function mondayForManilaDate(deliveryDate: string): string {
  const [year, month, day] = deliveryDate.split('-').map(Number)
  if (!year || !month || !day) throw new Error(`Invalid delivery date: ${deliveryDate}`)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  const mondayOffset = (weekday + 6) % 7
  const monday = new Date(Date.UTC(year, month - 1, day - mondayOffset))
  return monday.toISOString().slice(0, 10)
}

export function deriveBusinessInsights(orders: readonly StoredOrder[]): BusinessInsights {
  const activeOrders = orders.filter(isNonCancelled)
  const daily = new Map<string, PeriodTotal>()
  const weekly = new Map<string, PeriodTotal>()
  const drinkCounts = new Map<string, { quantity: number; lastOrder: StoredOrder }>()
  const customerCounts = new Map<string, number>()
  let cups = 0
  let recognizedRevenueCentavos = 0

  for (const order of activeOrders) {
    const orderCups = order.items.reduce((sum, item) => sum + item.quantity, 0)
    cups += orderCups
    if (order.paymentReceived) recognizedRevenueCentavos += order.totalCentavos
    customerCounts.set(order.customerId, (customerCounts.get(order.customerId) ?? 0) + 1)
    if (order.deliveryDate) {
      addPeriod(daily, order.deliveryDate, order)
      addPeriod(weekly, mondayForManilaDate(order.deliveryDate), order)
    }
    for (const item of order.items) {
      const tally = drinkCounts.get(item.productName)
      if (!tally) drinkCounts.set(item.productName, { quantity: item.quantity, lastOrder: order })
      else {
        tally.quantity += item.quantity
        if (compareOrderRecency(order, tally.lastOrder) > 0) tally.lastOrder = order
      }
    }
  }

  const periodSorter = (left: PeriodTotal, right: PeriodTotal) => left.period.localeCompare(right.period)
  const topDrinks = [...drinkCounts.entries()]
    .sort(([leftName, left], [rightName, right]) => {
      if (left.quantity !== right.quantity) return right.quantity - left.quantity
      const recency = compareOrderRecency(right.lastOrder, left.lastOrder)
      return recency !== 0 ? recency : leftName.localeCompare(rightName)
    })
    .map(([name, tally]) => ({ name, quantity: tally.quantity }))
  const customersWithOrders = customerCounts.size
  const repeatingCustomers = [...customerCounts.values()].filter((count) => count >= 2).length

  return {
    cups,
    recognizedRevenueCentavos,
    daily: [...daily.values()].sort(periodSorter),
    weekly: [...weekly.values()].sort(periodSorter),
    topDrinks,
    repeatRate: customersWithOrders === 0 ? 0 : repeatingCustomers / customersWithOrders,
  }
}
