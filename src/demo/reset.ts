import { LOCAL_DATABASE_NAME } from '../data/local-adapter'
import { clearRemoteDemoData, storageMode } from '../data/adapter'

export type ResetDemoDataOptions = {
  /** Close the open storage adapter before deleting the data. */
  closeAdapter?: () => Promise<void>
  /** Override IndexedDB deletion (tests). */
  deleteDatabase?: (name: string) => Promise<void>
  /** Override deletion of the visitor's Firestore changes (tests). */
  clearRemoteData?: () => Promise<void>
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
 * Clears this visitor's changes and reloads so the sample data shows fresh.
 * Local build: deletes the IndexedDB database (LocalAdapter re-seeds).
 * Firestore build: deletes the visitor's saved changes; the seed is rebuilt in
 * the browser on reload.
 */
export async function resetDemoData(options: ResetDemoDataOptions = {}): Promise<void> {
  if (options.closeAdapter) {
    await options.closeAdapter()
  }

  if (storageMode() === 'firestore') {
    await (options.clearRemoteData ?? clearRemoteDemoData)()
  } else {
    const deleteDatabase = options.deleteDatabase ?? defaultDeleteDatabase
    await deleteDatabase(LOCAL_DATABASE_NAME)
  }

  const reload = options.reload ?? (() => {
    window.location.reload()
  })
  reload()
}
