import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { StorageAdapter, StoredCustomer, StoredOrder } from '../../data/types'
import { confirmImportDraft } from '../import/persist'
import type { ImportDraft } from '../import/types'
import { OrderEditorCard } from './OrderEditorCard'
import { saveOrderEdit } from './saveOrderEdit'

type OrderEditorModalProps = {
  adapter: StorageAdapter
  customers: StoredCustomer[]
  orders: StoredOrder[]
  initialDraft: ImportDraft
  /** Pass the existing order to edit it in place; pass null to create a brand-new order. */
  editingOrder: StoredOrder | null
  title: string
  onClose: () => void
  onSaved: (order: StoredOrder) => void
}

/** Shared modal shell around the extracted order editor, used for manual new orders, editing an existing order, and repeat-last-order. */
export function OrderEditorModal({ adapter, customers, orders, initialDraft, editingOrder, title, onClose, onSaved }: OrderEditorModalProps) {
  const [draft, setDraft] = useState(initialDraft)
  const [confirming, setConfirming] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Escape closes the editor, and focus starts inside it, as a dialog is expected to behave.
  useEffect(() => {
    panelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const confirm = async () => {
    if (confirming) return
    setConfirming(true)
    setMessage(null)
    try {
      const saved = editingOrder ? await saveOrderEdit(adapter, editingOrder, draft) : await confirmImportDraft(adapter, draft)
      onSaved(saved)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Order could not be saved')
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="motion-fade-in fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div ref={panelRef} tabIndex={-1} className="motion-fade-up max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-[#FBF3D5] p-4 shadow-lg outline-none sm:rounded-3xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-black text-[#20242f]">{title}</h2>
          <button type="button" aria-label="Close editor" onClick={onClose} className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-[#4A5365] transition-colors duration-200 hover:bg-black/5 active:scale-95 motion-safe:transition-transform">
            <X size={20} />
          </button>
        </div>
        {message && <p role="alert" className="motion-fade-in mb-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">{message}</p>}
        <OrderEditorCard draft={draft} customers={customers} orders={orders} confirming={confirming} onChange={setDraft} onConfirm={() => void confirm()} />
      </div>
    </div>
  )
}
