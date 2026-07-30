import { Component, type ReactNode } from 'react'
import gellyLogo from '../assets/brand/gelly-logo-mark.png'

type ErrorBoundaryProps = {
  children: ReactNode
}

type ErrorBoundaryState = {
  hasError: boolean
}

/**
 * Branded generic failure screen. Never surfaces error messages, stacks, or
 * component stacks.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(): void {
    // Local-only demo — no external error reporting.
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="flex min-h-dvh items-center justify-center bg-[#FBF3D5] px-5 py-8">
          <section
            aria-labelledby="error-boundary-title"
            className="motion-fade-up w-full max-w-sm rounded-3xl border border-[#4F74C8]/20 bg-white/70 p-6 text-center shadow-sm"
          >
            <img
              src={gellyLogo}
              alt=""
              className="mx-auto size-16 rounded-full shadow-[0_0_0_4px_rgba(79,116,200,0.1)]"
              height={64}
              width={64}
            />
            <p className="mt-4 text-xs font-bold tracking-[0.18em] text-[#4F74C8]">CAFÉ OMS · DEMO</p>
            <h1 id="error-boundary-title" className="mt-1 text-3xl font-bold tracking-tight text-[#20242F]">
              Something went wrong
            </h1>
            <p className="mt-2 text-sm leading-6 text-[#4A5365]">
              The dashboard hit an unexpected problem. Your data is safe — reload to continue.
            </p>
            <button
              type="button"
              onClick={this.handleReload}
              className="mt-6 w-full rounded-xl bg-[#4F74C8] px-4 py-3 font-bold text-white transition duration-200 hover:bg-[#365AA9] active:scale-[0.98] motion-safe:transition-transform"
            >
              Reload
            </button>
          </section>
        </main>
      )
    }

    return this.props.children
  }
}
