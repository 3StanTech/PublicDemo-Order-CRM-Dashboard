import { useEffect, useState } from 'react'
import { createStorageAdapter } from '../data/adapter'
import type { StorageAdapter } from '../data/types'
import { InsightsFeature } from '../features/insights/InsightsFeature'

export function InsightsPage() {
  const [adapter, setAdapter] = useState<StorageAdapter | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void createStorageAdapter().then((storage) => { if (active) setAdapter(storage) }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Storage could not be started.')
    })
    return () => { active = false }
  }, [])

  if (error) return <p role="alert" className="rounded-2xl bg-red-50 p-4 font-semibold text-red-700">{error}</p>
  if (!adapter) return <section><h1 className="text-3xl font-black tracking-tight text-[#20242F]">Insights</h1><p className="pt-4 text-sm font-semibold text-[#4A5365]">Starting insights…</p></section>
  return <InsightsFeature adapter={adapter} />
}
