import { useState } from 'react'
import { ArrowRightLeft, Check, ChevronDown, Copy, Handshake, Star } from 'lucide-react'
import { COUNTER_RECEIVED_AGO, TONES, capitalize, formatEuro, formatLongDate, formatSignedPoints, formatTime, toPercent } from '../core/index.js'
import { copyText } from '../platform/clipboard.js'
import { SURFACE, TONE, cx } from '../theme.js'
import { Button } from './ui/Button.jsx'
import { Card } from './ui/Card.jsx'
import { Field, TextInput } from './ui/Field.jsx'

const counterPct = (v) => String(Math.round(v * 10) / 10).replace('.', ',')

/**
 * "Il venditore ha fatto una controproposta?": the seller's number (€ or % over our offer), when it arrived and an
 * optional budget; the answer is the reply price, the moment to send it, the options, the next-round plan and the message.
 */
export function CounterOfferCard({ result, counter }) {
  const f = counter.form
  const [open, setOpen] = useState(Boolean(counter.result))
  const previousPlaceholder = result && result.input ? String(result.input.targetPrice).replace('.', ',') : '45'
  const submit = (e) => {
    e.preventDefault()
    counter.analyze()
  }
  return (
    <Card eyebrow="Dopo l'invio" title="Il venditore ha fatto una controproposta?" icon={Handshake}>
      {!open ? (
        <div className="flex flex-col gap-3">
          <p className={cx('text-sm', SURFACE.muted)}>Inserisci la sua cifra: calcolo la tua risposta migliore, quanto salire in euro e in percentuale e quando inviarla.</p>
          <Button variant="secondary" icon={ArrowRightLeft} onClick={() => setOpen(true)} className="w-full sm:w-auto">Rispondi alla controproposta</Button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field id="counter-previous" label="La tua offerta inviata" error={counter.errors.previousOffer} adornment="€">
            <TextInput id="counter-previous" inputMode="decimal" value={f.previousOffer} placeholder={previousPlaceholder} hasError={Boolean(counter.errors.previousOffer)} onChange={(e) => counter.setField('previousOffer', e.target.value)} />
          </Field>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">Controproposta del venditore</p>
            <div role="radiogroup" aria-label="Formato della controproposta" className="flex flex-wrap gap-2">
              {[['eur', 'In €'], ['pct', '% sopra la tua offerta']].map(([id, label]) => (
                <button key={id} type="button" role="radio" aria-checked={f.counterMode === id} onClick={() => counter.setField('counterMode', id)}
                  className={cx('rounded-full px-3.5 py-2 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600', f.counterMode === id ? SURFACE.chipActive : SURFACE.chip)}>
                  {label}
                </button>
              ))}
            </div>
            <Field id="counter-seller" label="" error={counter.errors.sellerCounter} adornment={f.counterMode === 'pct' ? '%' : '€'}>
              <TextInput id="counter-seller" aria-label="Controproposta del venditore" inputMode="decimal" value={f.sellerCounter} placeholder={f.counterMode === 'pct' ? '30' : '58,50'} hasError={Boolean(counter.errors.sellerCounter)} onChange={(e) => counter.setField('sellerCounter', e.target.value)} />
            </Field>
            {counter.line && <p className={cx('text-xs', SURFACE.muted)}>{counter.line.text}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">Quando l'hai ricevuta?</p>
            <div role="radiogroup" aria-label="Quando hai ricevuto la controproposta" className="flex flex-wrap gap-2">
              {COUNTER_RECEIVED_AGO.map((c) => (
                <button key={c.id} type="button" role="radio" aria-checked={f.receivedAgo === c.id} onClick={() => counter.setField('receivedAgo', c.id)}
                  className={cx('rounded-full px-3 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600', f.receivedAgo === c.id ? SURFACE.chipActive : SURFACE.chip)}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <Field id="counter-max" label="Il massimo che spenderesti" hint="(facoltativo)" adornment="€">
            <TextInput id="counter-max" inputMode="decimal" value={f.maxPrice} placeholder="es. 55" onChange={(e) => counter.setField('maxPrice', e.target.value)} />
          </Field>
          <details className={cx('rounded-xl p-3', SURFACE.cardMuted)}>
            <summary className="cursor-pointer text-sm font-semibold">Altri dettagli</summary>
            <div className="mt-2 flex flex-col gap-2 text-sm">
              {[['chat', "Me l'ha scritta in chat, non col pulsante"], ['competition', 'Ci sono molti interessati (tanti cuori)'], ['publicPrice', 'Ha abbassato il prezzo per tutti a questa cifra']].map(([id, label]) => (
                <label key={id} className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-teal-700" checked={f[id]} onChange={(e) => counter.setField(id, e.target.checked)} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </details>
          {(counter.errors.category || counter.errors.listPrice) && <p className="text-sm text-rose-600 dark:text-rose-400">{counter.errors.category || counter.errors.listPrice} Correggi i dati dell'annuncio nel modulo della prima offerta.</p>}
          <Button type="submit" icon={ArrowRightLeft} className="w-full sm:w-auto">Calcola la mia risposta</Button>
        </form>
      )}
      {open && counter.result && <CounterAnswer result={counter.result} applied={counter.applied} onApply={counter.apply} onReset={() => counter.analyze()} />}
    </Card>
  )
}

function CounterAnswer({ result, applied, onApply, onReset }) {
  const n = result.negotiation
  if (!result.optimal) {
    return (
      <div className="mt-5 flex flex-col gap-3 border-t pt-4 text-sm dark:border-slate-800">
        {result.warnings.map((w) => <p key={w.id} className={cx('rounded-xl p-3 ring-1', TONE.warn.badge)}>{w.text}</p>)}
        <p className="font-semibold">{result.kind === 'walk_away' ? 'Lascia perdere per ora' : result.kind === 'stop' ? 'Fermati qui' : `Compra a ${formatEuro(n.sellerCounter)}`}</p>
        <p>{result.message}</p>
        {result.tips.map((t) => <p key={t} className={SURFACE.muted}>• {t}</p>)}
        {result.messages.length > 0 && <CounterMessages key={result.kind} result={result} />}
      </div>
    )
  }
  const rec = result.recommended
  const acceptRecommended = rec.id === 'accept'
  const window = result.optimal.score.timeWindow
  return (
    <div className="mt-5 flex flex-col gap-4 border-t pt-4 dark:border-slate-800">
      {result.warnings.map((w) => <p key={w.id} className={cx('rounded-xl p-3 text-sm ring-1', TONE.warn.badge)}>{w.text}</p>)}
      {applied && (
        <p className={cx('rounded-xl p-3 text-sm', SURFACE.cardMuted)}>
          Hai scelto «{applied.label}»: piano ricalcolato su {formatEuro(applied.price)}.{' '}
          <button type="button" className="font-semibold text-teal-700 underline dark:text-teal-300" onClick={onReset}>Torna alla consigliata</button>
        </p>
      )}
      <div className="rounded-2xl bg-teal-700 p-4 text-white dark:bg-teal-500 dark:text-slate-950">
        <p className="text-[11px] font-semibold uppercase tracking-wider opacity-80">La tua risposta</p>
        <p className="mt-1 text-2xl font-bold leading-tight">{result.verdict.hero.title}</p>
        <p className="mt-1 text-base font-semibold leading-snug">{acceptRecommended ? result.verdict.hero.sublabel : result.verdict.headline}</p>
        {!acceptRecommended && <p className="mt-1 text-xs opacity-90">{window.label}{window.range ? ` ${window.range}` : ''} · {toPercent(rec.pAccept)}% che accetti subito</p>}
      </div>
      {!acceptRecommended && (
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <span className={cx('rounded-full px-2.5 py-1 ring-1', TONE.good.badge)}>{toPercent(rec.pBelowSeller)}% di pagare meno di {formatEuro(n.sellerCounter)}</span>
          {rec.expectedSaving != null
            ? <span className={cx('rounded-full px-2.5 py-1 ring-1', TONE.good.badge)}>Risparmio atteso {formatEuro(rec.expectedSaving)}</span>
            : <span className={cx('rounded-full px-2.5 py-1 ring-1', TONE.warn.badge)}>Entro il tuo massimo di {formatEuro(n.maxPrice)}</span>}
        </div>
      )}
      {!acceptRecommended && <p className={cx('rounded-xl p-3 text-sm ring-1', result.sendNow.ok ? TONE.good.badge : TONE.warn.badge)}><strong>Adesso? </strong>{result.sendNow.text}</p>}
      {result.lines.tier && <p className={cx('rounded-xl p-3 text-sm ring-1', TONE.warn.badge)}>{result.lines.tier}</p>}
      {result.lines.alsoGood && <p className={cx('text-sm', SURFACE.muted)}>{result.lines.alsoGood}</p>}
      <p className={cx('text-sm', SURFACE.muted)}>{result.lines.deadline}</p>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold">Le tue opzioni</p>
        {result.options.map((o) => (
          <div key={o.id} className={cx('rounded-xl p-3 text-sm ring-1', o.isRecommended || o.isChosen ? 'ring-teal-600 dark:ring-teal-400' : 'ring-slate-200 dark:ring-slate-700', SURFACE.cardMuted)}>
            <div className="flex items-start justify-between gap-3">
              <p className="font-semibold">{o.isRecommended && <Star className="mr-1 inline h-4 w-4 text-teal-600" aria-hidden="true" />}{o.label}</p>
              <p className="shrink-0 text-lg font-bold tabular-nums">{formatEuro(o.price)}</p>
            </div>
            {o.id === 'accept' ? (
              <p className="mt-1">{o.overBudget ? 'Supera il tuo massimo. ' : ''}{o.howToBuy} Con la commissione Vinted paghi {formatEuro(o.totalWithFee)}.</p>
            ) : (
              <>
                <p className="mt-1">+{formatEuro(o.stepUpEur)} (+{counterPct(o.stepUpPct)}%) dalla tua offerta · −{formatEuro(o.stepDownEur)} (−{counterPct(o.stepDownPct)}%) dalla sua</p>
                <p>{toPercent(o.pAccept)}% che accetti subito · {toPercent(o.pBelowSeller)}% di pagare meno di {formatEuro(n.sellerCounter)} · in media {formatEuro(o.expectedPrice)}</p>
                <p className={SURFACE.muted}>Totale con commissione {formatEuro(o.totalWithFee)}{o.isFinal ? ' · ultima offerta' : ''}{o.wholeEuroFallback != null ? ` · senza centesimi: ${formatEuro(o.wholeEuroFallback)}` : ''}</p>
                {!o.isRecommended && !o.isChosen && !acceptRecommended && <Button variant="secondary" onClick={() => onApply(o)} className="mt-2 w-full sm:w-auto">Applica questa scelta</Button>}
              </>
            )}
          </div>
        ))}
        {result.lines.whyNotLower && <p className={cx('text-sm', SURFACE.muted)}>{result.lines.whyNotLower}</p>}
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <p className="font-semibold">{acceptRecommended ? 'Come comprare' : 'E dopo?'}</p>
        {result.plan.map((l) => <p key={l}>• {l}</p>)}
        {!acceptRecommended && <p className={cx('mt-1 text-xs', SURFACE.muted)}>{result.ladder}</p>}
      </div>

      <CounterMessages key={`${rec.id}-${rec.price}-${result.optimal.date.getTime()}`} result={result} />

      <div className="flex flex-col gap-2 text-sm">
        <p className="font-semibold">Perché</p>
        {result.reasons.map((r) => <p key={r}>• {r}</p>)}
        {!acceptRecommended && <details className={cx('rounded-xl p-3', SURFACE.cardMuted)}>
          <summary className="flex cursor-pointer items-center justify-between gap-2 font-semibold">Che cosa pesa sulla probabilità <ChevronDown className="h-4 w-4" aria-hidden="true" /></summary>
          <ul className="mt-2 flex flex-col gap-1">
            <li className="flex justify-between gap-3"><span>{result.factors.baseLabel} (punto di partenza)</span><span className="font-semibold tabular-nums">{result.factors.basePct}%</span></li>
            {result.factors.rows.filter((r) => r.deltaPoints !== 0).map((r) => (
              <li key={r.id} className="flex justify-between gap-3"><span className="min-w-0 truncate">{r.label}</span><span className={cx('shrink-0 font-semibold tabular-nums', r.deltaPoints > 0 ? TONE.good.text : TONE.bad.text)}>{formatSignedPoints(r.deltaPoints)} pt</span></li>
            ))}
            <li className="flex justify-between gap-3 border-t pt-1 font-semibold dark:border-slate-700"><span>Accettazione nel momento consigliato</span><span className="tabular-nums">{result.factors.totalPct}%</span></li>
          </ul>
        </details>}
        <details className={cx('rounded-xl p-3', SURFACE.cardMuted)}>
          <summary className="flex cursor-pointer items-center justify-between gap-2 font-semibold">Rischi, costi e altri momenti <ChevronDown className="h-4 w-4" aria-hidden="true" /></summary>
          {!acceptRecommended && <p className="mt-2">{result.lines.risk}</p>}
          <p className="mt-1">{result.lines.totals}</p>
          {result.timing.otherMoments.map((m) => (
            <p key={m.date.getTime()} className="mt-1 flex justify-between gap-3"><span className="min-w-0 truncate">{capitalize(formatLongDate(m.date, result.now))} · {formatTime(m.date)} · {m.score.timeWindow.label.toLowerCase()}</span><span className="shrink-0 font-semibold tabular-nums">{toPercent(m.pAccept)}%</span></p>
          ))}
        </details>
        {result.tips.map((t) => <p key={t} className={SURFACE.muted}>• {t}</p>)}
        <p className={cx('text-xs', SURFACE.muted)}>{result.disclaimer}</p>
      </div>
    </div>
  )
}

function CounterMessages({ result }) {
  const [tone, setTone] = useState(result.recommendedTone)
  const [copied, setCopied] = useState(false)
  const current = result.messages.find((m) => m.tone === tone) || result.messages[0]
  const copy = async () => {
    const ok = await copyText(current.text)
    setCopied(ok)
    if (ok) setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="font-semibold">Che cosa scrivergli</p>
      <div role="tablist" aria-label="Tono del messaggio" className="flex flex-wrap gap-2">
        {TONES.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={x.id === tone} onClick={() => { setTone(x.id); setCopied(false) }}
            className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600', x.id === tone ? SURFACE.chipActive : SURFACE.chip)}>
            {x.id === result.recommendedTone && <Star className="h-3.5 w-3.5" aria-hidden="true" />}{x.label}
          </button>
        ))}
      </div>
      <p className={cx('rounded-xl p-3', SURFACE.cardMuted)}>{current.text}</p>
      {result.messageFooter && <p className={cx('text-xs', SURFACE.muted)}>{result.messageFooter}</p>}
      <Button variant="secondary" icon={copied ? Check : Copy} onClick={copy} className="w-full sm:w-auto">{copied ? 'Copiato!' : 'Copia il messaggio'}</Button>
    </div>
  )
}
