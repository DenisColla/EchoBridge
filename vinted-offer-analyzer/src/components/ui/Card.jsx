import { SURFACE, cx } from '../../theme.js'

export function Card({ eyebrow, title, icon: Icon, action, children, className = '', muted = false }) {
  return (
    <section className={cx('rounded-2xl p-4 sm:p-5', muted ? SURFACE.cardMuted : SURFACE.card, className)}>
      {(eyebrow || title) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            {Icon && (
              <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
            )}
            <div className="min-w-0">
              {eyebrow && <p className={cx('text-[11px] font-semibold uppercase tracking-wider', SURFACE.muted)}>{eyebrow}</p>}
              {title && <h2 className="text-base font-semibold leading-snug">{title}</h2>}
            </div>
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}
