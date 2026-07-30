import { describe, expect, it, vi } from 'vitest'
import type { StoredCustomer, StoredOrder } from '../../../data/types'
import { applyCustomerMatch } from '../customer-matching'
import { normalizeCandidate, parseLocalInput, validateDraft } from '../parser'
import { malformedJsonLines, taglishStructuralResponse, taglishThread, validJsonLinesWithBlankLines } from '../../../../test/fixtures/import/hostile/hostile-import-fixtures'

function local(raw: string) {
  const result = parseLocalInput(raw)
  if (result.kind !== 'local') throw new Error(`Expected local parse, got ${result.kind}`)
  return result.drafts
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    customer_name: 'Mika Santos',
    items: [{ product_slug: 'matcha-latte', quantity: 1 }],
    address: 'Makati',
    ...overrides,
  }
}

function customer(id: string, name: string): StoredCustomer {
  return { id, name, phone: null, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z' }
}

function order(customerId: string, addressSnapshot: string | null, updatedAt = '2026-07-02T00:00:00.000Z'): StoredOrder {
  return { id: `order-${customerId}`, customerId, status: 'delivered', items: [], subtotalCentavos: 0, deliveryFeeCentavos: 0, totalCentavos: 0, deliveryDate: null, paymentReceived: true, rawSource: 'history', addressSnapshot, notes: null, routePosition: null, paidAt: '2026-07-01T00:00:00.000Z', deliveredAt: updatedAt, createdAt: updatedAt, updatedAt }
}

describe('T6 hostile import normalization and data-integrity audit', () => {
  it('reprices Taglish/emoji/irregular whitespace structural output after a later L3 correction, ignoring fake money', () => {
    const draft = normalizeCandidate(
      (taglishStructuralResponse as { orders: Record<string, unknown>[] }).orders[0],
      taglishThread,
    )
    const validation = validateDraft(draft)
    expect(draft.items).toMatchObject([
      { productSlug: 'matcha-latte', quantity: 2, level: 3, powder: 'yumeno' },
      { productSlug: 'hojicha-latte', quantity: 1, level: 1, powder: 'mk_isuzu', sweetness: 'light' },
    ])
    expect(validation.errors).toEqual([])
    expect(validation.totalCentavos).toBe(79_500)
  })

  it('never turns unrecognized product typos into priced menu items', () => {
    for (const typo of ['strabery matca', 'hojica.']) {
      const [draft] = local(JSON.stringify(candidate({ items: [{ product_slug: typo, quantity: 1 }] })))
      const validation = validateDraft(draft)
      expect(draft.items[0].productSlug, typo).toBeNull()
      expect(validation.totalCentavos, typo).toBeNull()
      expect(validation.errors.join(' '), typo).toMatch(/unknown product/i)
    }
  })

  it('accepts only explicit aliases and leaves a typo close to a known alias unresolved', () => {
    const [draft] = local(JSON.stringify(candidate({ items: [{ product_slug: 'strawberry matca', quantity: 1 }] })))
    expect(draft.items[0].productSlug).toBe('strawberry-matcha')
    expect(validateDraft(draft).totalCentavos).toBe(22_000)
  })

  it('rejects invalid flavored sweetness, unknown powder, and unknown level before pricing', () => {
    const [draft] = local(JSON.stringify(candidate({ items: [
      { product_slug: 'strawberry-matcha', quantity: 1, sweetness: 'extra' },
      { product_slug: 'hojicha-latte', quantity: 1, powder: 'ceremonial moon dust', level: 'L9' },
    ] })))
    const validation = validateDraft(draft)
    expect(validation.totalCentavos).toBeNull()
    expect(validation.errors.join(' ')).toMatch(/does not allow a sweetness|unknown powder|unknown level/i)
  })

  it('rejects zero, negative, decimal, and unsafe large quantities without assigning a total', () => {
    for (const quantity of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const [draft] = local(JSON.stringify(candidate({ items: [{ product_slug: 'matcha-latte', quantity }] })))
      expect(validateDraft(draft).totalCentavos, String(quantity)).toBeNull()
      expect(validateDraft(draft).errors.join(' '), String(quantity)).toMatch(/quantity must be a positive integer/i)
    }
  })

  it('uses the shared pricing engine even when item, bag, and order JSON carry fake prices', () => {
    const [draft] = local(JSON.stringify(candidate({
      items: [{ product_slug: 'matcha-latte', quantity: 1, level: 3, powder: 'mk_isuzu', price: 1, unitPriceCentavos: 1, lineTotalCentavos: 1 }],
      thermal_bags: [{ covered_cup_count: 1, price: 1 }], subtotalCentavos: 1, totalCentavos: 1, price: '₱1 lang',
    })))
    expect(validateDraft(draft).totalCentavos).toBe(33_500)
  })

  it('prices multiple drinks and multiple thermal bags exactly from centavos catalog values', () => {
    const [draft] = local(JSON.stringify(candidate({
      items: [
        { product_slug: 'matcha-latte', quantity: 1, level: 2 },
        { product_slug: 'salted-maple-hojicha', quantity: 3, level: 3, powder: 'mk_isuzu' },
      ],
      thermal_bags: [{ covered_cup_count: 1 }, { covered_cup_count: 3 }],
    })))
    expect(validateDraft(draft).totalCentavos).toBe(118_500)
  })

  it('visibly warns for a missing address rather than silently treating it as complete', () => {
    const [draft] = local(JSON.stringify(candidate({ address: null })))
    expect(validateDraft(draft)).toMatchObject({ errors: [], warnings: ['Delivery address is missing — review before confirming'] })
  })

  it('parses blank-surrounded valid JSON Lines locally with zero network calls', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const drafts = local(validJsonLinesWithBlankLines)
    expect(drafts).toHaveLength(2)
    expect(drafts.map((draft) => validateDraft(draft).totalCentavos)).toEqual([20_000, 18_000])
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('parses a JSON array locally with zero network calls', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const drafts = local(JSON.stringify([candidate(), candidate({ customer_name: 'Aira Cruz', items: [{ product_slug: 'hojicha-latte', quantity: 1 }] })]))
    expect(drafts).toHaveLength(2)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('does not silently drop a malformed JSON Line or prose braces into a local order', () => {
    expect(parseLocalInput(malformedJsonLines)).toEqual({ kind: 'free-text' })
    expect(parseLocalInput('Mika said {one matcha latte} but this is not JSON.')).toEqual({ kind: 'free-text' })
  })

  it('resolves same-as-last-time only when one normalized customer and history record exist', () => {
    const [draft] = local(JSON.stringify(candidate({ customer_name: '  MIKA  SANTOS ', address: null })))
    const matched = applyCustomerMatch({ ...draft, sameAsLastTime: true }, [customer('mika', 'Mika Santos')], [order('mika', 'Old Makati address')])
    expect(matched.matchedCustomerId).toBe('mika')
    expect(matched.address).toBe('Old Makati address')
  })

  it('leaves same-as-last-time unresolved when no customer matches or the matching customer has no order history', () => {
    const [draft] = local(JSON.stringify(candidate({ address: null })))
    expect(applyCustomerMatch({ ...draft, sameAsLastTime: true }, [], []).address).toBeNull()
    const withoutHistory = applyCustomerMatch({ ...draft, sameAsLastTime: true }, [customer('mika', 'Mika Santos')], [])
    expect(withoutHistory.matchedCustomerId).toBe('mika')
    expect(withoutHistory.address).toBeNull()
  })

  it('does not resolve ambiguous similar customer identities to a saved history', () => {
    const [draft] = local(JSON.stringify(candidate({ address: null })))
    const ambiguous = applyCustomerMatch({ ...draft, sameAsLastTime: true }, [customer('mika-1', 'Mika Santos'), customer('mika-2', 'Mika  Santos')], [order('mika-1', 'Wrong history')])
    expect(ambiguous.matchedCustomerId).toBeNull()
    expect(ambiguous.address).toBeNull()
    expect(ambiguous.unresolvedFields).toContain('Customer name matches multiple saved customers')
  })
})
