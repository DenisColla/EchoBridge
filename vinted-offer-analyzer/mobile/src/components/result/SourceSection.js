import { View } from 'react-native'
import { formatEuro } from '../../../core/index.js'
import { Body, Button, Collapsible } from '../ui.js'

/** Guesses that say nothing («nessun indizio», «non lo so») are not worth a line. */
const guessedOf = (summary) => summary.guessed.filter((g) => !/\(nessun indizio|non lo so/i.test(g))

/** The found lines that the signals line below repeats (they come from the same readings). */
const SIGNAL_FOUND = /^(Interesse:|Prezzo ribassato:|Sconto sui lotti|Il venditore propone sconti)/

const has = (v) => v !== null && v !== undefined

/**
 * «Visualizzazioni 123 · Interessati 4 · prezzo ribassato da 30 €»: the page's own signals (engine-spec §3.1), read
 * from the hydrated page by the in-app browser. Only what was read; null when the page showed none of them.
 */
export const signalsLineOf = (raw) => {
  const s = raw && raw.signals && typeof raw.signals === 'object' ? raw.signals : null
  if (!s) return null
  const parts = [
    has(s.views) ? `Visualizzazioni ${s.views}` : null,
    has(s.interested) ? `Interessati ${s.interested}` : null,
    s.priceDropped === true && has(s.oldPrice) ? `prezzo ribassato da ${formatEuro(s.oldPrice)}` : null,
    has(s.sellerItems) ? `${s.sellerItems} altri articoli del venditore` : null,
    has(s.bundleDiscountPct) ? `sconto sui lotti ${s.bundleDiscountPct}%` : s.bundleOffered === true ? 'sconti sui lotti' : null,
    s.reserved === true ? 'riservato' : null,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

/**
 * What the extractor read from the listing, what it guessed and what it could not find: the basis of the numbers.
 * `extraction.raw` (the parser's output, when the screen kept it) adds the page signals and the fields this page did
 * not show («non letti»: the DOM-only ones a quick download never carries).
 */
export function SourceSection({ extraction, onEdit }) {
  const { summary, raw = null } = extraction
  const guessed = guessedOf(summary)
  const signals = signalsLineOf(raw)
  const found = signals ? summary.found.filter((f) => !SIGNAL_FOUND.test(f)) : summary.found
  const unread = raw && Array.isArray(raw.unread) ? raw.unread.filter(Boolean) : []
  return (
    <Collapsible title="Letto dall'annuncio" summary={`${summary.found.length} dati letti · ${guessed.length} stimati`}>
      {found.map((f) => <Body key={f} small>✓ {f}</Body>)}
      {signals ? <Body small>✓ Dalla pagina: {signals}</Body> : null}
      {summary.condition || summary.brand ? <Body muted small>{[summary.brand && `Marca ${summary.brand}`, summary.condition && `condizioni: ${summary.condition}`].filter(Boolean).join(' · ')}</Body> : null}
      {guessed.length > 0 && (
        <View style={{ gap: 2 }}>
          <Body small style={{ fontWeight: '700' }}>Stimati, da controllare:</Body>
          {guessed.map((g) => <Body key={g} small>• {g}</Body>)}
        </View>
      )}
      {summary.missing.length > 0 ? <Body muted small>Non trovati: {summary.missing.join(', ')}. Puoi indicarli a mano nel modulo.</Body> : null}
      {unread.length > 0 ? <Body muted small>Non letti dalla pagina: {unread.join(', ')}{extraction.via === 'browser' ? '' : ' (li mostra solo la pagina aperta nel browser interno)'}.</Body> : null}
      {onEdit ? <Button label="Modifica i dati" variant="secondary" small onPress={onEdit} /> : null}
    </Collapsible>
  )
}
