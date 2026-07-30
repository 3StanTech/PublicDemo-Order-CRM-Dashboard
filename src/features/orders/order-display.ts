/**
 * Presentation helpers shared by the order surfaces (cards, history, editor).
 *
 * These live outside `OrderCard.tsx` because a component file that also exports
 * non-components breaks React Fast Refresh — do not move them back.
 */
import type { StoredOrder } from '../../data/types'

export function formatPhp(centavos: number): string {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(centavos / 100)
}

export function cupCount(order: StoredOrder): number {
  return order.items.reduce((total, item) => total + item.quantity, 0)
}
