import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { capitalize, formatEuro, toPercent } from '../../../core/index.js'
import { copyText } from '../../services/clipboard.js'
import { radius, space, toneColors, useTheme } from '../../theme.js'
import { Badge, Body, Button, Card, Chip, Field, InlineAction, Note } from '../ui.js'

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
      {Number.isFinite(option.total) ? <Text style={[styles.proposalSub, { color: t.ink3 }]} numberOfLines={1}>tot. {formatEuro(option.total)}</Text> : null}
    </Pressable>
  )
}

/**
 * The purchase as a whole (1.11): what the chosen proposal costs with Vinted's protection and the shipping, what is
 * left when the article is sold again, where a counter-offer would land. «Per rivendere» caps the proposals at the
 * price that does not lose; «Per me» only shows the costs.
 */
function CostBlock({ strategy, chosen, onGoal, onResale, onMargin }) {
  const t = useTheme()
  const { costs } = strategy
  const resell = strategy.goal === 'resell'
  const typed = costs.resale.source === 'user'
  const [text, setText] = useState(typed ? String(costs.resale.amount).replace('.', ',') : '')
  const resale = costs.resale.amount
  const shipWord = costs.shipping.source === 'estimate' ? 'spedizione (stima)' : 'spedizione'
  const gain = chosen.margin
  const tone = toneColors(t, gain >= 0 ? 'good' : 'bad')
  // 1.12: the market the figures rest on — for a book, the other listings with the same ISBN (or title).
  const mk = costs.market
  const alike = { isbn: 'dello stesso libro (ISBN)', title: 'con lo stesso titolo', model: 'dello stesso modello', ai: 'dello stesso articolo (riconosciuti dall\'AI)' }[mk && mk.basis] || 'simili'
  // The resale value is the market's lower quartile: asking prices of unsold listings, and the next buyer haggles too.
  const from = costs.resale.source === 'market' ? ' (il quartile basso del mercato: il prezzo a cui si vende)' : costs.resale.source === 'listing' ? ' (il prezzo dell\'annuncio)' : ''
  const gapWord = mk && Number.isFinite(mk.gapPct) && mk.gapPct !== 0 ? ` Questo annuncio è il ${Math.abs(mk.gapPct)}% ${mk.gapPct > 0 ? 'sopra' : 'sotto'}.` : ''
  const marketLine = mk ? `Mercato: ${mk.n} annunci ${alike}, mediana ${formatEuro(mk.medianPrice)}; la metà chiede tra ${formatEuro(mk.p25Price)} e ${formatEuro(mk.p75Price)}.${gapWord}` : null
  let counter = `Se controbatte arriverà verso ${formatEuro(chosen.landing)}, in tutto ${formatEuro(chosen.landingTotal)}`
  if (!resell) counter += '.'
  else if (chosen.landingMargin >= 0) counter += ': resti in guadagno, puoi chiudere.'
  else if (costs.reachable) counter += `: rilancia e chiudi solo fino a ${formatEuro(costs.ceiling)}.`
  else counter += '.'
  // The «set»: with other articles of the same seller the fixed costs are paid once. It is the way out when alone the
  // article cannot gain, and a saving worth a line in every other case.
  const set = costs.set
  const setOff = set && set.discountPct ? `, e lui toglie già il ${String(set.discountPct).replace('.', ',')}% sui set` : ''
  const setStrong = Boolean(resell && set && !costs.reachable && set.reachable)
  let setLine = null
  if (setStrong) setLine = `La via è il set: con ${set.items} articoli suoi (ne ha ${set.sellerItems}) spedizione e 0,70 € fissi si pagano una volta sola e il tetto sale a ${formatEuro(set.ceilingEach)} l'uno${setOff}. Stima a parità di spedizione e di valore.`
  else if (set && resell && costs.reachable) setLine = `In set con un altro suo articolo il tetto sale a ${formatEuro(set.ceilingEach)} l'uno: i costi fissi si dividono (${formatEuro(set.savingEach)} in meno a pezzo)${setOff}.`
  else if (set && !resell) setLine = `In set con un altro suo articolo risparmi circa ${formatEuro(set.savingEach)} a pezzo: spedizione e 0,70 € fissi si pagano una volta sola${setOff}.`
  return (
    <View style={[styles.costs, { borderColor: t.line }]}>
      <View style={styles.inlineRow}>
        <Chip compact label="Per rivendere" active={resell} onPress={() => onGoal && onGoal('resell')} />
        <Chip compact label="Per me" active={!resell} onPress={() => onGoal && onGoal('keep')} />
      </View>
      <Body small>
        Con {formatEuro(chosen.price)} paghi in tutto <Text style={{ fontWeight: '700' }}>{formatEuro(chosen.total)}</Text>: {formatEuro(chosen.fee)} di commissione Vinted e {formatEuro(costs.shipping.amount)} di {shipWord}.
      </Body>
      {marketLine ? <Body small muted>{marketLine}</Body> : null}
      {resell ? (
        <Body small style={{ color: tone.fg, fontWeight: '600' }}>
          {gain >= 0 ? `Rivendendolo a ${formatEuro(resale)}${from} ti restano ${formatEuro(gain)}.` : `Rivendendolo a ${formatEuro(resale)}${from} ci perdi ${formatEuro(-gain)}.`}
        </Body>
      ) : (
        <Body small muted>Se un giorno lo rivendi, per non perderci dovrai chiedere almeno {formatEuro(chosen.total)}.</Body>
      )}
      {resell && costs.reachable ? <Body small muted>{costs.marginPct ? `Tetto per tenerti almeno il ${costs.marginPct}%` : 'Tetto per non perderci'}: {formatEuro(costs.ceiling)}. Nessuna delle tre proposte lo supera.</Body> : null}
      {resell && !costs.reachable ? (
        <Body small muted>
          Per non perderci dovresti pagarlo al massimo {formatEuro(costs.ceiling)}, ma Vinted non lascia offrire meno di {formatEuro(costs.floor)}, e anche lì paghi in tutto {formatEuro(costs.floorTotal)}. Da solo conviene se lo rivendi sopra {formatEuro(costs.floorTotal)} (scrivilo sotto) o se lo tieni.
        </Body>
      ) : null}
      {setLine ? <Body small style={setStrong ? { fontWeight: '600' } : null} muted={!setStrong}>{setLine}</Body> : null}
      <Body small muted>{counter}</Body>
      {resell ? (
        <View style={styles.resale}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Field
              label="Lo rivendo a"
              value={text}
              onChangeText={setText}
              placeholder={String(resale).replace('.', ',')}
              keyboardType="decimal-pad"
              suffix="€"
              returnKeyType="done"
              onSubmitEditing={() => onResale && onResale(text)}
            />
          </View>
          <Button label="Ricalcola" variant="secondary" small onPress={() => onResale && onResale(text)} />
        </View>
      ) : null}
      {resell ? (
        <View style={styles.inlineRow}>
          <Text style={{ color: t.ink3, fontSize: 12, alignSelf: 'center' }}>Margine minimo</Text>
          {[0, 10, 20, 30].map((m) => <Chip key={m} compact label={`${m}%`} active={(costs.marginPct || 0) === m} onPress={() => onMargin && onMargin(m)} />)}
        </View>
      ) : null}
    </View>
  )
}

/**
 * The 1.8 hero: who the seller is, three proposals, when to send, the moves in order, one primary button.
 * `strategy` comes from strategyFor (core); `result` is the analysis of the chosen proposal.
 */
export function StrategyHero({ strategy, result, saveState = null, calendarBusy = false, onPick, onEdit, onSave, onSaveAndMarkSent, onCalendar, onCounter, onCopyMessage, onGoal = null, onResale = null, onMargin = null }) {
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
      {strategy.costs && strategy.goal === 'resell' && !strategy.costs.noMargin ? (
        <Body small muted>
          ★ = guadagna di più in media, contando che se rifiuta non compri. {history}
        </Body>
      ) : (
        <Body small muted>
          ★ = paga meno in media. Con {formatEuro(chosen.price)} paghi in media {formatEuro(chosen.expectedPrice)} tra sì, controproposte e no. {history}{strategy.costs ? '' : counter}
        </Body>
      )}
      {strategy.costs && Number.isFinite(chosen.total) ? <CostBlock key={`${input.listPrice}|${input.itemTitle}|${strategy.costs.resale.source}|${strategy.costs.resale.amount}`} strategy={strategy} chosen={chosen} onGoal={onGoal} onResale={onResale} onMargin={onMargin} /> : null}

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
  proposal: { flex: 1, minWidth: 0, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: 8, paddingVertical: 10, gap: 2, minHeight: 98, justifyContent: 'center' },
  costs: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.sm, gap: 6 },
  resale: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  proposalLabel: { fontSize: 11, fontWeight: '700' },
  star: { position: 'absolute', top: 4, right: 6, fontSize: 10, fontWeight: '800' },
  proposalPrice: { fontSize: 20, fontWeight: '800', lineHeight: 26, fontVariant: ['tabular-nums'] },
  proposalSub: { fontSize: 12, lineHeight: 16 },
  own: { borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 8 },
  h2: { fontSize: 17, fontWeight: '700', lineHeight: 22 },
  step: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stepIndex: { width: 18, fontSize: 13, fontWeight: '800', textAlign: 'center' },
  actionRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
})
