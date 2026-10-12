import { useEffect, useState } from 'react'
import { useSyncGate } from '../../components/layout/AppShell'

/** How long "Checking…" may show before the chip hides (Design Decision 4). */
const CHECKING_VISIBLE_MS = 20_000

type ChipState = 'none' | 'checking' | 'verified' | 'mismatch'

const chipCopy: Record<Exclude<ChipState, 'none'>, { label: string; className: string }> = {
  verified: { label: 'Server-verified', className: 'border-emerald-300 bg-emerald-50 text-emerald-800' },
  mismatch: { label: 'Not verified', className: 'border-amber-300 bg-amber-50 text-amber-900' },
  checking: { label: 'Checking…', className: 'border-[#4F74C8]/25 bg-[#4F74C8]/10 text-[#36579E]' },
}

/** The server's re-pricing result for a saved order; sample orders the visitor never changed show nothing. */
export function VerificationChip({ orderId }: { orderId: string }) {
  const { synced } = useSyncGate()
  const [chip, setChip] = useState<ChipState>('none')

  useEffect(() => {
    if (!synced) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = synced.subscribeVerification(orderId, (state) => {
      clearTimeout(timer)
      if (state.status !== 'checking') { setChip(state.status); return }
      const remaining = state.since + CHECKING_VISIBLE_MS - Date.now()
      if (remaining <= 0) { setChip('none'); return }
      setChip('checking')
      timer = setTimeout(() => setChip('none'), remaining)
    })
    return () => { clearTimeout(timer); unsubscribe() }
  }, [synced, orderId])

  if (!synced || chip === 'none') return null
  const { label, className } = chipCopy[chip]
  return <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-bold ${className}`}>{label}</span>
}
