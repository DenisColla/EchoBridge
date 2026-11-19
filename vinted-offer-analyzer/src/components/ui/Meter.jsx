import { TONE, cx } from '../../theme.js'

/** Horizontal meter: the fill carries severity, the track is a lighter step of the same hue. */
export function Meter({ value, tone = 'accent', label, className = '' }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)))
  return (
    <div
      className={cx('h-2.5 w-full overflow-hidden rounded-full', TONE[tone].track, className)}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={label}
    >
      <div className={cx('h-full rounded-full transition-[width] duration-500', TONE[tone].bar)} style={{ width: `${pct}%` }} />
    </div>
  )
}
