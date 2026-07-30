import type { DrinkModifiers } from '../../domain/contracts'
import type { StoredItemModifiers } from '../../data/types'

/**
 * Per-cup names ("one for Ana, one for Ben") for orders a single customer
 * places on behalf of several people.
 *
 * These are a fulfillment label, never a priced option, so they deliberately
 * live outside `DrinkModifiers` — the pricing engine rebuilds that object from
 * catalog data and would strip them anyway. They ride along in the existing
 * `modifiers` jsonb column instead of a new one, which keeps the feature free
 * of any database migration.
 */
export const MAX_CUP_NAME_LENGTH = 40

export function normalizeCupNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim().slice(0, MAX_CUP_NAME_LENGTH))
    .filter(Boolean)
}

/**
 * Attaches cup names to priced modifiers on the way to storage. Absent names
 * leave the persisted shape byte-identical to what it was before this feature,
 * so existing orders and their tests are unaffected.
 */
export function withCupNames(modifiers: DrinkModifiers, cupNames: readonly string[] | undefined): StoredItemModifiers {
  const names = normalizeCupNames(cupNames)
  return names.length > 0 ? { ...modifiers, cupNames: names } : { ...modifiers }
}

/**
 * Expands names to one editable slot per cup so the editor can render a field
 * per cup. Blank slots are how "this cup is unnamed" is represented while
 * editing; `normalizeCupNames` drops them again at the storage boundary, so a
 * partially named item reopens with its names packed toward the first cups.
 */
export function padCupNames(cupNames: readonly string[] | undefined, quantity: number | null): string[] {
  const names = Array.isArray(cupNames) ? cupNames : []
  const slots = Number.isSafeInteger(quantity) && (quantity ?? 0) > 0 ? quantity as number : 0
  return Array.from({ length: slots }, (_, index) => names[index] ?? '')
}

/** Formats names for display next to a drink line, e.g. "Ana, Ben". */
export function formatCupNames(cupNames: readonly string[] | undefined): string {
  return normalizeCupNames(cupNames).join(', ')
}
