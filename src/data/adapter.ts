import type { StorageAdapter } from './types'
import type { FirestoreAdapter } from './firestore-adapter'
import { LocalAdapter } from './local-adapter'

export type { OrderVerificationState, SyncStatus } from './firestore-adapter'

/** The sync surface the UI uses for loading, error and "Server-verified" states. */
export type SyncedStorage = Pick<
  FirestoreAdapter,
  'ready' | 'syncStatus' | 'subscribeSyncStatus' | 'onSyncError' | 'retrySync' | 'verificationFor' | 'subscribeVerification'
>

/**
 * `local`: IndexedDB only (unit tests, the offline e2e build, `VITE_STORAGE=local`).
 * `firestore`: browser seed + the visitor's saved changes in Firestore.
 */
export function storageMode(): 'local' | 'firestore' {
  return import.meta.env.VITE_STORAGE === 'local' || import.meta.env.MODE === 'test' ? 'local' : 'firestore'
}

let firestoreAdapter: Promise<FirestoreAdapter> | null = null

function sharedFirestoreAdapter(): Promise<FirestoreAdapter> {
  // Loaded on demand so the Firebase SDK stays out of the local build's initial bundle.
  firestoreAdapter ??= import('./firestore-adapter').then(({ FirestoreAdapter }) => FirestoreAdapter.instance())
  firestoreAdapter.catch(() => { firestoreAdapter = null })
  return firestoreAdapter
}

export async function createStorageAdapter(): Promise<StorageAdapter> {
  if (storageMode() === 'local') return LocalAdapter.create()
  return sharedFirestoreAdapter()
}

/** The sync surface when the adapter syncs to Firestore; null for LocalAdapter (always ready, no chips). */
export function syncedStorage(adapter: StorageAdapter): SyncedStorage | null {
  return 'subscribeVerification' in adapter ? adapter as unknown as SyncedStorage : null
}

/** Deletes the visitor's saved changes in Firestore (reset). */
export async function clearRemoteDemoData(): Promise<void> {
  await (await sharedFirestoreAdapter()).clearVisitorData()
}
