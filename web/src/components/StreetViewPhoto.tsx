import { useState } from 'react'
import { formatNumber } from '../lib'
import type { Vision } from '../types'

interface StreetViewPhotoProps {
  doorId: string
  address: string
  vision: Vision
}

/** Photos are synced by scripts/sync-data.mjs as public/img/streetview/<door_id>.jpg. */
export function streetViewUrl(doorId: string): string {
  return `/img/streetview/${encodeURIComponent(doorId)}.jpg`
}

const UNUSABLE_NOTE = 'No clear frontage in imagery'

/**
 * Street View frame for a door with capture caption and the vision model's notes.
 * Mount with `key={doorId}` so the error state resets when the selected door changes.
 */
export function StreetViewPhoto({ doorId, address, vision }: StreetViewPhotoProps) {
  const [failed, setFailed] = useState(false)
  const image = vision.image
  if (!image) return null

  const usable = vision.signals?.image_usable !== false
  const notes = vision.signals?.notes
  const captionParts = [
    image.date ? `Street View · ${image.date}` : 'Street View',
    image.approximate && image.distance_m != null
      ? `camera ~${formatNumber(image.distance_m)} m from lot center`
      : null,
    // When the photo itself could not be loaded, the overlay is gone, so say it in the caption.
    !usable && failed ? UNUSABLE_NOTE : null,
  ].filter((part): part is string => part !== null)

  return (
    <figure className="streetview">
      {failed ? null : (
        <div className="streetview-frame">
          <img
            className="streetview-img"
            src={streetViewUrl(doorId)}
            alt={`Street View of ${address}`}
            loading="lazy"
            onError={() => setFailed(true)}
          />
          {usable ? null : <div className="streetview-overlay">{UNUSABLE_NOTE}</div>}
          <span className="streetview-credit">© Google</span>
        </div>
      )}
      <figcaption className="streetview-caption muted">{captionParts.join(' · ')}</figcaption>
      {notes ? <p className="streetview-notes muted">{notes}</p> : null}
    </figure>
  )
}
