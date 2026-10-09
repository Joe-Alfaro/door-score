import { SCORE_GRADIENT_CSS } from '../lib'

export function Legend() {
  return (
    <div className="legend" aria-label="Door score color scale">
      <div className="legend-title">Territory percentile</div>
      <div className="legend-bar" style={{ background: SCORE_GRADIENT_CSS }} />
      <div className="legend-ticks">
        <span>bottom</span>
        <span>median</span>
        <span>top</span>
      </div>
    </div>
  )
}
