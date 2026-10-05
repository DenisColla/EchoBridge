import { Sparkles, Target, Wand2 } from 'lucide-react'
import { GOAL_CHOICES, formatPoints, toPercent } from '../core/index.js'
import { SURFACE, TONE, cx } from '../theme.js'
import { Button } from './ui/Button.jsx'
import { Card } from './ui/Card.jsx'

export function OptimizeCard({ result, goal, onGoal, plan, onOptimize, onApply }) {
  const currentPct = toPercent(result.probability)
  const goalPct = Math.round(goal * 100)
  const alreadyThere = currentPct >= goalPct

  return (
    <Card eyebrow="Obiettivo" title="Quante probabilità vorresti?" icon={Target}>
      <div role="radiogroup" aria-label="Probabilità desiderata" className="flex flex-wrap gap-2">
        {GOAL_CHOICES.map((g) => {
          const active = Math.abs(goal - g) < 0.001
          return (
            <button
              key={g}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onGoal(g)}
              className={cx('rounded-full px-3.5 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600', active ? SURFACE.chipActive : SURFACE.chip)}
            >
              {Math.round(g * 100)}%
            </button>
          )
        })}
      </div>
      <p className={cx('mt-3 text-sm', SURFACE.muted)}>
        Oggi sei al {currentPct}%. Con un clic cerco il modo più economico per arrivare al {goalPct}%: aspettare un momento migliore, alzare di poco l'offerta, o entrambe le cose.
      </p>
      <Button icon={Wand2} onClick={onOptimize} disabled={alreadyThere} className="mt-3 w-full sm:w-auto">
        Portami al {goalPct}%
      </Button>
      {alreadyThere && <p className={cx('mt-2 text-xs', SURFACE.muted)}>Sei già oltre questo obiettivo: scegli una percentuale più alta.</p>}

      {plan && !plan.ok && (
        <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-100 dark:ring-amber-900">
          Non posso ottimizzare questa offerta: {plan.reason === 'no_offer_needed' ? 'non serve nessuna offerta.' : 'controlla i dati inseriti.'}
        </p>
      )}
      {plan && plan.ok && (
        <div className="mt-4 flex flex-col gap-3">
          {plan.options.length === 0 && (
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-100 dark:ring-amber-900">
              Il {Math.round(plan.target * 100)}% non è raggiungibile senza pagare quasi il prezzo pieno. Il massimo è {toPercent(plan.maxAchievable.probability)}%: {plan.maxAchievable.changes.join(' e ').toLowerCase()}.
            </p>
          )}
          {plan.options.map((o, index) => (
            <div key={o.id} className={cx('rounded-xl p-3 ring-1', index === 0 ? 'ring-teal-600 dark:ring-teal-400' : 'ring-slate-200 dark:ring-slate-700', SURFACE.cardMuted)}>
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold">{index === 0 && <Sparkles className="mr-1 inline h-4 w-4 text-teal-600" aria-hidden="true" />}{o.label}</p>
                <p className={cx('shrink-0 text-sm font-semibold tabular-nums', TONE.good.text)}>{toPercent(o.probability)}% ({formatPoints(o.deltaPoints)})</p>
              </div>
              <ul className="mt-1.5 flex flex-col gap-1 text-sm">
                {o.changes.map((c) => <li key={c}>• {c}</li>)}
              </ul>
              <Button variant={index === 0 ? 'primary' : 'secondary'} onClick={() => onApply(o)} className="mt-3 w-full sm:w-auto">
                Applica questa scelta
              </Button>
            </div>
          ))}
          {plan.options.length > 0 && plan.maxAchievable.probability > plan.options[0].probability + 0.05 && (
            <p className={cx('text-xs', SURFACE.muted)}>Massimo raggiungibile: {toPercent(plan.maxAchievable.probability)}% ({plan.maxAchievable.changes.join(', ').toLowerCase()}).</p>
          )}
        </div>
      )}
    </Card>
  )
}
