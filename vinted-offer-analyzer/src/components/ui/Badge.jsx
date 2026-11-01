import { TONE, cx } from '../../theme.js'

export function Badge({ tone = 'neutral', icon: Icon, children, className = '' }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1', TONE[tone].badge, className)}>
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
      {children}
    </span>
  )
}
