import { Button } from 'primereact/button'
import { Message } from 'primereact/message'
import { Skeleton } from 'primereact/skeleton'

interface LoadingPanelProps {
  rows?: number
}

export function LoadingPanel({ rows = 4 }: LoadingPanelProps) {
  return (
    <div className="console-grid" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} height="2.2rem" />
      ))}
    </div>
  )
}

interface ErrorPanelProps {
  message: string
  onRetry?: () => void
}

export function ErrorPanel({ message, onRetry }: ErrorPanelProps) {
  return (
    <div className="console-grid" style={{ justifyItems: 'start' }}>
      <Message severity="error" text={message} />
      {onRetry ? <Button label="Retry" icon="pi pi-refresh" size="small" outlined onClick={onRetry} /> : null}
    </div>
  )
}

interface EmptyStateProps {
  icon?: string
  title: string
  hint?: string
}

export function EmptyState({ icon = 'pi pi-inbox', title, hint }: EmptyStateProps) {
  return (
    <div className="console-empty">
      <i className={icon} aria-hidden="true" />
      <div>{title}</div>
      {hint ? <div style={{ marginTop: 4, fontSize: 12 }}>{hint}</div> : null}
    </div>
  )
}

interface PageHeaderProps {
  title: string
  subtitle?: string
}

export function PageHeader({ title, subtitle }: PageHeaderProps) {
  return (
    <>
      <h1 className="console-page-title">{title}</h1>
      {subtitle ? <p className="console-page-sub">{subtitle}</p> : null}
    </>
  )
}
