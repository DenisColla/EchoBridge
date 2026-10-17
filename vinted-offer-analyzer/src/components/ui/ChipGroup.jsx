import { SURFACE, cx } from '../../theme.js'

/**
 * Accessible single-select chip group (radiogroup semantics).
 * options: [{ id, label, hint?, icon? }]
 */
export function ChipGroup({ id, label, hint, options, value, onChange, error, columns = 'grid-cols-2 sm:grid-cols-3' }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p id={`${id}-label`} className="text-sm font-medium">
        {label}
        {hint && <span className={cx('ml-1 font-normal', SURFACE.muted)}>{hint}</span>}
      </p>
      <div role="radiogroup" aria-labelledby={`${id}-label`} className={cx('grid gap-2', columns)}>
        {options.map((opt) => {
          const active = opt.id === value
          const Icon = opt.icon
          return (
            <button
              key={opt.id}
              id={`${id}-${opt.id}`}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(opt.id)}
              className={cx(
                'flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950',
                active ? SURFACE.chipActive : SURFACE.chip,
              )}
            >
              {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
              <span className="min-w-0">
                <span className="block font-medium leading-tight">{opt.label}</span>
                {opt.hint && (
                  <span className={cx('block text-[11px] leading-tight', active ? 'opacity-80' : SURFACE.muted)}>{opt.hint}</span>
                )}
              </span>
            </button>
          )
        })}
      </div>
      {error && <p className="text-xs font-medium text-rose-600 dark:text-rose-400" role="alert">{error}</p>}
    </div>
  )
}
