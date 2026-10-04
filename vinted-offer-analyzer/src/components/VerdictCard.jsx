import { Ban, CalendarClock, Check, Hourglass, Scale, X, Zap } from 'lucide-react'
import { capitalize, formatLongDate, formatRelativeDay, formatSignedPoints, formatTime, toPercent } from '../core/index.js'
import { SURFACE, cx } from '../theme.js'
import { Badge } from './ui/Badge.jsx'
import { Card } from './ui/Card.jsx'
import { windowIcon } from './icons.js'

const heroBadge = 'bg-white/15 text-white ring-white/25 dark:bg-white/15 dark:text-white dark:ring-white/25'

function SlotRow({ slot, now }) {
  return (
    <li className="flex items-center justify-between gap-3 text-sm">
      <span className="min-w-0">
        <span className="font-medium">{capitalize(formatLongDate(slot.date, now))}</span>
        <span className={SURFACE.muted}> · {formatTime(slot.date)} · {formatRelativeDay(slot.date, now)}</span>
      </span>
      <span className="shrink-0 tabular-nums font-semibold">{toPercent(slot.pOverall)}%</span>
    </li>
  )
}

export function VerdictCard({ result }) {
  const { verdict, opening, reasons, optimal, alsoGood, quick, alternatives, now, avoidToday, sendNow, timingMatters, spread } = result
  const WindowIcon = windowIcon(optimal.score.timeWindow.id)
  const showSendNow = optimal.kind !== 'now'

  return (
    <Card eyebrow="Verdetto temporale" title="Quando inviare l'offerta" icon={CalendarClock}>
      {showSendNow && (
        <div className={cx('mb-3 flex items-start gap-2.5 rounded-xl p-3 text-sm', sendNow.ok ? 'bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-100 dark:ring-emerald-900' : 'bg-rose-50 text-rose-900 ring-1 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-100 dark:ring-rose-900')}>
          {sendNow.ok ? <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <X className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
          <p>
            <strong>Adesso?</strong>{' '}
            {sendNow.ok
              ? `Sì, anche subito va bene (${sendNow.deltaPoints === 0 ? 'stesse probabilità' : `${formatSignedPoints(sendNow.deltaPoints)} punti`}): ${sendNow.window.label.toLowerCase()}.`
              : `No: ${sendNow.window.label.toLowerCase()} (${formatSignedPoints(sendNow.deltaPoints)} punti rispetto al momento consigliato). Aspetta.`}
          </p>
        </div>
      )}

      <div className="rounded-2xl bg-teal-700 p-4 text-white shadow-sm dark:bg-teal-600 sm:p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-teal-100">{verdict.sublabel}</p>
        <p className="mt-1 text-2xl font-semibold leading-tight tracking-tight sm:text-3xl" style={{ textWrap: 'balance' }}>
          {verdict.headline}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge tone="neutral" icon={WindowIcon} className={heroBadge}>
            {optimal.score.timeWindow.label}{optimal.score.timeWindow.range ? ` · ${optimal.score.timeWindow.range}` : ''}
          </Badge>
          {optimal.score.monthWindow.weight !== 0 && (
            <Badge tone="neutral" className={heroBadge}>{optimal.score.monthWindow.label}</Badge>
          )}
          <Badge tone="neutral" className={heroBadge}>{toPercent(optimal.pOverall)}% complessivo</Badge>
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-teal-100">
          <Hourglass className="h-3.5 w-3.5" aria-hidden="true" />
          Resta valida circa 24 ore: fino a {verdict.expiresLabel}
          {verdict.isHoliday ? ' · giorno festivo, si comporta come una domenica' : ''}
        </p>
      </div>

      <div className="mt-4 text-sm leading-relaxed">
        <p className="font-medium">{opening}</p>
        <ul className="mt-2 flex flex-col gap-1.5">
          {reasons.map((r) => (
            <li key={r} className="flex items-start gap-2.5">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-600 dark:bg-teal-400" aria-hidden="true" />
              <span>{r}</span>
            </li>
          ))}
        </ul>
      </div>

      {!timingMatters && (
        <p className={cx('mt-3 flex items-start gap-2 text-sm', SURFACE.muted)}>
          <Scale className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Qui il tempismo pesa poco (circa {Math.max(1, Math.round(spread * 100))} punti tra le finestre migliori): la prima buona fascia serale va bene.
        </p>
      )}

      {alsoGood && (
        <div className={cx('mt-4 flex items-start gap-3 rounded-xl p-3 text-sm', SURFACE.cardMuted)}>
          <Scale className="mt-0.5 h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" aria-hidden="true" />
          <p>
            <span className="font-semibold">Pari merito:</span> {formatLongDate(alsoGood.date, now)} alle {formatTime(alsoGood.date)} ({formatRelativeDay(alsoGood.date, now)}) vale {toPercent(alsoGood.pOverall)}%. Scegli il giorno più comodo.
          </p>
        </div>
      )}

      {quick && (
        <div className={cx('mt-4 flex items-start gap-3 rounded-xl p-3', SURFACE.cardMuted)}>
          <Zap className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
          <div className="min-w-0 text-sm">
            <p className="font-semibold">Hai fretta? Alternativa entro 48 ore</p>
            <p>
              {capitalize(formatLongDate(quick.date, now))} alle {formatTime(quick.date)} ({formatRelativeDay(quick.date, now)}):{' '}
              <strong>{toPercent(quick.pOverall)}%</strong>
              <span className={SURFACE.muted}> ({formatSignedPoints(toPercent(quick.pOverall) - toPercent(optimal.pOverall))} punti rispetto al momento consigliato, ma nessun rischio che venga venduto prima)</span>
            </p>
          </div>
        </div>
      )}

      {alternatives.length > 0 && (
        <div className="mt-5">
          <h3 className={cx('text-[11px] font-semibold uppercase tracking-wider', SURFACE.muted)}>Altre finestre valide</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {alternatives.map((slot) => (
              <SlotRow key={slot.date.getTime()} slot={slot} now={now} />
            ))}
          </ul>
        </div>
      )}

      {avoidToday.length > 0 && (
        <div className="mt-5">
          <h3 className={cx('flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider', SURFACE.muted)}>
            <Ban className="h-3.5 w-3.5" aria-hidden="true" /> Fasce da evitare {optimal.daysWaited === 0 ? 'oggi' : `${formatLongDate(optimal.date, now).split(' ')[0]}`}
          </h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {avoidToday.slice(0, 4).map((w) => {
              const Icon = windowIcon(w.id)
              return (
                <li key={w.id}>
                  <Badge tone="bad" icon={Icon}>{w.label} · {w.rangeLabel}</Badge>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </Card>
  )
}
