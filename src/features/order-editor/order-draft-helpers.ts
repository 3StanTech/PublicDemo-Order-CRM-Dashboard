/**
 * Pure `ImportDraft` constructors and transforms for the order editor.
 *
 * These live outside `OrderEditorCard.tsx` because a component file that also
 * exports non-components breaks React Fast Refresh — do not move them back.
 */
import type { ImportDraft, ImportItem, ImportThermalBag } from '../import/types'
import { MAX_CUP_NAME_LENGTH, padCupNames } from '../import/cup-names'

export function blankItem(): ImportItem { return { id: crypto.randomUUID(), productSlug: 'matcha-latte', quantity: 1, level: 1, powder: 'yumeno' } }
export function blankBag(): ImportThermalBag { return { id: crypto.randomUUID(), coveredCupCount: 1 } }

export function updateItem(draft: ImportDraft, itemId: string, patch: Partial<ImportItem>): ImportDraft {
  return { ...draft, items: draft.items.map((item) => item.id === itemId ? { ...item, ...patch } : item) }
}

/**
 * Sets one cup's name. Trailing blanks are trimmed so an untouched item never
 * carries an empty `cupNames` array into storage.
 */
export function setCupName(item: ImportItem, cupIndex: number, value: string): Partial<ImportItem> {
  const names = padCupNames(item.cupNames, item.quantity).map((name, index) => index === cupIndex ? value.slice(0, MAX_CUP_NAME_LENGTH) : name)
  while (names.length > 0 && names[names.length - 1].trim() === '') names.pop()
  return { cupNames: names.map((name) => name.trim()) }
}
