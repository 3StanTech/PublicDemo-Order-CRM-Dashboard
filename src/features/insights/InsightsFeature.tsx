import { useEffect, useState } from 'react'
import type { StorageAdapter } from '../../data/types'
import { deriveBusinessInsights, type PeriodTotal } from './insight-stats'

function formatCurrency(centavos: number): string {
  return `₱${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function PeriodBars({ title, values }: { title: string; values: readonly PeriodTotal[] }) {
  const maxCups = Math.max(1, ...values.map((value) => value.cups))
  return (
    <section className="rounded-2xl border border-[#4F74C8]/20 bg-white p-4 shadow-sm" aria-labelledby={`${title}-heading`}>
      <h2 id={`${title}-heading`} className="text-lg font-black">{title}</h2>
      <div className="mt-4 space-y-4">
        {values.map((value) => (
          <div key={value.period}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm"><span className="font-bold">{value.period}</span><span className="text-[#4A5365]">{value.cups} cups · {formatCurrency(value.revenueCentavos)}</span></div>
            <div className="mt-2 h-3 overflow-hidden rounded-full bg-[#FBF3D5]" aria-label={`${value.period}: ${value.cups} cups and ${formatCurrency(value.revenueCentavos)}`}><div className="h-full rounded-full bg-[#4F74C8] transition-[width] duration-500 ease-out" style={{ width: `${Math.max(8, (value.cups / maxCups) * 100)}%` }} /></div>
          </div>
        ))}
        {values.length === 0 && <p className="text-sm text-[#4A5365]">No delivered-date data yet.</p>}
      </div>
    </section>
  )
}

export function InsightsFeature({ adapter }: { adapter: StorageAdapter }) {
  const [insights, setInsights] = useState<ReturnType<typeof deriveBusinessInsights> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    async function load(): Promise<void> {
      try {
        const orders = await adapter.listOrders()
        if (active) setInsights(deriveBusinessInsights(orders))
      } catch {
        if (active) setError('Insights could not be loaded.')
      }
    }
    void load()
    const unsubscribe = adapter.subscribe(() => { void load() })
    return () => { active = false; unsubscribe() }
  }, [adapter])

  if (error) return <p role="alert" className="motion-fade-in rounded-2xl bg-red-50 p-4 font-semibold text-red-700">{error}</p>
  if (!insights) return <section><h1 className="text-3xl font-black tracking-tight text-[#20242F]">Insights</h1><p className="motion-fade-in pt-4 text-sm font-semibold text-[#4A5365]">Loading insights…</p></section>
  return (
    <section aria-labelledby="insights-heading" className="motion-fade-in">
      <header>
        <h1 id="insights-heading" className="text-3xl font-black tracking-tight text-[#20242F]">Insights</h1>
        <p className="mt-1.5 text-sm text-[#4A5365]">Business pulse — cups, revenue, and repeat customers at a glance.</p>
      </header>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <article className="rounded-2xl bg-[#4F74C8] p-4 text-white shadow-sm"><p className="text-sm font-semibold text-white/75">Non-cancelled cups</p><p className="mt-2 text-3xl font-black">{insights.cups}</p></article>
        <article className="rounded-2xl border border-[#4F74C8]/25 bg-white p-4 shadow-sm"><p className="text-sm font-semibold text-[#4A5365]">Recognized revenue</p><p className="mt-2 text-2xl font-black text-[#20242F]">{formatCurrency(insights.recognizedRevenueCentavos)}</p></article>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <article className="rounded-2xl border border-[#4F74C8]/20 bg-white p-4 shadow-sm"><p className="text-sm font-semibold text-[#4A5365]">Repeat rate</p><p className="mt-2 text-2xl font-black text-[#4F74C8]">{Math.round(insights.repeatRate * 100)}%</p><p className="mt-1 text-xs text-[#4A5365]">Customers with 2+ orders</p></article>
        <article className="min-w-0 rounded-2xl border border-[#4F74C8]/20 bg-white p-4 shadow-sm"><p className="text-sm font-semibold text-[#4A5365]">Top drink</p><p className="mt-2 truncate text-lg font-black text-[#20242F]">{insights.topDrinks[0]?.name ?? '—'}</p><p className="mt-1 text-xs text-[#4A5365]">{insights.topDrinks[0]?.quantity ?? 0} cups</p></article>
      </div>
      <div className="mt-4 space-y-4">
        <PeriodBars title="Cups and revenue by day" values={insights.daily} />
        <PeriodBars title="Cups and revenue by week" values={insights.weekly} />
        <section className="rounded-2xl border border-[#4F74C8]/20 bg-white p-4 shadow-sm" aria-labelledby="top-drinks-heading">
          <h2 id="top-drinks-heading" className="text-lg font-black">Top drinks</h2>
          <ol className="mt-3 space-y-2">{insights.topDrinks.map((drink) => <li key={drink.name} className="flex justify-between gap-3 text-sm"><span className="font-semibold">{drink.name}</span><span className="shrink-0 text-[#4A5365]">{drink.quantity} cups</span></li>)}</ol>
        </section>
      </div>
    </section>
  )
}
