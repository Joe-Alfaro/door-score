import { humanize } from '../lib'
import type { Signal } from '../types'

interface SignalRowProps {
  signal: Signal
}

export function SignalRow({ signal }: SignalRowProps) {
  const max = signal.max_points > 0 ? signal.max_points : 1
  const ratio = Math.max(0, Math.min(1, signal.points / max))

  return (
    <li className="signal-row">
      <div className="signal-head">
        <span className="signal-name">{humanize(signal.name)}</span>
        <span className="signal-points">
          {signal.points}
          <span className="muted">/{signal.max_points}</span>
        </span>
      </div>
      <div className="signal-bar" role="meter" aria-valuemin={0} aria-valuemax={signal.max_points} aria-valuenow={signal.points}>
        <div className="signal-bar-fill" style={{ width: `${ratio * 100}%` }} />
      </div>
      {signal.evidence ? <div className="signal-evidence">{signal.evidence}</div> : null}
      {signal.image_url ? (
        <img className="signal-image" src={signal.image_url} alt={`${humanize(signal.name)} evidence`} loading="lazy" />
      ) : null}
      <div className="signal-meta muted">
        {signal.icp_trait ? <span>{signal.icp_trait}</span> : null}
        {signal.icp_trait && signal.source ? <span aria-hidden="true"> · </span> : null}
        {signal.source ? <span>{signal.source}</span> : null}
      </div>
    </li>
  )
}
