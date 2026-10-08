import { SURFACE, cx } from '../../theme.js'

export function Field({ id, label, hint, error, adornment, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {hint && <span className={cx('ml-1 font-normal', SURFACE.muted)}>{hint}</span>}
      </label>
      <div className="relative">
        {children}
        {adornment && (
          <span className={cx('pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm', SURFACE.muted)}>{adornment}</span>
        )}
      </div>
      {error && <p className="text-xs font-medium text-rose-600 dark:text-rose-400" role="alert">{error}</p>}
    </div>
  )
}

export function TextInput({ id, hasError, className = '', ...rest }) {
  return (
    <input
      id={id}
      className={cx(
        'w-full rounded-xl px-3.5 py-3 text-base outline-none transition-shadow',
        SURFACE.input,
        hasError && 'ring-2 ring-rose-400 focus:ring-rose-500',
        className,
      )}
      {...rest}
    />
  )
}
