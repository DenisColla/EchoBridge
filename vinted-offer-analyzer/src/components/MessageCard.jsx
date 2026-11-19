import { useState } from 'react'
import { Check, Copy, MessageSquare, Star } from 'lucide-react'
import { TONES } from '../core/index.js'
import { copyText } from '../platform/clipboard.js'
import { SURFACE, cx } from '../theme.js'
import { Button } from './ui/Button.jsx'
import { Card } from './ui/Card.jsx'

export function MessageCard({ result }) {
  const { messages, recommendedTone } = result
  // Tone selection resets whenever a new analysis arrives: the parent remounts this card via `key`.
  const [tone, setTone] = useState(recommendedTone)
  const [copied, setCopied] = useState(false)

  const current = messages.find((m) => m.tone === tone) || messages[0]

  const handleCopy = async () => {
    const ok = await copyText(current.text)
    setCopied(ok)
    if (ok) setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card eyebrow="Messaggio di supporto" title="Che cosa scrivere al venditore" icon={MessageSquare}>
      <div role="tablist" aria-label="Tono del messaggio" className="flex flex-wrap gap-2">
        {TONES.map((t) => {
          const active = t.id === tone
          const recommended = t.id === recommendedTone
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => { setTone(t.id); setCopied(false) }}
              className={cx(
                'inline-flex min-h-10 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950',
                active ? SURFACE.chipActive : SURFACE.chip,
              )}
            >
              {recommended && <Star className="h-3.5 w-3.5" aria-hidden="true" />}
              {t.label}
            </button>
          )
        })}
      </div>
      <p className={cx('mt-2 text-xs', SURFACE.muted)}>
        {TONES.find((t) => t.id === tone)?.hint}
        {tone === recommendedTone && ' · consigliato per questo livello di rischio'}
      </p>

      <blockquote className={cx('mt-4 select-all rounded-xl p-4 text-sm leading-relaxed', SURFACE.cardMuted)}>
        {current.text}
      </blockquote>
      <p className={cx('mt-2 text-xs', SURFACE.muted)}>
        {result.messageBeforeOffer
          ? 'Invia prima questo messaggio in chat; l\'offerta dal pulsante di Vinted parte solo dopo la risposta.'
          : 'L\'offerta si invia dal pulsante di Vinted; il messaggio la accompagna in chat.'}
      </p>

      <Button variant="secondary" icon={copied ? Check : Copy} onClick={handleCopy} className="mt-3 w-full sm:w-auto" aria-live="polite">
        {copied ? 'Copiato!' : 'Copia il messaggio'}
      </Button>
    </Card>
  )
}
