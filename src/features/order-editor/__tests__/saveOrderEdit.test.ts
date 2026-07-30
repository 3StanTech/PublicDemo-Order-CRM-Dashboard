import { describe, expect, it } from 'vitest'
import { LocalAdapter, resetLocalAdapterMemoryForTests } from '../../../data/local-adapter'
import { demoOrders } from '../../../demo/seed'
import { blankItem } from '../order-draft-helpers'
import { storedOrderToImportDraft } from '../orderDraftMapping'
import { saveOrderEdit } from '../saveOrderEdit'

describe('saveOrderEdit', () => {
  it('changes what listOrders and getOrder return and leaves no orphan order_items', async () => {
    resetLocalAdapterMemoryForTests()
    const adapter = await LocalAdapter.create()
    const order = (await adapter.listOrders()).find((entry) => entry.id === demoOrders[0].id)!
    expect(order.items).toHaveLength(1)
    const originalItemId = order.items[0].id

    const draft = storedOrderToImportDraft(order, 'Mika Santos')
    const edited = { ...draft, items: [{ ...draft.items[0], quantity: 3 }, { ...blankItem(), productSlug: 'hojicha-latte' as const }] }

    await saveOrderEdit(adapter, order, edited)

    const reloadedList = await adapter.listOrders()
    const fromList = reloadedList.find((entry) => entry.id === order.id)!
    expect(fromList.items).toHaveLength(2)
    expect(fromList.items.some((item) => item.id === originalItemId)).toBe(false)

    const fromGet = await adapter.getOrder(order.id)
    expect(fromGet!.items).toHaveLength(2)

    // No orphaned order_items belonging to the edited order beyond the two current ones.
    const orderItemsForOrder = await adapter.listOrderItems(order.id)
    expect(orderItemsForOrder).toHaveLength(2)

    await adapter.close()
  })

  it('reprices through the pricing engine rather than trusting any caller-supplied total', async () => {
    resetLocalAdapterMemoryForTests()
    const adapter = await LocalAdapter.create()
    const order = (await adapter.listOrders()).find((entry) => entry.id === demoOrders[0].id)!
    const draft = storedOrderToImportDraft(order, 'Mika Santos')

    // Bump quantity from 2 to 5 and try to smuggle a fabricated total through unrelated fields.
    const edited = { ...draft, items: [{ ...draft.items[0], quantity: 5 }], notes: 'attempted total: 1' }

    const saved = await saveOrderEdit(adapter, order, edited)

    // Matcha Latte level 1 / yumeno is 20000 centavos per the demo catalog; five units price to 100000.
    expect(saved.subtotalCentavos).toBe(100000)
    expect(saved.totalCentavos).toBe(saved.subtotalCentavos + saved.deliveryFeeCentavos)
    expect(saved.items[0].quantity).toBe(5)
    expect(saved.items[0].lineTotalCentavos).toBe(100000)

    await adapter.close()
  })

  it('preserves id, customerId, status, paymentReceived, createdAt, and rawSource', async () => {
    resetLocalAdapterMemoryForTests()
    const adapter = await LocalAdapter.create()
    const order = (await adapter.listOrders()).find((entry) => entry.id === demoOrders[0].id)!
    const draft = storedOrderToImportDraft(order, 'Mika Santos')
    const edited = { ...draft, notes: 'Leave with the guard', address: 'New address' }

    const saved = await saveOrderEdit(adapter, order, edited)

    expect(saved.id).toBe(order.id)
    expect(saved.customerId).toBe(order.customerId)
    expect(saved.status).toBe(order.status)
    expect(saved.paymentReceived).toBe(order.paymentReceived)
    expect(saved.createdAt).toBe(order.createdAt)
    expect(saved.rawSource).toBe(order.rawSource)
    expect(saved.notes).toBe('Leave with the guard')
    expect(saved.addressSnapshot).toBe('New address')

    await adapter.close()
  })
})
