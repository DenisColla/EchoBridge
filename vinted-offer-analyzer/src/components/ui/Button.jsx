import { SURFACE, cx } from '../../theme.js'

export function Button({ variant = 'primary', icon: Icon, children, className = '', type = 'button', ...rest }) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none focus:outline-none'
  const look = variant === 'primary' ? SURFACE.primaryButton : SURFACE.secondaryButton
  return (
    <button type={type} className={cx(base, look, className)} {...rest}>
      {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
      {children}
    </button>
  )
}
