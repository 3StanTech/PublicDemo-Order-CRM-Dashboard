import { describe, expect, it } from 'vitest'
import { LocalAdapter, resetLocalAdapterMemoryForTests } from '../../../data/local-adapter'
import { normalizeCandidate } from '../parser'
import { applyCustomerMatch } from '../customer-matching'
import { confirmImportDraft } from '../persist'

describe('import confirmation', () => {
  it('matches a normalized customer and creates one aggregate order with preserved raw source', async () => {
    resetLocalAdapterMemoryForTests()
    const adapter = await LocalAdapter.create()
    const rawSource = 'Lorenzo Bautista: one matcha latte, Makati'
    const parsed = normalizeCandidate({ customer_name: '  lorenzo bautista ', items: [{ product_slug: 'matcha-latte', quantity: 1 }], address: 'Makati' }, rawSource)
    const matched = applyCustomerMatch(parsed, await adapter.listCustomers(), await adapter.listOrders())
    expect(matched.matchedCustomerId).not.toBeNull()
    const before = await adapter.listOrders()
    const saved = await confirmImportDraft(adapter, matched)
    const after = await adapter.listOrders()
    expect(after).toHaveLength(before.length + 1)
    expect(saved.rawSource).toBe(rawSource)
    expect(saved.items).toHaveLength(1)
    await adapter.close()
  })
})
