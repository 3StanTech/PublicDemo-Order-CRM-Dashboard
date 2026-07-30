import { useEffect, useState } from 'react'
import { createStorageAdapter } from '../data/adapter'
import type { StorageAdapter } from '../data/types'
import { ImportWorkspace } from '../features/import/ImportWorkspace'

export function ImportPage() {
  const [adapter, setAdapter] = useState<StorageAdapter | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { void createStorageAdapter().then(setAdapter).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Storage could not be initialized')) }, [])
  if (error) return <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}</p>
  if (!adapter) return <p className="text-sm text-[#4A5365]">Preparing local order storage…</p>
  return <ImportWorkspace adapter={adapter} />
}
