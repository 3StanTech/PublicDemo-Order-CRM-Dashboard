import { useEffect, useState } from 'react'
import { createStorageAdapter } from '../data/adapter'
import type { StorageAdapter } from '../data/types'
import { SettingsFeature } from '../features/settings/SettingsFeature'

export function SettingsPage() {
  const [adapter, setAdapter] = useState<StorageAdapter | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { let active = true; void createStorageAdapter().then((storage) => { if (active) setAdapter(storage) }).catch(() => { if (active) setError('Storage could not be started.') }); return () => { active = false } }, [])
  if (error) return <p role="alert" className="rounded-2xl bg-red-50 p-4 font-semibold text-red-700">{error}</p>
  if (!adapter) return <section aria-busy="true"><h1 className="text-3xl font-black tracking-tight text-[#20242F]">Settings</h1><p className="mt-4 text-sm font-semibold text-[#4A5365]">Starting business settings…</p></section>
  return <SettingsFeature adapter={adapter} />
}
