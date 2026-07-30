import { LOCAL_DATABASE_NAME } from '../data/local-adapter'

export type ResetDemoDataOptions = {
  /** Close the open storage adapter before deleting the database. */
  closeAdapter?: () => Promise<void>
  /** Override IndexedDB deletion (tests). */
  deleteDatabase?: (name: string) => Promise<void>
  /** Override page reload (tests). */
  reload?: () => void
}

function defaultDeleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      resolve()
      return
    }
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('Failed to delete demo database'))
    // Another connection may briefly block; treat blocked as success so reload can proceed.
    request.onblocked = () => resolve()
  })
}

/**
 * Closes local storage, deletes the IndexedDB database, and reloads so
 * LocalAdapter.create() re-seeds sample data from scratch.
 */
export async function resetDemoData(options: ResetDemoDataOptions = {}): Promise<void> {
  if (options.closeAdapter) {
    await options.closeAdapter()
  }

  const deleteDatabase = options.deleteDatabase ?? defaultDeleteDatabase
  await deleteDatabase(LOCAL_DATABASE_NAME)

  const reload = options.reload ?? (() => {
    window.location.reload()
  })
  reload()
}
