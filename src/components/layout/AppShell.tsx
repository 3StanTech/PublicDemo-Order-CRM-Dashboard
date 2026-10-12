import { BarChart3, FileUp, Home, RefreshCw, Settings, ShoppingBag, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import gellyLogo from '../../assets/brand/gelly-logo-mark.png'
import { createStorageAdapter, storageMode, syncedStorage, type SyncedStorage, type SyncStatus } from '../../data/adapter'

type NavigationItem = { label: string; path: string; icon: LucideIcon }

const navigationItems: NavigationItem[] = [
  { label: 'Today', path: '/today', icon: Home },
  { label: 'Import', path: '/import', icon: FileUp },
  { label: 'Orders', path: '/orders', icon: ShoppingBag },
  { label: 'Customers', path: '/customers', icon: Users },
  { label: 'Insights', path: '/insights', icon: BarChart3 },
  { label: 'Settings', path: '/settings', icon: Settings },
]

/**
 * What the UI needs from the Firestore sync: the sync surface (null on the
 * local build, which is always ready) and whether writes may start yet.
 */
export type SyncGate = {
  synced: SyncedStorage | null
  status: SyncStatus | null
  /** False until the visitor's saved changes have loaded; editing controls stay disabled meanwhile. */
  writesReady: boolean
}

const localGate: SyncGate = { synced: null, status: null, writesReady: true }
const SyncGateContext = createContext<SyncGate>(localGate)

// oxlint-disable-next-line react/only-export-components
export function useSyncGate(): SyncGate {
  return useContext(SyncGateContext)
}

/** "Your saved changes have loaded." is announced once per page load, not on every remount. */
let loadedAnnounced = false
const LOADED_MESSAGE_MS = 6000

function writesAllowed(status: SyncStatus): boolean {
  if (status.state === 'ready') return true
  return status.state === 'error' && status.kind !== 'connect'
}

function useFirestoreSyncGate(): SyncGate {
  const enabled = storageMode() === 'firestore'
  const [gate, setGate] = useState<SyncGate>(
    enabled ? { synced: null, status: { state: 'connecting' }, writesReady: false } : localGate,
  )

  useEffect(() => {
    if (!enabled) return
    let active = true
    let unsubscribe: (() => void) | undefined
    void createStorageAdapter().then((adapter) => {
      const synced = syncedStorage(adapter)
      if (!active) return
      if (!synced) { setGate(localGate); return }
      const apply = (status: SyncStatus) => setGate({ synced, status, writesReady: writesAllowed(status) })
      apply(synced.syncStatus)
      unsubscribe = synced.subscribeSyncStatus(apply)
    }).catch((cause: unknown) => {
      if (active) setGate({ synced: null, status: { state: 'error', kind: 'connect', error: cause instanceof Error ? cause : new Error(String(cause)) }, writesReady: false })
    })
    return () => { active = false; unsubscribe?.() }
  }, [enabled])

  return gate
}

const syncErrorCopy: Record<'connect' | 'listen' | 'write', string> = {
  connect: 'Your saved changes could not be loaded, so editing is paused. Check your connection and try again.',
  listen: 'Syncing stopped, so the latest changes may not show. Try again to reconnect.',
  write: 'A change could not be saved yet. Try again to resend it.',
}

function SyncStatusArea({ gate }: { gate: SyncGate }) {
  const { status, synced } = gate
  const [showLoaded, setShowLoaded] = useState(false)
  const sawLoading = useRef(status?.state !== 'ready')

  useEffect(() => {
    if (!status) return
    if (status.state !== 'ready') { sawLoading.current = true; return }
    if (loadedAnnounced) return
    loadedAnnounced = true
    if (sawLoading.current) setShowLoaded(true)
  }, [status])

  useEffect(() => {
    if (!showLoaded) return
    const timer = setTimeout(() => setShowLoaded(false), LOADED_MESSAGE_MS)
    return () => clearTimeout(timer)
  }, [showLoaded])

  if (!status) return null
  const politeText = status.state === 'connecting'
    ? 'Loading your saved changes… Editing is paused until they load.'
    : status.state === 'ready' && showLoaded ? 'Your saved changes have loaded.' : ''

  return (
    <div className="px-5">
      {/* Always mounted so screen readers hear each change once, politely. */}
      <p
        role="status"
        aria-live="polite"
        className={politeText ? 'motion-fade-in mb-3 rounded-xl border border-[#4F74C8]/20 bg-white/70 px-3 py-2 text-sm font-semibold text-[#36579E]' : 'sr-only'}
      >
        {politeText}
      </p>
      {status.state === 'error' && (
        <div role="alert" className="motion-fade-in mb-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <p className="font-semibold">{syncErrorCopy[status.kind]}</p>
          {synced && (
            <button
              type="button"
              onClick={() => synced.retrySync()}
              className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-xl bg-red-700 px-4 font-bold text-white transition duration-200 hover:bg-red-800 active:scale-[0.98] motion-safe:transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
            >
              <RefreshCw aria-hidden="true" size={16} />
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function SyncGateProvider({ gate, children }: { gate: SyncGate; children: ReactNode }) {
  return <SyncGateContext.Provider value={gate}>{children}</SyncGateContext.Provider>
}

export function AppShell() {
  const gate = useFirestoreSyncGate()
  return (
    <SyncGateProvider gate={gate}>
      <div className="mx-auto min-h-dvh w-full max-w-3xl bg-[#FBF3D5] shadow-[0_0_0_1px_rgba(79,116,200,0.08)]">
        <header className="flex min-h-9 items-center gap-2.5 px-5 pb-3 pr-24 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <img src={gellyLogo} alt="" className="size-8 shrink-0 rounded-full ring-1 ring-[#4F74C8]/15" height={32} width={32} />
          <div className="flex min-w-0 flex-col items-start gap-1">
            <p className="min-w-0 max-w-full truncate text-[15px] font-black leading-none tracking-tight text-[#20242F]">
              Gelly <span className="text-[#4F74C8]">Dashboard</span>
            </p>
            <span className="rounded-full border border-[#4F74C8]/25 bg-white/70 px-2 py-0.5 text-[11px] font-bold leading-4 text-[#36579E]">
              Demo · sample data
            </span>
          </div>
        </header>
        <SyncStatusArea gate={gate} />
        <main className="min-h-dvh px-5 pb-[calc(7.25rem+env(safe-area-inset-bottom))] pt-2">
          <Outlet />
        </main>
        <nav aria-label="Primary navigation" className="fixed inset-x-0 bottom-0 z-10 mx-auto w-full max-w-3xl border-t border-[#4F74C8]/20 bg-[#FBF3D5]/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur">
          <ul className="grid grid-cols-6 gap-0.5" role="list">
            {navigationItems.map(({ label, path, icon: Icon }) => (
              <li key={path}>
                <NavLink
                  to={path}
                  className={({ isActive }) => `group flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-semibold leading-none transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4F74C8] active:scale-95 motion-safe:transition-transform ${isActive ? 'bg-[#4F74C8] text-white' : 'text-[#4A5365] hover:bg-[#4F74C8]/10'}`}
                >
                  <Icon aria-hidden="true" size={19} strokeWidth={2} className="transition-transform duration-200 group-active:scale-90" />
                  <span>{label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </SyncGateProvider>
  )
}
