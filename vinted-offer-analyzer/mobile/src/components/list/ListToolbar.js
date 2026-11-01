import { StyleSheet, Text, View } from 'react-native'
import { toPercent } from '../../../core/index.js'
import { SEGMENTS } from '../../services/segments.js'
import { space, useTheme } from '../../theme.js'
import { InlineAction, SearchField, SegmentedControl } from '../ui.js'

/**
 * Top of the Lista: search, the four segments with counts and the one-line truth about the engine's estimates.
 * `elsewhere` = { count, segmentLabel } when the active segment has no match but others do.
 */
export function ListToolbar({ query, onQuery, segment, onSegment, counts, stats, onGoInfo, elsewhere }) {
  const t = useTheme()
  const options = SEGMENTS.map((s) => ({ id: s.id, label: s.label, count: counts ? counts[s.id] : null }))
  const honest = stats && stats.acceptanceRate != null && stats.decided > 0
  return (
    <View style={styles.wrap}>
      <SearchField value={query} onChangeText={onQuery} placeholder="Cerca titolo o prezzo" onClear={() => onQuery('')} />
      {elsewhere && elsewhere.count > 0 ? (
        <InlineAction label={`Nessun risultato in ${elsewhere.segmentLabel} · ${elsewhere.count} in Tutte`} onPress={() => onSegment('all')} />
      ) : null}
      <SegmentedControl options={options} value={segment} onChange={onSegment} />
      {honest ? (
        <View style={styles.honesty}>
          <Text style={[styles.honestyText, { color: t.ink3 }]} numberOfLines={2}>
            {stats.accepted} accettate su {stats.decided} ({toPercent(stats.acceptanceRate)}%) · stima media {toPercent(stats.predictedAverage || 0)}%
          </Text>
          {onGoInfo ? <InlineAction label="Perché →" onPress={onGoInfo} /> : null}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  honesty: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: 2 },
  honestyText: { fontSize: 13, lineHeight: 18, flexShrink: 1, minWidth: 0 },
})
