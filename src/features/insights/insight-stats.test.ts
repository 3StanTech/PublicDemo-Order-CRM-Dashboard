import { createInsightsFixture } from '../../../test/fixtures/insights/createInsightsFixture'
import { deriveBusinessInsights, mondayForManilaDate } from './insight-stats'

describe('deriveBusinessInsights', () => {
  it('returns the required paid, non-cancelled business totals', async () => {
    const adapter = await createInsightsFixture()
    const result = deriveBusinessInsights(await adapter.listOrders())

    expect(result.cups).toBe(5)
    expect(result.recognizedRevenueCentavos).toBe(117500)
    expect(result.daily).toEqual([
      { period: '2026-07-12', cups: 3, revenueCentavos: 62000 },
      { period: '2026-07-15', cups: 2, revenueCentavos: 55500 },
    ])
    expect(result.weekly).toEqual([
      { period: '2026-07-06', cups: 3, revenueCentavos: 62000 },
      { period: '2026-07-13', cups: 2, revenueCentavos: 55500 },
    ])
    expect(result.topDrinks[0]).toEqual({ name: 'Matcha Latte', quantity: 3 })
    expect(result.repeatRate).toBe(0.5)
    await adapter.close()
  })

  it('groups weekly periods on Monday in Asia/Manila calendar dates', () => {
    expect(mondayForManilaDate('2026-07-15')).toBe('2026-07-13')
  })
})
