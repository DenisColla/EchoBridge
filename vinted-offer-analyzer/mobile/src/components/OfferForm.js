import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { CATEGORIES, LISTING_AGES, LISTING_SIGNALS, SELLER_PROFILES, VINTED, computeDiscountPct, parsePrice, riskBandFor } from '../../core/index.js'
import { isVintedItemLink } from '../services/vinted.js'
import { space, useTheme } from '../theme.js'
import { Button, ButtonRow, Card, Chip, ChipGroup, Field, Note, Row, SectionLabel, Title } from './ui.js'

const QUICK_DISCOUNTS = [10, 15, 20, 25, 30]

export const EMPTY_FORM = {
  itemTitle: '',
  link: '',
  category: '',
  listPrice: '',
  targetPrice: '',
  listingAge: 'unknown',
  sellerProfile: 'unknown',
  listingSignal: 'none',
}

/**
 * Two ways in, in this order: paste a Vinted link and let the app read the listing ("Estrai e calcola"),
 * or fill the fields by hand. After an extraction the same fields show what was read, so the user can correct them.
 */
export function OfferForm({ form, errors, onChange, onSubmit, onReset, onExtract, onPasteLink, extracting = false, extractPhase = null, extraction = null }) {
  const t = useTheme()
  const linkOk = isVintedItemLink(form.link)
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
    <View style={{ gap: space.lg }}>
      <Card style={{ borderColor: t.accent }}>
        <SectionLabel>Passo 1 · dal link</SectionLabel>
        <Title>Incolla il link dell'annuncio</Title>
        <Body2 t={t}>Leggo titolo, prezzo, data di caricamento e attività del venditore dalla pagina pubblica di Vinted, poi calcolo subito il momento migliore.</Body2>
        <Field label="Link all'annuncio Vinted" value={form.link} onChangeText={(v) => onChange('link', v)} placeholder="https://www.vinted.it/items/…" keyboardType="url" autoCapitalize="none" error={form.link && !linkOk ? 'Serve un link a un articolo: vinted.it/items/…' : undefined} />
        <ButtonRow>
          <Button label={extracting ? 'Leggo l\'annuncio…' : 'Estrai e calcola'} onPress={() => onExtract(form.link)} disabled={extracting || !linkOk} />
          <Button label="Incolla dagli appunti" variant="secondary" onPress={onPasteLink} disabled={extracting} />
        </ButtonRow>
        {extracting && extractPhase && (
          <Note>
            {extractPhase === 'verify'
              ? 'Vinted chiede una verifica: completala nella schermata che si è aperta.'
              : 'Vinted sta facendo un controllo anti-robot: apro l\'annuncio con il browser interno, ci vuole qualche secondo…'}
          </Note>
        )}
        {extraction && !extraction.ok && <Note tone="warn">{extraction.message}</Note>}
        {extraction && extraction.ok && (
          <Note tone="good">
            Annuncio letto: {extraction.summary.found.length} dati trovati{extraction.summary.guessed.length ? `, ${extraction.summary.guessed.length} stimati` : ''}. Controlla i campi qui sotto e correggi se serve: il risultato si aggiorna con "Ricalcola".
          </Note>
        )}
      </Card>

      <Card>
        <SectionLabel>Passo 2 · controlla o compila a mano</SectionLabel>
        <Title>{extraction && extraction.ok ? 'Dati letti dall\'annuncio' : 'Che cosa vuoi comprare?'}</Title>

        <Field label="Titolo articolo" hint="(facoltativo)" value={form.itemTitle} onChangeText={(v) => onChange('itemTitle', v)} placeholder="es. Fumetto Alan Moore, Jack lo Squartatore" />

        <ChipGroup label="Categoria" options={CATEGORIES} value={form.category} onChange={(v) => onChange('category', v)} error={errors.category} />

        <Row style={{ alignItems: 'flex-start' }}>
          <View style={styles.half}>
            <Field label="Prezzo di listino" value={form.listPrice} onChangeText={(v) => onChange('listPrice', v)} placeholder="60" keyboardType="decimal-pad" suffix="€" error={errors.listPrice} />
          </View>
          <View style={styles.half}>
            <Field label="Prezzo target" value={form.targetPrice} onChangeText={(v) => onChange('targetPrice', v)} placeholder="45" keyboardType="decimal-pad" suffix="€" error={errors.targetPrice} />
          </View>
        </Row>

        <View style={{ gap: 6 }}>
          <Text style={{ color: t.ink3, fontSize: 12 }}>Sconto rapido</Text>
          <Row>
            {QUICK_DISCOUNTS.map((pct) => (
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
            ) : 'Il prezzo target è pari o superiore al listino: nessuno sconto richiesto.'}
          </Text>
        )}

        <ChipGroup label="Anzianità dell'annuncio" hint="(facoltativo)" options={LISTING_AGES} value={form.listingAge} onChange={(v) => onChange('listingAge', v)} />
        <ChipGroup label="Valutazione del venditore" hint="(facoltativo)" options={SELLER_PROFILES} value={form.sellerProfile} onChange={(v) => onChange('sellerProfile', v)} />
        <ChipGroup label="Nell'annuncio c'è scritto…" hint="(facoltativo)" options={LISTING_SIGNALS} value={form.listingSignal} onChange={(v) => onChange('listingSignal', v)} />

        <View style={{ gap: space.sm }}>
          <Button label={extraction && extraction.ok ? 'Ricalcola con questi dati' : 'Calcola momento ottimale'} onPress={onSubmit} />
          <Button label="Azzera il modulo" variant="ghost" small onPress={onReset} />
        </View>
      </Card>
    </View>
  )
}

function Body2({ t, children }) {
  return <Text style={{ color: t.ink2, fontSize: 14, lineHeight: 20 }}>{children}</Text>
}

const styles = StyleSheet.create({
  half: { flex: 1, minWidth: 140 },
})
