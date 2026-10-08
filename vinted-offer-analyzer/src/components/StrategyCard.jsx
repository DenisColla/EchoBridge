import { BadgeEuro, Lightbulb, Repeat } from 'lucide-react'
import { formatEuro } from '../core/index.js'
import { SURFACE, cx } from '../theme.js'
import { Card } from './ui/Card.jsx'

export function StrategyCard({ result }) {
  const { suggestedPrice, twoStep, tips, input } = result
  return (
    <Card eyebrow="Strategia" title="Come aumentare le probabilità" icon={Lightbulb}>
      <div className="flex flex-col gap-3">
        {suggestedPrice && (
          <div className="flex items-start gap-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-100 dark:ring-amber-900">
            <BadgeEuro className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>
              Con <strong>{formatEuro(suggestedPrice.price)}</strong> (sconto {Math.round(suggestedPrice.discountPct)}% invece di {Math.round(input.discountPct)}%)
              la probabilità complessiva sale a <strong>{Math.round(suggestedPrice.probability * 100)}%</strong>.
            </p>
          </div>
        )}
        {twoStep && (
          <div className={cx('flex items-start gap-3 rounded-xl p-3 text-sm', SURFACE.cardMuted)}>
            <Repeat className="mt-0.5 h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" aria-hidden="true" />
            <p>
              <span className="font-semibold">Due step:</span> apri a <strong>{formatEuro(twoStep.openingPrice)}</strong> ({Math.round(twoStep.openingProbability * 100)}% di accettazione diretta)
              e chiudi intorno a <strong>{formatEuro(twoStep.closingPrice)}</strong> sulla controproposta.
            </p>
          </div>
        )}
      </div>
      <ul className={cx('flex flex-col gap-2 text-sm', (suggestedPrice || twoStep) && 'mt-4')}>
        {tips.map((tip) => (
          <li key={tip} className="flex items-start gap-2.5">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-600 dark:bg-teal-400" aria-hidden="true" />
            <span>{tip}</span>
          </li>
        ))}
      </ul>
      <p className={cx('mt-4 text-xs', SURFACE.muted)}>
        Stime basate su euristiche di psicologia della negoziazione e sulle abitudini d'uso di Vinted, non su dati ufficiali della piattaforma.
      </p>
    </Card>
  )
}
