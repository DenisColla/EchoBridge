import { Calculator, ClipboardPaste, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { CATEGORIES, LISTING_AGES, LISTING_SIGNALS, SELLER_PROFILES, VINTED, parsePrice } from '../core/index.js'
import { SURFACE, TONE, cx } from '../theme.js'
import { Button } from './ui/Button.jsx'
import { Card } from './ui/Card.jsx'
import { ChipGroup } from './ui/ChipGroup.jsx'
import { Field, TextInput } from './ui/Field.jsx'
import { iconByName } from './icons.js'

const categoryOptions = CATEGORIES.map((c) => ({ id: c.id, label: c.label, hint: c.hint, icon: iconByName(c.icon) }))
const QUICK_DISCOUNTS = [10, 15, 20, 25, 30]

export function OfferForm({ form, errors, livePreview, onChange, onApplyDiscount, onSubmit, onReset, onListingText }) {
  const [pasted, setPasted] = useState('')
  const [pasteNote, setPasteNote] = useState(null)
  const handleSubmit = (event) => {
    event.preventDefault()
    onSubmit()
  }
  const hasList = parsePrice(form.listPrice) > 0

  return (
    <Card eyebrow="Dati dell'offerta" title="Che cosa vuoi comprare?">
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        <Field id="itemTitle" label="Titolo articolo" hint="(facoltativo)">
          <TextInput
            id="itemTitle"
            name="itemTitle"
            value={form.itemTitle}
            onChange={(e) => onChange('itemTitle', e.target.value)}
            placeholder="es. Nike Air Force 1 bianche, 42"
            autoComplete="off"
            maxLength={80}
          />
        </Field>

        <ChipGroup
          id="category"
          label="Categoria"
          options={categoryOptions}
          value={form.category}
          onChange={(v) => onChange('category', v)}
          error={errors.category}
        />

        <div className="grid grid-cols-2 gap-3">
          <Field id="listPrice" label="Prezzo di listino" hint="senza spedizione" adornment="€" error={errors.listPrice}>
            <TextInput
              id="listPrice"
              name="listPrice"
              inputMode="decimal"
              value={form.listPrice}
              onChange={(e) => onChange('listPrice', e.target.value)}
              placeholder="60"
              hasError={Boolean(errors.listPrice)}
              className="pr-8"
            />
          </Field>
          <Field id="targetPrice" label="Prezzo target" hint="che vorresti pagare" adornment="€" error={errors.targetPrice}>
            <TextInput
              id="targetPrice"
              name="targetPrice"
              inputMode="decimal"
              value={form.targetPrice}
              onChange={(e) => onChange('targetPrice', e.target.value)}
              placeholder="45"
              hasError={Boolean(errors.targetPrice)}
              className="pr-8"
            />
          </Field>
        </div>

        <div className="-mt-2 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5" aria-label="Sconto rapido">
            <span className={cx('mr-1 text-xs', SURFACE.muted)}>Sconto rapido</span>
            {QUICK_DISCOUNTS.map((pct) => (
              <button
                key={pct}
                type="button"
                id={`quick-discount-${pct}`}
                disabled={!hasList}
                onClick={() => onApplyDiscount(pct)}
                className={cx(
                  'rounded-full px-2.5 py-1 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 disabled:opacity-40',
                  livePreview && Math.round(livePreview.discountPct) === pct ? SURFACE.chipActive : SURFACE.chip,
                )}
              >
                −{pct}%
              </button>
            ))}
          </div>
          {livePreview && (
            <p className={cx('text-sm', SURFACE.muted)} aria-live="polite">
              {livePreview.discountPct > 0 ? (
                <>
                  Sconto richiesto <strong className="text-slate-900 dark:text-slate-100">{Math.round(livePreview.discountPct)}%</strong>
                  {' · '}rischio{' '}
                  <strong className={TONE[livePreview.riskBand.tone].text}>{livePreview.riskBand.label.toLowerCase()}</strong>
                  {livePreview.overCap && (
                    <span className={cx('block', TONE.bad.text)}>Vinted non accetta offerte oltre il {VINTED.MAX_DISCOUNT_PCT}% di sconto.</span>
                  )}
                </>
              ) : (
                'Il prezzo target è pari o superiore al listino: nessuno sconto richiesto.'
              )}
            </p>
          )}
        </div>

        <ChipGroup
          id="listingAge"
          label="Anzianità dell'annuncio"
          hint="(facoltativo)"
          options={LISTING_AGES}
          value={form.listingAge}
          onChange={(v) => onChange('listingAge', v)}
          columns="grid-cols-2 sm:grid-cols-3"
        />

        <ChipGroup
          id="sellerProfile"
          label="Valutazione del venditore"
          hint="(facoltativo)"
          options={SELLER_PROFILES}
          value={form.sellerProfile}
          onChange={(v) => onChange('sellerProfile', v)}
          columns="grid-cols-2"
        />

        <ChipGroup
          id="listingSignal"
          label="Nell'annuncio c'è scritto…"
          hint="(facoltativo)"
          options={LISTING_SIGNALS}
          value={form.listingSignal}
          onChange={(v) => onChange('listingSignal', v)}
          columns="grid-cols-2"
        />

        <Field id="listingText" label="Incolla il testo dell'annuncio" hint="(facoltativo: leggo da solo segnali e prezzo)">
          <textarea
            id="listingText"
            name="listingText"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={3}
            placeholder="Copia la descrizione da Vinted e incollala qui"
            className={cx('w-full rounded-xl px-3.5 py-3 text-sm outline-none transition-shadow', SURFACE.input)}
          />
        </Field>
        <div className="-mt-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
          <Button variant="secondary" icon={ClipboardPaste} onClick={() => { const r = onListingText(pasted); setPasteNote(r) }} disabled={!pasted.trim()} className="w-full sm:w-auto">
            Leggi segnali dal testo
          </Button>
          {pasteNote && (
            <p className={cx('text-xs', SURFACE.muted)}>
              {pasteNote.signal.reason}{pasteNote.price ? ` · prezzo trovato ${String(pasteNote.price).replace('.', ',')} €` : ''}. Nell'app Android basta incollare il link.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 pt-1 sm:flex-row">
          <Button type="submit" icon={Calculator} className="w-full sm:flex-1">
            Calcola momento ottimale
          </Button>
          <Button variant="secondary" icon={RotateCcw} onClick={onReset} className="w-full sm:w-auto" aria-label="Azzera il modulo">
            Azzera
          </Button>
        </div>
      </form>
    </Card>
  )
}
