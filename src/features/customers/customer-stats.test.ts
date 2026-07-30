import { createInsightsFixture } from '../../../test/fixtures/insights/createInsightsFixture'
import { getCustomerSummaries } from './customer-stats'

describe('getCustomerSummaries', () => {
  it('excludes cancelled orders from CRM facts', async () => {
    const adapter = await createInsightsFixture()
    const summaries = getCustomerSummaries(await adapter.listCustomers(), await adapter.listOrders())

    expect(summaries.find((summary) => summary.customer.name === 'Ana')).toMatchObject({ orderCount: 2, favoriteDrink: 'Matcha Latte' })
    expect(summaries.find((summary) => summary.customer.name === 'Bea')).toMatchObject({ orderCount: 1 })
    expect(summaries.find((summary) => summary.customer.name === 'Cara')).toMatchObject({ orderCount: 0, favoriteDrink: null, lastOrder: null })
    await adapter.close()
  })
})
