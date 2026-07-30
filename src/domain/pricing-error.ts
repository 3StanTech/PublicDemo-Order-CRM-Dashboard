export type PricingErrorCode =
  | 'UNKNOWN_PRODUCT'
  | 'UNKNOWN_MODIFIER_OPTION'
  | 'INVALID_MODIFIER_COMBINATION'
  | 'INVALID_QUANTITY'
  | 'INVALID_THERMAL_BAG'
  | 'THERMAL_BAGS_EXCEED_CUPS'
  | 'MALFORMED_MONEY'

export class PricingError extends Error {
  readonly name = 'PricingError'
  readonly code: PricingErrorCode

  constructor(
    code: PricingErrorCode,
    message: string,
  ) {
    super(message)
    this.code = code
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
