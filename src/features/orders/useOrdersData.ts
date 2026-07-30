import { useEffect, useState } from 'react'
import { createStorageAdapter } from '../../data/adapter'
import type { StorageAdapter, StoredCustomer, StoredOrder } from '../../data/types'

export type OrdersData = {
  adapter: StorageAdapter | null
  customers: StoredCustomer[]
  orders: StoredOrder[]
  loading: boolean
  error: Error | null
}

/** Loads a single live data snapshot and refreshes it after relevant adapter events. */
export function useOrdersData(providedAdapter?: StorageAdapter): OrdersData {
  const [state, setState] = useState<OrdersData>({
    adapter: providedAdapter ?? null,
    customers: [],
    orders: [],
    loading: true,
    error: null,
  })

  useEffect(() => {
    let active = true
    let unsubscribe: (() => void) | undefined
    let ownedAdapter: StorageAdapter | undefined

    const connect = async () => {
      try {
        const adapter = providedAdapter ?? await createStorageAdapter()
        if (!active) {
          if (!providedAdapter) await adapter.close()
          return
        }

        ownedAdapter = providedAdapter ? undefined : adapter
        const refresh = async () => {
          const [orders, customers] = await Promise.all([adapter.listOrders(), adapter.listCustomers()])
          if (active) setState({ adapter, orders, customers, loading: false, error: null })
        }

        unsubscribe = adapter.subscribe((change) => {
          if (change.collection === 'orders' || change.collection === 'orderItems' || change.collection === 'customers') {
            void refresh()
          }
        })
        await refresh()
      } catch (caught) {
        if (active) {
          setState({
            adapter: null,
            customers: [],
            orders: [],
            loading: false,
            error: caught instanceof Error ? caught : new Error('Unable to load orders.'),
          })
        }
      }
    }

    void connect()
    return () => {
      active = false
      unsubscribe?.()
      if (ownedAdapter) void ownedAdapter.close()
    }
  }, [providedAdapter])

  return state
}
