import type { OrderStatus } from '../../domain/contracts'
import type { StoredOrder } from '../../data/types'

export const operationalStatuses: readonly OrderStatus[] = [
  'new',
  'paid',
  'delivered',
  'cancelled',
]

export const statusLabels: Readonly<Record<OrderStatus, string>> = {
  new: 'New',
  paid: 'Paid',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}

const forwardTransitions: Readonly<Partial<Record<OrderStatus, OrderStatus>>> = {
  new: 'paid',
  paid: 'delivered',
}

export function nextStatus(status: OrderStatus): OrderStatus | null {
  return forwardTransitions[status] ?? null
}

export function canCancel(status: OrderStatus): boolean {
  return status !== 'delivered' && status !== 'cancelled'
}

export function canAdvance(order: StoredOrder): boolean {
  return nextStatus(order.status) !== null
}

export function nextAction(order: StoredOrder): string {
  const next = nextStatus(order.status)
  if (!next) return order.status === 'cancelled' ? 'Cancelled — no further action' : 'Delivered — complete'
  return `Mark ${statusLabels[next].toLowerCase()}`
}
