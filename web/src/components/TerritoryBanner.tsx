import { useEffect, useState } from 'react'
import { formatNumber, territoryShareLink } from '../lib'

interface TerritoryBannerProps {
  territoryId: string
  name: string | null
  /** Total homes in the custom territory. */
  total: number
  /** Homes whose `vision` block is present, i.e. imagery signals were already cached. */
  withImagery: number
  loading: boolean
  onBack: () => void
}

export function TerritoryBanner({ territoryId, name, total, withImagery, loading, onBack }: TerritoryBannerProps) {
  const [copied, setCopied] = useState(false)
  const link = territoryShareLink(territoryId)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1800)
    return () => window.clearTimeout(timer)
  }, [copied])

  function copy() {
    navigator.clipboard
      .writeText(link)
      .then(() => setCopied(true))
      .catch(() => setCopied(false))
  }

  return (
    <div className="territory-banner" role="status">
      <div className="banner-text">
        <strong>Your area{name ? ` · ${name}` : ''}</strong>
        {loading ? (
          <span className="muted"> · loading…</span>
        ) : (
          <span>
            {' '}
            · {formatNumber(total)} homes · scored from public records; imagery signals only where cached (
            {formatNumber(withImagery)} of {formatNumber(total)} homes)
          </span>
        )}
      </div>
      <div className="share-row">
        <input type="text" className="share-link" readOnly value={link} aria-label="Share link" onFocus={(event) => event.target.select()} />
        <button type="button" className="btn" onClick={copy}>
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <button type="button" className="btn" onClick={onBack}>
          Clear area
        </button>
      </div>
    </div>
  )
}
