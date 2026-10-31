import { StyleSheet, Text, View } from 'react-native'
import { MONTHS_IT, WEEKDAYS_SHORT_IT, capitalize, formatLongDate, formatPoints, formatRelativeDay, formatTime, isSameDay, toPercent } from '../../../core/index.js'
import { space, useTheme } from '../../theme.js'
import { Badge, Body, Button, Collapsible, InlineAction, Note, Row, SectionLabel } from '../ui.js'

/** «Dom 2 nov»: short enough to share a row with the percentage and a button. */
const shortDay = (date) => `${capitalize(WEEKDAYS_SHORT_IT[date.getDay()])} ${date.getDate()} ${MONTHS_IT[date.getMonth()].slice(0, 3)}`
/** «stasera» / «oggi» / «domani» / «lun 21:30» for the one-line summary. */
const whenShort = (date, now) => {
  if (isSameDay(date, now)) return date.getHours() >= 17 ? 'stasera' : 'oggi'
  const rel = formatRelativeDay(date, now)
  return rel === 'domani' ? 'domani' : `${WEEKDAYS_SHORT_IT[date.getDay()]} ${formatTime(date)}`
}

/** «Pari merito lun 21:30 (51%) · fretta? stasera 44%», parts omitted when missing. */
export function momentsSummaryOf(result) {
  const { alsoGood, quick, alternatives, optimal, now, exploration } = result
  const parts = []
  if (alsoGood && !exploration) {
    const sameDay = isSameDay(alsoGood.date, optimal.date)
    parts.push(sameDay ? `Ancora meglio alle ${formatTime(alsoGood.date)} (${toPercent(alsoGood.pOverall)}%)` : `Pari merito ${WEEKDAYS_SHORT_IT[alsoGood.date.getDay()]} ${formatTime(alsoGood.date)} (${toPercent(alsoGood.pOverall)}%)`)
  }
  if (quick) parts.push(`fretta? ${whenShort(quick.date, now)} ${toPercent(quick.pOverall)}%`)
  if (parts.length) return parts.join(' · ')
  if (alternatives && alternatives.length) return `${alternatives.length} altre finestre valide`
  return 'Nessun\'altra finestra utile'
}

/**
 * The other moments: the tie or the better slot, the quicker one, the other valid windows (each pickable: the analysis
 * re-runs pinned to that moment) and today's windows to avoid.
 */
export function MomentsSection({ result, onPickMoment = null }) {
  const t = useTheme()
  const { alsoGood, quick, alternatives, optimal, now, avoidToday, exploration } = result
  const sameDay = alsoGood && isSameDay(alsoGood.date, optimal.date)
  const quickDelta = quick ? toPercent(quick.pOverall) - toPercent(optimal.pOverall) : 0
  const pick = (date) => (onPickMoment ? <InlineAction label="Scegli" onPress={() => onPickMoment(date)} /> : null)

  return (
    <Collapsible title="Altri momenti" summary={momentsSummaryOf(result)}>
      {alsoGood && !exploration && (
        <View style={{ gap: space.xs }}>
          <Note>
            <Text style={{ fontWeight: '700' }}>{sameDay ? 'Ancora meglio: ' : 'Pari merito: '}</Text>
            {sameDay ? `alle ${formatTime(alsoGood.date)}` : `${formatLongDate(alsoGood.date, now)} alle ${formatTime(alsoGood.date)} (${formatRelativeDay(alsoGood.date, now)})`}
            {' '}vale {toPercent(alsoGood.pOverall)}%{sameDay ? ', se puoi aspettare.' : '.'}
          </Note>
          {pick(alsoGood.date)}
        </View>
      )}
      {quick && (
        <View style={{ gap: space.xs }}>
          <Note tone="warn">
            <Text style={{ fontWeight: '700' }}>Hai fretta? </Text>
            {capitalize(formatLongDate(quick.date, now))} alle {formatTime(quick.date)} ({formatRelativeDay(quick.date, now)}): {toPercent(quick.pOverall)}%
            {' '}({quickDelta === 0 ? 'stesse probabilità' : formatPoints(quickDelta)} rispetto al consigliato, meno rischio che venga venduto prima).
          </Note>
          {pick(quick.date)}
        </View>
      )}
      {alternatives.length > 0 && (
        <View style={{ gap: 6 }}>
          <SectionLabel>Altre finestre valide</SectionLabel>
          {alternatives.map((s) => (
            <View key={s.date.getTime()} style={styles.row}>
              <Body small style={styles.label} numberOfLines={1}>{shortDay(s.date)} · {formatTime(s.date)}</Body>
              <Text style={[styles.value, { color: t.ink }]}>{toPercent(s.pOverall)}%</Text>
              {onPickMoment ? <Button label="Scegli" variant="secondary" small onPress={() => onPickMoment(s.date)} /> : null}
            </View>
          ))}
        </View>
      )}
      {avoidToday.length > 0 && (
        <View style={{ gap: 6 }}>
          <SectionLabel>Fasce da evitare {optimal.daysWaited === 0 ? 'oggi' : formatLongDate(optimal.date, now).split(' ')[0]}</SectionLabel>
          <Row>{avoidToday.map((w) => <Badge key={w.id} tone="bad">{w.label} · {w.rangeLabel}</Badge>)}</Row>
        </View>
      )}
      {!alsoGood && !quick && alternatives.length === 0 && avoidToday.length === 0 ? <Body muted small>Nessun'altra finestra utile nei prossimi giorni.</Body> : null}
    </Collapsible>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  label: { flex: 1, flexShrink: 1, minWidth: 0 },
  value: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'], flexShrink: 0 },
})
