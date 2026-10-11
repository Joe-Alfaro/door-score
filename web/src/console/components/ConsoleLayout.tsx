import { useEffect } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ConfirmDialog } from 'primereact/confirmdialog'
import { ProgressBar } from 'primereact/progressbar'
import { Skeleton } from 'primereact/skeleton'
import { Tag } from 'primereact/tag'
import { usd } from '../format'
import { useConsoleStatus } from './StatusProvider'
import { TokenButton } from './TokenButton'

interface NavItem {
  to: string
  label: string
  icon: string
  end?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/console', label: 'Overview', icon: 'pi pi-home', end: true },
  { to: '/console/pipeline', label: 'Pipeline', icon: 'pi pi-play' },
  { to: '/console/sources', label: 'Sources', icon: 'pi pi-database' },
  { to: '/console/eval', label: 'Eval', icon: 'pi pi-check-square' },
  { to: '/console/doors', label: 'Doors', icon: 'pi pi-list' },
  { to: '/console/route', label: 'Route planner', icon: 'pi pi-directions' },
  { to: '/console/ledger', label: 'Ledger', icon: 'pi pi-dollar' },
]

const DEFAULT_SPEND_CAP_USD = 50

function ConsoleHeader() {
  const { search } = useLocation()
  const { status, health, loading } = useConsoleStatus()
  const territory = status?.territory
  const spent = status?.cost.total_usd ?? 0
  const cap = status?.max_spend_usd ?? DEFAULT_SPEND_CAP_USD
  const spendPct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0
  const deployments = Object.entries(status?.deployments ?? {})

  return (
    <header className="console-header">
      {territory?.custom ? (
        <Tag severity="warning" icon="pi pi-map" value={`Custom territory: ${territory.name ?? territory.territory_id ?? ''}`} title="Overview, Doors and tag counts reflect this territory. Eval, sources and ledger are project-wide." style={{ marginRight: 10 }} />
      ) : null}
      <div className="console-header-title">
        <i className="pi pi-compass" aria-hidden="true" />
        {loading && !status ? <Skeleton width="160px" height="18px" /> : <span>{status?.territory?.name ?? 'Door Score console'}</span>}
      </div>
      <div className="console-header-meta">
        {health ? (
          <span>
            <strong>{health.doors.toLocaleString()}</strong> doors
          </span>
        ) : (
          <Skeleton width="70px" height="16px" />
        )}
      </div>
      <div className="console-spend" title="Total spend against the paid-stage cap">
        <span className="console-muted">Spend</span>
        <ProgressBar value={spendPct} showValue={false} aria-label="Spend against cap" />
        <span className="console-num">
          {usd(spent)} / {usd(cap, 0)}
        </span>
      </div>
      <div className="console-health">
        {deployments.map(([name, deployment]) => (
          <Tag
            key={name}
            severity={deployment.ok ? 'success' : 'danger'}
            icon={deployment.ok ? 'pi pi-check' : 'pi pi-times'}
            value={deployment.ms === null ? name : `${name} ${deployment.ms} ms`}
            title={`${deployment.url} → ${deployment.status}`}
          />
        ))}
        <TokenButton />
        <Link to={{ pathname: '/', search }} className="console-map-link">
          <i className="pi pi-map" aria-hidden="true" /> Map
        </Link>
      </div>
    </header>
  )
}

export function ConsoleLayout() {
  const { search, pathname } = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    const params = new URLSearchParams(search)
    const stored = window.localStorage.getItem('door-score-active-territory')
    if (!params.get('territory') && stored) {
      params.set('territory', stored)
      navigate({ pathname, search: `?${params.toString()}` }, { replace: true })
    }
  }, [search, pathname, navigate])
  return (
    <div className="console">
      <ConsoleHeader />
      <nav className="console-nav" aria-label="Console sections">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={{ pathname: item.to, search }} end={item.end}>
            <i className={item.icon} aria-hidden="true" />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <main className="console-main">
        <Outlet />
      </main>
      <ConfirmDialog className="console-portal" />
    </div>
  )
}
