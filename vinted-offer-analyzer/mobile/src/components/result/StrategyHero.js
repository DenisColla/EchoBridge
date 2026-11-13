import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { capitalize, formatEuro, toPercent } from '../../../core/index.js'
import { copyText } from '../../services/clipboard.js'
import { radius, space, toneColors, useTheme } from '../../theme.js'
import { Badge, Body, Button, Card, InlineAction, Note } from '../ui.js'

const TYPE_TONE = { facile: 'good', medio: 'warn', difficile: 'bad' }
const CONFIDENCE = { alta: 'profilo completo', media: 'profilo parziale', bassa: 'pochi dati sul venditore' }

/** One of the three proposals: label, price, discount and odds. The chosen one is filled, the best on average starred. */
function Proposal({ option, selected, onPress }) {
  const t = useTheme()
  const c = toneColors(t, 'accent')
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${option.label}: ${formatEuro(option.price)}, sconto ${Math.round(option.discountPct)}%, probabilità ${toPercent(option.probability)}%`}
      style={({ pressed }) => [styles.proposal, { borderColor: selected ? t.accent : t.line, backgroundColor: selected ? c.bg : t.card, opacity: pressed ? 0.85 : 1 }]}
    >
      <Text style={[styles.proposalLabel, { color: selected ? c.fg : t.ink3 }]} numberOfLines={1}>{option.label}</Text>
      {option.recommended ? <Text style={[styles.star, { color: t.accentInk }]} accessibilityLabel="paga meno in media">★</Text> : null}
      <Text style={[styles.proposalPrice, { color: t.ink }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{formatEuro(option.price)}</Text>
      <Text style={[styles.proposalSub, { color: t.ink3 }]} numberOfLines={1}>−{Math.round(option.discountPct)}% · {toPercent(option.probability)}%</Text>
    </Pressable>
  )
}

/**
 * The 1.8 hero: who the seller is, three proposals, when to send, the moves in order, one primary button.
 * `strategy` comes from strategyFor (core); `result` is the analysis of the chosen proposal.
 */
export function StrategyHero({ strategy, result, saveState = null, calendarBusy = false, onPick, onEdit, onSave, onSaveAndMarkSent, onCalendar, onCounter, onCopyMessage }) {
  const t = useTheme()
  const [copied, setCopied] = useState(false)
  const { seller, options, moment, plan } = strategy
  const chosen = options.find((o) => o.id === strategy.chosenId) || options[0]
  const { input, verdict, gate } = result
  const saved = Boolean(saveState && saveState.saved)
  const main = options.filter((o) => o.id !== 'tua')
  const own = options.find((o) => o.id === 'tua') || null

  const copy = async (text) => {
    const ok = await copyText(text)
    setCopied(ok)
    if (ok && onCopyMessage) onCopyMessage()
    setTimeout(() => setCopied(false), 2000)
  }
  const message = plan.find((s) => s.text) || null
  const timing = verdict ? (verdict.timing && verdict.timing.headline) || verdict.headline : ''
  const when = moment.kind === 'now' ? 'Invia adesso'
    : moment.kind === 'morning' ? 'Invia domattina, appena sveglio'
      : timing ? capitalize(timing.replace("Invia l'offerta ", 'Invia ')) : 'Invia nel momento consigliato'
  const history = chosen.history && chosen.history.n > 0
    ? `Nel tuo storico a questo sconto: ${chosen.history.accepted} accettat${chosen.history.accepted === 1 ? 'a' : 'e'} su ${chosen.history.n}.`
    : 'Nessun tuo esito a questo sconto: stima del motore.'
  const counter = chosen.counterChance >= 0.15 ? ` Controproposta probabile al ${toPercent(chosen.counterChance)}%, intorno a ${formatEuro(chosen.counterPrice)}.` : ''
  const advice = gate && gate.advice && [2, 4, 6, 7].includes(gate.advice.rule) ? gate.advice.reason : null
  const traits = seller.traits.slice(0, 3).map((x) => x.label)
  const sendNow = moment.kind === 'now'

  return (
    <Card style={{ borderColor: t.accent }}>
      <View style={styles.eyebrow}>
        <Text style={[styles.eyebrowText, { color: t.ink3, flex: 1 }]} numberOfLines={1}>{input.itemTitle || 'Articolo senza titolo'}</Text>
        <Text style={[styles.eyebrowText, { color: t.ink3, flexShrink: 0 }]}>Annuncio {formatEuro(input.listPrice)}</Text>
        {onEdit ? <InlineAction label="Modifica" onPress={onEdit} style={styles.eyebrowAction} /> : null}
      </View>

      <View style={{ gap: 4 }}>
        <View style={styles.inlineRow}>
          <Badge tone={TYPE_TONE[seller.type] || 'neutral'}>{seller.label}</Badge>
          <Body small muted>{seller.archetype ? seller.archetype.label : ''}{seller.confidence ? ` · ${CONFIDENCE[seller.confidence] || ''}` : ''}</Body>
        </View>
        {traits.length ? <Body small muted>{capitalize(traits.join(' · '))}</Body> : null}
      </View>

      <View accessibilityRole="radiogroup" style={styles.proposals}>
        {main.map((o) => <Proposal key={o.id} option={o} selected={o.id === chosen.id} onPress={() => onPick && onPick(o)} />)}
      </View>
      {own ? (
        <Pressable onPress={() => onPick && onPick(own)} accessibilityRole="radio" accessibilityState={{ checked: own.id === chosen.id }} style={[styles.own, { borderColor: own.id === chosen.id ? t.accent : t.line }]}>
          <Body small>La tua cifra: {formatEuro(own.price)} (−{Math.round(own.discountPct)}%) · {toPercent(own.probability)}%</Body>
        </Pressable>
      ) : null}
      <Body small muted>
        ★ = paga meno in media. Con {formatEuro(chosen.price)} paghi in media {formatEuro(chosen.expectedPrice)} tra sì, controproposte e no. {history}{counter}
      </Body>

      <View style={{ gap: 2 }}>
        <Text style={[styles.h2, { color: t.ink }]}>{when}</Text>
        <Body small muted>{moment.kind === 'slot' && verdict && verdict.timing && verdict.timing.sublabel ? verdict.timing.sublabel : moment.reason}</Body>
      </View>

      {plan.length > 1 ? (
        <View style={{ gap: 4 }}>
          {plan.map((s, i) => (
            <View key={s.id} style={styles.step}>
              <Text style={[styles.stepIndex, { color: t.accentInk }]}>{i + 1}</Text>
              <Body small style={{ flex: 1, minWidth: 0 }}>{s.label}</Body>
              {s.text ? <InlineAction label={copied ? 'Copiato!' : 'Copia'} onPress={() => copy(s.text)} style={styles.eyebrowAction} /> : null}
            </View>
          ))}
        </View>
      ) : null}
      {advice ? <Note tone="warn">{advice}</Note> : null}

      {saved ? (
        <View style={{ gap: space.sm }}>
          <Note tone={saveState.tone}>{saveState.message}</Note>
          <View style={styles.actionRow}>
            {message ? <Button label={copied ? 'Copiato!' : 'Copia messaggio'} variant="secondary" small onPress={() => copy(message.text)} /> : null}
            <Button label={calendarBusy ? 'Apro…' : 'Calendario'} variant="ghost" small onPress={onCalendar} disabled={calendarBusy} />
            <Button label="Controproposta ricevuta?" variant="ghost" small onPress={onCounter} />
          </View>
        </View>
      ) : (
        <View style={{ gap: space.sm }}>
          {sendNow
            ? <Button label={`L'ho inviata a ${formatEuro(chosen.price)}`} onPress={onSaveAndMarkSent || onSave} />
            : <Button label="Salva e ricordamelo" onPress={onSave} />}
          <View style={styles.actionRow}>
            {sendNow
              ? <Button label="Salva per dopo" variant="ghost" small onPress={onSave} />
              : <Button label="L'ho già inviata" variant="ghost" small onPress={onSaveAndMarkSent || onSave} />}
            {message && plan.length === 1 ? <Button label={copied ? 'Copiato!' : 'Copia messaggio'} variant="ghost" small onPress={() => copy(message.text)} /> : null}
          </View>
        </View>
      )}
    </Card>
  )
}

const styles = StyleSheet.create({
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  eyebrowText: { fontSize: 12, flexShrink: 1, minWidth: 0 },
  eyebrowAction: { paddingVertical: 0, minHeight: 0, flexShrink: 0 },
  inlineRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  proposals: { flexDirection: 'row', gap: space.sm },
  proposal: { flex: 1, minWidth: 0, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: 8, paddingVertical: 10, gap: 2, minHeight: 84, justifyContent: 'center' },
  proposalLabel: { fontSize: 11, fontWeight: '700' },
  star: { position: 'absolute', top: 6, right: 8, fontSize: 12, fontWeight: '800' },
  proposalPrice: { fontSize: 20, fontWeight: '800', lineHeight: 26, fontVariant: ['tabular-nums'] },
  proposalSub: { fontSize: 12, lineHeight: 16 },
  own: { borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 8 },
  h2: { fontSize: 17, fontWeight: '700', lineHeight: 22 },
  step: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stepIndex: { width: 18, fontSize: 13, fontWeight: '800', textAlign: 'center' },
  actionRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
})
