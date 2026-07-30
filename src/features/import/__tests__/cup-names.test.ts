import { describe, expect, it } from 'vitest'
import { LocalAdapter, resetLocalAdapterMemoryForTests } from '../../../data/local-adapter'
import { normalizeCandidate, parseLocalInput, validateDraft } from '../parser'
import { applyCustomerMatch } from '../customer-matching'
import { confirmImportDraft } from '../persist'
import { formatCupNames, MAX_CUP_NAME_LENGTH, normalizeCupNames, padCupNames } from '../cup-names'
import { saveOrderEdit } from '../../order-editor/saveOrderEdit'
import { storedOrderToImportDraft } from '../../order-editor/orderDraftMapping'
import { setCupName } from '../../order-editor/order-draft-helpers'

async function adapterWithCustomers() {
  resetLocalAdapterMemoryForTests()
  return LocalAdapter.create()
}

describe('cup name normalization', () => {
  it('trims, drops blanks, and ignores non-strings', () => {
    expect(normalizeCupNames(['  Ana ', '', 'Ben', null, 7, '   '])).toEqual(['Ana', 'Ben'])
  })

  it('returns an empty list for a missing or non-array value', () => {
    expect(normalizeCupNames(undefined)).toEqual([])
    expect(normalizeCupNames('Ana')).toEqual([])
  })

  it('caps a single name at the maximum length', () => {
    expect(normalizeCupNames(['A'.repeat(200)])[0]).toHaveLength(MAX_CUP_NAME_LENGTH)
  })

  it('pads to one editable slot per cup and ignores an unset quantity', () => {
    expect(padCupNames(['Ana'], 3)).toEqual(['Ana', '', ''])
    expect(padCupNames(['Ana'], null)).toEqual([])
  })

  it('formats names for display', () => {
    expect(formatCupNames(['Ana', 'Ben'])).toBe('Ana, Ben')
    expect(formatCupNames(undefined)).toBe('')
  })
})

describe('cup names through the import parser', () => {
  it('reads cup_names off an imported item', () => {
    const draft = normalizeCandidate(
      { customer_name: 'Rina', items: [{ product_slug: 'matcha-latte', quantity: 4, cup_names: ['Ana', 'Ben', 'Cara', 'Dave'] }], address: 'Makati' },
      'raw',
    )
    expect(draft.items[0].cupNames).toEqual(['Ana', 'Ben', 'Cara', 'Dave'])
  })

  it('leaves cupNames unset when the payload omits them', () => {
    const draft = normalizeCandidate({ customer_name: 'Rina', items: [{ product_slug: 'matcha-latte', quantity: 2 }] }, 'raw')
    expect(draft.items[0].cupNames).toBeUndefined()
  })

  it('rejects a draft naming more cups than were ordered', () => {
    const draft = normalizeCandidate(
      { customer_name: 'Rina', items: [{ product_slug: 'matcha-latte', quantity: 2, cup_names: ['Ana', 'Ben', 'Cara'] }], address: 'Makati' },
      'raw',
    )
    expect(validateDraft(draft).errors).toContain('Item 1: 3 cup names for only 2 cups')
  })

  it('accepts naming only some of the cups', () => {
    const draft = normalizeCandidate(
      { customer_name: 'Rina', items: [{ product_slug: 'matcha-latte', quantity: 4, cup_names: ['Ana'] }], address: 'Makati' },
      'raw',
    )
    expect(validateDraft(draft).errors).toHaveLength(0)
  })

  it('does not treat two orders that differ only by cup names as a duplicate paste', () => {
    const line = (names: string[]) => JSON.stringify({ customer_name: 'Rina', items: [{ product_slug: 'matcha-latte', quantity: 2, cup_names: names }] })
    const result = parseLocalInput(`${line(['Ana', 'Ben'])}\n${line(['Cara', 'Dave'])}`)
    expect(result.kind).toBe('local')
    if (result.kind !== 'local') throw new Error('expected a local parse')
    expect(result.drafts).toHaveLength(2)
  })

  it('still collapses a genuinely duplicated paste that carries cup names', () => {
    const line = JSON.stringify({ customer_name: 'Rina', items: [{ product_slug: 'matcha-latte', quantity: 2, cup_names: ['Ana', 'Ben'] }] })
    const result = parseLocalInput(`${line}\n${line}`)
    if (result.kind !== 'local') throw new Error('expected a local parse')
    expect(result.drafts).toHaveLength(1)
  })

  it('does not let cup names influence the price', () => {
    const withNames = normalizeCandidate({ customer_name: 'Rina', items: [{ product_slug: 'matcha-latte', quantity: 4, cup_names: ['Ana', 'Ben', 'Cara', 'Dave'] }] }, 'raw')
    const withoutNames = normalizeCandidate({ customer_name: 'Rina', items: [{ product_slug: 'matcha-latte', quantity: 4 }] }, 'raw')
    expect(validateDraft(withNames).totalCentavos).toBe(validateDraft(withoutNames).totalCentavos)
  })
})

describe('cup names through persistence', () => {
  it('persists a name per cup when one customer orders for four people', async () => {
    const adapter = await adapterWithCustomers()
    const draft = normalizeCandidate(
      { customer_name: 'Rina Cruz', items: [{ product_slug: 'matcha-latte', quantity: 4, cup_names: ['Ana', 'Ben', 'Cara', 'Dave'] }], address: 'Makati' },
      'Rina: 4 matcha, para kay Ana, Ben, Cara, Dave',
    )
    const matched = applyCustomerMatch(draft, await adapter.listCustomers(), await adapter.listOrders())
    const saved = await confirmImportDraft(adapter, matched)
    expect(saved.items[0].quantity).toBe(4)
    expect(saved.items[0].modifiers.cupNames).toEqual(['Ana', 'Ben', 'Cara', 'Dave'])
    await adapter.close()
  })

  it('keeps cup names on the row that is read back out of storage', async () => {
    const adapter = await adapterWithCustomers()
    const draft = normalizeCandidate(
      { customer_name: 'Rina Cruz', items: [{ product_slug: 'matcha-latte', quantity: 2, cup_names: ['Ana', 'Ben'] }], address: 'Makati' },
      'raw',
    )
    const saved = await confirmImportDraft(adapter, applyCustomerMatch(draft, await adapter.listCustomers(), await adapter.listOrders()))
    const reloaded = (await adapter.listOrders()).find((order) => order.id === saved.id)
    expect(reloaded?.items[0].modifiers.cupNames).toEqual(['Ana', 'Ben'])
    await adapter.close()
  })

  it('omits the field entirely for an order with no names, leaving the stored shape unchanged', async () => {
    const adapter = await adapterWithCustomers()
    const draft = normalizeCandidate({ customer_name: 'Rina Cruz', items: [{ product_slug: 'matcha-latte', quantity: 2 }], address: 'Makati' }, 'raw')
    const saved = await confirmImportDraft(adapter, applyCustomerMatch(draft, await adapter.listCustomers(), await adapter.listOrders()))
    expect(saved.items[0].modifiers).not.toHaveProperty('cupNames')
    await adapter.close()
  })

  it('round-trips names through edit: reopen, rename one cup, save', async () => {
    const adapter = await adapterWithCustomers()
    const draft = normalizeCandidate(
      { customer_name: 'Rina Cruz', items: [{ product_slug: 'matcha-latte', quantity: 3, cup_names: ['Ana', 'Ben', 'Cara'] }], address: 'Makati' },
      'raw',
    )
    const saved = await confirmImportDraft(adapter, applyCustomerMatch(draft, await adapter.listCustomers(), await adapter.listOrders()))

    const editable = storedOrderToImportDraft(saved, 'Rina Cruz')
    expect(editable.items[0].cupNames).toEqual(['Ana', 'Ben', 'Cara'])

    const renamed = { ...editable, items: [{ ...editable.items[0], ...setCupName(editable.items[0], 1, 'Bea') }] }
    const updated = await saveOrderEdit(adapter, saved, renamed)
    expect(updated.items[0].modifiers.cupNames).toEqual(['Ana', 'Bea', 'Cara'])
    await adapter.close()
  })

  it('drops every name when the owner clears them in the editor', async () => {
    const adapter = await adapterWithCustomers()
    const draft = normalizeCandidate(
      { customer_name: 'Rina Cruz', items: [{ product_slug: 'matcha-latte', quantity: 2, cup_names: ['Ana', 'Ben'] }], address: 'Makati' },
      'raw',
    )
    const saved = await confirmImportDraft(adapter, applyCustomerMatch(draft, await adapter.listCustomers(), await adapter.listOrders()))
    const editable = storedOrderToImportDraft(saved, 'Rina Cruz')
    let item = editable.items[0]
    item = { ...item, ...setCupName(item, 1, '') }
    item = { ...item, ...setCupName(item, 0, '') }
    const updated = await saveOrderEdit(adapter, saved, { ...editable, items: [item] })
    expect(updated.items[0].modifiers).not.toHaveProperty('cupNames')
    await adapter.close()
  })
})

describe('setCupName', () => {
  const item = { id: 'i1', productSlug: 'matcha-latte', quantity: 3, level: 1 as const, powder: 'yumeno' as const }

  it('sets one cup without disturbing the others', () => {
    expect(setCupName({ ...item, cupNames: ['Ana', 'Ben', 'Cara'] }, 1, 'Bea').cupNames).toEqual(['Ana', 'Bea', 'Cara'])
  })

  it('trims trailing blanks so an untouched item stores nothing', () => {
    expect(setCupName(item, 0, '').cupNames).toEqual([])
  })

  it('keeps an interior blank so later cups do not shift while typing', () => {
    expect(setCupName(item, 2, 'Cara').cupNames).toEqual(['', '', 'Cara'])
  })

  it('caps a pasted name at the maximum length', () => {
    expect(setCupName(item, 0, 'A'.repeat(200)).cupNames?.[0]).toHaveLength(MAX_CUP_NAME_LENGTH)
  })
})
