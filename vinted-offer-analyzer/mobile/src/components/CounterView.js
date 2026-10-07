import { useMemo, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import {
  COUNTER_RECEIVED_AGO, TONES, analyzeCounter, capitalize, counterFromPercent, counterPreview, formatEuro, formatLongDate,
  formatSignedPoints, formatTime, parsePercent, parsePrice, toPercent,
} from '../../core/index.js'
import { copyText } from '../services/clipboard.js'
import { radius, space, toneForProbability, useTheme } from '../theme.js'
import { Badge, Body, Button, ButtonRow, Card, Chip, Collapsible, Field, Note, Row, SectionLabel, Title, Toggle } from './ui.js'

const pctText = (v) => String(Math.round(v * 10) / 10).replace('.', ',')
const priceText = (v) => (Math.abs(v - Math.round(v)) > 0.004 ? v.toFixed(2) : String(Math.round(v))).replace('.', ',')

/**
 * "Il venditore ha fatto una controproposta": the user types the seller's number (in € or as % over the offer),
 * the engine returns the best reply price, the moment to send it, the plan for the next round and the message.
 * `context` comes from a fresh analysis ({ form }) or from a saved item ({ itemId, form, history }).
 */
export function CounterView({ context, onClose, onSave, onCalendar, calendarBusy = false, clock = () => new Date(), onScrollTo = null, profile = null }) {
  const t = useTheme()
  const pendingScroll = useRef(false)
  const history = Array.isArray(context.history) ? context.history : []
  const last = history[history.length - 1]
  // Our last offer: the latest buyer entry of a saved negotiation, else the analysed target price.
  const lastBuyer = [...history].reverse().find((e) => e.by === 'buyer')
  const recalculating = Boolean(last && last.by === 'seller')
  const [fields, setFields] = useState({
    previousOffer: lastBuyer ? priceText(lastBuyer.price) : (context.form.targetPrice || ''),
    sellerCounter: recalculating ? priceText(last.price) : '',
    counterMode: 'eur',
    receivedAgo: 'just_now',
    maxPrice: '',
    chat: false,
    competition: false,
    publicPrice: false,
  })
  const [result, setResult] = useState(null)
  const [errors, setErrors] = useState({})
  const [applied, setApplied] = useState(null)
  const [saveState, setSaveState] = useState(null)
  const setField = (name, value) => setFields((prev) => ({ ...prev, [name]: value }))
  const round = history.filter((e) => e.by === 'seller').length + (recalculating ? 0 : 1)

  // His previous counter (round 2+), so the preview measures his step from there and not from the list price.
  const sellerPrevious = useMemo(() => {
    const sellers = (recalculating ? history.slice(0, -1) : history).filter((e) => e.by === 'seller')
    return sellers.length ? sellers[sellers.length - 1].price : null
  }, [history, recalculating])
  const preview = useMemo(() => counterPreview({ listPrice: context.form.listPrice, previousOffer: fields.previousOffer, sellerCounter: fields.sellerCounter, counterMode: fields.counterMode, sellerPrevious }), [context.form.listPrice, fields.previousOffer, fields.sellerCounter, fields.counterMode, sellerPrevious])

  /** Builds the engine input; saved negotiations pass their history with the new (or corrected) seller counter. */
  const buildRaw = () => {
    const raw = {
      ...context.form,
      previousOffer: fields.previousOffer,
      sellerCounter: fields.sellerCounter,
      counterMode: fields.counterMode,
      receivedAgo: fields.receivedAgo,
      maxPrice: fields.maxPrice,
      channel: fields.chat ? 'chat' : 'button',
      competition: fields.competition,
      publicPrice: fields.publicPrice,
      offerSentAt: context.offerSentAt || null,
    }
    if (history.length) {
      const B = parsePrice(fields.previousOffer)
      const S = fields.counterMode === 'pct' ? counterFromPercent(B, parsePercent(fields.sellerCounter)) : parsePrice(fields.sellerCounter)
      if (!(S > 0)) return raw // let the engine report the missing counter
      const base = recalculating ? history.slice(0, -1) : history
      // A planned (never marked as sent) offer has no real send time; keep the "final" flag and the uncertainty of each counter.
      const entries = base.map((e) => ({ by: e.by, price: e.price, at: e.planned ? null : (e.at || null), isFinal: Boolean(e.isFinal), receivedUncertaintyMinutes: e.receivedUncertaintyMinutes || 0 }))
      if (entries.length && entries[entries.length - 1].by === 'buyer' && Number.isFinite(B)) entries[entries.length - 1] = { ...entries[entries.length - 1], price: B }
      raw.history = [...entries, { by: 'seller', price: S, at: recalculating ? last.at : null, receivedUncertaintyMinutes: recalculating ? (last.receivedUncertaintyMinutes || 0) : 0 }]
    }
    return raw
  }

  const run = (opts = {}) => {
    // The learned profile (monthly report) corrects the acceptance of our counter for this user's sellers.
    const outcome = analyzeCounter(buildRaw(), clock(), profile ? { ...opts, profile } : opts)
    if (!outcome.ok) {
      setErrors(outcome.errors)
      setResult(null)
      return
    }
    setErrors({})
    setResult(outcome)
    setSaveState(null)
    pendingScroll.current = true
  }

  const calculate = () => {
    setApplied(null)
    run()
  }

  const applyOption = (option) => {
    setApplied(option)
    run({ forcePrice: option.apply.counterPrice, preferredSendAt: option.apply.preferredSendAt })
  }

  const save = async () => {
    // The list updates at once; the reminder waits for the notification permission, if Android asks for it.
    setSaveState({ saved: true, tone: 'neutral', message: 'Salvato nella lista. Imposto il promemoria…' })
    const outcome = await onSave(result, buildRaw())
    setSaveState(outcome)
  }

  return (
    <View style={{ gap: space.lg }}>
      <Card style={{ borderColor: t.accent }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <SectionLabel>Controproposta · round {round}</SectionLabel>
          <Button label="Chiudi" variant="ghost" small onPress={onClose} />
        </Row>
        <Title>Il venditore ha fatto una controproposta?</Title>
        <Body muted small>
          {context.form.itemTitle ? `${context.form.itemTitle} · ` : ''}listino {formatEuro(parsePrice(context.form.listPrice) || 0)}. Inserisci la sua cifra: calcolo la tua risposta migliore, quanto salire e quando inviarla.
        </Body>
        <Field label="La tua offerta inviata" value={fields.previousOffer} onChangeText={(v) => setField('previousOffer', v)} placeholder="45" keyboardType="decimal-pad" suffix="€" error={errors.previousOffer} />
        <View style={{ gap: 6 }}>
          <Text style={[styles.label, { color: t.ink }]}>Controproposta del venditore</Text>
          <Row>
            <Chip compact label="In €" active={fields.counterMode === 'eur'} onPress={() => setField('counterMode', 'eur')} />
            <Chip compact label="% sopra la tua offerta" active={fields.counterMode === 'pct'} onPress={() => setField('counterMode', 'pct')} />
          </Row>
          <Field label="" value={fields.sellerCounter} onChangeText={(v) => setField('sellerCounter', v)} placeholder={fields.counterMode === 'pct' ? '30' : '58,50'} keyboardType="decimal-pad" suffix={fields.counterMode === 'pct' ? '%' : '€'} error={errors.sellerCounter || errors.history} />
          {preview ? <Body muted small>{preview.text}</Body> : null}
        </View>
        {!recalculating && (
          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: t.ink }]}>Quando l'hai ricevuta?</Text>
            <Row>
              {COUNTER_RECEIVED_AGO.map((c) => <Chip key={c.id} compact label={c.label} active={fields.receivedAgo === c.id} onPress={() => setField('receivedAgo', c.id)} />)}
            </Row>
          </View>
        )}
        <Field label="Il massimo che spenderesti" hint="(facoltativo)" value={fields.maxPrice} onChangeText={(v) => setField('maxPrice', v)} placeholder="es. 55" keyboardType="decimal-pad" suffix="€" />
        <Collapsible title="Altri dettagli" summary="Chat, tanti interessati, prezzo abbassato per tutti">
          <Toggle label="Me l'ha scritta in chat, non col pulsante" value={fields.chat} onChange={(v) => setField('chat', v)} />
          <Toggle label="Ci sono molti interessati (tanti cuori)" value={fields.competition} onChange={(v) => setField('competition', v)} />
          <Toggle label="Ha abbassato il prezzo per tutti a questa cifra" value={fields.publicPrice} onChange={(v) => setField('publicPrice', v)} />
        </Collapsible>
        {errors.category || errors.listPrice ? <Note tone="bad">{errors.category || errors.listPrice} Correggi i dati dell'annuncio nel modulo della prima offerta.</Note> : null}
        <Button label="Calcola la mia risposta" onPress={calculate} />
      </Card>

      {result && (
        <View onLayout={(e) => {
          // Bring the answer into view once, right after a calculation.
          if (pendingScroll.current && onScrollTo) {
            pendingScroll.current = false
            onScrollTo(e.nativeEvent.layout.y)
          }
        }}>
        <CounterResult
          result={result}
          applied={applied}
          onApply={applyOption}
          onReset={calculate}
          onSave={save}
          saveState={saveState}
          onCalendar={() => onCalendar(result)}
          calendarBusy={calendarBusy}
        />
        </View>
      )}
    </View>
  )
}

function CounterResult({ result, applied, onApply, onReset, onSave, saveState, onCalendar, calendarBusy }) {
  const t = useTheme()
  const n = result.negotiation
  if (!result.optimal) {
    // Short answers: buy now, walk away, stop after three counters.
    const accept = result.options[0]
    return (
      <View style={{ gap: space.lg }}>
        {result.warnings.map((w) => <Note key={w.id} tone="warn">{w.text}</Note>)}
        <Card>
          <SectionLabel>La tua risposta</SectionLabel>
          <Title>{result.kind === 'walk_away' ? 'Lascia perdere per ora' : result.kind === 'stop' ? 'Fermati qui' : `Compra a ${formatEuro(n.sellerCounter)}`}</Title>
          <Body>{result.message}</Body>
          {accept && result.kind !== 'walk_away' ? <Body muted small>Con la commissione Vinted paghi {formatEuro(accept.totalWithFee)}, spedizione esclusa.</Body> : null}
          {result.tips.map((tip) => <Body key={tip} small>• {tip}</Body>)}
        </Card>
        {result.messages.length > 0 && <CounterMessageCard key={`${result.kind}-${n.sellerCounter}`} result={result} />}
      </View>
    )
  }

  const rec = result.recommended
  const acceptRecommended = rec.id === 'accept'
  const window = result.optimal.score.timeWindow
  return (
    <View style={{ gap: space.lg }}>
      {result.warnings.map((w) => <Note key={w.id} tone="warn">{w.text}</Note>)}
      {applied && (
        <Note>
          Hai scelto «{applied.label}»: piano ricalcolato su {formatEuro(applied.price)}.{' '}
          <Text style={{ fontWeight: '700', color: t.accentInk }} onPress={onReset}>Torna alla consigliata</Text>
        </Note>
      )}
      <Card>
        <SectionLabel>La tua risposta</SectionLabel>
        <View style={[styles.hero, { backgroundColor: t.accent }]}>
          <Text style={[styles.heroTitle, { color: t.onAccent }]}>{result.verdict.hero.title}</Text>
          <Text style={[styles.heroLine, { color: t.onAccent }]}>{acceptRecommended ? result.verdict.hero.sublabel : result.verdict.headline}</Text>
          {!acceptRecommended && (
            <Text style={[styles.heroMeta, { color: t.onAccent }]}>
              {window.label}{window.range ? ` ${window.range}` : ''} · {toPercent(rec.pAccept)}% che accetti subito
            </Text>
          )}
        </View>
        {!acceptRecommended && (
          <Row>
            <Badge tone={toneForProbability(rec.pBelowSeller)}>{toPercent(rec.pBelowSeller)}% di pagare meno di {formatEuro(n.sellerCounter)}</Badge>
            {rec.expectedSaving != null
              ? <Badge tone="good">Risparmio atteso {formatEuro(rec.expectedSaving)}</Badge>
              : <Badge tone="warn">Entro il tuo massimo di {formatEuro(n.maxPrice)}</Badge>}
          </Row>
        )}
        {!acceptRecommended && <Note tone={result.sendNow.ok ? 'good' : 'warn'}><Text style={{ fontWeight: '700' }}>Adesso? </Text>{result.sendNow.text}</Note>}
        {result.lines.tier ? <Note tone="warn">{result.lines.tier}</Note> : null}
        {result.lines.alsoGood ? <Body muted small>{result.lines.alsoGood}</Body> : null}
        <Body muted small>{result.lines.deadline}</Body>
      </Card>

      <Card style={{ borderColor: t.accent }}>
        <SectionLabel>Promemoria</SectionLabel>
        <Title>{acceptRecommended ? 'Segna e compra' : 'Salva il piano e ricordamelo'}</Title>
        <Body muted small>
          {acceptRecommended
            ? 'La trattativa finisce nella lista: quando hai comprato segna l\'esito «Accettata».'
            : 'Ti avviso 10 minuti prima con la cifra e il messaggio pronto. Quando hai inviato, tocca «Ho inviato la nuova offerta» nella lista.'}
        </Body>
        {saveState && saveState.message ? <Note tone={saveState.tone}>{saveState.message}</Note> : null}
        <ButtonRow>
          <Button label={saveState && saveState.saved ? 'Salvato nella lista' : 'Salva e ricordamelo'} onPress={onSave} disabled={Boolean(saveState && saveState.saved)} />
          {!acceptRecommended && <Button label={calendarBusy ? 'Apro il calendario…' : 'Metti in calendario'} variant="secondary" onPress={onCalendar} disabled={calendarBusy} />}
        </ButtonRow>
      </Card>

      <Card>
        <SectionLabel>Le tue opzioni</SectionLabel>
        <Title>Quanto salire</Title>
        {result.options.map((o) => <OptionBox key={o.id} option={o} sellerPrice={n.sellerCounter} onApply={onApply} applyAllowed={!acceptRecommended} />)}
        {result.lines.whyNotLower ? <Body muted small>{result.lines.whyNotLower}</Body> : null}
      </Card>

      <Card>
        <SectionLabel>{acceptRecommended ? 'Come comprare' : 'E dopo?'}</SectionLabel>
        <Title>{acceptRecommended ? 'Compra adesso' : 'Il piano per la prossima mossa'}</Title>
        {result.plan.map((line) => <Body key={line}>• {line}</Body>)}
        {!acceptRecommended && <Body muted small>{result.ladder}</Body>}
      </Card>

      <CounterMessageCard key={`${rec.id}-${rec.price}-${result.optimal.date.getTime()}`} result={result} />

      <Card>
        <SectionLabel>Perché</SectionLabel>
        <Title>Come ho scelto cifra e momento</Title>
        {result.reasons.map((r) => <Body key={r}>• {r}</Body>)}
        {!acceptRecommended && (
          <Collapsible title="Che cosa pesa sulla probabilità" summary={`${result.factors.baseLabel} → ${result.factors.basePct}%, alla fine ${result.factors.totalPct}%`}>
            <FactorRows factors={result.factors} />
          </Collapsible>
        )}
        <Collapsible title={acceptRecommended ? 'Costi' : 'Rischi e costi'} summary={acceptRecommended ? 'Commissione Vinted' : 'Cosa rischi inviando una nuova offerta, commissione Vinted'}>
          {!acceptRecommended && <Body small>{result.lines.risk}</Body>}
          <Body small>{result.lines.totals}</Body>
        </Collapsible>
        {!acceptRecommended && (result.timing.otherMoments.length > 0 || result.avoidToday.length > 0) && (
          <Collapsible title="Altri momenti e fasce da evitare" summary={momentsSummary(result.timing.otherMoments.length, result.avoidToday.length)}>
            {result.timing.otherMoments.map((m) => (
              <View key={m.date.getTime()} style={styles.row}>
                <Body small style={styles.rowLabel} numberOfLines={1}>{capitalize(formatLongDate(m.date, result.now))} · {formatTime(m.date)} · {m.score.timeWindow.label.toLowerCase()}</Body>
                <Text style={[styles.rowValue, { color: t.ink }]}>{toPercent(m.pAccept)}%</Text>
              </View>
            ))}
            {result.avoidToday.length > 0 && <Row>{result.avoidToday.map((w) => <Badge key={w.id} tone="bad">{w.label} · {w.rangeLabel}</Badge>)}</Row>}
          </Collapsible>
        )}
        {result.tips.map((tip) => <Body key={tip} small>• {tip}</Body>)}
        <Body muted small>{result.disclaimer}</Body>
      </Card>
    </View>
  )
}

const momentsSummary = (n, m) => [
  n ? `${n} ${n === 1 ? 'alternativa' : 'alternative'}` : null,
  m ? `${m} ${m === 1 ? 'fascia' : 'fasce'} da evitare` : null,
].filter(Boolean).join(' · ')

function OptionBox({ option, sellerPrice, onApply, applyAllowed = true }) {
  const t = useTheme()
  const o = option
  const isAccept = o.id === 'accept'
  return (
    <View style={[styles.option, { borderColor: o.isRecommended || o.isChosen ? t.accent : t.line, backgroundColor: t.cardMuted }]}>
      <View style={styles.row}>
        <Body style={[styles.rowLabel, { fontWeight: '700' }]} numberOfLines={2}>{o.isRecommended ? '★ ' : ''}{o.label}</Body>
        <Text style={[styles.optionPrice, { color: t.ink }]}>{formatEuro(o.price)}</Text>
      </View>
      {isAccept ? (
        <Body small>{o.overBudget ? 'Supera il tuo massimo. ' : ''}{o.howToBuy} Con la commissione Vinted paghi {formatEuro(o.totalWithFee)}.</Body>
      ) : (
        <>
          <Body small>+{formatEuro(o.stepUpEur)} (+{pctText(o.stepUpPct)}%) dalla tua offerta · −{formatEuro(o.stepDownEur)} (−{pctText(o.stepDownPct)}%) dalla sua</Body>
          <Body small>{toPercent(o.pAccept)}% che accetti subito · {toPercent(o.pBelowSeller)}% di pagare meno di {formatEuro(sellerPrice)} · in media {formatEuro(o.expectedPrice)}</Body>
          <Body muted small>Totale con commissione {formatEuro(o.totalWithFee)}{o.isFinal ? ' · ultima offerta' : ''}{o.wholeEuroFallback != null ? ` · senza centesimi: ${formatEuro(o.wholeEuroFallback)}` : ''}</Body>
          {applyAllowed && !o.isRecommended && !o.isChosen && <Button label="Applica questa scelta" variant="secondary" small onPress={() => onApply(o)} />}
        </>
      )}
    </View>
  )
}

function FactorRows({ factors }) {
  const t = useTheme()
  const rows = factors.rows.filter((r) => r.deltaPoints !== 0)
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.row}>
        <Body small style={styles.rowLabel}>{factors.baseLabel} (punto di partenza)</Body>
        <Text style={[styles.rowValue, { color: t.ink }]}>{factors.basePct}%</Text>
      </View>
      {rows.map((f) => (
        <View key={f.id} style={styles.row}>
          <Body small style={styles.rowLabel} numberOfLines={1}>{f.label}</Body>
          <Text style={[styles.rowValue, { color: f.deltaPoints > 0 ? t.good : t.bad }]}>{formatSignedPoints(f.deltaPoints)} pt</Text>
        </View>
      ))}
      <View style={[styles.row, { borderTopWidth: 1, borderTopColor: t.line, paddingTop: 6 }]}>
        <Body small style={[styles.rowLabel, { fontWeight: '600' }]}>Accettazione nel momento consigliato</Body>
        <Text style={[styles.rowValue, { color: t.ink }]}>{factors.totalPct}%</Text>
      </View>
    </View>
  )
}

function CounterMessageCard({ result }) {
  const [tone, setTone] = useState(result.recommendedTone)
  const [copied, setCopied] = useState(false)
  const current = result.messages.find((m) => m.tone === tone) || result.messages[0]
  const copy = async () => {
    const ok = await copyText(current.text)
    setCopied(ok)
    if (ok) setTimeout(() => setCopied(false), 2000)
  }
  return (
    <Card>
      <SectionLabel>Messaggio</SectionLabel>
      <Title>Che cosa scrivergli</Title>
      <Row>
        {TONES.map((x) => <Chip key={x.id} compact label={`${x.id === result.recommendedTone ? '★ ' : ''}${x.label}`} active={x.id === tone} onPress={() => { setTone(x.id); setCopied(false) }} />)}
      </Row>
      <Note>{current.text}</Note>
      {result.messageFooter ? <Body muted small>{result.messageFooter}</Body> : null}
      <Button label={copied ? 'Copiato!' : 'Copia il messaggio'} variant="secondary" onPress={copy} />
    </Card>
  )
}

/** Small summary of a saved negotiation for the list: «Lui 58,50 € → tu 51,70 € …». */
export function negotiationLine(item) {
  const steps = (item.negotiation || []).filter((e) => !e.planned).map((e) => `${e.by === 'buyer' ? 'tu' : 'lui'} ${formatEuro(e.price)}`)
  return steps.join(' → ')
}

const styles = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '600' },
  hero: { borderRadius: radius.lg, padding: space.lg, gap: 6 },
  heroTitle: { fontSize: 26, fontWeight: '800', lineHeight: 32 },
  heroLine: { fontSize: 16, fontWeight: '600', lineHeight: 22 },
  heroMeta: { fontSize: 12, opacity: 0.9 },
  option: { borderWidth: 1, borderRadius: radius.lg, padding: space.md, gap: 6 },
  optionPrice: { fontSize: 20, fontWeight: '800', flexShrink: 0 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  rowLabel: { flex: 1, flexShrink: 1, minWidth: 0 },
  rowValue: { fontSize: 14, fontWeight: '700', flexShrink: 0 },
})
