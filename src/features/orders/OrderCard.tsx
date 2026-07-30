import { useState } from 'react'
import type { StoredCustomer, StoredOrder } from '../../data/types'
import { formatCupNames } from '../import/cup-names'
import { cupCount, formatPhp } from './order-display'
import { canAdvance, canCancel, nextAction, nextStatus, statusLabels } from './orderLifecycle'
import { lifecycleTimestampLines } from './order-timestamps'

type OrderCardProps = {
  order: StoredOrder
  customer: StoredCustomer | undefined
  busy?: boolean
  onAdvance: (order: StoredOrder) => Promise<void>
  onCancel: (order: StoredOrder) => Promise<void>
  /** Opens the shared order editor prefilled from this order. Renders an "Edit order" button when provided. */
  onEdit?: (order: StoredOrder) => void
  /** Hard-deletes the order (distinct from "Cancel order", which only sets status to cancelled). Renders a "Delete order" button, gated by an inline confirmation, when provided. */
  onDelete?: (order: StoredOrder) => Promise<void>
}

export function OrderCard({ order, customer, busy = false, onAdvance, onCancel, onEdit, onDelete }: OrderCardProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const next = nextStatus(order.status)

  const confirmDelete = async () => {
    if (!onDelete) return
    setDeleting(true)
    try {
      await onDelete(order)
    } finally {
      setDeleting(false)
      setConfirmingDelete(false)
    }
  }

  return (
    <article className="min-w-0 rounded-2xl border border-[#4F74C8]/20 bg-white p-4 shadow-sm transition-shadow duration-200 hover:shadow-md">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold text-[#20242F]">{customer?.name ?? 'Unknown customer'}</h3>
          <p className="mt-1 text-sm text-[#4A5365]">{cupCount(order)} {cupCount(order) === 1 ? 'cup' : 'cups'} · {formatPhp(order.totalCentavos)}</p>
        </div>
      </div>

      <ul className="mt-3 space-y-1">
        {order.items.map((item) => {
          const names = formatCupNames(item.modifiers.cupNames)
          return (
            <li key={item.id} className="break-words text-sm text-[#4A5365]">
              <span className="font-semibold text-[#20242F]">{item.quantity}× {item.productName}</span>
              {names && <> · <span className="font-semibold text-[#36579E]">{names}</span></>}
            </li>
          )
        })}
      </ul>

      <p className="mt-3 break-words text-sm text-[#4A5365]">
        <span className="font-semibold text-[#20242F]">Address:</span> {order.addressSnapshot || 'Address not provided'}
      </p>
      {customer?.phone && <p className="mt-1 text-sm text-[#4A5365]">{customer.phone}</p>}
      <p className="mt-3 text-sm font-semibold text-[#4F74C8]">Next: {nextAction(order)}</p>
      {lifecycleTimestampLines(order).map((line) => (
        <p key={line} className="mt-1 text-sm text-[#4A5365]">{line}</p>
      ))}

      <div className="mt-4 flex flex-wrap gap-2">
        {next && canAdvance(order) && (
          <button type="button" disabled={busy} onClick={() => void onAdvance(order)} className="rounded-xl bg-[#4F74C8] px-3 py-2 text-sm font-bold text-white shadow-sm transition duration-200 hover:bg-[#365AA9] active:scale-[0.97] motion-safe:transition-transform disabled:opacity-50 disabled:active:scale-100">
            Mark {statusLabels[next]}
          </button>
        )}
        {canCancel(order.status) && (
          <button type="button" disabled={busy} onClick={() => void onCancel(order)} className="rounded-xl px-3 py-2 text-sm font-semibold text-rose-700 underline underline-offset-2 transition-colors duration-200 hover:bg-rose-50 disabled:opacity-50">
            Cancel order
          </button>
        )}
        {onEdit && (
          <button type="button" disabled={busy} onClick={() => onEdit(order)} className="rounded-xl border border-[#4F74C8]/35 px-3 py-2 text-sm font-semibold text-[#36579E] transition-colors duration-200 hover:bg-[#4F74C8]/10 active:scale-[0.97] motion-safe:transition-transform disabled:opacity-50 disabled:active:scale-100">
            Edit order
          </button>
        )}
        {onDelete && !confirmingDelete && (
          <button type="button" disabled={busy} onClick={() => setConfirmingDelete(true)} className="rounded-xl px-3 py-2 text-sm font-semibold text-rose-700 underline underline-offset-2 transition-colors duration-200 hover:bg-rose-50 disabled:opacity-50">
            Delete order
          </button>
        )}
      </div>

      {confirmingDelete && (
        <div role="alert" className="motion-fade-up mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-950">
          <p>Delete this order permanently? This cannot be undone.</p>
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy || deleting} onClick={() => void confirmDelete()} className="rounded-lg bg-rose-700 px-3 py-1.5 font-bold text-white transition duration-200 hover:bg-rose-800 active:scale-[0.97] motion-safe:transition-transform disabled:opacity-50">Confirm delete order</button>
            <button type="button" disabled={busy || deleting} onClick={() => setConfirmingDelete(false)} className="rounded-lg px-3 py-1.5 font-semibold text-[#36579E] transition-colors duration-200 hover:bg-black/5 disabled:opacity-50">Keep order</button>
          </div>
        </div>
      )}
    </article>
  )
}
