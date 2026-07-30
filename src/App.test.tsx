import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach } from 'vitest'
import App from './App'
import { DEMO_UNLOCK_KEY } from './features/auth/demoAuth'

describe('application shell', () => {
  beforeEach(() => {
    try {
      sessionStorage.setItem(DEMO_UNLOCK_KEY, '1')
    } catch {
      // ignore
    }
  })

  it('renders all six routes and updates the active tab', async () => {
    window.history.pushState({}, '', '/today')
    const user = userEvent.setup()
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Today' })).toHaveAttribute('aria-current', 'page')
    for (const route of ['Import', 'Orders', 'Customers', 'Insights', 'Settings']) {
      await user.click(screen.getByRole('link', { name: route }))
      expect(screen.getByRole('heading', { name: route })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: route })).toHaveAttribute('aria-current', 'page')
    }
  })
})
