/**
 * Delivery-day arithmetic for the Today board. Open days are Sun/Tue/Wed/Thu/Fri.
 *
 * This lives outside `TodayBoard.tsx` because a component file that also exports
 * non-components breaks React Fast Refresh — do not move it back.
 */

/** Day-of-week indices the café delivers on: Sun, Tue, Wed, Thu, Fri. */
const deliveryDays = new Set([0, 2, 3, 4, 5])

function asDateInput(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

/** The next operational delivery day, treating an open day as the current run. */
export function relevantDeliveryDate(now = new Date()): string {
  const next = new Date(now)
  while (!deliveryDays.has(next.getDay())) next.setDate(next.getDate() + 1)
  return asDateInput(next)
}
