import { Navigate, Route, Routes } from 'react-router-dom'
import { ConsoleLayout, StatusProvider, ToastProvider } from './components'
import { DoorsPage, EvalPage, LedgerPage, OverviewPage, PipelinePage, RoutePage, SourcesPage } from './pages'
import './console.css'

/** Mounted at /console/* by main.tsx; the map app at / is untouched. */
export function ConsoleApp() {
  return (
    <ToastProvider>
      <StatusProvider>
        <Routes>
          <Route element={<ConsoleLayout />}>
            <Route index element={<OverviewPage />} />
            <Route path="pipeline" element={<PipelinePage />} />
            <Route path="sources" element={<SourcesPage />} />
            <Route path="eval" element={<EvalPage />} />
            <Route path="doors" element={<DoorsPage />} />
            <Route path="route" element={<RoutePage />} />
            <Route path="ledger" element={<LedgerPage />} />
            <Route path="*" element={<Navigate to="/console" replace />} />
          </Route>
        </Routes>
      </StatusProvider>
    </ToastProvider>
  )
}
