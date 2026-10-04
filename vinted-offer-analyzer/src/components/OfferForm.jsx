import { Calculator, RotateCcw } from 'lucide-react'
import { CATEGORIES, LISTING_AGES, LISTING_SIGNALS, SELLER_PROFILES, VINTED } from '../core/index.js'
import { SURFACE, TONE, cx } from '../theme.js'
import { Button } from './ui/Button.jsx'
import { Card } from './ui/Card.jsx'
import { ChipGroup } from './ui/ChipGroup.jsx'
import { Field, TextInput } from './ui/Field.jsx'
import { iconByName } from './icons.js'

const categoryOptions = CATEGORIES.map((c) => ({ id: c.id, label: c.label, hint: c.hint, icon: iconByName(c.icon) }))
const QUICK_DISCOUNTS = [10, 15, 20, 25, 30]

export function OfferForm({ form, errors, livePreview, onChange, onApplyDiscount, onSubmit, onReset }) {
  const handleSubmit = (event) => {
    event.preventDefault()
    onSubmit()
  }
  const hasList = Number(String(form.listPrice).replace(',', '.')) > 0

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
