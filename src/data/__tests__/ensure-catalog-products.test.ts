import { describe, expect, it, beforeEach } from 'vitest'
import { LocalAdapter, resetLocalAdapterMemoryForTests } from '../local-adapter'
import { ensureCatalogProducts } from '../ensure-catalog-products'
import { PRODUCT_CATALOG } from '../../domain/catalog'
import { normalizeCandidate } from '../../features/import/parser'
import { applyCustomerMatch } from '../../features/import/customer-matching'
import { confirmImportDraft } from '../../features/import/persist'
import { saveOrderEdit } from '../../features/order-editor/saveOrderEdit'
import { storedOrderToImportDraft } from '../../features/order-editor/orderDraftMapping'

const CATALOG_NAMES = Object.values(PRODUCT_CATALOG).map((product) => product.name)

/**
 * Strips seeded product rows first so the back-fill path is exercised. The rest
 * of the suite runs against a fully seeded LocalAdapter and would miss this.
 */
async function adapterWithNoProducts() {
  resetLocalAdapterMemoryForTests()
  const adapter = await LocalAdapter.create()
  for (const product of await adapter.listProducts()) await adapter.deleteProduct(product.id)
  expect(await adapter.listProducts()).toHaveLength(0)
  return adapter
}

function draft(customerName = 'Irish Mateo') {
  return normalizeCandidate(
    { customer_name: customerName, items: [{ product_slug: 'matcha-latte', quantity: 1 }], address: 'Walnut 33' },
    'raw',
  )
}

describe('ensureCatalogProducts', () => {
  beforeEach(() => resetLocalAdapterMemoryForTests())

  it('back-fills every catalog product into an empty registry', async () => {
    const adapter = await adapterWithNoProducts()
    const byName = await ensureCatalogProducts(adapter)
    expect([...byName.keys()].sort()).toEqual([...CATALOG_NAMES].sort())
    expect(await adapter.listProducts()).toHaveLength(CATALOG_NAMES.length)
    await adapter.close()
  })

  it('is idempotent — a second call creates nothing further', async () => {
    const adapter = await adapterWithNoProducts()
    await ensureCatalogProducts(adapter)
    const afterFirst = await adapter.listProducts()
    await ensureCatalogProducts(adapter)
    expect(await adapter.listProducts()).toHaveLength(afterFirst.length)
    await adapter.close()
  })

  it('leaves already-seeded rows untouched, preserving their ids', async () => {
    resetLocalAdapterMemoryForTests()
    const adapter = await LocalAdapter.create()
    const before = await adapter.listProducts()
    await ensureCatalogProducts(adapter)
    const after = await adapter.listProducts()
    expect(after.map((product) => product.id).sort()).toEqual(before.map((product) => product.id).sort())
    await adapter.close()
  })

  it('back-fills a single missing row without duplicating the others', async () => {
    resetLocalAdapterMemoryForTests()
    const adapter = await LocalAdapter.create()
    const matcha = (await adapter.listProducts()).find((product) => product.name === 'Matcha Latte')!
    await adapter.deleteProduct(matcha.id)

    await ensureCatalogProducts(adapter)

    const after = await adapter.listProducts()
    expect(after).toHaveLength(CATALOG_NAMES.length)
    expect(after.filter((product) => product.name === 'Matcha Latte')).toHaveLength(1)
    await adapter.close()
  })
})

describe('confirming an order against an unseeded deployment', () => {
  it('no longer fails with "Storage is missing the catalog product"', async () => {
    const adapter = await adapterWithNoProducts()
    const matched = applyCustomerMatch(draft(), await adapter.listCustomers(), await adapter.listOrders())
    const saved = await confirmImportDraft(adapter, matched)
    expect(saved.items[0].productName).toBe('Matcha Latte')
    expect(saved.totalCentavos).toBe(20000)
    await adapter.close()
  })

  it('links the order item to the back-filled product row', async () => {
    const adapter = await adapterWithNoProducts()
    const matched = applyCustomerMatch(draft(), await adapter.listCustomers(), await adapter.listOrders())
    const saved = await confirmImportDraft(adapter, matched)
    const products = await adapter.listProducts()
    expect(products.some((product) => product.id === saved.items[0].productId)).toBe(true)
    await adapter.close()
  })

  it('lets an existing order be edited on an unseeded deployment', async () => {
    resetLocalAdapterMemoryForTests()
    const adapter = await LocalAdapter.create()
    const matched = applyCustomerMatch(draft(), await adapter.listCustomers(), await adapter.listOrders())
    const saved = await confirmImportDraft(adapter, matched)

    for (const product of await adapter.listProducts()) await adapter.deleteProduct(product.id)

    const editable = storedOrderToImportDraft(saved, 'Irish Mateo')
    const updated = await saveOrderEdit(adapter, saved, { ...editable, items: [{ ...editable.items[0], quantity: 2 }] })
    expect(updated.items[0].quantity).toBe(2)
    expect(updated.totalCentavos).toBe(40000)
    await adapter.close()
  })
})
