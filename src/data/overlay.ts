/**
 * Pure merge of the browser-generated seed with a visitor's saved changes.
 *
 * The seed is rebuilt in every browser from a fixed RNG seed with stable IDs;
 * Firestore holds only what the visitor created, edited or deleted. A delta
 * either replaces a record (upsert, or a brand-new record) or removes it
 * (tombstone). No I/O here, so the merge is easy to reason about and test.
 */

export type Delta<T> = { deleted: true } | { deleted: false; record: T }

/** Code-unit string order, which is how IndexedDB orders string keys. */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Applies deltas to a seed collection. `keyOf` maps a record to its delta key
 * (the record ID, or the settings document ID). The result is sorted by record
 * ID so listing order matches `LocalAdapter`, whose IndexedDB `getAll` returns
 * records in key order.
 */
export function applyDeltas<T extends { id: string }>(
  seed: readonly T[],
  deltas: ReadonlyMap<string, Delta<T>>,
  keyOf: (record: T) => string = (record) => record.id,
): T[] {
  const merged = new Map<string, T>()
  for (const record of seed) merged.set(keyOf(record), record)
  for (const [key, delta] of deltas) {
    if (delta.deleted) merged.delete(key)
    else merged.set(key, delta.record)
  }
  return [...merged.values()].sort((a, b) => compareIds(a.id, b.id))
}

/** The record a key resolves to after deltas, or null when absent or deleted. */
export function resolveRecord<T extends { id: string }>(
  seed: readonly T[],
  deltas: ReadonlyMap<string, Delta<T>>,
  key: string,
  keyOf: (record: T) => string = (record) => record.id,
): T | null {
  const delta = deltas.get(key)
  if (delta) return delta.deleted ? null : delta.record
  return seed.find((record) => keyOf(record) === key) ?? null
}
