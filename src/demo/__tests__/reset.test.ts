import { describe, expect, it, vi } from 'vitest'
import { LOCAL_DATABASE_NAME } from '../../data/local-adapter'
import { resetDemoData } from '../reset'

describe('resetDemoData', () => {
  it('closes the adapter, deletes the IndexedDB database by name, and reloads', async () => {
    const closeAdapter = vi.fn().mockResolvedValue(undefined)
    const deleteDatabase = vi.fn().mockResolvedValue(undefined)
    const reload = vi.fn()

    await resetDemoData({ closeAdapter, deleteDatabase, reload })

    expect(closeAdapter).toHaveBeenCalledOnce()
    expect(deleteDatabase).toHaveBeenCalledWith(LOCAL_DATABASE_NAME)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('still deletes and reloads when no closeAdapter is provided', async () => {
    const deleteDatabase = vi.fn().mockResolvedValue(undefined)
    const reload = vi.fn()

    await resetDemoData({ deleteDatabase, reload })

    expect(deleteDatabase).toHaveBeenCalledWith(LOCAL_DATABASE_NAME)
    expect(reload).toHaveBeenCalledOnce()
  })
})
