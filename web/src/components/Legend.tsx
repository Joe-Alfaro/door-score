import { SCORE_GRADIENT_CSS } from '../lib'

export function Legend() {
  return (
    <div className="legend" aria-label="Door score color scale">
      <div className="legend-title">Door score</div>
      <div className="legend-bar" style={{ background: SCORE_GRADIENT_CSS }} />
      <div className="legend-ticks">
        <span>0</span>
        <span>50</span>
        <span>100</span>
      </div>
    </div>
  )
}
