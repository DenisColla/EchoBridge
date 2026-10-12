import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CHANNELS, ITALIAN_CITIES, buyerFee, channelOfUrl, channelSearchUrl, cleanProduct, fallbackProduct, negotiationFor, parseSubitoSearch,
  parseWallapopSearch, prefilter, priceWindow, productPrompt, rankResults, readVinted, readModelJson, searchVerifyPrompt, SEARCH_VERIFY_SCHEMA,
  PRODUCT_SCHEMA, referenceOutlook, savingVersus, scrubContacts, withCosts,
} from '../src/core/index.js'

const fixture = (name) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', name), 'utf8')

test('channels: buyer fees follow the published formulas (Vinted half-up, Subito tiers and cap) and Wallapop is flagged as an estimate', () => {
  assert.deepEqual(buyerFee('vinted', 6.45), { amount: 1.02, estimated: false })
  assert.equal(buyerFee('vinted', 4.9).amount, 0.95, 'half-up, not half-even')
  assert.equal(buyerFee('vinted', 20).amount, 1.7)
  assert.equal(buyerFee('subito', 30).amount, 2.7)
  assert.equal(buyerFee('subito', 300).amount, 16.2)
  assert.equal(buyerFee('subito', 301).amount, 14.75)
  assert.equal(buyerFee('subito', 5000).amount, 91.2)
  assert.deepEqual(buyerFee('wallapop', 10), { amount: 1.95, estimated: true })
  assert.equal(buyerFee('wallapop', 100).amount, 8.19)
  assert.equal(buyerFee('wallapop', 2000).amount, 50)
  assert.equal(buyerFee('vinted', 0).amount, null)
})

test('channels: search URLs per channel, with price window, shipping-only filters and Wallapop location label', () => {
  assert.equal(channelSearchUrl('vinted', 'galaxy tab s9', { minPrice: 150.5, maxPrice: 600.2 }), 'https://www.vinted.it/catalog?search_text=galaxy%20tab%20s9&price_from=150&price_to=601&currency=EUR')
  assert.equal(channelSearchUrl('subito', 'galaxy tab s9', { minPrice: 150, maxPrice: 600 }), 'https://www.subito.it/annunci-italia/vendita/usato/?q=galaxy+tab+s9&shp=true&ps=150&pe=600')
  const w = channelSearchUrl('wallapop', 'galaxy tab s9+', { city: ITALIAN_CITIES[1] })
  assert.equal(w, 'https://it.wallapop.com/search?keywords=galaxy%20tab%20s9%2B&latitude=45.4642&longitude=9.19&location_label=Milano&is_shippable=true')
  assert.equal(channelOfUrl('https://it.wallapop.com/item/x'), 'wallapop')
  assert.equal(channelOfUrl('https://www.subito.it/x.htm'), 'subito')
  assert.equal(channelOfUrl('https://evil-subito.it/'), null)
  assert.throws(() => channelSearchUrl('ebay', 'x'))
})

test('channels: Subito __NEXT_DATA__ → candidates (list + originalList + galleryList merged, banners, sold, foreign links dropped)', () => {
  const { items } = parseSubitoSearch(fixture('subito-search-reconstructed.json'))
  assert.deepEqual(items.map((c) => c.id), ['577096643', '600000001', '600000002', '600000003'])
  const [a, b, sold, noPrice] = items
  assert.equal(a.title, 'Mario Kart 8 Deluxe Nintendo Switch')
  assert.equal(a.price, 30)
  assert.equal(a.condition, 'Buono')
  assert.equal(a.photo, 'https://images.sbito.it/api/v1/sbt-ads-images-pro/images/29/2966833a-ec9c-4384-977f-80dbbddd51ee?rule=gallery-desktop-1x-auto')
  assert.deepEqual([a.shippingCost, a.shippingEstimated, a.buyerFee, a.total], [5.99, false, 2.7, 38.69])
  assert.equal(a.location, 'Aversa CE')
  assert.equal(a.sellerBusiness, false)
  assert.equal(b.title, 'Mario Kart 8 Deluxe Switch & custodia')
  assert.equal(b.shipping.available, false)
  assert.equal(b.sellerBusiness, true)
  assert.equal(sold.sold, true)
  assert.equal(noPrice.price, null)
  assert.deepEqual(parseSubitoSearch('not json'), { items: [], total: 0 })
  assert.deepEqual(parseSubitoSearch({ props: {} }), { items: [], total: 0 })
})

test('channels: Wallapop search JSON → candidates (current and legacy shapes, free shipping, abroad, CDN-only images)', () => {
  const raw = JSON.parse(fixture('wallapop-search-reconstructed.json'))
  const { items } = parseWallapopSearch(raw)
  assert.deepEqual(items.map((c) => c.id), ['qzmml5yo7yzv', 'r2', 'r3', 'r5'])
  const [a, free, reserved, external] = items
  assert.equal(a.url, 'https://it.wallapop.com/item/samsung-galaxy-tab-s9-256gb-1312234156')
  assert.equal(a.price, 520)
  assert.equal(a.condition, 'Come nuovo')
  assert.equal(a.photo, 'https://cdn.wallapop.com/images/10420/a/b/__/c1/i1.jpg?pictureSize=W640')
  assert.deepEqual([a.shippingCost, a.shippingEstimated, a.feeEstimated], [CHANNELS.wallapop.shippingEstimate, true, true])
  assert.equal(free.shippingCost, 0)
  assert.equal(free.abroad, true)
  assert.equal(reserved.reserved, true)
  assert.equal(external.photo, null)
  const legacy = parseWallapopSearch({ data: { section: { payload: { items: raw.data.section.items } } } })
  assert.equal(legacy.items.length, 4)
  assert.deepEqual(parseWallapopSearch('{'), { items: [] })
})

test('channels: Vinted search page → candidates with fee from the page and estimated shipping', () => {
  const items = readVinted(fixture('vinted-catalog-2026-10.html'))
  assert.ok(items.length >= 4)
  for (const c of items) {
    assert.equal(c.source, 'vinted')
    assert.equal(c.shippingEstimated, true)
    assert.ok(Math.abs(c.total - (c.price + c.buyerFee + CHANNELS.vinted.shippingEstimate)) < 0.011)
  }
})

const reference = { source: 'vinted', id: 'ref', title: 'Samsung Galaxy Tab S9+ 256GB', brand: 'Samsung', price: 600, photo: 'https://images1.vinted.net/x.webp' }

test('search: product card prompt and schema, AI card cleaned, deterministic fallback', () => {
  const p = productPrompt({ ...reference, description: 'x'.repeat(2000) })
  assert.equal(p.schema, PRODUCT_SCHEMA)
  assert.ok(p.text.length < 1200, 'description is capped')
  const fb = fallbackProduct(reference)
  assert.match(fb.query, /galaxy/i)
  assert.equal(fb.fromAi, false)
  const card = cleanProduct({ name: 'Samsung Galaxy Tab S9+', brand: 'Samsung', model: 'Galaxy Tab S9+', attributes: ['256GB'], category: 'tablet', query: 'galaxy tab s9+ 256gb extra words here too', mustWords: ['S9', 'plus', 'x', 'y'], accessoryWords: ['Cover'], family: ['Galaxy Tab S9', 'Galaxy Tab S9 FE+'] }, reference)
  assert.equal(card.query.split(' ').length, 6)
  assert.deepEqual(card.mustWords, ['s9', 'plus', 'x'])
  assert.deepEqual(card.accessoryWords, ['cover'])
  assert.equal(cleanProduct(null, reference).fromAi, false)
  assert.deepEqual(priceWindow(600), { minPrice: 180, maxPrice: 750 })
  assert.deepEqual(priceWindow(null), { minPrice: null, maxPrice: null })
})

const cand = (id, title, price, extra = {}) => withCosts({ source: 'subito', id, title, price, photo: 'https://images.sbito.it/x', shipping: { available: true, cost: 6, free: false }, ...extra })

test('search: pre-filter drops sold, priceless, photoless, accessories, the reference itself and other products; caps per channel', () => {
  const product = { mustWords: ['s9'], accessoryWords: ['cover', 'pellicola'] }
  const list = [
    cand('1', 'Galaxy Tab S9+ 256GB', 500),
    cand('2', 'Cover Galaxy Tab S9+', 20),
    cand('3', 'Pellicola vetro per Tab S9', 10),
    cand('4', 'Galaxy Tab S9 con caricatore', 450),
    cand('5', 'iPad Air 5', 400),
    cand('6', 'Galaxy Tab S9 venduto', 300, { sold: true }),
    cand('7', 'Galaxy Tab S9', null),
    cand('8', 'Galaxy Tab S9 senza foto', 300, { photo: null }),
    cand('1', 'Galaxy Tab S9+ 256GB', 500),
    withCosts({ source: 'vinted', id: 'ref', title: 'Samsung Galaxy Tab S9+', price: 600, photo: 'x', shipping: {} }),
  ]
  const { kept, dropped } = prefilter(list, product, reference)
  assert.deepEqual(kept.map((c) => c.id), ['4', '1'])
  assert.equal(dropped.accessorio, 2)
  assert.equal(dropped['altro prodotto (parole chiave assenti)'], 1)
  assert.equal(dropped['venduto o riservato'], 1)
  assert.equal(dropped['senza prezzo'], 1)
  assert.equal(dropped['senza foto'], 1)
  assert.equal(dropped.doppione, 1)
  assert.equal(dropped['annuncio di partenza'], 1)
  const many = Array.from({ length: 30 }, (_, i) => cand(`m${i}`, 'Galaxy Tab S9', 300 + i))
  assert.equal(prefilter(many, product, reference, { perChannel: 20 }).kept.length, 20)
  // a reference that IS a cover keeps covers
  assert.equal(prefilter([cand('c', 'Cover Galaxy Tab S9+', 20)], product, { title: 'Cover per Galaxy Tab S9+' }).kept.length, 1)
})

test('search: verification prompt carries channel and description, schema adds the family flag, answers validate', () => {
  const p = searchVerifyPrompt(reference, { name: 'Samsung Galaxy Tab S9+', attributes: ['256GB'] }, cand('1', 'Galaxy Tab S9 FE', 300, { description: 'tablet\n\nottimo' }))
  assert.equal(p.schema, SEARCH_VERIFY_SCHEMA)
  assert.match(p.text, /canale: Subito/)
  assert.match(p.text, /prodotto: Samsung Galaxy Tab S9\+ \(256GB\)/)
  assert.match(p.text, /descrizione: tablet ottimo/)
  assert.match(p.system, /family: true solo se/)
  const ok = readModelJson(JSON.stringify({ verdict: 'different', family: true, confidence: 0.8, differences: ['modello FE'], candidateCondition: 'buone', redFlags: [], reason: 'FE' }), SEARCH_VERIFY_SCHEMA)
  assert.equal(ok.ok, true)
  assert.equal(readModelJson(JSON.stringify({ verdict: 'same', confidence: 0.8, differences: [], candidateCondition: '', redFlags: [], reason: '' }), SEARCH_VERIFY_SCHEMA).ok, false, 'family is required')
})

test('search: negotiation respects channel floors and PRO sellers; ranking splits main and alternatives and penalises risk', () => {
  const now = new Date('2026-10-12T10:00:00Z')
  const w = withCosts({ source: 'wallapop', id: 'w', title: 'Galaxy Tab S9+', price: 500, photo: 'x', shipping: { available: true } })
  const n = negotiationFor(w, now)
  assert.ok(n.offer >= 350 && n.offer <= 500, 'Wallapop offers stay within 30% of the price')
  assert.equal(n.estimated, true)
  const pro = negotiationFor({ ...w, sellerBusiness: true }, now)
  assert.deepEqual([pro.offer, pro.expectedPrice], [500, 500])
  const v = withCosts({ source: 'vinted', id: 'v', title: 'Galaxy Tab S9+', price: 520, buyerFee: 26.7, photo: 'x', shipping: {} })
  assert.ok(negotiationFor(v, now).offer >= 312)
  const results = [
    { candidate: w, verdict: 'same', family: false, confidence: 0.9, redFlags: [], reason: 'uguale' },
    { candidate: v, verdict: 'variant', family: false, confidence: 0.5, redFlags: ['foto dal web'], reason: 'colore diverso' },
    { candidate: cand('fe', 'Galaxy Tab S9 FE', 280), verdict: 'different', family: true, confidence: 0.9, redFlags: [], reason: 'FE' },
    { candidate: cand('x', 'Cover', 20), verdict: 'different', family: false, confidence: 0.9, redFlags: [], reason: 'cover' },
  ]
  const { main, alternatives } = rankResults(results, now)
  assert.deepEqual(main.map((r) => r.candidate.id), ['w', 'v'])
  assert.deepEqual(alternatives.map((r) => r.candidate.id), ['fe'])
  const riskyRow = main.find((r) => r.candidate.id === 'v')
  assert.ok(riskyRow.score > riskyRow.expectedTotal, 'risk raises the score')
  assert.ok(riskyRow.risks.includes('foto dal web') && riskyRow.risks.includes('verifica incerta'))
  for (const r of [...main, ...alternatives]) assert.ok(r.expectedTotal <= r.totalNow + 0.001)
})

test('search: the reference is compared on the same basis (total now and expected after negotiation), photo-less references verify on text', () => {
  const now = new Date('2026-10-12T10:00:00Z')
  const ref = { source: 'vinted', id: 'r', title: 'Galaxy Tab S9+', price: 500 }
  const out = referenceOutlook(ref, now)
  assert.equal(out.totalNow, 500 + 25.7 + 3.5)
  assert.ok(out.expectedTotal <= out.totalNow)
  assert.equal(referenceOutlook({ title: 'x' }, now), null)
  const row = { totalNow: 400, expectedTotal: 380 }
  assert.deepEqual(savingVersus(row, { totalNow: 529.2, expectedTotal: 500 }), { now: 129.2, expected: 120 })
  assert.equal(savingVersus(row, null), null)
  const p = searchVerifyPrompt(ref, null, cand('1', 'Galaxy Tab S9+', 300), { withReferencePhoto: false })
  assert.match(p.text, /^Unica immagine: annuncio candidato/)
})

test('search: phone numbers and e-mails in listing texts never reach the providers; prices, sizes and models stay', () => {
  assert.equal(scrubContacts('scrivimi a mario.rossi@gmail.com o al 333 123 4567'), 'scrivimi a [contatto] o al [contatto]')
  assert.equal(scrubContacts('+39 333-1234567 dopo le 18'), '[contatto] dopo le 18')
  assert.equal(scrubContacts('Galaxy Tab S9+ 256GB, 1.200 € trattabili, SM-X816B, anno 2023'), 'Galaxy Tab S9+ 256GB, 1.200 € trattabili, SM-X816B, anno 2023')
  const p = productPrompt({ title: 'Tab S9+', description: 'chiamami 3331234567' })
  assert.doesNotMatch(p.text, /3331234567/)
})

test('privacy: contacts are blanked in every common Italian shape and in titles; model lists, sizes, dates and prices stay', () => {
  const blanked = ['333 - 1234567', '333  1234567', '333 . 123 . 4567', '333 / 123 45 67', '+39 (333) 1234567', 'tel 06 1234 5678', '0039 3331234567',
    'mario.rossi @ gmail.com', 'mario.rossi(at)gmail(dot)com', 'mario chiocciola gmail punto com', 'Telegram @mario_rossi92', 'IG: mario.rossi', 'wa.me/393331234567']
  for (const s of blanked) assert.doesNotMatch(scrubContacts(s), /\d{6,}|rossi|mario/, s)
  assert.equal(scrubContacts('iPhone 13 3331234567'), 'iPhone 13 [contatto]')
  for (const s of ['Cover compatibile con iPhone 11 12 13 14', 'Acquistato il 12/05/2023, garanzia fino al 03/05/2025', 'taglie 38 39 40 41 42', '30 x 40 x 50 cm', 'EAN 8806094935561', 'stagione 2023/2024']) {
    assert.equal(scrubContacts(s), s)
  }
  const v = searchVerifyPrompt({ title: 'Tab S9+ wa 3331234567', price: 500 }, null, cand('1', 'iPhone 13 chiama 333 1234567', 300, { description: 'Telegram @mario_rossi92' }))
  assert.doesNotMatch(v.text, /3331234567|333 1234567|mario_rossi92/)
  assert.doesNotMatch(productPrompt({ title: 'Tab S9+ 333 1234567' }).text, /1234567/)
})

test('search: accessory filter ignores extras in the reference description, "per" must follow the accessory closely, price window and hand-delivery-only listings are dropped', () => {
  const product = { mustWords: ['iphone'], accessoryWords: ['cover', 'pellicola', 'caricatore'] }
  const ref = { source: 'vinted', id: 'r', title: 'iPhone 13 128GB con cover', description: 'Vendo con cover e pellicola in omaggio, caricatore incluso', price: 400 }
  const list = [
    cand('a', 'Cover iPhone 13 silicone', 150),
    cand('b', 'Pellicola vetro temperato per iPhone 13', 130),
    cand('c', 'iPhone 13 con cover, perfetto per la scuola', 350),
    cand('d', 'iPhone 13 128GB', 20),
    cand('e', 'iPhone 13 128GB ritiro a mano', 300, { shipping: { available: false } }),
    cand('f', 'iPhone 13 Pro Max 1TB', 900),
  ]
  const { kept, dropped } = prefilter(list, product, ref, { window: priceWindow(400) })
  assert.deepEqual(kept.map((c) => c.id), ['c'])
  assert.deepEqual(dropped, { accessorio: 2, 'fuori fascia di prezzo': 2, 'senza spedizione': 1 })
  // a reference that is itself a cover still keeps covers
  assert.equal(prefilter([cand('a', 'Cover iPhone 13 silicone', 15)], product, { title: 'Cover iPhone 13 MagSafe', price: 20 }).kept.length, 1)
  // hand delivery only: no shipping estimate and no total to rank on
  const local = withCosts({ source: 'wallapop', id: 'w', title: 'x', price: 100, shipping: { available: false } })
  assert.deepEqual([local.shippingCost, local.total], [null, null])
})

test('channels: shipping is unknown (not "hand delivery") when the page omits it; Wallapop refurbished items get no offer and PRO is flagged as a risk', () => {
  const w = (extra) => parseWallapopSearch({ data: { section: { items: [{ id: 'x', title: 'iPhone 13', web_slug: 'iphone-13-1', price: { amount: 400, currency: 'EUR' }, images: [{ urls: { medium: 'https://cdn.wallapop.com/x.jpg' } }], ...extra }] } } }).items[0]
  assert.equal(w({}).shipping.available, null)
  assert.equal(w({ shipping: { item_is_shippable: false, user_allows_shipping: true } }).shipping.available, false)
  assert.equal(w({ shipping: { item_is_shippable: true, user_allows_shipping: true } }).shipping.available, true)
  const now = new Date('2026-10-12T10:00:00Z')
  const refurb = negotiationFor(w({ is_refurbished: { flag: true } }), now)
  assert.deepEqual([refurb.offer, refurb.expectedPrice], [400, 400])
  assert.match(refurb.note, /ricondizionato/)
  const { main } = rankResults([{ candidate: w({}), verdict: 'same', family: false, confidence: 0.9, redFlags: [], reason: '' }], now)
  assert.ok(main[0].risks.includes('offerta possibile solo se il venditore non è PRO'))
})
