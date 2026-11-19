import { StyleSheet, Text, View } from 'react-native'
import { statusMeta } from '../../services/storage.js'
import { space, useTheme } from '../../theme.js'
import { Body, Chip, Row, SectionLabel } from '../ui.js'

const REPLY = ['accepted', 'countered', 'declined', 'no_reply']
const CLOSE = ['bought', 'sold_other', 'abandoned']

/**
 * The grouped outcome picker, rendered inside the row (no modal). `onPick(statusId)` is the only exit besides the
 * row's own «Chiudi»: the row routes «Controproposta» to the counter flow and everything else to setStatus.
 */
export function OutcomePanel({ item, onPick }) {
  const t = useTheme()
  // «Inviata» is pointless on a sent row; on a planned row it is the most likely tap, so it comes first.
  const fix = item.status === 'sent' ? ['planned'] : item.status === 'planned' ? ['sent', 'planned'] : ['planned', 'sent']
  const group = (ids) => (
    <Row>
      {ids.map((id) => {
        const meta = statusMeta(id)
        return <Chip key={id} compact label={meta.label} active={item.status === id} onPress={() => onPick(id)} />
      })}
    </Row>
  )
  return (
    <View style={[styles.panel, { borderColor: t.line }]}>
      <Text style={[styles.heading, { color: t.ink }]}>Com'è andata?</Text>
      <SectionLabel>Risposta del venditore</SectionLabel>
      {group(REPLY)}
      <SectionLabel>Chiusura</SectionLabel>
      {group(CLOSE)}
      <SectionLabel>Correggi</SectionLabel>
      {group(fix)}
      <Body muted small>Gli esiti ritarano il motore ogni mese.</Body>
    </View>
  )
}

const styles = StyleSheet.create({
  panel: { borderTopWidth: 1, paddingTop: space.md, gap: space.sm },
  heading: { fontSize: 15, fontWeight: '700' },
})
