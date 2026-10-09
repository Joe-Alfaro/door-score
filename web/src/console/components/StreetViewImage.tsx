import { useEffect, useState } from 'react'
import { streetViewUrl } from '../api'

/** Renders the cached Street View frame for a door; hides itself if the photo was never synced. */
export function StreetViewImage({ doorId, className }: { doorId: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [doorId])
  if (failed) return <div className="console-muted">No Street View photo synced for this door.</div>
  return <img className={className} src={streetViewUrl(doorId)} alt={`Street View of door ${doorId}`} onError={() => setFailed(true)} />
}
