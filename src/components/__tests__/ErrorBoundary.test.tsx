import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '../ErrorBoundary'

const SECRET_MESSAGE = 'SECRET_ORDER_FAIL_CUSTOMER_MARIA_PHONE_917'
const SECRET_STACK_MARKER = 'at BoomForTest'

function BoomForTest(): never {
  throw new Error(SECRET_MESSAGE)
}

function HealthyChild() {
  return <p>Dashboard content</p>
}

describe('ErrorBoundary', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // React logs the thrown error; keep the suite quiet without asserting on it.
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
    vi.restoreAllMocks()
  })

  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <HealthyChild />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Dashboard content')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument()
  })

  it('renders a branded fallback without exposing the error message or stack', () => {
    render(
      <ErrorBoundary>
        <BoomForTest />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(screen.getByText(/unexpected problem/i)).toBeInTheDocument()

    const main = screen.getByRole('main')
    expect(main).not.toHaveTextContent(SECRET_MESSAGE)
    expect(main).not.toHaveTextContent(SECRET_STACK_MARKER)
    expect(main).not.toHaveTextContent('Error:')
    expect(document.body.textContent).not.toContain(SECRET_MESSAGE)
  })

  it('offers a reload action on the fallback', async () => {
    const reload = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    })

    const user = userEvent.setup()
    render(
      <ErrorBoundary>
        <BoomForTest />
      </ErrorBoundary>,
    )

    await user.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledOnce()
  })
})
