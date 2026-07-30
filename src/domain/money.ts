import type { MoneyCentavos } from './contracts'
import { PricingError } from './pricing-error'

const pesoFormatter = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })

export function assertMoneyCentavos(value: unknown, field = 'money'): asserts value is MoneyCentavos {
  if (!Number.isSafeInteger(value)) {
    throw new PricingError('MALFORMED_MONEY', `${field} must be an integer number of centavos`)
  }
}

export function formatPesos(centavos: MoneyCentavos): string {
  assertMoneyCentavos(centavos)
  return pesoFormatter.format(centavos / 100)
}
