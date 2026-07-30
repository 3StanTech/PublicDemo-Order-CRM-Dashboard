import { lazy, Suspense, type ComponentType } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { DemoBanner } from './components/DemoBanner'
import { ErrorBoundary } from './components/ErrorBoundary'
import { InstallPrompt } from './components/InstallPrompt'
import { AppShell } from './components/layout/AppShell'
import { AuthBoundary } from './features/auth/AuthBoundary'

/**
 * Production: React.lazy so each page is its own async chunk.
 * Vitest: top-level await resolves the same modules before tests run, so existing
 * sync getByRole assertions in App.test.tsx keep working. Vite DCE removes the
 * test branch (and the await) from the production bundle.
 */
let TodayPage: ComponentType
let ImportPage: ComponentType
let OrdersPage: ComponentType
let CustomersPage: ComponentType
let InsightsPage: ComponentType
let SettingsPage: ComponentType

if (import.meta.env.MODE === 'test') {
  const [today, imp, orders, customers, insights, settings] = await Promise.all([
    import('./pages/TodayPage'),
    import('./pages/ImportPage'),
    import('./pages/OrdersPage'),
    import('./pages/CustomersPage'),
    import('./pages/InsightsPage'),
    import('./pages/SettingsPage'),
  ])
  TodayPage = today.TodayPage
  ImportPage = imp.ImportPage
  OrdersPage = orders.OrdersPage
  CustomersPage = customers.CustomersPage
  InsightsPage = insights.InsightsPage
  SettingsPage = settings.SettingsPage
} else {
  TodayPage = lazy(() =>
    import('./pages/TodayPage').then((m) => ({ default: m.TodayPage })),
  )
  ImportPage = lazy(() =>
    import('./pages/ImportPage').then((m) => ({ default: m.ImportPage })),
  )
  OrdersPage = lazy(() =>
    import('./pages/OrdersPage').then((m) => ({ default: m.OrdersPage })),
  )
  CustomersPage = lazy(() =>
    import('./pages/CustomersPage').then((m) => ({ default: m.CustomersPage })),
  )
  InsightsPage = lazy(() =>
    import('./pages/InsightsPage').then((m) => ({ default: m.InsightsPage })),
  )
  SettingsPage = lazy(() =>
    import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
  )
}

function RouteFallback() {
  return (
    <p
      role="status"
      aria-live="polite"
      className="rounded-xl bg-[#FBF3D5] p-4 text-sm font-medium text-[#4F74C8]"
    >
      Loading…
    </p>
  )
}

/** Single Suspense around the nested outlet so AppShell stays mounted while pages load. */
function SuspenseOutlet() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Outlet />
    </Suspense>
  )
}

export default function App() {
  return (
    <AuthBoundary>
      <ErrorBoundary>
        <DemoBanner />
        <div className="pt-9">
          <BrowserRouter>
            <Routes>
              <Route element={<AppShell />}>
                <Route element={<SuspenseOutlet />}>
                  <Route path="/today" element={<TodayPage />} />
                  <Route path="/import" element={<ImportPage />} />
                  <Route path="/orders" element={<OrdersPage />} />
                  <Route path="/customers" element={<CustomersPage />} />
                  <Route path="/insights" element={<InsightsPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/" element={<Navigate to="/today" replace />} />
                  <Route path="*" element={<Navigate to="/today" replace />} />
                </Route>
              </Route>
            </Routes>
          </BrowserRouter>
        </div>
        <InstallPrompt />
      </ErrorBoundary>
    </AuthBoundary>
  )
}
