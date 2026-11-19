import { StyleSheet, Text, View } from 'react-native'
import { GOAL_CHOICES, formatEuro, formatPoints, goalChoicesFor, toPercent } from '../../../core/index.js'
import { radius, space, useTheme } from '../../theme.js'
import { Body, Button, Chip, Collapsible, Note, Row, SectionLabel } from '../ui.js'

const daysAgo = (date, now) => {
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000)
  return days <= 0 ? 'oggi' : days === 1 ? 'ieri' : `${days} giorni fa`
}

const marketOf = (result, marketInfo) => {
  const m = result.market || (marketInfo && marketInfo.market)
  return m && m.n >= 2 ? m : null
}

/** «prezzo tipico 48 € · 2 leve · obiettivo 70%». */
export function priceSummaryOf({ result, marketInfo, levers, goal }) {
  const m = marketOf(result, marketInfo)
  const k = levers.length
  return `${m ? `prezzo tipico ${formatEuro(m.medianPrice)}` : 'Nessun confronto di mercato'} · ${k} ${k === 1 ? 'leva' : 'leve'} · obiettivo ${Math.round(goal * 100)}%`
}

/** The optimiser's goals: relative to this analysis when the engine offers them, the legacy fixed list otherwise. */
const goalChipsFor = (result) => {
  const choices = typeof goalChoicesFor === 'function' ? goalChoicesFor(result) : []
  if (choices && choices.length) return choices.map((g) => ({ id: g.id, label: g.label, value: g.probability }))
  return GOAL_CHOICES.map((g) => ({ id: String(g), label: `${Math.round(g * 100)}%`, value: g }))
}

/**
 * Price, market and levers in one fold: the expected-price curve (the hero owns «Usa N €»), the market picture from
 * «Cerca altrove», the moves beyond the offer, and the optimiser («Voglio più probabilità») with the two-step plan.
 */
export function PriceSection({
  result, curve = null, marketInfo = null, levers = [], goal, onGoal, plan = null, onOptimize, onApply, optimizing = false,
  onLever = null, onOpenSearch = null, searchJob = null, onRecalc = null, open, onToggle,
}) {
  const t = useTheme()
  const m = marketOf(result, marketInfo)
  const gap = m && Number.isFinite(m.gapPct) ? m.gapPct : null
  const when = marketInfo && marketInfo.at ? new Date(marketInfo.at) : null
  const curveReady = Boolean(curve && !curve.empty && curve.best)
  const best = curveReady ? curve.best : null
  const at = curveReady ? curve.atTarget : null
  const shown = curveReady ? curve.points.filter((p, i) => i % Math.max(1, Math.floor(curve.points.length / 6)) === 0 || p === best || p === at) : []
  const currentPct = toPercent(result.probability)
  const goalPct = Math.round(goal * 100)
  const running = Boolean(searchJob && searchJob.running)

  return (
    <Collapsible title="Prezzo, mercato e leve" summary={priceSummaryOf({ result, marketInfo, levers, goal })} open={open} onToggle={onToggle}>
      <View style={styles.block}>
        <SectionLabel>Curva delle offerte</SectionLabel>
        {!curve ? <Body small muted>Calcolo la curva…</Body> : !curveReady ? <Body small muted>Nessuna curva per questi dati.</Body> : (
          <View style={{ gap: 4 }}>
            {shown.map((p) => (
              <View key={p.price} style={styles.row}>
                <Body small style={[styles.label, { fontWeight: p === best ? '700' : '400' }]}>{p === best ? '★ ' : ''}{formatEuro(p.price)} (−{Math.round(p.discountPct)}%) · {toPercent(p.probability)}%</Body>
                <Text style={[styles.value, { color: p === best ? t.good : t.ink }]}>{formatEuro(p.expected)}</Text>
              </View>
            ))}
            <Body small muted>Risparmio atteso sul prezzo pieno: ~{formatEuro(curve.savingVsList)}</Body>
          </View>
        )}
      </View>

      <View style={styles.block}>
        <SectionLabel>Mercato</SectionLabel>
        {m ? (
          <View style={{ gap: space.sm }}>
            <Body small>Prezzo tipico {formatEuro(m.medianPrice)} · metà tra {formatEuro(m.p25Price)} e {formatEuro(m.p75Price)} · {m.n} annunci{when ? `, ${daysAgo(when, new Date())}` : ''}</Body>
            <Body small muted>
              {gap !== null && gap > 10 ? 'Il venditore chiede più degli altri: lo sconto che proponi è giustificato e il calcolo ne tiene conto.' : gap !== null && gap < -10 ? 'È già tra i più economici: si vende in fretta, meglio non tirare troppo.' : 'Prezzo allineato: contano di più momento e tono.'}
              {m.best && m.best.expectedTotal && m.best.title ? ` L'alternativa più conveniente trovata: ${m.best.title} a circa ${formatEuro(m.best.expectedTotal)} tutto compreso.` : ''}
            </Body>
            {!result.market ? (
              <View style={{ gap: space.sm }}>
                <Note tone="warn">Mercato trovato dopo il calcolo.</Note>
                {onRecalc ? <Button label="Ricalcola con il mercato" small variant="secondary" onPress={onRecalc} /> : null}
              </View>
            ) : onOpenSearch ? (
              <Button label={running ? `Torna alla ricerca (${searchJob.done}/${searchJob.total})` : 'Rivedi la ricerca'} small variant="secondary" onPress={onOpenSearch} />
            ) : null}
          </View>
        ) : onOpenSearch ? (
          <Button label={running ? `Torna alla ricerca (${searchJob.done}/${searchJob.total})` : 'Cerca lo stesso articolo altrove'} small variant="secondary" onPress={onOpenSearch} />
        ) : (
          <Body small muted>Nessun confronto di mercato.</Body>
        )}
      </View>

      {levers.length > 0 && (
        <View style={styles.block}>
          <SectionLabel>Altre leve</SectionLabel>
          {levers.map((l) => (
            <View key={l.id} style={[styles.optionBox, { borderColor: t.line, backgroundColor: t.cardMuted }]}>
              <View style={styles.row}>
                <Body style={[styles.label, { fontWeight: '700' }]}>{l.title}</Body>
                {Number.isFinite(l.valueEur) && l.valueEur > 0 ? <Text style={[styles.value, { color: t.good }]}>≈ {formatEuro(l.valueEur)}</Text> : null}
              </View>
              <Body small>{l.body}</Body>
              {l.action && l.action.kind === 'reminder' && onLever ? <Button label={`Ricordamelo tra ${l.action.hours} ore`} small variant="secondary" onPress={() => onLever(l)} /> : null}
            </View>
          ))}
        </View>
      )}

      <View style={styles.block}>
        <SectionLabel>Voglio più probabilità</SectionLabel>
        <Row>
          {goalChipsFor(result).map((g) => (
            <Chip key={g.id} compact label={g.label} active={Math.abs(goal - g.value) < 0.001} onPress={() => onGoal(g.value)} />
          ))}
        </Row>
        <Button label={optimizing ? 'Calcolo…' : `Portami al ${goalPct}%`} variant="secondary" onPress={onOptimize} disabled={optimizing || currentPct >= goalPct} />
        {currentPct >= goalPct ? <Body muted small>Sei già oltre questo obiettivo: scegli una percentuale più alta.</Body> : null}
        {plan && !plan.ok ? <Note tone="warn">Non posso ottimizzare questa offerta: {plan.reason === 'no_offer_needed' ? 'non serve nessuna offerta.' : 'controlla i dati inseriti.'}</Note> : null}
        {plan && plan.ok && (
          <View style={{ gap: space.md }}>
            {plan.options.length === 0 && (
              <Note tone="warn">
                Il {Math.round(plan.target * 100)}% non è raggiungibile senza pagare quasi il prezzo pieno. Il massimo è {toPercent(plan.maxAchievable.probability)}%: {plan.maxAchievable.changes.join(' e ').toLowerCase()}.
              </Note>
            )}
            {plan.options.map((o, index) => (
              <View key={o.id} style={[styles.optionBox, { borderColor: index === 0 ? t.accent : t.line, backgroundColor: t.cardMuted }]}>
                <View style={styles.row}>
                  <Body style={[styles.label, { fontWeight: '700' }]}>{index === 0 ? '★ ' : ''}{o.label}</Body>
                  <Text style={[styles.value, { color: t.good }]}>{toPercent(o.probability)}% ({formatPoints(o.deltaPoints)})</Text>
                </View>
                {o.changes.map((c) => <Body key={c} small>• {c}</Body>)}
                <Button label="Applica" variant="secondary" small onPress={() => onApply(o)} />
              </View>
            ))}
            {plan.options.length > 0 && plan.maxAchievable.probability > plan.options[0].probability + 0.05 && (
              <Body muted small>Massimo raggiungibile: {toPercent(plan.maxAchievable.probability)}% ({plan.maxAchievable.changes.join(', ').toLowerCase()}).</Body>
            )}
          </View>
        )}
        {result.twoStep && (
          <Note>
            <Text style={{ fontWeight: '700' }}>Due step: </Text>apri a {formatEuro(result.twoStep.openingPrice)} ({Math.round(result.twoStep.openingProbability * 100)}% di accettazione diretta) e chiudi intorno a {formatEuro(result.twoStep.closingPrice)} sulla controproposta.
          </Note>
        )}
        {(result.tips || []).map((tip) => <Body key={tip} small>• {tip}</Body>)}
      </View>
    </Collapsible>
  )
}

const styles = StyleSheet.create({
  block: { gap: 6, paddingTop: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  label: { flex: 1, flexShrink: 1, minWidth: 0 },
  value: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'], flexShrink: 0 },
  optionBox: { borderWidth: 1, borderRadius: radius.lg, padding: space.md, gap: 6 },
})
