import { Text } from 'react-native'
import { isVintedItemLink } from '../services/vinted.js'
import { useTheme } from '../theme.js'
import { Button, Card, Field, InlineAction, Note, Title } from './ui.js'

/** The primary button carries the extraction phase: no separate notes while the in-app browser passes Vinted's check. */
const extractLabel = (extracting, phase) => {
  if (!extracting) return 'Leggi e calcola'
  if (phase === 'verify') return 'Completa la verifica qui sopra'
  if (phase === 'browser') return 'Supero il controllo di Vinted…'
  return 'Leggo l\'annuncio…'
}

/**
 * The only card on a fresh Calcola screen: paste a Vinted link and read the listing. With a Vinted link found in the
 * clipboard the same card shows it prefilled (no second banner); editing the field or «Ignora» dismisses it.
 */
export function LinkEntry({ link, onChangeLink, onExtract, onPasteLink, extracting = false, extractPhase = null, extraction = null, clipboardLink = null, onIgnoreClipboard, onManual }) {
  const t = useTheme()
  const fromClipboard = Boolean(clipboardLink) && !extracting
  const value = fromClipboard ? clipboardLink : link || ''
  const linkOk = isVintedItemLink(value)
  const failed = Boolean(extraction && !extraction.ok)
  return (
    <Card style={{ borderColor: t.accent }}>
      {fromClipboard ? <Text style={{ color: t.accentInk, fontSize: 12, fontWeight: '700' }}>Link Vinted trovato negli appunti</Text> : null}
      <Title>Incolla il link dell'annuncio Vinted</Title>
      <Field
        value={value}
        onChangeText={onChangeLink}
        placeholder="https://www.vinted.it/items/…"
        keyboardType="url"
        autoCapitalize="none"
        error={value && !linkOk ? 'Serve un link a un articolo: vinted.it/items/…' : undefined}
        trailing={<InlineAction label="Incolla" onPress={onPasteLink} disabled={extracting} />}
      />
      <Button label={extractLabel(extracting, extractPhase)} onPress={() => onExtract(value)} disabled={extracting || !linkOk} />
      {fromClipboard
        ? <Button label="Ignora" variant="ghost" small onPress={onIgnoreClipboard} />
        : <Button label="Oppure inserisci i dati a mano" variant="ghost" small onPress={onManual} />}
      {failed ? <Note tone="warn">{extraction.message}</Note> : null}
      {failed && fromClipboard ? <Button label="Inserisci i dati a mano" variant="ghost" small onPress={onManual} /> : null}
    </Card>
  )
}
