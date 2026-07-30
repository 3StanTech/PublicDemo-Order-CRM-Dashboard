import { getRuntimeCatalog } from '../../domain/catalog'
import type { DrinkFamily, Powder, ProductSlug, Sweetness } from '../../domain/contracts'
import type { ProductAliasDictionary } from './types'

export const PRODUCT_ALIASES: ProductAliasDictionary = {
  'matcha latte': 'matcha-latte',
  'matcha late': 'matcha-latte',
  'matca latte': 'matcha-latte',
  'strawberry matcha': 'strawberry-matcha',
  'strawberry macha': 'strawberry-matcha',
  'strawberry matca': 'strawberry-matcha',
  'salted maple matcha': 'salted-maple-matcha',
  'salted mapel matcha': 'salted-maple-matcha',
  'hojicha latte': 'hojicha-latte',
  'hoji latte': 'hojicha-latte',
  'hojicha late': 'hojicha-latte',
  'strawberry hojicha': 'strawberry-hojicha',
  'strawberry hoji': 'strawberry-hojicha',
  'salted maple hojicha': 'salted-maple-hojicha',
  'salted mapel hojicha': 'salted-maple-hojicha',
}

export function normalizeAlias(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
    : ''
}

export function normalizeProductSlug(value: unknown): ProductSlug | null {
  const catalog = getRuntimeCatalog()
  const normalized = normalizeAlias(value)
  if (normalized in catalog) return normalized as ProductSlug
  const alias = PRODUCT_ALIASES[normalized]
  return alias && alias in catalog ? alias : null
}

export function productFamily(slug: string | null): DrinkFamily | null {
  const catalog = getRuntimeCatalog()
  return slug && slug in catalog ? catalog[slug as ProductSlug].family : null
}

export function defaultLevel(slug: string | null): 1 | null {
  return productFamily(slug) ? 1 : null
}

export function normalizeLevel(value: unknown): 1 | 2 | 3 | null {
  if (value === 1 || value === 2 || value === 3) return value
  if (typeof value !== 'string') return null
  const match = value.trim().toLowerCase().match(/^(?:l(?:evel)?\s*)?([123])$/)
  if (!match) return null
  const level = Number(match[1])
  return level === 1 || level === 2 || level === 3 ? level : null
}

export function normalizePowder(value: unknown): Powder | null {
  const normalized = normalizeAlias(value)
  if (normalized === '' || normalized === 'yumeno') return 'yumeno'
  if (normalized === 'mk isuzu' || normalized === 'isuzu') return 'mk_isuzu'
  return null
}

export function normalizeSweetness(value: unknown): Sweetness | null | undefined {
  if (value === undefined || value === null || normalizeAlias(value) === '') return undefined
  const normalized = normalizeAlias(value)
  return normalized === 'none' || normalized === 'light' || normalized === 'regular' || normalized === 'extra'
    ? normalized
    : null
}
