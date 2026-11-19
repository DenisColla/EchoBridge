import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BUNDLE_HINT, SELLER_INACTIVE_DAYS, SELLER_QUIET_DAYS, buildFormFromExtraction, parseVintedItemHtml, sellerProfileGuess, signalFromText,
} from '../src/core/extract.js'
import { analyzeOffer } from '../src/core/analyze.js'

const fixture = (name) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', name), 'utf8')
const NULL_SIGNALS = { views: null, interested: null, oldPrice: null, priceDropped: null, priceDrop: null, bundleOffered: null, bundleDiscountPct: null, lastSeenDays: null, sellerItems: null, reserved: null }

/** A minimal item page: JSON-LD product plus whatever hydrated-DOM fragments the test adds. */
const page = ({ price = 25, description = 'Bella felpa, poco usata.', extra = '' } = {}) =>
  `<html><head><script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'Felpa Nike', description, brand: { '@type': 'Brand', name: 'Nike' }, category: 'Uomo Felpe', offers: { price, priceCurrency: 'EUR', itemCondition: 'https://schema.org/UsedCondition' } })}</script></head><body>${extra}<script>var chunk = "bundle.js"; var b = {bundle: 1}</script></body></html>`

test('extractor signals: views, interested, previous price, dates from the hydrated DOM (label/value in either order, thousands dots)', () => {
  const html = page({ extra: '<div class="details-list"><div class="details-list__item-value"><span>Visualizzazioni</span></div><div class="details-list__item-value"><span>1.234</span></div></div>'
    + '<div><span>7 interessati</span></div><div><span class="web_ui__Text__strikethrough">30,00 €</span><span>25,00 €</span></div>'
    + '<div itemProp="upload_date"><span>3 giorni fa</span></div><div><span>Visto 5 giorni fa</span></div>' })
  const ex = parseVintedItemHtml(html)
  assert.equal(ex.listPrice, 25)
  assert.equal(ex.signals.views, 1234)
  assert.equal(ex.signals.interested, 7)
  assert.equal(ex.signals.oldPrice, 30)
  assert.equal(ex.signals.priceDropped, true)
  assert.deepEqual(ex.signals.priceDrop, { from: 30, to: 25, hoursAgo: null })
  assert.equal(ex.uploadedDays, 3)
  assert.equal(ex.sellerLastSeenText, '5 giorni fa')
  assert.equal(ex.sellerLastSeenDays, 5)
  assert.equal(ex.signals.lastSeenDays, 5)
  assert.equal(ex.signals.bundleOffered, null, 'a script named bundle.js is not a bundle discount')
  assert.equal(ex.signals.bundleDiscountPct, null)
  assert.ok(['visualizzazioni', 'interessati', 'prezzo precedente'].every((l) => ex.found.includes(l)))
  assert.deepEqual(ex.unread, ['sconto sui lotti', 'altri articoli del venditore'])
  assert.ok(!ex.missing.includes('visualizzazioni') && !ex.missing.includes('interessati'), 'DOM-only fields never count as missing')

  const other = parseVintedItemHtml(page({ extra: '<span>1.234 visualizzazioni</span><span>12 persone interessate</span>' }))
  assert.equal(other.signals.views, 1234)
  assert.equal(other.signals.interested, 12)
  const escaped = parseVintedItemHtml(page({ extra: '<script>self.__next_f.push("\\"view_count\\":88,\\"favourite_count\\":3,\\"original_price\\":{\\"amount\\":\\"29.9\\"}")</script>' }))
  assert.equal(escaped.signals.views, 88)
  assert.equal(escaped.signals.interested, 3)
  assert.equal(escaped.signals.oldPrice, 29.9)
  assert.equal(escaped.signals.priceDropped, true)
})

test('extractor signals: the probe\'s details win, a crossed-out price at or under the current one is no drop, nothing is guessed', () => {
  const ex = parseVintedItemHtml(page(), { flight: { view_count: 88, favourite_count: 3, item_count: 12, is_reserved: false }, strikethrough: ['€ 29,90'], bundleText: 'Sconto sui lotti: fino al 20%', attributes: [['Caricato', '2 settimane fa']] })
  assert.deepEqual(ex.signals, { views: 88, interested: 3, oldPrice: 29.9, priceDropped: true, priceDrop: { from: 29.9, to: 25, hoursAgo: null }, bundleOffered: true, bundleDiscountPct: 20, lastSeenDays: null, sellerItems: 12, reserved: false })
  assert.equal(ex.uploadedDays, 14)
  const attrs = parseVintedItemHtml(page(), { attributes: [['Visualizzazioni', '2.050'], ['Interessati', '9']], sellerItemCards: 4 })
  assert.equal(attrs.signals.views, 2050)
  assert.equal(attrs.signals.interested, 9)
  assert.equal(attrs.signals.sellerItems, 4)
  const noDrop = parseVintedItemHtml(page({ extra: '<span style="text-decoration: line-through">25 €</span>' }))
  assert.equal(noDrop.signals.oldPrice, null)
  assert.equal(noDrop.signals.priceDropped, null)
  assert.deepEqual(parseVintedItemHtml('').signals, NULL_SIGNALS)
  assert.deepEqual(parseVintedItemHtml(page()).signals, NULL_SIGNALS)
  assert.deepEqual(parseVintedItemHtml(page(), { flight: { view_count: 'x', is_reserved: 'no' } }).signals, NULL_SIGNALS, 'junk in the probe is ignored')
})

test('extractor signals: bundle discount from the listing text, listing age and seller activity phrases', () => {
  const bundle = parseVintedItemHtml(page({ description: 'Guarda il mio armadio: sconto sui lotti fino al 15%!' }))
  assert.equal(bundle.signals.bundleOffered, true)
  assert.equal(bundle.signals.bundleDiscountPct, 15)
  assert.ok(bundle.found.includes('sconto sui lotti'))
  const hint = parseVintedItemHtml(page({ description: 'Se prendi più pezzi facciamo un prezzo.' }))
  assert.equal(hint.signals.bundleOffered, true)
  assert.equal(hint.signals.bundleDiscountPct, null, 'no percentage written, none guessed')
  assert.ok(BUNDLE_HINT.test('Sconto per i lotti') && !BUNDLE_HINT.test('bundle.js') && !BUNDLE_HINT.test('due pezzi'))
  const phrases = parseVintedItemHtml(page({ extra: '<p>In vendita da 2 settimane</p><p>Attivo oggi</p>' }))
  assert.equal(phrases.uploadedDays, 14)
  assert.equal(phrases.sellerLastSeenDays, 0)
  const marker = parseVintedItemHtml(page({ extra: '<span data-testid="seller-last-logged-in">Ultima visita 14 ore fa</span><p>Visto 5 giorni fa</p>' }))
  assert.ok(marker.sellerLastSeenDays < 1, 'the structured marker wins over a phrase')
})

test('extractor signals: the committed fixtures (server-side pages) read no DOM-only field and keep their found/missing lists', () => {
  const oct = parseVintedItemHtml(fixture('vinted-item-2026-10.html'))
  assert.deepEqual({ ...oct.signals, lastSeenDays: null }, NULL_SIGNALS)
  assert.ok(oct.signals.lastSeenDays > 0.5 && oct.signals.lastSeenDays < 0.6)
  assert.deepEqual(oct.missing, ['marca'])
  assert.deepEqual(oct.unread, ['visualizzazioni', 'interessati', 'prezzo precedente', 'sconto sui lotti', 'altri articoli del venditore'])
  assert.equal(oct.uploadedText, '3 settimane fa')
  const sample = parseVintedItemHtml(fixture('vinted-item-sample.html'))
  assert.deepEqual({ ...sample.signals, lastSeenDays: null }, NULL_SIGNALS)
  assert.deepEqual(sample.missing, [])
  assert.equal(sample.sellerUsername, 'venditore_demo')
})

test('extractor: seller «quiet» from 3 to 13 days, «inactive» from 14; new fixed-price phrases', () => {
  assert.equal(SELLER_QUIET_DAYS, 3)
  assert.equal(SELLER_INACTIVE_DAYS, 14)
  assert.equal(sellerProfileGuess({ lastSeenDays: 2.9, feedbackCount: 2 }).id, 'new_seller')
  assert.equal(sellerProfileGuess({ lastSeenDays: 3, feedbackCount: 2 }).id, 'quiet', 'activity beats the review count')
  assert.equal(sellerProfileGuess({ lastSeenDays: 13.9, feedbackCount: 200, rating: 5 }).id, 'quiet')
  assert.equal(sellerProfileGuess({ lastSeenDays: 14 }).id, 'inactive')
  assert.match(sellerProfileGuess({ lastSeenDays: 5 }).reason, /ultima visita 5 giorni fa/)
  for (const t of ['Ultimo prezzo, non scendo', 'Prezzo minimo', 'già ribassato', 'prezzo già basso', 'No perditempo']) assert.equal(signalFromText(t).id, 'fixed_price', t)
  assert.equal(signalFromText('Vendo tutto, svuoto l\'armadio').id, 'clearing_out')
})

test('extractor: the policy sets the target when asked, the legacy default otherwise, «no offer» points at the list price', () => {
  const ex = parseVintedItemHtml(page({ extra: '<div itemProp="upload_date"><span>10 giorni fa</span></div><div><span>Visto 5 giorni fa</span></div>' }))
  const legacy = buildFormFromExtraction(ex, { link: 'https://www.vinted.it/items/1' })
  assert.equal(legacy.form.targetPrice, '20')
  assert.equal(legacy.form.policy.source, 'default')
  assert.equal(legacy.form.policy.discountPct, 20)
  assert.match(legacy.summary.found.find((f) => f.startsWith('Prezzo')), /target proposto 20 €, −20%/)

  const policy = buildFormFromExtraction(ex, { link: 'https://www.vinted.it/items/1', policy: true })
  assert.equal(policy.form.category, 'other')
  assert.equal(policy.form.listingAge, 'weeks_1_2')
  assert.equal(policy.form.sellerProfile, 'quiet')
  assert.equal(policy.form.targetPrice, '22', '25 € · 1–2 weeks · 20–40 € band → 12% → 22 €')
  assert.equal(policy.form.policy.source, 'policy')
  assert.equal(policy.form.policy.kind, 'offer')
  assert.equal(policy.form.policy.discountPct, 12)
  assert.equal(policy.summary.found.find((f) => f.startsWith('Prezzo')), 'Prezzo 25 € · target proposto 22 € (−12%: fascia 20–40 €, 10 giorni)')
  assert.deepEqual(policy.form.signals, { lastSeenDays: 5 }, 'the page\'s non-null signals ride on the form')
  assert.equal(analyzeOffer(policy.form, new Date(2026, 9, 4, 16, 0)).kind, 'analysis')

  // Caller signals merge in (and win), the learned shift and the market reach the policy.
  const merged = buildFormFromExtraction(ex, { policy: true, signals: { favourites: 4, sellerItems: 3, lastSeenDays: 6 }, profile: { discountShift: -4 }, market: { n: 4, p25Price: 18, medianPrice: 24, p75Price: 25 } })
  assert.deepEqual(merged.form.signals, { lastSeenDays: 6, favourites: 4, sellerItems: 3 })
  assert.equal(merged.form.policy.discountPct, 13, '12 + 5 (listed at p75) − 4 (shift)')
  assert.equal(merged.form.policy.shift, -4)

  // A given policy object is used as is.
  const given = buildFormFromExtraction(ex, { policy: { kind: 'offer', targetPrice: 21, discountPct: 16, summary: '−16%: prova' } })
  assert.equal(given.form.targetPrice, '21')
  assert.equal(given.form.policy.summary, '−16%: prova')

  // No offer: cheap and fresh → the target is the list price and the engine says «compra».
  const cheap = parseVintedItemHtml(page({ price: 9, extra: '<div itemProp="upload_date"><span>2 giorni fa</span></div>' }))
  const none = buildFormFromExtraction(cheap, { policy: true })
  assert.equal(none.form.targetPrice, '9')
  assert.equal(none.form.policy.kind, 'no_offer')
  assert.match(none.summary.found.find((f) => f.startsWith('Prezzo')), /^Prezzo 9 € · meglio non offrire: fascia sotto 12 €/)
  assert.equal(analyzeOffer({ ...none.form, category: 'other' }, new Date(2026, 9, 4, 16, 0)).kind, 'no_offer_needed')
  // Under the market's cheapest quarter → no offer too.
  const under = buildFormFromExtraction(ex, { policy: true, market: { n: 4, p25Price: 30, medianPrice: 35, p75Price: 40 } })
  assert.equal(under.form.policy.kind, 'no_offer')
  assert.equal(under.form.policy.alternative, 'buy_now')
  // Without a price the policy has nothing to say and the form has no target.
  const noPrice = buildFormFromExtraction(parseVintedItemHtml('<meta property="og:title" content="Felpa | Vinted">'), { policy: true, previousForm: { targetPrice: '5' } })
  assert.equal(noPrice.form.targetPrice, '5')
  assert.equal(noPrice.form.policy, undefined)
  assert.ok(noPrice.summary.missing.includes('prezzo'))
})

test('extractor: DOM readings show up in the summary, and the whole form survives JSON', () => {
  const ex = parseVintedItemHtml(page({ description: 'Sconto sui lotti fino al 15%', extra: '<span>300 visualizzazioni</span><span>4 interessati</span><span class="strikethrough">35 €</span>' }))
  const built = buildFormFromExtraction(ex, { policy: true })
  assert.ok(built.summary.found.includes('Interesse: 300 visualizzazioni, 4 interessati'))
  assert.ok(built.summary.found.includes('Prezzo ribassato: prima 35 €'))
  assert.ok(built.summary.found.includes('Sconto sui lotti fino al 15%'))
  assert.deepEqual(built.form.policy.caps.map((c) => c.id), ['price_dropped'])
  assert.equal(built.form.policy.discountPct, 10, 'unknown age → middle tier 12, capped at 10 by the price drop')
  assert.ok(!JSON.stringify(built).includes('[object Object]'))
  assert.deepEqual(JSON.parse(JSON.stringify(built.form)), built.form)
})
