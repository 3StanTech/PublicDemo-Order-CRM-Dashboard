import { type ReactNode, useState } from 'react'
import gellyLogo from '../../assets/brand/gelly-logo-mark.png'
import { DEMO_UNLOCK_KEY, verifyDemoPin } from './demoAuth'

type AuthBoundaryProps = {
  children: ReactNode
}

function readUnlocked(): boolean {
  try {
    return sessionStorage.getItem(DEMO_UNLOCK_KEY) === '1'
  } catch {
    return false
  }
}

function writeUnlocked(value: boolean): void {
  try {
    if (value) sessionStorage.setItem(DEMO_UNLOCK_KEY, '1')
    else sessionStorage.removeItem(DEMO_UNLOCK_KEY)
  } catch {
    // Safari private mode can throw; unlock still works for the current mount.
  }
}

export function AuthBoundary({ children }: AuthBoundaryProps) {
  const [unlocked, setUnlocked] = useState(readUnlocked)

  if (!unlocked) {
    return (
      <PinGate
        onUnlocked={() => {
          writeUnlocked(true)
          setUnlocked(true)
        }}
      />
    )
  }

  return (
    <UnlockedSession
      onLock={() => {
        writeUnlocked(false)
        setUnlocked(false)
      }}
    >
      {children}
    </UnlockedSession>
  )
}

type PinGateProps = {
  onUnlocked: () => void
}

function PinGate({ onUnlocked }: PinGateProps) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (!verifyDemoPin(pin)) {
      setError("That PIN didn't work. Try again.")
      setPin('')
      return
    }
    setPin('')
    onUnlocked()
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#FBF3D5] px-5 py-8">
      <section aria-labelledby="pin-gate-title" className="motion-fade-up w-full max-w-sm rounded-3xl border border-[#4F74C8]/20 bg-white/70 p-6 shadow-sm">
        <img src={gellyLogo} alt="" className="mx-auto size-16 rounded-full shadow-[0_0_0_4px_rgba(79,116,200,0.1)]" height={64} width={64} />
        <p className="mt-4 text-center text-xs font-bold tracking-[0.18em] text-[#4F74C8]">CAFÉ OMS · DEMO</p>
        <h1 id="pin-gate-title" className="mt-1 text-center text-3xl font-bold tracking-tight text-[#20242F]">Gelly Dashboard</h1>
        <p className="mt-2 text-center text-sm leading-6 text-[#4A5365]">Enter your PIN to continue.</p>
        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="sr-only" htmlFor="dashboard-pin">PIN</label>
            <input
              id="dashboard-pin"
              aria-describedby={error ? 'pin-error' : 'pin-hint'}
              autoComplete="current-password"
              className="w-full rounded-xl border border-[#4F74C8]/30 bg-white px-4 py-3 text-center text-lg tracking-[0.3em] text-[#20242F] outline-none transition focus:border-[#4F74C8] focus:ring-2 focus:ring-[#4F74C8]/30"
              inputMode="numeric"
              name="pin"
              onChange={(event) => setPin(event.target.value)}
              pattern="[0-9]*"
              placeholder="••••"
              required
              type="password"
              value={pin}
            />
            <p id="pin-hint" className="mt-2 text-center text-sm text-[#4A5365]">Demo access — use PIN 123456</p>
            {error && <p id="pin-error" className="motion-fade-in mt-2 text-sm font-medium text-[#A33B3B]" role="alert">{error}</p>}
          </div>
          <button
            className="w-full rounded-xl bg-[#4F74C8] px-4 py-3 font-bold text-white transition duration-200 hover:bg-[#365AA9] active:scale-[0.98] motion-safe:transition-transform"
            type="submit"
          >
            Continue
          </button>
        </form>
      </section>
    </main>
  )
}

function UnlockedSession({ children, onLock }: { children: ReactNode; onLock: () => void }) {
  return (
    <>
      <button
        aria-label="Lock demo"
        className="fixed right-4 top-[calc(max(0.75rem,env(safe-area-inset-top))+2.25rem)] z-20 rounded-full border border-[#4F74C8]/30 bg-[#FBF3D5]/95 px-3 py-1.5 text-xs font-bold text-[#365AA9] shadow-sm backdrop-blur transition duration-200 hover:bg-white active:scale-95 motion-safe:transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4F74C8]"
        onClick={onLock}
        type="button"
      >
        Lock demo
      </button>
      {children}
    </>
  )
}
