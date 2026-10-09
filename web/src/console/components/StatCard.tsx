import { Card } from 'primereact/card'

interface StatCardProps {
  label: string
  value: string
  hint?: string
}

export function StatCard({ label, value, hint }: StatCardProps) {
  return (
    <Card className="console-stat">
      <div className="console-stat-label">{label}</div>
      <div className="console-stat-value">{value}</div>
      {hint ? <div className="console-stat-hint">{hint}</div> : null}
    </Card>
  )
}
