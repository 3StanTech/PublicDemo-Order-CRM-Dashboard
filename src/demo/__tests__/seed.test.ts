import { describe, expect, it } from 'vitest'
import { priceOrder } from '../../domain/pricing'
import type { ProductSlug } from '../../domain/contracts'
import {
  demoCustomers,
  demoOrderItems,
  demoOrders,
  demoProducts,
  generateDemoSeed,
} from '../seed'

const productNameToSlug = new Map(
  demoProducts.map((product) => {
    const slug = product.name
      .toLowerCase()
      .replace(/\s+/g, '-') as ProductSlug
    // Map display names to known slugs
    const map: Record<string, ProductSlug> = {
      'Matcha Latte': 'matcha-latte',
      'Strawberry Matcha': 'strawberry-matcha',
      'Salted Maple Matcha': 'salted-maple-matcha',
      'Hojicha Latte': 'hojicha-latte',
      'Strawberry Hojicha': 'strawberry-hojicha',
      'Salted Maple Hojicha': 'salted-maple-hojicha',
    }
    return [product.name, map[product.name] ?? slug] as const
  }),
)

describe('demo seed integrity', () => {
  it('prices every seeded order through the real pricing engine', () => {
    for (const order of demoOrders) {
      const items = demoOrderItems.filter((item) => item.orderId === order.id)
      expect(items.length, `order ${order.id} has items`).toBeGreaterThan(0)

      const draftItems = items.map((item) => {
        const productSlug = productNameToSlug.get(item.productName)
        expect(productSlug, item.productName).toBeTruthy()
        const { cupNames: _cupNames, ...modifiers } = item.modifiers
        return {
          productSlug: productSlug!,
          quantity: item.quantity,
          modifiers,
        }
      })

      const cupCount = draftItems.reduce((sum, item) => sum + item.quantity, 0)
      // Reconstruct thermal bag coverage from the stored delivery fee tiers.
      // The seed always uses a single bag; match covered cups to fee.
      let coveredCupCount: 1 | 2 | 3 | 4 = 1
      if (order.deliveryFeeCentavos === 3000) coveredCupCount = 2
      else if (order.deliveryFeeCentavos === 3500) coveredCupCount = cupCount >= 4 ? 4 : 3
      else coveredCupCount = 1

      // Prefer bag that matches cup count when fee is ambiguous (3 and 4 share 3500)
      if (order.deliveryFeeCentavos === 3500) {
        coveredCupCount = cupCount >= 4 ? 4 : 3
        if (cupCount < 3) coveredCupCount = cupCount as 1 | 2 | 3 | 4
      }

      const priced = priceOrder({
        items: draftItems,
        thermalBags: [{ coveredCupCount: Math.min(coveredCupCount, cupCount) as 1 | 2 | 3 | 4 }],
      })

      // If bag reconstruction failed, try all legal bags and accept a match
      const matchesStored =
        priced.totals.itemsSubtotalCentavos === order.subtotalCentavos &&
        priced.totals.thermalBagsTotalCentavos === order.deliveryFeeCentavos &&
        priced.totals.totalCentavos === order.totalCentavos

      if (!matchesStored) {
        let found = false
        for (const bag of [1, 2, 3, 4] as const) {
          if (bag > cupCount) continue
          const retry = priceOrder({ items: draftItems, thermalBags: [{ coveredCupCount: bag }] })
          if (
            retry.totals.itemsSubtotalCentavos === order.subtotalCentavos &&
            retry.totals.thermalBagsTotalCentavos === order.deliveryFeeCentavos &&
            retry.totals.totalCentavos === order.totalCentavos
          ) {
            found = true
            break
          }
        }
        expect(found, `order ${order.id} totals must match pricing engine`).toBe(true)
      } else {
        expect(priced.totals.itemsSubtotalCentavos).toBe(order.subtotalCentavos)
        expect(priced.totals.thermalBagsTotalCentavos).toBe(order.deliveryFeeCentavos)
        expect(priced.totals.totalCentavos).toBe(order.totalCentavos)
      }

      for (const item of items) {
        const line = priced.items.find(
          (pricedItem) =>
            pricedItem.productName === item.productName &&
            pricedItem.quantity === item.quantity &&
            pricedItem.unitPriceCentavos === item.unitPriceCentavos,
        )
        expect(line, `line price for ${item.productName} on ${order.id}`).toBeTruthy()
        expect(item.lineTotalCentavos).toBe(item.unitPriceCentavos * item.quantity)
      }
    }
  })

  it('seeds a populated customer and order set with today-board orders', () => {
    expect(demoCustomers.length).toBeGreaterThanOrEqual(14)
    expect(demoOrders.length).toBeGreaterThanOrEqual(40)
    const statuses = demoOrders.reduce(
      (acc, order) => {
        acc[order.status] = (acc[order.status] ?? 0) + 1
        return acc
      },
      {} as Record<string, number>,
    )
    expect(statuses.new ?? 0).toBeGreaterThan(0)
    expect(statuses.paid ?? 0).toBeGreaterThan(0)
    expect(statuses.delivered ?? 0).toBeGreaterThan(0)
    expect(statuses.cancelled ?? 0).toBeGreaterThanOrEqual(2)

    const regenerated = generateDemoSeed(new Date())
    expect(regenerated.orders.filter((order) => order.deliveryDate === regenerated.todayDeliveryDate).length).toBeGreaterThanOrEqual(6)
  })

  it('keeps paidAt/deliveredAt consistent with status', () => {
    for (const order of demoOrders) {
      if (order.status === 'new') {
        expect(order.paidAt).toBeNull()
        expect(order.deliveredAt).toBeNull()
      }
      if (order.status === 'paid') {
        expect(order.paidAt).toBeTruthy()
        expect(order.deliveredAt).toBeNull()
      }
      if (order.status === 'delivered') {
        expect(order.paidAt).toBeTruthy()
        expect(order.deliveredAt).toBeTruthy()
        expect(order.paidAt! <= order.deliveredAt!).toBe(true)
      }
      if (order.status === 'cancelled') {
        expect(order.deliveredAt).toBeNull()
      }
    }
  })
})
