import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { setWorkerUrl } from 'maplibre-gl'
import { App } from './App'
// PrimeReact CSS is imported before styles.css so the map's own :root rules keep precedence.
import 'primereact/resources/themes/lara-light-blue/theme.css'
import 'primereact/resources/primereact.min.css'
import 'primeicons/primeicons.css'
import './styles.css'

// Served from public/maplibre by scripts/sync-data.mjs; see the note there.
setWorkerUrl(`${import.meta.env.BASE_URL}maplibre/maplibre-gl-worker.mjs`)

// Code-split so the map page never downloads the console's PrimeReact bundle.
const ConsoleApp = lazy(() => import('./console/ConsoleApp').then((module) => ({ default: module.ConsoleApp })))

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route
          path="/console/*"
          element={
            <Suspense fallback={<div className="app-message muted">Loading console…</div>}>
              <ConsoleApp />
            </Suspense>
          }
        />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
