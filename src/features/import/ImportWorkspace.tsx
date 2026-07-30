import { Clipboard } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getRuntimeCatalog } from '../../domain/catalog'
import type { StorageAdapter, StoredCustomer, StoredOrder } from '../../data/types'
import { loadDashboardSettings } from '../settings/settings-store'
import { FieldLabel, OrderEditorCard } from '../order-editor/OrderEditorCard'
import { applyCustomerMatch } from './customer-matching'
import { parseLocalInput } from './parser'
import { confirmImportDraft } from './persist'
import { buildViberChatGptPrompt } from './prompt'
import type { ImportDraft } from './types'

type ImportWorkspaceProps = { adapter: StorageAdapter }

export function ImportWorkspace({ adapter }: ImportWorkspaceProps) {
  const [rawText, setRawText] = useState('')
  const [drafts, setDrafts] = useState<ImportDraft[]>([])
  const [customers, setCustomers] = useState<StoredCustomer[]>([])
  const [orders, setOrders] = useState<StoredOrder[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [, setCatalogVersion] = useState(0)

  useEffect(() => {
    let active = true
    const refreshCatalog = () => { void loadDashboardSettings(adapter).then(() => { if (active) setCatalogVersion((version) => version + 1) }) }
    refreshCatalog()
    const unsubscribe = adapter.subscribe((change) => { if (change.collection === 'settings') refreshCatalog() })
    return () => { active = false; unsubscribe() }
  }, [adapter])
  useEffect(() => { void Promise.all([adapter.listCustomers(), adapter.listOrders()]).then(([nextCustomers, nextOrders]) => { setCustomers(nextCustomers); setOrders(nextOrders) }) }, [adapter])
  const setDraft = (next: ImportDraft) => setDrafts((current) => current.map((draft) => draft.id === next.id ? next : draft))
  const parse = () => {
    setMessage(null)
    const local = parseLocalInput(rawText)
    if (local.kind === 'empty') {
      setMessage('Paste an order conversation, JSON object, or JSON Lines first.')
      return
    }
    if (local.kind === 'local') {
      setDrafts(local.drafts.map((draft) => applyCustomerMatch(draft, customers, orders)))
      setMessage('Parsed locally — no network request was made.')
      return
    }
    setMessage('Paste JSON or JSON Lines. This demo parses entirely in your browser — it makes no network requests.')
  }
  const copyPrompt = async () => { await navigator.clipboard.writeText(buildViberChatGptPrompt(getRuntimeCatalog())); setMessage('The @ChatGPT-in-Viber extraction prompt is copied.') }
  const confirm = async (draft: ImportDraft) => {
    if (confirmingId) return
    setConfirmingId(draft.id); setMessage(null)
    try {
      const order = await confirmImportDraft(adapter, draft)
      const [nextCustomers, nextOrders] = await Promise.all([adapter.listCustomers(), adapter.listOrders()])
      setCustomers(nextCustomers); setOrders(nextOrders); setDrafts((current) => current.filter((entry) => entry.id !== draft.id)); setMessage(`Order ${order.id.slice(0, 8)} was created as new.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Order confirmation failed') } finally { setConfirmingId(null) }
  }
  return <section className="space-y-4"><header className="motion-fade-up"><h1 className="text-3xl font-black tracking-tight text-[#20242f]">Import</h1><p className="mt-1.5 max-w-xl text-sm leading-6 text-[#4A5365]">Order intake — paste JSON or JSON Lines. Prices are calculated only from the catalog after review.</p></header>
    <div className="rounded-2xl border border-[#4F74C8]/20 bg-[#FFFDF6] p-4 shadow-sm"><FieldLabel>Order text or JSON<textarea aria-label="Order text or JSON" value={rawText} onChange={(event) => setRawText(event.target.value)} placeholder={'{"customer_name":"Lorenzo Bautista","items":[...]}'} className="mt-1 min-h-44 w-full rounded-xl border border-[#4F74C8]/25 bg-white p-3 text-sm outline-none transition-colors focus:border-[#4F74C8] focus:ring-2 focus:ring-[#4F74C8]/20" /></FieldLabel><button type="button" onClick={parse} className="mt-3 flex min-h-12 w-full items-center justify-center rounded-xl bg-[#4F74C8] px-4 font-bold text-white shadow-sm transition duration-200 hover:bg-[#365AA9] active:scale-[0.98] motion-safe:transition-transform">Create editable drafts</button><button type="button" onClick={() => void copyPrompt()} className="mt-2 flex min-h-11 w-full items-center justify-center rounded-xl border border-[#4F74C8]/30 px-4 text-sm font-bold text-[#365aa8] transition-colors duration-200 hover:bg-[#4F74C8]/10 active:scale-[0.98] motion-safe:transition-transform"><Clipboard className="mr-2" size={16} />Copy @ChatGPT-in-Viber prompt</button></div>
    {message && <p role="status" className="motion-fade-in rounded-xl bg-[#4F74C8]/10 p-3 text-sm text-[#263d70]">{message}</p>}
    {drafts.map((draft) => <div key={draft.id} className="motion-fade-up"><OrderEditorCard draft={draft} customers={customers} orders={orders} confirming={confirmingId === draft.id} onChange={setDraft} onConfirm={() => void confirm(draft)} /></div>)}
  </section>
}
