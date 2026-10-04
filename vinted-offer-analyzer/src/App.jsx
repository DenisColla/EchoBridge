import { useEffect, useRef } from 'react'
import { Clock, Tag, TriangleAlert } from 'lucide-react'
import { useOfferAnalysis } from './hooks/useOfferAnalysis.js'
import { formatLongDate, formatTime } from './core/index.js'
import { SURFACE, cx } from './theme.js'
import { EmptyState } from './components/EmptyState.jsx'
import { MessageCard } from './components/MessageCard.jsx'
import { OfferForm } from './components/OfferForm.jsx'
import { ScoreCard } from './components/ScoreCard.jsx'
import { StrategyCard } from './components/StrategyCard.jsx'
import { VerdictCard } from './components/VerdictCard.jsx'

/**
 * Vinted offer timing analyzer. Mobile-first single column; two columns from `lg`.
 * All business logic lives in ./core (pure JS), the hook holds state, the
 * components are presentational: port to React Native by swapping ./components.
 */
export default function VintedOfferAnalyzer({ clock } = {}) {
  const { form, setField, applyDiscount, errors, result, livePreview, analyze, reset } = useOfferAnalysis({ clock })
  const resultsRef = useRef(null)

  useEffect(() => {
    if (!result || !resultsRef.current) return
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [result])

  return (
    <div className={cx('min-h-full', SURFACE.page)}>
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 pt-6 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-700 text-white dark:bg-teal-500 dark:text-slate-950">
            <Tag className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold leading-tight tracking-tight">Offerta Vinted Timing</h1>
            <p className={cx('truncate text-xs', SURFACE.muted)}>Il momento giusto per proporre il tuo prezzo</p>
          </div>
        </div>
        {result && (
          <p className={cx('hidden items-center gap-1.5 text-xs sm:flex', SURFACE.muted)}>
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            calcolato {formatLongDate(result.now)} alle {formatTime(result.now)}
          </p>
        )}
      </header>

      <main className="mx-auto grid max-w-6xl gap-5 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-8">
        <div className="lg:sticky lg:top-6 lg:self-start">
          <OfferForm form={form} errors={errors} livePreview={livePreview} onChange={setField} onApplyDiscount={applyDiscount} onSubmit={analyze} onReset={reset} />
        </div>

        <div ref={resultsRef} className="flex min-w-0 flex-col gap-5 scroll-mt-4">
          {!result && <EmptyState />}
          {result && result.kind === 'no_offer_needed' && (
            <section className={cx('rounded-2xl p-5 text-sm', SURFACE.card)}>
              <p className="font-semibold">Nessuna offerta necessaria</p>
              <p className="mt-1">{result.message}</p>
            </section>
          )}
          {result && result.warnings && result.warnings.map((w) => (
            <p key={w.id} className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-950 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-100 dark:ring-amber-900">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{w.text}</span>
            </p>
          ))}
          {result && result.kind === 'over_cap' && (
            <section className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-950 ring-1 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-100 dark:ring-rose-900 sm:p-5">
              <p className="flex items-start gap-2 font-semibold">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                Sconto del {Math.round(result.requestedInput.discountPct)}%: oltre il limite di Vinted
              </p>
              <p className="mt-1">{result.message}</p>
              <ul className="mt-2 flex flex-col gap-1">
                {result.capAdvice.map((a) => (
                  <li key={a} className="flex items-start gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" aria-hidden="true" /><span>{a}</span></li>
                ))}
              </ul>
            </section>
          )}
          {result && (result.kind === 'analysis' || result.kind === 'over_cap') && (
            <>
              <ScoreCard result={result} />
              <VerdictCard result={result} />
              <StrategyCard result={result} />
              <MessageCard key={result.now.getTime()} result={result} />
            </>
          )}
        </div>
      </main>
    </div>
  )
}
