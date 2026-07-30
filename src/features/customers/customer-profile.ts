import type { JsonValue, Setting, StorageAdapter } from '../../data/types'

export type CustomerProfile = {
  notes: string
  address: string
  preferences: string
}

const emptyProfile: CustomerProfile = { notes: '', address: '', preferences: '' }

export function customerProfileKey(customerId: string): string {
  return `customer:${customerId}:profile`
}

function isProfile(value: JsonValue): value is CustomerProfile & { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && typeof value.notes === 'string'
    && typeof value.address === 'string'
    && typeof value.preferences === 'string'
}

export async function loadCustomerProfile(adapter: StorageAdapter, customerId: string): Promise<CustomerProfile> {
  const setting = await adapter.getSetting(customerProfileKey(customerId))
  if (!setting || !isProfile(setting.value)) return emptyProfile
  return {
    notes: setting.value.notes,
    address: setting.value.address,
    preferences: setting.value.preferences,
  }
}

export async function saveCustomerProfile(
  adapter: StorageAdapter,
  customerId: string,
  profile: CustomerProfile,
): Promise<Setting> {
  const now = new Date().toISOString()
  return adapter.setSetting({
    id: crypto.randomUUID(),
    key: customerProfileKey(customerId),
    value: profile,
    createdAt: now,
    updatedAt: now,
  })
}
