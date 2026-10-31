import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { capitalize, formatEuro, formatPoints, formatRelativeDay, formatTime, toPercent } from '../../../core/index.js'
import { copyText } from '../../services/clipboard.js'
import { radius, space, toneColors, toneForProbability, useTheme } from '../../theme.js'
import { Badge, Body, Button, Card, InlineAction, Note, Stat, StatRow } from '../ui.js'

/**
 * The decision the page leads with.
 *   buy          no offer needed, or the listing is already under the market (lever market_buy_now)
 *   unrealistic  no moment where this ask passes
 *   wait         the moment is later and now is bad, or a message must go first
 *   offer        send, now or at the moment shown
 */
export function heroStateFor(result, levers = []) {
  if (!result) return 'offer'
  if (result.kind === 'no_offer_needed' || (Array.isArray(levers) && levers.some((l) => l && l.id === 'market_buy_now'))) return 'buy'
  if (result.ambition === 'unrealistic') return 'unrealistic'
  const later = Boolean(result.optimal && result.optimal.kind !== 'now' && result.sendNow && !result.sendNow.ok)
  if (later || result.messageBeforeOffer) return 'wait'
  return 'offer'
}

/** { low, high, n } from the engine's interval (an object, or the older [low, high] pair), or null. */
const rangeOf = (result) => {
  const pr = result.probabilityRange
  if (!pr) return null
  if (Array.isArray(pr)) return Number.isFinite(pr[0]) && Number.isFinite(pr[1]) ? { low: pr[0], high: pr[1], n: 0 } : null
  if (!Number.isFinite(pr.low) || !Number.isFinite(pr.high)) return null
  return { low: pr.low, high: pr.high, n: Number.isFinite(pr.n) ? pr.n : 0 }
}

/** The blank optional fields that widen the estimate, as the caption names them. */
const missingOf = (input) => [
  (!input.sellerProfile || input.sellerProfile === 'unknown') && 'venditore',
  input.listingAge && input.listingAge.id === 'unknown' && 'anzianità',
].filter(Boolean).join(' e ')

const recommendedText = (result) => {
  const list = result.messages || []
  const m = list.find((x) => x.tone === result.recommendedTone) || list[0]
  return m ? m.text : ''
}

/** A one-line coloured statement («Adesso? …»), smaller than a Note. */
function Pill({ tone, children }) {
  const t = useTheme()
  const c = toneColors(t, tone)
  return (
    <View style={[styles.pill, { backgroundColor: c.bg }]}>
      <Text style={[styles.pillText, { color: c.fg }]}>{children}</Text>
    </View>
  )
}

/** A short sentence with, at most, one inline action after it. */
function Line({ text, action }) {
  return (
    <View style={styles.inlineRow}>
      <Body small style={{ flexShrink: 1 }}>{text}</Body>
      {action ? <InlineAction label={action.label} onPress={action.onPress} /> : null}
    </View>
  )
}

/**
 * Decision first: what to offer, when, with how much chance, and one action. Everything else lives in the folds below.
 * `curve` is useExpectedCurve's result (null while computing), `levers` value.js leversFor, `risk` failureRiskFor,
 * `policy` the discount policy that proposed the ask (may be absent).
 */
export function DecisionHero({
  result, levers = [], curve = null, risk = null, policy = null, saveState = null, calendarBusy = false, now = null,
  onEdit, onSave, onSaveAndMarkSent, onCalendar, onCounter, onApplyPrice, onSkipExploration, onOpenPrice,
}) {
  const t = useTheme()
  const [copied, setCopied] = useState(false)
  const state = heroStateFor(result, levers)
  const { input } = result
  const border = { offer: t.accent, wait: t.warn, unrealistic: t.bad, buy: t.good }[state]
  const reference = now || result.now || new Date()

  const eyebrow = (
    <View style={styles.eyebrow}>
      <Text style={[styles.eyebrowText, { color: t.ink3, flex: 1 }]} numberOfLines={1}>{input.itemTitle || 'Articolo senza titolo'}</Text>
      <Text style={[styles.eyebrowText, { color: t.ink3 }]}>Listino {formatEuro(input.listPrice)}</Text>
      {onEdit ? <InlineAction label="Modifica" onPress={onEdit} style={styles.eyebrowAction} /> : null}
    </View>
  )

  if (result.kind === 'no_offer_needed') {
    const why = policy && policy.noOffer && Array.isArray(policy.reason) && policy.reason[0] ? policy.reason[0] : null
    return (
      <Card style={{ borderColor: border }}>
        {eyebrow}
        <Text style={[styles.h1, { color: t.ink }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>Compra senza offerta</Text>
        <Text style={[styles.h2, { color: t.ink }]}>{result.message}</Text>
        {why ? <Body small muted>{capitalize(why)}</Body> : null}
      </Card>
    )
  }

  const { verdict, optimal, sendNow, riskBand, suggestedPrice, exploration, messageBeforeOffer, probability } = result
  const saved = Boolean(saveState && saveState.saved)
  const sendable = Boolean((optimal && optimal.kind === 'now') || (sendNow && sendNow.ok))
  const at = curve && curve.atTarget ? curve.atTarget : null
  const best = curve && curve.best ? curve.best : null
  const sameAsTarget = Boolean(at && best && Math.abs(best.price - at.price) < 0.005)
  const range = rangeOf(result)
  const missing = result.uncertainty > 0 ? missingOf(input) : ''
  const discount = Math.round(input.discountPct)
  const target = formatEuro(input.targetPrice)

  const h1 = state === 'unrealistic' ? `Così non passa a ${target}` : state === 'buy' ? 'Compra, o offri poco' : `Offri ${target}`
  const moment = verdict ? capitalize(verdict.headline.replace("Invia l'offerta ", 'Invia ')) : ''
  const sub = verdict ? `${verdict.sublabel}${verdict.isHoliday ? ' · festivo, vale come domenica' : ''}` : ''

  // «Adesso?»: only when the recommended moment is not now.
  let nowText = null
  if (optimal && optimal.kind !== 'now' && sendNow) {
    const name = sendNow.window ? sendNow.window.label.toLowerCase() : 'questa fascia'
    const pts = formatPoints(sendNow.deltaPoints)
    if (sendNow.reason === 'exploration') nowText = 'Adesso? No: prova del motore, invia all\'orario indicato.'
    else if (sendNow.ok) nowText = `Adesso? Sì, va bene anche subito (${pts}).`
    else nowText = `Adesso? No: ${name} (${pts}). Aspetta.`
  }

  // One suggestion, first match wins: test variation, under-market warning, suggested price, cheaper point of the
  // curve, pinned moment. In the unrealistic state the primary button already carries «Usa N €».
  let suggestion = null
  if (exploration) {
    const n = exploration.costPoints
    suggestion = (
      <View style={{ gap: space.xs }}>
        <Badge tone="warn">Prova del motore (1 su 5): {exploration.label}</Badge>
        <Line text={n > 0 ? `Costa ~${n} ${n === 1 ? 'punto' : 'punti'}` : 'Nessun costo'} action={onSkipExploration ? { label: 'Usa il piano migliore', onPress: onSkipExploration } : null} />
      </View>
    )
  } else if (state === 'buy') {
    suggestion = <Line text="Costa già meno degli altri annunci: un'offerta può fartelo perdere." action={onOpenPrice ? { label: 'Vedi mercato', onPress: onOpenPrice } : null} />
  } else if (suggestedPrice) {
    const price = formatEuro(suggestedPrice.price)
    suggestion = (
      <Line
        text={`Con ${price} (−${Math.round(suggestedPrice.discountPct)}%) sali al ${toPercent(suggestedPrice.probability)}%`}
        action={state !== 'unrealistic' && onApplyPrice ? { label: `Usa ${price}`, onPress: () => onApplyPrice(suggestedPrice.price) } : null}
      />
    )
  } else if (best && at && !sameAsTarget) {
    const price = formatEuro(best.price)
    suggestion = <Line text={`Paghi meno in media con ${price}: atteso ${formatEuro(best.expected)}`} action={onApplyPrice ? { label: `Usa ${price}`, onPress: () => onApplyPrice(best.price) } : null} />
  } else if (result.pinned) {
    suggestion = <Body small muted>Orario scelto da te</Body>
  }

  const copy = async () => {
    const ok = await copyText(recommendedText(result))
    setCopied(ok)
    if (ok) setTimeout(() => setCopied(false), 2000)
  }
  const copyButton = <Button label={copied ? 'Copiato!' : 'Copia messaggio'} variant="secondary" small onPress={copy} />
  const calendarButton = <Button label={calendarBusy ? 'Apro il calendario…' : 'Calendario'} variant="ghost" small onPress={onCalendar} disabled={calendarBusy} />

  let actions
  if (saved) {
    actions = (
      <View style={{ gap: space.sm }}>
        {saveState.message ? <Note tone={saveState.tone || 'neutral'}>{saveState.message}</Note> : null}
        <View style={styles.actionRow}>
          {copyButton}
          {calendarButton}
          {onCounter ? <Button label="Controproposta ricevuta?" variant="ghost" small onPress={onCounter} /> : null}
        </View>
      </View>
    )
  } else if (state === 'unrealistic') {
    actions = (
      <View style={{ gap: space.sm }}>
        {suggestedPrice && onApplyPrice
          ? <Button label={`Usa ${formatEuro(suggestedPrice.price)}`} onPress={() => onApplyPrice(suggestedPrice.price)} />
          : <Button label="Cambia l'offerta" onPress={onEdit} />}
        <Button label="Salva comunque" variant="ghost" small onPress={onSave} />
      </View>
    )
  } else if (sendable) {
    actions = (
      <View style={{ gap: space.sm }}>
        <Button label="L'ho inviata adesso" onPress={onSaveAndMarkSent || onSave} />
        <View style={styles.actionRow}>
          {copyButton}
          <Button label="Salva per dopo" variant="ghost" small onPress={onSave} />
        </View>
      </View>
    )
  } else {
    actions = (
      <View style={{ gap: space.sm }}>
        <Button label="Salva e ricordamelo" onPress={onSave} />
        <View style={styles.actionRow}>
          {copyButton}
          {calendarButton}
        </View>
      </View>
    )
  }

  const basis = range && range.n > 0 ? `su ${range.n} ${range.n === 1 ? 'tuo esito' : 'tuoi esiti'}` : risk && risk.basis === 'history' ? 'sui tuoi esiti' : 'stima iniziale'

  return (
    <Card style={{ borderColor: border }}>
      {eyebrow}
      <View style={{ gap: space.xs }}>
        <Text style={[styles.h1, { color: state === 'unrealistic' ? t.bad : t.ink }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{h1}</Text>
        {riskBand ? <Badge tone={state === 'unrealistic' ? 'bad' : riskBand.tone}>−{discount}% · rischio {riskBand.label.toLowerCase()}</Badge> : null}
      </View>
      <View style={{ gap: 2 }}>
        {messageBeforeOffer ? <Badge tone="warn">Prima scrivi in chat, poi l'offerta</Badge> : null}
        {moment ? <Text style={[styles.h2, { color: t.ink }]}>{moment}</Text> : null}
        {sub ? <Body small muted>{sub}</Body> : null}
      </View>
      <StatRow>
        <Stat label="Probabilità" value={`${toPercent(probability)}%`} tone={toneForProbability(probability)} sub={basis} />
        <Stat label="Prezzo atteso" value={at ? formatEuro(at.expected) : '…'} sub="media tra sì e no" />
        <Stat label="Risposta entro" value={optimal && optimal.expiresAt ? formatTime(optimal.expiresAt) : '—'} sub={optimal && optimal.expiresAt ? formatRelativeDay(optimal.expiresAt, reference) : ''} />
      </StatRow>
      {range || missing ? (
        <View style={styles.inlineRow}>
          {range ? <Body small muted>Tra {toPercent(range.low)}% e {toPercent(range.high)}%</Body> : null}
          {missing && onEdit ? <InlineAction label={`manca: ${missing}`} onPress={onEdit} /> : null}
        </View>
      ) : null}
      {nowText ? <Pill tone={sendNow && sendNow.ok ? 'good' : 'bad'}>{nowText}</Pill> : null}
      {suggestion}
      {actions}
    </Card>
  )
}

const styles = StyleSheet.create({
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  eyebrowText: { fontSize: 12, flexShrink: 1, minWidth: 0 },
  eyebrowAction: { paddingVertical: 0, minHeight: 0, flexShrink: 0 },
  h1: { fontSize: 28, fontWeight: '800', lineHeight: 34, letterSpacing: -0.5 },
  h2: { fontSize: 17, fontWeight: '700', lineHeight: 22 },
  pill: { borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 8, alignSelf: 'stretch' },
  pillText: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  inlineRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  actionRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
})
