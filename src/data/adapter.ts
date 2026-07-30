import type { StorageAdapter } from './types'
import { LocalAdapter } from './local-adapter'

export async function createStorageAdapter(): Promise<StorageAdapter> {
  return LocalAdapter.create()
}
