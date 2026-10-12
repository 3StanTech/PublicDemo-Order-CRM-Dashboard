import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { AuthBoundary } from '../AuthBoundary'
import { DEMO_UNLOCK_KEY } from '../demoAuth'

function renderBoundary() {
  return render(
    <AuthBoundary>
      <p>Private dashboard</p>
    </AuthBoundary>,
  )
}

describe('AuthBoundary', () => {
  beforeEach(() => {
    try {
      sessionStorage.removeItem(DEMO_UNLOCK_KEY)
    } catch {
      // ignore
    }
  })

  it('shows the PIN gate on a fresh visit', () => {
    renderBoundary()
    expect(screen.getByLabelText('PIN')).toBeInTheDocument()
    expect(screen.queryByText('Private dashboard')).not.toBeInTheDocument()
    expect(screen.getByText('Demo PIN: 123456')).toBeInTheDocument()
  })

  it('unlocks with the demo PIN and renders children', async () => {
    const user = userEvent.setup()
    renderBoundary()
    await user.type(screen.getByLabelText('PIN'), '123456')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText('Private dashboard')).toBeInTheDocument()
    expect(sessionStorage.getItem(DEMO_UNLOCK_KEY)).toBe('1')
  })

  it('shows an error for a wrong PIN and does not unlock', async () => {
    const user = userEvent.setup()
    renderBoundary()
    await user.type(screen.getByLabelText('PIN'), '000000')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("That PIN didn't work. Try again.")
    expect(screen.queryByText('Private dashboard')).not.toBeInTheDocument()
    expect(sessionStorage.getItem(DEMO_UNLOCK_KEY)).toBeNull()
  })

  it('returns to the PIN gate after Lock demo', async () => {
    const user = userEvent.setup()
    sessionStorage.setItem(DEMO_UNLOCK_KEY, '1')
    renderBoundary()
    expect(screen.getByText('Private dashboard')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Lock demo' }))
    expect(screen.getByLabelText('PIN')).toBeInTheDocument()
    expect(sessionStorage.getItem(DEMO_UNLOCK_KEY)).toBeNull()
  })

  it('skips the gate when sessionStorage already holds the unlock key', () => {
    sessionStorage.setItem(DEMO_UNLOCK_KEY, '1')
    renderBoundary()
    expect(screen.getByText('Private dashboard')).toBeInTheDocument()
    expect(screen.queryByLabelText('PIN')).not.toBeInTheDocument()
  })
})
