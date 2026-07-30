export const DEMO_PIN = '123456'
export const DEMO_UNLOCK_KEY = 'gelly-demo-unlocked'

export function verifyDemoPin(pin: string): boolean {
  return pin === DEMO_PIN
}
