import { View } from 'react-native'
import { Body, Button, Collapsible } from '../ui.js'

/** Guesses that say nothing («nessun indizio», «non lo so») are not worth a line. */
const guessedOf = (summary) => summary.guessed.filter((g) => !/\(nessun indizio|non lo so/i.test(g))

/** What the extractor read from the listing, what it guessed and what it could not find: the basis of the numbers. */
export function SourceSection({ extraction, onEdit }) {
  const { summary } = extraction
  const guessed = guessedOf(summary)
  return (
    <Collapsible title="Letto dall'annuncio" summary={`${summary.found.length} dati letti · ${guessed.length} stimati`}>
      {summary.found.map((f) => <Body key={f} small>✓ {f}</Body>)}
      {summary.condition || summary.brand ? <Body muted small>{[summary.brand && `Marca ${summary.brand}`, summary.condition && `condizioni: ${summary.condition}`].filter(Boolean).join(' · ')}</Body> : null}
      {guessed.length > 0 && (
        <View style={{ gap: 2 }}>
          <Body small style={{ fontWeight: '700' }}>Stimati, da controllare:</Body>
          {guessed.map((g) => <Body key={g} small>• {g}</Body>)}
        </View>
      )}
      {summary.missing.length > 0 ? <Body muted small>Non trovati: {summary.missing.join(', ')}. Puoi indicarli a mano nel modulo.</Body> : null}
      {onEdit ? <Button label="Modifica i dati" variant="secondary" small onPress={onEdit} /> : null}
    </Collapsible>
  )
}
