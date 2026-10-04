import { Gauge, ShieldAlert, TriangleAlert } from 'lucide-react'
import { articleFor, formatSignedPoints, toPercent } from '../core/index.js'
import { SURFACE, TONE, cx, toneForLevel, toneForProbability } from '../theme.js'
import { Badge } from './ui/Badge.jsx'
import { Card } from './ui/Card.jsx'
import { Meter } from './ui/Meter.jsx'

export function ScoreCard({ result }) {
  const { probability, probabilityRange, uncertainty, components, riskBand, blockRisk, factors, ambition, input, suggestedPrice } = result
  const tone = toneForProbability(probability)
  const rows = factors.rows.filter((r) => r.deltaPoints !== 0)
  const showEquation = components.pAvailable < 0.995 || components.pRead < 0.995 || toPercent(probability) !== factors.totalPct
  const missing = [
    input.listingAge.id === 'unknown' && "l'anzianità dell'annuncio",
    (!input.sellerProfile || input.sellerProfile === 'unknown') && 'il tipo di venditore',
  ].filter(Boolean).join(' e ')

  return (
    <Card eyebrow="Score di fattibilità" title="Quante possibilità hai?" icon={Gauge}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className={cx('text-6xl font-semibold leading-none tracking-tight', TONE[tone].text)}>
            {toPercent(probability)}
            <span className="text-3xl font-medium">%</span>
          </p>
          <p className={cx('mt-2 text-sm', SURFACE.muted)}>
            probabilità complessiva nel momento consigliato
            {uncertainty > 0 && (
              <span className="block">stima tra {toPercent(probabilityRange[0])}% e {toPercent(probabilityRange[1])}%: indica {missing} per restringerla</span>
            )}
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <Badge tone={riskBand.tone} icon={TriangleAlert}>Rischio {riskBand.label.toLowerCase()} · sconto {Math.round(input.discountPct)}%</Badge>
          <Badge tone={toneForLevel(blockRisk.level)} icon={ShieldAlert}>Rifiuto secco / blocco: {blockRisk.label.toLowerCase()}</Badge>
        </div>
      </div>

      <Meter value={probability} tone={tone} label="Probabilità complessiva" className="mt-5" />

      {showEquation && (
        <p className={cx('mt-3 text-sm tabular-nums', SURFACE.muted)}>
          Accettazione {toPercent(components.pAccept)}%
          {components.pAvailable < 0.995 && <> × ancora in vendita {toPercent(components.pAvailable)}%</>}
          {components.pRead < 0.995 && <> × il venditore la legge {toPercent(components.pRead)}%</>}
          {' '}= {toPercent(probability)}% complessivo
        </p>
      )}

      {ambition && (
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-900 ring-1 ring-rose-200 dark:bg-rose-950/50 dark:text-rose-100 dark:ring-rose-900">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            {ambition === 'unrealistic'
              ? 'Così non passa: anche nel momento perfetto il rifiuto è quasi certo.'
              : 'Obiettivo molto ambizioso: anche nel momento migliore le probabilità restano basse.'}
            {' '}{suggestedPrice ? 'Usa il prezzo consigliato nella strategia.' : 'Alza il prezzo o scrivi prima al venditore.'}
          </p>
        </div>
      )}

      <div className="mt-5">
        <h3 className={cx('text-[11px] font-semibold uppercase tracking-wider', SURFACE.muted)}>Che cosa pesa sul risultato</h3>
        <ul className="mt-2 flex flex-col gap-2 text-sm">
          <li className="flex items-center justify-between gap-3">
            <span>Sconto {articleFor(input.discountPct)}{Math.round(input.discountPct)}%: punto di partenza</span>
            <span className="tabular-nums font-semibold">{factors.basePct}%</span>
          </li>
          {rows.map((f) => {
            const positive = f.deltaPoints > 0
            const width = Math.min(100, Math.abs(f.deltaPoints) * 5)
            return (
              <li key={f.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
                <span className="min-w-0 truncate">{f.label}</span>
                <span className={cx('tabular-nums font-semibold', positive ? TONE.good.text : TONE.bad.text)}>
                  {formatSignedPoints(f.deltaPoints)} pt
                </span>
                <div className={cx('col-span-2 h-1.5 overflow-hidden rounded-full', SURFACE.cardMuted)}>
                  <div className={cx('h-full rounded-full', positive ? TONE.good.bar : TONE.bad.bar)} style={{ width: `${width}%` }} />
                </div>
              </li>
            )
          })}
          <li className={cx('flex items-center justify-between gap-3 border-t pt-2', SURFACE.divider)}>
            <span className="font-medium">Accettazione nel momento consigliato</span>
            <span className="tabular-nums font-semibold">{factors.totalPct}%</span>
          </li>
        </ul>
      </div>

      {blockRisk.reasons.length > 0 && (
        <div className="mt-4">
          <h3 className={cx('text-[11px] font-semibold uppercase tracking-wider', SURFACE.muted)}>Perché il rischio di rifiuto secco è {blockRisk.label.toLowerCase()}</h3>
          <ul className={cx('mt-1.5 flex flex-wrap gap-1.5 text-xs')}>
            {blockRisk.reasons.map((r) => (
              <li key={r}><Badge tone={toneForLevel(blockRisk.level)}>{r}</Badge></li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}
