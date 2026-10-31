import { StyleSheet, Text, View } from 'react-native'
import { articleFor, formatSignedPoints, prepArticleFor, toPercent } from '../../../core/index.js'
import { radius, space, toneForLevel, useTheme } from '../../theme.js'
import { Badge, Body, Collapsible, Note, Row, SectionLabel } from '../ui.js'

/** «sconto 25% → 54% · domenica sera +6 · annuncio vecchio +4»: the base and the two strongest factors. */
export function factorSummaryOf(result) {
  const { factors, input } = result
  const rows = factors.rows.filter((r) => r.deltaPoints !== 0)
  const strongest = [...rows].sort((a, b) => Math.abs(b.deltaPoints) - Math.abs(a.deltaPoints)).slice(0, 2)
  return [`sconto ${Math.round(input.discountPct)}% → ${factors.basePct}%`, ...strongest.map((f) => `${f.label.toLowerCase()} ${formatSignedPoints(f.deltaPoints)}`)].join(' · ')
}

/**
 * Why this probability: the reasoning sentences, the factor table, the hard-refusal risk, the failure risk even at
 * the right moment (failureRiskFor) and what to do when the seller answers. `policy` adds why this ask was proposed.
 */
export function WhySection({ result, risk = null, policy = null }) {
  const t = useTheme()
  const { probability, components, blockRisk, factors, input, opening, reasons, timingNote } = result
  const rows = factors.rows.filter((r) => r.deltaPoints !== 0)
  const showEquation = components.pAvailable < 0.995 || components.pRead < 0.995 || toPercent(probability) !== factors.totalPct
  const pct = (x) => Math.round(x * 100)
  const policyReasons = policy && Array.isArray(policy.reason) ? policy.reason.filter(Boolean) : []
  const similar = risk && risk.similar ? risk.similar : null

  return (
    <Collapsible title="Perché questo numero" summary={factorSummaryOf(result)}>
      <Body style={{ fontWeight: '600' }}>{opening}</Body>
      {reasons.map((r) => <Body key={r}>• {r}</Body>)}
      {timingNote ? <Body muted small>{timingNote}</Body> : null}

      {policyReasons.length > 0 && (
        <View style={styles.block}>
          <SectionLabel>La cifra proposta</SectionLabel>
          {policyReasons.map((r) => <Body key={r} small>• {r}</Body>)}
        </View>
      )}

      <View style={styles.block}>
        <SectionLabel>Che cosa pesa</SectionLabel>
        <View style={styles.factorRow}>
          <Body style={styles.factorLabel}>Sconto {articleFor(input.discountPct)}{Math.round(input.discountPct)}%: punto di partenza</Body>
          <Text style={[styles.factorValue, { color: t.ink }]}>{factors.basePct}%</Text>
        </View>
        {rows.map((f) => (
          <View key={f.id} style={{ gap: 3 }}>
            <View style={styles.factorRow}>
              <Body style={styles.factorLabel} numberOfLines={1}>{f.label}</Body>
              <Text style={[styles.factorValue, { color: f.deltaPoints > 0 ? t.good : t.bad }]}>{formatSignedPoints(f.deltaPoints)} punti</Text>
            </View>
            <View style={[styles.miniTrack, { backgroundColor: t.cardMuted }]}>
              <View style={[styles.miniFill, { backgroundColor: f.deltaPoints > 0 ? t.good : t.bad, width: `${Math.min(100, Math.abs(f.deltaPoints) * 5)}%` }]} />
            </View>
          </View>
        ))}
        <View style={[styles.factorRow, { borderTopWidth: 1, borderTopColor: t.line, paddingTop: 6 }]}>
          <Body style={[styles.factorLabel, { fontWeight: '600' }]}>Accettazione nel momento consigliato</Body>
          <Text style={[styles.factorValue, { color: t.ink }]}>{factors.totalPct}%</Text>
        </View>
      </View>

      {showEquation && (
        <Body muted small>
          Accettazione {toPercent(components.pAccept)}%
          {components.pAvailable < 0.995 ? ` × ancora in vendita ${toPercent(components.pAvailable)}%` : ''}
          {components.pRead < 0.995 ? ` × il venditore la legge ${toPercent(components.pRead)}%` : ''}
          {` = ${toPercent(probability)}% complessivo`}
        </Body>
      )}

      <View style={styles.block}>
        <Body small style={{ fontWeight: '700' }}>Rischio di un no secco: {blockRisk.label.toLowerCase()}</Body>
        {blockRisk.reasons.length > 0 ? <Row>{blockRisk.reasons.map((r) => <Badge key={r} tone={toneForLevel(blockRisk.level)}>{r}</Badge>)}</Row> : null}
      </View>

      {risk && (
        <View style={styles.block}>
          <SectionLabel>Anche nel momento giusto</SectionLabel>
          <Row>
            <Badge tone={toneForLevel(risk.level)}>{pct(risk.pFail)}% di rischio · tra {pct(risk.range[0])} e {pct(risk.range[1])}%</Badge>
            <Badge tone="neutral">{risk.basis === 'history' ? 'Calibrato sui tuoi esiti' : 'Stima del motore'}</Badge>
          </Row>
          {risk.reasons.length > 0 && (
            <View style={{ gap: 2 }}>
              <Body small style={{ fontWeight: '700' }}>Perché può fallire</Body>
              {risk.reasons.map((r) => <Body key={r.id} small>• {r.text}</Body>)}
            </View>
          )}
          {risk.failureMix && risk.failureMix.length > 0 && (
            <View style={{ gap: 2 }}>
              <Body small style={{ fontWeight: '700' }}>Se non passa, di solito è</Body>
              {risk.failureMix.filter((m) => m.share >= 0.05).map((m) => (
                <Body key={m.id} small>• {m.label}: {pct(m.share)}% dei casi{m.closeAfter >= 0.05 ? `, poi l'affare si chiude comunque ${prepArticleFor('in', m.closeAfter * 100)}${pct(m.closeAfter)}%` : ''}</Body>
              ))}
            </View>
          )}
          <Note tone={risk.pClose >= 0.6 ? 'good' : 'neutral'}>
            Probabilità di chiudere l'affare, anche dopo controproposte: {pct(risk.pClose)}% (tra {pct(risk.pCloseRange[0])} e {pct(risk.pCloseRange[1])}%).
          </Note>
          {similar ? (
            <Body muted small>
              Nel tuo storico{similar.bandLabel ? `, ${similar.bandLabel.toLowerCase()}` : ''}, con uno sconto simile: {similar.successes} {similar.successes === 1 ? 'accettata' : 'accettate'} su {similar.n} offerte.
            </Body>
          ) : null}
        </View>
      )}

      {risk && risk.plan && risk.plan.length > 0 && (
        <View style={styles.block}>
          <SectionLabel>Se risponde</SectionLabel>
          {risk.plan.map((p) => <Note key={p}>{p}</Note>)}
        </View>
      )}
    </Collapsible>
  )
}

const styles = StyleSheet.create({
  block: { gap: 6, paddingTop: space.xs },
  factorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  factorLabel: { flex: 1, flexShrink: 1, minWidth: 0 },
  factorValue: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'], flexShrink: 0 },
  miniTrack: { height: 6, borderRadius: radius.pill, overflow: 'hidden' },
  miniFill: { height: '100%', borderRadius: radius.pill },
})
