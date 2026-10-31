import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { CATEGORIES, LISTING_AGES, LISTING_SIGNALS, SELLER_PROFILES, VINTED, computeDiscountPct, formatEuro, parsePrice, riskBandFor } from '../../core/index.js'
import { space, useTheme } from '../theme.js'
import { Button, Chip, ChipGroup, Collapsible, Field, Row } from './ui.js'

/** Static quick chips; the integrator swaps in quickDiscountsFor(form.policy) through the `quickDiscounts` prop. */
export const QUICK_DISCOUNTS = [10, 15, 20, 25, 30]

const labelOf = (options, id) => {
  const option = options.find((x) => x.id === id)
  return option ? option.label : ''
}
/** «1–2 settimane fa» → «1–2 settimane»: the label already reads «in vendita da». */
const ageLabel = (id) => labelOf(LISTING_AGES, id || 'unknown').replace(/ fa$/, '')
const sellerLabel = (id) => (id && id !== 'unknown' ? `venditore ${labelOf(SELLER_PROFILES, id).toLowerCase()}` : 'Non lo so')

/** Summary of the nested «Venditore e annuncio» fold: the three chip values as the user reads them. */
export const sellerSummaryOf = (form) => [ageLabel(form.listingAge), sellerLabel(form.sellerProfile), labelOf(LISTING_SIGNALS, form.listingSignal || 'none')].join(' · ')

/** Summary of the «Dati dell'offerta» fold: an invitation before a result, the data in one line after it (unknowns omitted). */
export function dataSummaryOf(form, hasResult) {
  if (!hasResult) return 'Compila a mano se il link non si legge'
  const list = parsePrice(form.listPrice)
  const target = parsePrice(form.targetPrice)
  return [
    list > 0 && target > 0 ? `${formatEuro(list)} → ${formatEuro(target)}` : null,
    form.category ? labelOf(CATEGORIES, form.category) : null,
    form.listingAge && form.listingAge !== 'unknown' ? ageLabel(form.listingAge) : null,
    form.sellerProfile && form.sellerProfile !== 'unknown' ? sellerLabel(form.sellerProfile) : null,
  ].filter(Boolean).join(' · ') || 'Controlla o correggi i dati'
}

/**
 * The manual form, rendered by the Calcola screen inside its «Dati dell'offerta» fold. Prices first, then the quick
 * discount chips, the category, the title and, in a nested fold, the three optional groups. The footer button is the
 * screen's primary only before a result (the hero owns the primary afterwards).
 */
export function DataForm({ form, errors = {}, onChange, onSubmit, onReset, hasResult = false, quickDiscounts = QUICK_DISCOUNTS }) {
  const t = useTheme()
  const preview = useMemo(() => {
    const list = parsePrice(form.listPrice)
    const target = parsePrice(form.targetPrice)
    if (!(list > 0) || !(target > 0)) return null
    const d = computeDiscountPct(list, target)
    return { d, band: d > 0 ? riskBandFor(d) : null, overCap: d > VINTED.MAX_DISCOUNT_PCT }
  }, [form.listPrice, form.targetPrice])

  const applyDiscount = (pct) => {
    const list = parsePrice(form.listPrice)
    if (!(list > 0)) return
    const raw = list * (1 - pct / 100)
    const target = list >= 20 ? Math.round(raw) : Math.round(raw * 2) / 2
    onChange('targetPrice', String(target).replace('.', ','))
  }

  return (
    <View style={{ gap: space.md }}>
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={styles.half}>
          <Field label="Prezzo in annuncio" value={form.listPrice} onChangeText={(v) => onChange('listPrice', v)} placeholder="60" keyboardType="decimal-pad" suffix="€" error={errors.listPrice} />
        </View>
        <View style={styles.half}>
          <Field label="La tua offerta" value={form.targetPrice} onChangeText={(v) => onChange('targetPrice', v)} placeholder="45" keyboardType="decimal-pad" suffix="€" error={errors.targetPrice} />
        </View>
      </Row>

      <View style={{ gap: 6 }}>
        <Text style={{ color: t.ink3, fontSize: 12 }}>Sconto rapido</Text>
        <Row>
          {quickDiscounts.map((pct) => (
            <Chip key={pct} compact label={`−${pct}%`} active={preview ? Math.round(preview.d) === pct : false} onPress={() => applyDiscount(pct)} />
          ))}
        </Row>
      </View>
      {preview && (
        <Text style={{ color: t.ink3, fontSize: 14 }}>
          {preview.d > 0 ? (
            <>
              Sconto richiesto <Text style={{ color: t.ink, fontWeight: '700' }}>{Math.round(preview.d)}%</Text> · rischio{' '}
              <Text style={{ fontWeight: '700', color: preview.band.tone === 'good' ? t.good : preview.band.tone === 'warn' ? t.warn : t.bad }}>{preview.band.label.toLowerCase()}</Text>
              {preview.overCap ? <Text style={{ color: t.bad }}>{'\n'}Vinted non accetta offerte oltre il {VINTED.MAX_DISCOUNT_PCT}% di sconto.</Text> : null}
            </>
          ) : 'La tua offerta è pari o superiore al prezzo in annuncio: nessuno sconto richiesto.'}
        </Text>
      )}

      <ChipGroup label="Categoria" options={CATEGORIES} value={form.category} onChange={(v) => onChange('category', v)} error={errors.category} />

      <Field label="Titolo" hint="(facoltativo)" value={form.itemTitle} onChangeText={(v) => onChange('itemTitle', v)} placeholder="es. Fumetto Alan Moore, Jack lo Squartatore" />

      <Collapsible title="Venditore e annuncio (facoltativi)" summary={sellerSummaryOf(form)}>
        <ChipGroup label="In vendita da" options={LISTING_AGES} value={form.listingAge} onChange={(v) => onChange('listingAge', v)} />
        <ChipGroup label="Venditore" options={SELLER_PROFILES} value={form.sellerProfile} onChange={(v) => onChange('sellerProfile', v)} />
        <ChipGroup label="Nell'annuncio c'è scritto…" options={LISTING_SIGNALS} value={form.listingSignal} onChange={(v) => onChange('listingSignal', v)} />
      </Collapsible>

      <View style={{ gap: space.sm }}>
        <Button label={hasResult ? 'Ricalcola' : 'Calcola'} variant={hasResult ? 'secondary' : 'primary'} onPress={onSubmit} />
        <Button label="Svuota" variant="ghost" small onPress={onReset} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  half: { flex: 1, minWidth: 140 },
})
