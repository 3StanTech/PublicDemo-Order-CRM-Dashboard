import type { StoredCustomer, StoredOrder } from '../../data/types'
import type { ImportDraft } from './types'

export function normalizeCustomerName(name: string): string {
  return name.trim().toLocaleLowerCase('en-PH').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ')
}

export function matchingCustomers(name: string | null, customers: readonly StoredCustomer[]): StoredCustomer[] {
  if (!name) return []
  const normalized = normalizeCustomerName(name)
  return customers.filter((customer) => normalizeCustomerName(customer.name) === normalized)
}

export function applyCustomerMatch(draft: ImportDraft, customers: readonly StoredCustomer[], orders: readonly StoredOrder[]): ImportDraft {
  const matches = matchingCustomers(draft.customerName, customers)
  if (matches.length !== 1) {
    const reason = matches.length > 1 ? 'Customer name matches multiple saved customers' : null
    return { ...draft, matchedCustomerId: null, unresolvedFields: reason && !draft.unresolvedFields.includes(reason) ? [...draft.unresolvedFields, reason] : draft.unresolvedFields }
  }
  const customer = matches[0]
  const withoutAmbiguity = draft.unresolvedFields.filter((field) => field !== 'Customer name matches multiple saved customers')
  const latest = orders.filter((order) => order.customerId === customer.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  return {
    ...draft,
    matchedCustomerId: customer.id,
    address: draft.sameAsLastTime && !draft.address ? latest?.addressSnapshot ?? null : draft.address,
    unresolvedFields: withoutAmbiguity,
  }
}
