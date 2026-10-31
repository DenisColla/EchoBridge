import { useState } from 'react'
import { TONES, toneMeta } from '../../../core/index.js'
import { copyText } from '../../services/clipboard.js'
import { Body, Button, Chip, Collapsible, Note, Row } from '../ui.js'

const summaryOf = (text) => (text.length > 70 ? `${text.slice(0, 70).trimEnd()}…` : text)
/** Label and hint of a tone, including the market and extra tones the engine may add. */
const metaOf = (id) => (typeof toneMeta === 'function' ? toneMeta(id) : null) || TONES.find((x) => x.id === id) || { id, label: id, hint: '' }

/**
 * The message that goes with the offer: one chip per message the engine built (the four base tones plus, when they
 * apply, informato / lotto / spedizione / domanda), ★ on the recommended one, the text, a copy button.
 */
export function MessageSection({ result }) {
  const { messages, recommendedTone, messageBeforeOffer } = result
  const [tone, setTone] = useState(recommendedTone)
  const [copied, setCopied] = useState(false)
  const current = messages.find((m) => m.tone === tone) || messages[0]
  const recommended = messages.find((m) => m.tone === recommendedTone) || messages[0]
  const meta = metaOf(tone)
  const policy = result.messagePolicy && typeof result.messagePolicy === 'object' ? result.messagePolicy : null
  if (!current) return null

  const handleCopy = async () => {
    const ok = await copyText(current.text)
    setCopied(ok)
    if (ok) setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Collapsible title="Messaggio per il venditore" summary={summaryOf(recommended ? recommended.text : '')}>
      <Row>
        {messages.map((m) => (
          <Chip key={m.tone} compact label={`${m.tone === recommendedTone ? '★ ' : ''}${metaOf(m.tone).label}`} active={m.tone === tone} onPress={() => { setTone(m.tone); setCopied(false) }} />
        ))}
      </Row>
      <Body muted small>{meta.hint}{tone === recommendedTone ? ' · consigliato per questo annuncio' : ''}</Body>
      <Note>{current.text}</Note>
      {messageBeforeOffer ? <Body muted small>Invia prima questo messaggio in chat; l'offerta parte dopo la risposta{policy && policy.randomised ? ' (prova del motore)' : ''}.</Body> : null}
      <Button label={copied ? 'Copiato!' : 'Copia il messaggio'} variant="secondary" onPress={handleCopy} />
    </Collapsible>
  )
}
