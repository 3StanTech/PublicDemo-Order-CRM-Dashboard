import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getRuntimeCatalog, setRuntimeCatalogSettings } from '../../domain/catalog'
import { priceOrder } from '../../domain/pricing'
import { LocalAdapter, resetLocalAdapterMemoryForTests } from '../../data/local-adapter'
import { buildViberChatGptPrompt } from '../import/prompt'
import {
  DEFAULT_DASHBOARD_SETTINGS,
  ORDER_DASHBOARD_SETTINGS_KEY,
  loadDashboardSettings,
  saveDashboardSettings,
  type DashboardSettings,
} from './settings-store'

describe('dashboard settings catalog bridge', () => {
  beforeEach(() => { resetLocalAdapterMemoryForTests(); setRuntimeCatalogSettings(null) })
  afterEach(() => setRuntimeCatalogSettings(null))

  it('persists owner settings and applies them to deterministic pricing and the prompt', async () => {
    const adapter = await LocalAdapter.create()
    const configured: DashboardSettings = {
      ...DEFAULT_DASHBOARD_SETTINGS,
      productBasePrices: { ...DEFAULT_DASHBOARD_SETTINGS.productBasePrices, 'matcha-latte': 21000 },
      gCashNumber: '09171234567',
      openDays: ['tuesday', 'wednesday'],
    }

    await saveDashboardSettings(adapter, configured)
    expect(await adapter.getSetting(ORDER_DASHBOARD_SETTINGS_KEY)).toMatchObject({ value: expect.objectContaining({ gCashNumber: '09171234567', orderCutoff: '20:00' }) })
    expect(priceOrder({ items: [{ productSlug: 'matcha-latte', quantity: 1, modifiers: { level: 2, powder: 'yumeno' } }] }).totals.totalCentavos).toBe(23500)
    expect(buildViberChatGptPrompt()).toContain('Matcha Latte: 210 PHP')

    await adapter.close()
  })

  it('restores defaults and removes unavailable products from runtime import catalog', async () => {
    const adapter = await LocalAdapter.create()
    await saveDashboardSettings(adapter, { ...DEFAULT_DASHBOARD_SETTINGS, productAvailability: { ...DEFAULT_DASHBOARD_SETTINGS.productAvailability, 'matcha-latte': false } })
    expect(getRuntimeCatalog()['matcha-latte']).toBeUndefined()
    await saveDashboardSettings(adapter, DEFAULT_DASHBOARD_SETTINGS)
    expect((await loadDashboardSettings(adapter)).productBasePrices['matcha-latte']).toBe(20000)
    expect(priceOrder({ items: [{ productSlug: 'matcha-latte', quantity: 1, modifiers: { level: 1, powder: 'yumeno' } }] }).totals.totalCentavos).toBe(20000)
    await adapter.close()
  })
})
