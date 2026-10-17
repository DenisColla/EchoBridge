import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CHANNELS, CONDITION_PENALTY_PCT, ITALIAN_CITIES, applyTriage, attributeConflict, buyerFee, channelOfUrl, channelSearchUrl, cleanProduct,
  conditionGrade, fallbackProduct, negotiationFor, offerCurveFor, parseSubitoSearch, parseWallapopSearch, prefilter, priceWindow, probabilityAt,
  productPrompt, rankResults, readVinted, readModelJson, searchVerifyPrompt, SEARCH_VERIFY_SCHEMA, PRODUCT_SCHEMA, TRIAGE_SCHEMA, referenceOutlook,
  savingVersus, scrubContacts, tierFor, triageBatches, triagePrompt, withCosts,
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

test('search: accessory references keep their accessories, bundles named product-first stay, no «per» rule without product words, fallback names are scrubbed', () => {
  const fb = { mustWords: [], accessoryWords: ['cover', 'custodia', 'caricatore'] }
  // the reference is an accessory named after the brand or the product
  for (const title of ['Apple caricatore 20W USB-C originale', 'iPhone 13 cover MagSafe silicone', 'Samsung custodia Galaxy Tab S9 con tastiera']) {
    const kept = prefilter([cand('a', 'Caricatore Apple 20W', 15), cand('b', 'Cover MagSafe iPhone 13', 15), cand('c', 'Custodia con tastiera Galaxy Tab S9', 15)], fb, { title }).kept
    assert.ok(kept.length >= 1, title)
  }
  // bundles: the product comes first
  const ipad = { mustWords: ['ipad'], accessoryWords: ['custodia', 'cover'] }
  const r = prefilter([cand('1', 'iPad Air 5 64GB + Apple Pencil + custodia per iPad', 420), cand('2', 'iPad Air 5 con cover per iPad Air', 400), cand('3', 'Custodia in pelle per iPad Air 5', 30)], ipad, { title: 'iPad Air 5 64GB' })
  assert.deepEqual(r.kept.map((c) => c.id).sort(), ['1', '2'])
  // empty must-words: only the "starts with" rule applies
  assert.equal(prefilter([cand('1', 'Mac Pro con custodia ottimo per lavoro', 900)], { mustWords: [], accessoryWords: ['custodia'] }, { title: 'Mac Pro' }).kept.length, 1)
  // fallback card name never carries contacts into the verification prompt
  const ref = { title: 'Galaxy Tab S9+ 256GB wa 3331234567', price: 500 }
  const p = searchVerifyPrompt(ref, fallbackProduct(ref), cand('1', 'Galaxy Tab S9+', 450))
  assert.doesNotMatch(p.text, /3331234567/)
  assert.doesNotMatch(searchVerifyPrompt(ref, cleanProduct({ name: '' }, ref), cand('1', 'x', 1)).text, /3331234567/)
})

test('search: rows without a possible offer are not flagged as estimated negotiations', () => {
  const now = new Date('2026-10-12T10:00:00Z')
  const w = parseWallapopSearch({ data: { section: { items: [{ id: 'x', title: 'iPhone 13', web_slug: 'iphone-13-1', price: { amount: 400 }, images: [{ urls: { medium: 'https://cdn.wallapop.com/x.jpg' } }], is_refurbished: { flag: true } }] } } }).items[0]
  const { main } = rankResults([{ candidate: w, verdict: 'same', family: false, confidence: 0.9, redFlags: [], reason: '' }], now)
  assert.equal(main[0].offer, 400)
  assert.ok(!main[0].risks.includes('trattativa stimata con il modello Vinted'))
  assert.ok(!main[0].risks.includes('offerta possibile solo se il venditore non è PRO'))
  assert.match(main[0].negotiationNote, /ricondizionato/)
})

test('privacy: obfuscated numbers and handles are caught; codes, price lists and date ranges survive; long numeric lists stay fast', () => {
  for (const s of ['333.123.45.67', 'cell3331234567', 'wa:3331234567', '+393331234567', '3 3 3 1 2 3 4 5 6 7', '333–123–4567', '333·123·4567', '333_123_4567', '333    -    1234567', 'IG mario.rossi', 'mario.rossi at gmail dot com', 'tel 33312 34567']) {
    assert.doesNotMatch(scrubContacts(s), /\d{5,}|\d{3}\D{1,4}\d{3,}|rossi|\d( \d){5}/, s)
  }
  for (const s of ['Lego 31120 31121', 'BILLY 002.638.50', 'ISBN 978-88-04-71234-5', 'Pikachu 025/165 026/165', 'Garmin 010-02540-01', 'prezzi 300 350 400', 'garanzia 30/11/2024 - 30/11/2025', 'ricevuto 30/11/24 300€', 'Instagram story', 'tg 128GB']) {
    assert.equal(scrubContacts(s), s)
  }
  assert.equal(scrubContacts('Email mario@gmail.com. iPhone 13 Pro 256GB'), 'Email [contatto]. iPhone 13 Pro 256GB')
  const list = Array.from({ length: 165 }, (_, i) => `${String(i + 1).padStart(3, '0')}/165`).join(' ')
  const t = Date.now()
  assert.equal(scrubContacts(list), list)
  assert.ok(Date.now() - t < 500)
})

test('search and privacy: bundle references keep the accessory filter; third-round contact formats', () => {
  const product = { mustWords: ['iphone'], accessoryWords: ['cover', 'caricatore'] }
  for (const title of ['iPhone 13 128GB + cover + caricatore', 'iPhone 13 128GB, cover, caricatore', 'iPhone 13 cover inclusa', 'iPhone 13 + caricatore in regalo']) {
    assert.equal(prefilter([cand('a', 'Cover MagSafe iPhone 13', 150)], product, { title, price: 400 }).kept.length, 0, title)
  }
  assert.equal(prefilter([cand('a', 'Cover Galaxy S9+', 15)], { mustWords: ['s9'], accessoryWords: ['cover'] }, { title: 'Galaxy S9+ cover silicone' }).kept.length, 1)
  for (const s of ['Per info 3471234567/3389876543', 'per info 333 1234567/02 12345678', 'per info 0521.123456', 'Tel/fax 0521.123456', '02 123 45 67', '338 123 456',
    'nome (chiocciola) gmail (punto) com', 'mario.rossi92@gmail', 'Tel 06 1234567 / 06 7654321']) {
    assert.doesNotMatch(scrubContacts(s), /\d{5,}|\d{3}\D{1,4}\d{3,}|\d{2}\D{1,2}\d{3,}|rossi|gmail/, s)
  }
  for (const s of ["Jeans Levi's 501 tg W32 L34", 'Scarpe tg EU38', 'Felpa tg XXL.', 'Scarpe Nike numero 38 39 40 41 42', 'MALM 090.123.45', 'Omega 311.30.42.30.01.005', '399 449 499', 'Xbox Live Gold']) {
    assert.equal(scrubContacts(s), s)
  }
})

/* ───────── 1.6.0: triage, light pre-filter, attribute check, condition, tiers, suspects, offer curve ───────── */

test('triage: one text-only prompt per batch (ids, channel, scrubbed titles, no descriptions), batches, and answers sorted into buckets', () => {
  const ref = { ...reference, title: 'Samsung Galaxy Tab S9+ 256GB wa 3331234567', condition: 'Ottime condizioni' }
  const list = [
    cand('1', 'Galaxy Tab S9+ 256GB chiama 333 1234567', 500, { condition: 'Buono', description: 'DESCRIZIONE SEGRETA' }),
    withCosts({ source: 'wallapop', id: 'w', title: 'Cover Galaxy Tab S9', price: 15, photo: 'x', shipping: {} }),
    withCosts({ source: 'vinted', id: 'v', title: 'Galaxy Tab S9 FE', price: 300, photo: 'x', shipping: {} }),
    cand('4', 'iPad Air 5', 400),
    cand('5', 'Galaxy Tab S9 scatola vuota', 20),
    cand('6', 'Galaxy Tab S9+ 128GB', 450),
  ]
  const p = triagePrompt(ref, { name: 'Samsung Galaxy Tab S9+', attributes: ['256GB'] }, list)
  assert.equal(p.schema, TRIAGE_SCHEMA)
  assert.equal(p.schemaName, 'triage_ricerca')
  assert.match(p.text, /prodotto: Samsung Galaxy Tab S9\+ \(256GB\)/)
  assert.match(p.text, /condizioni dichiarate: Ottime condizioni/)
  assert.match(p.text, /^#subito:1 \[Subito\] Galaxy Tab S9\+ 256GB chiama \[contatto\] — 500 € — Buono$/m)
  assert.match(p.text, /^#wallapop:w \[Wallapop\] Cover Galaxy Tab S9 — 15 € — n\.d\.$/m)
  assert.match(p.text, /^#vinted:v \[Vinted\] /m)
  assert.doesNotMatch(p.text, /SEGRETA|3331234567|333 1234567|descrizione/)
  assert.match(p.system, /"same" = stesso modello e stessa versione/)
  assert.match(p.system, /"accessory" = accessorio/)
  const ok = readModelJson(JSON.stringify({ items: [{ id: 'subito:1', verdict: 'same', confidence: 0.9 }] }), TRIAGE_SCHEMA)
  assert.equal(ok.ok, true)
  assert.equal(readModelJson(JSON.stringify({ items: [{ id: 'subito:1', verdict: 'different', confidence: 0.9 }] }), TRIAGE_SCHEMA).ok, false, 'different is not a triage verdict')
  assert.equal(readModelJson(JSON.stringify({ items: [{ id: 'subito:1', verdict: 'same' }] }), TRIAGE_SCHEMA).ok, false, 'confidence is required')
  // batches
  assert.deepEqual(triageBatches(list, 4).map((b) => b.length), [4, 2])
  assert.deepEqual(triageBatches([], 40), [])
  assert.equal(triageBatches(list).length, 1)
  // answers from two batches, concatenated; "#" tolerated in ids; the 6th candidate gets no answer
  const answers = [
    { id: 'subito:1', verdict: 'same', confidence: 0.9 },
    { id: '#wallapop:w', verdict: 'accessory', confidence: 0.95 },
    { id: 'vinted:v', verdict: 'family', confidence: 0.8 },
    { id: 'subito:4', verdict: 'other', confidence: 0.9 },
    { id: 'subito:5', verdict: 'accessory', confidence: 0.3 },
    { id: 'subito:zzz', verdict: 'same', confidence: 1 },
  ]
  const { plausible, rejected, unanswered } = applyTriage(list, answers)
  assert.deepEqual(plausible.map((c) => c.id), ['1', 'v', '5', '6'])
  assert.deepEqual(plausible[0].triage, { verdict: 'same', confidence: 0.9 })
  assert.deepEqual(plausible[2].triage, { verdict: 'accessory', confidence: 0.3 }, 'low-confidence rejections get the benefit of the doubt')
  assert.equal(plausible[3].triage, null)
  assert.deepEqual(unanswered.map((c) => c.id), ['6'])
  assert.deepEqual(rejected, { accessorio: 1, 'altro prodotto': 1 })
  assert.equal(list[0].triage, undefined, 'inputs are not mutated')
  assert.deepEqual(applyTriage(list, null).unanswered.length, 6)
})

test('search: light pre-filter keeps bargains below the window as suspects and leaves accessories to the triage; the channel cap keeps the prices closest to the reference', () => {
  const product = { mustWords: ['s9'], accessoryWords: ['cover', 'pellicola'] }
  const ref = { ...reference, price: 600 }
  const list = [
    cand('1', 'Galaxy Tab S9+ 256GB', 500),
    cand('2', 'Cover Galaxy Tab S9+', 200),
    cand('3', 'iPad Air 5', 400),
    cand('4', 'Galaxy Tab S9+ 256GB occasione', 100),
    cand('5', 'Galaxy Tab S9+ 256GB', 900),
    cand('6', 'Galaxy Tab S9 venduto', 300, { sold: true }),
    cand('7', 'Galaxy Tab S9 senza foto', 50, { photo: null }),
    cand('8', 'Galaxy Tab S9 ritiro', 300, { shipping: { available: false } }),
  ]
  const light = prefilter(list, product, ref, { window: priceWindow(600), mode: 'light' })
  assert.deepEqual(light.kept.map((c) => c.id), ['1', '3', '2', '4'], 'closest to 600 € first, the suspect last')
  assert.equal(light.suspects, 1)
  assert.equal(light.kept.find((c) => c.id === '4').suspect, true)
  assert.equal(light.kept.find((c) => c.id === '1').suspect, undefined)
  assert.equal(list[3].suspect, undefined, 'inputs are not mutated')
  assert.deepEqual(light.dropped, { 'fuori fascia di prezzo': 1, 'venduto o riservato': 1, 'senza foto': 1, 'senza spedizione': 1 })
  // the cap keeps the prices nearest the reference, not the cheapest
  const many = Array.from({ length: 10 }, (_, i) => cand(`m${i}`, 'Galaxy Tab S9', 100 + i * 100))
  const capped = prefilter(many, product, ref, { perChannel: 3, mode: 'light' })
  assert.deepEqual(capped.kept.map((c) => c.price), [600, 500, 700])
  assert.equal(capped.dropped['oltre il limite per canale'], 7)
  // default mode is unchanged and reports no suspects
  const strict = prefilter(list, product, ref, { window: priceWindow(600) })
  assert.deepEqual(strict.kept.map((c) => c.id), ['1'])
  assert.equal(strict.suspects, 0)
  assert.equal(strict.dropped['fuori fascia di prezzo'], 3, 'the window is checked before the photo: 100 €, 900 € and the photo-less 50 €')
})

test('search: attribute check reads capacity (GB/TB, RAM ignored), size (same scale only) and model number from the titles, without false positives on spacing', () => {
  assert.deepEqual(attributeConflict('Samsung Galaxy Tab S9+ 256GB', 'Samsung Galaxy Tab S9+ 128GB'), { capacity: ['256GB', '128GB'], size: null, model: null })
  assert.deepEqual(attributeConflict('MacBook Pro 1TB', 'MacBook Pro 512 GB'), { capacity: ['1TB', '512GB'], size: null, model: null })
  assert.equal(attributeConflict('iPhone 13 128GB', 'iPhone 13 128 GB'), null)
  assert.equal(attributeConflict('Galaxy Tab S9 8GB RAM 256GB', 'Galaxy Tab S9 12GB RAM 256GB'), null, 'RAM is not storage')
  assert.equal(attributeConflict('Galaxy Tab S9 RAM 8GB 256GB', 'Galaxy Tab S9 12 GB di RAM 256GB'), null)
  assert.deepEqual(attributeConflict('Galaxy Tab S9 8/256GB', 'Galaxy Tab S9 8/128GB').capacity, ['256GB', '128GB'])
  assert.deepEqual(attributeConflict('Nike Air Max 90 tg 42', 'Nike Air Max 90 EU 43').size, ['42', '43'])
  assert.deepEqual(attributeConflict('Felpa Nike taglia M', 'Felpa Nike L').size, ['M', 'L'])
  assert.deepEqual(attributeConflict('Scarpe Nike tg 42,5', 'Scarpe Nike tg 42').size, ['42.5', '42'])
  assert.equal(attributeConflict('Scarpe EU 42', 'Scarpe US 9'), null, 'different scales are not compared')
  assert.equal(attributeConflict('Felpa Nike M', 'Felpa Nike'), null, 'one size only: nothing to compare')
  assert.deepEqual(attributeConflict('iPhone 13 128GB', 'iPhone 14 128GB'), { capacity: null, size: null, model: ['13', '14'] })
  assert.deepEqual(attributeConflict('Galaxy Tab S9+ 256GB', 'Galaxy Tab S8+ 256GB').model, ['S9', 'S8'])
  assert.deepEqual(attributeConflict("Levi's 501 W32", "Levi's 505 W32").model, ['501', '505'])
  assert.equal(attributeConflict('Apple iPhone 13', 'iPhone 14'), null, 'no shared first token: too risky')
  assert.equal(attributeConflict('iPhone 13 Pro 128GB', 'iPhone 13 128GB'), null, 'Pro is left to the model')
  assert.equal(attributeConflict('iPhone 13 anno 2022', 'iPhone 13 anno 2023'), null, 'year of purchase is not a model')
  assert.equal(attributeConflict('iPhone 13 128GB', 'iPhone 13 256GB').model, null)
  assert.equal(attributeConflict('', 'iPhone 13'), null)
})

test('channels: condition grades span the vocabularies of the three channels and English labels; Wallapop has its own middle', () => {
  for (const [label, grade] of [['Nuovo con cartellino', 0], ['Nuovo senza cartellino', 1], ['Ottime condizioni', 2], ['Buone condizioni', 3], ['Discrete condizioni', 4], ['Soddisfacenti', 4]]) assert.equal(conditionGrade(label, 'vinted'), grade, label)
  for (const [label, grade] of [['Nuovo', 0], ['Come nuovo', 1], ['Ottimo', 2], ['Buono', 3], ['Danneggiato', 4]]) assert.equal(conditionGrade(label, 'subito'), grade, label)
  for (const [label, grade] of [['Nuovo', 0], ['Come nuovo', 1], ['Buono', 2], ['Discreto', 3], ['Usurato', 4]]) assert.equal(conditionGrade(label, 'wallapop'), grade, label)
  for (const [label, grade] of [['New with tags', 0], ['new', 0], ['Like new', 1], ['Very good', 2], ['Good', 3], ['Satisfactory', 4], ['BUONE CONDIZIONI', 3], ['buono ', 3]]) assert.equal(conditionGrade(label), grade, label)
  assert.equal(conditionGrade(''), null)
  assert.equal(conditionGrade(null), null)
  assert.equal(conditionGrade('mai visto'), null)
  assert.deepEqual(Object.keys(CONDITION_PENALTY_PCT).sort(), ['collectible', 'electronics', 'fast_fashion', 'kids', 'luxury', 'other', 'sneakers'])
})

test('search: ranking with the reference turns a "same" with a capacity conflict into a functional variant (alternatives), keeps cosmetic variants in the main list, and stays compatible with positional calls', () => {
  const now = new Date('2026-10-12T10:00:00Z')
  const ref = { ...reference, title: 'Samsung Galaxy Tab S9+ 256GB', condition: 'Ottime condizioni' }
  const results = [
    { candidate: cand('a', 'Samsung Galaxy Tab S9+ 256GB', 500, { condition: 'Ottimo' }), verdict: 'same', family: false, confidence: 0.9, redFlags: [], reason: '' },
    { candidate: cand('b', 'Samsung Galaxy Tab S9+ 128GB', 450, { condition: 'Ottimo' }), verdict: 'same', family: false, confidence: 0.9, redFlags: [], reason: '', differences: [] },
    { candidate: cand('c', 'Samsung Galaxy Tab S9+ 256GB grigio', 480, { condition: 'Ottimo' }), verdict: 'variant', family: false, confidence: 0.9, redFlags: [], reason: 'colore', differences: ['colore grigio'] },
    { candidate: cand('d', 'Samsung Galaxy Tab S8+ 256GB', 400, { condition: 'Ottimo' }), verdict: 'variant', family: false, confidence: 0.9, redFlags: [], reason: '' },
  ]
  const { main, alternatives, suspects } = rankResults(results, now, { reference: ref })
  assert.deepEqual(main.map((r) => r.candidate.id), ['c', 'a'])
  assert.deepEqual(alternatives.map((r) => r.candidate.id).sort(), ['b', 'd'])
  assert.deepEqual(suspects, [])
  const a = main.find((r) => r.candidate.id === 'a')
  assert.deepEqual([a.verdict, a.variantKind, a.conflict], ['same', null, null])
  const c = main.find((r) => r.candidate.id === 'c')
  assert.deepEqual([c.verdict, c.variantKind, c.differences], ['variant', 'cosmetic', ['colore grigio']])
  const b = alternatives.find((r) => r.candidate.id === 'b')
  assert.deepEqual([b.verdict, b.variantKind], ['variant', 'functional'])
  assert.deepEqual(b.conflict, { capacity: ['256GB', '128GB'], size: null, model: null })
  assert.deepEqual(b.differences, ['capacità 128GB invece di 256GB'])
  assert.ok(b.risks.includes('variante: controlla la differenza'))
  const d = alternatives.find((r) => r.candidate.id === 'd')
  assert.deepEqual([d.variantKind, d.differences], ['functional', ['modello S8 invece di S9']])
  // same condition on both sides: no correction, value = expected total
  assert.equal(a.conditionDeltaPct, 0)
  assert.equal(a.valueTotal, a.expectedTotal)
  assert.equal(a.conditionGrade, 2)
  // the old positional call: no reference, so no attribute check and no condition correction
  const old = rankResults(results, now)
  assert.deepEqual(old.main.map((r) => r.candidate.id).sort(), ['a', 'b', 'c', 'd'])
  assert.deepEqual(old.alternatives, [])
  assert.deepEqual(old.suspects, [])
  assert.deepEqual([old.main[0].conditionDeltaPct, old.main[0].conflict, old.main[0].tier, old.main[0].dealIndex], [null, null, null, null])
  assert.equal(old.main[0].valueTotal, old.main[0].expectedTotal)
})

test('search: declared condition corrects the value (worse = +pct per grade by category, better = at most −5%) and is named among the risks', () => {
  const now = new Date('2026-10-12T10:00:00Z')
  const ref = { ...reference, title: 'Samsung Galaxy Tab S9+ 256GB', condition: 'Ottime condizioni' }
  const row = (condition, opts) => rankResults([{ candidate: cand('x', 'Samsung Galaxy Tab S9+ 256GB', 500, { condition }), verdict: 'same', family: false, confidence: 0.9, redFlags: [], reason: '' }], now, { reference: ref, ...opts }).main[0]
  const same = row('Ottimo')
  const worse = row('Buono')
  const bad = row('Danneggiato')
  const better = row('Nuovo')
  const unknown = row(null)
  assert.equal(worse.conditionDeltaPct, CONDITION_PENALTY_PCT.electronics, 'a Samsung tablet is electronics (guessed from the reference)')
  assert.equal(worse.valueTotal, Math.round(worse.expectedTotal * 1.06 * 100) / 100)
  assert.ok(worse.score > same.score && bad.score > worse.score)
  assert.equal(bad.conditionDeltaPct, 2 * CONDITION_PENALTY_PCT.electronics)
  assert.ok(worse.risks.includes('condizioni peggiori (Buono vs Ottime condizioni)'))
  assert.ok(!same.risks.some((r) => r.startsWith('condizioni')))
  assert.equal(better.conditionDeltaPct, -5, 'two grades better: −6 capped at −5')
  assert.ok(better.valueTotal < better.expectedTotal && better.score < same.score)
  assert.ok(!better.risks.some((r) => r.startsWith('condizioni')))
  assert.equal(unknown.conditionDeltaPct, null)
  assert.equal(unknown.valueTotal, unknown.expectedTotal)
  // the category id of the card or the reference wins over the guess; an unknown reference condition disables the correction
  assert.equal(row('Buono', { product: { categoryId: 'luxury' } }).conditionDeltaPct, 10)
  assert.equal(row('Buono', { reference: { ...ref, category: 'sneakers' } }).conditionDeltaPct, 8)
  assert.equal(row('Buono', { reference: { ...ref, condition: null } }).conditionDeltaPct, null)
  // Wallapop's «Buono» is its middle grade (2), one step below «Ottime condizioni»... no: equal, so no penalty
  const w = withCosts({ source: 'wallapop', id: 'w', title: 'Samsung Galaxy Tab S9+ 256GB', price: 500, condition: 'Buono', photo: 'x', shipping: { available: true } })
  assert.equal(rankResults([{ candidate: w, verdict: 'same', family: false, confidence: 0.9, redFlags: [], reason: '' }], now, { reference: ref }).main[0].conditionDeltaPct, 0)
})

test('search: alternatives carry the family tier and a deal index against the typical price of that tier, and are sorted by it (unknown last); suspects are listed apart', () => {
  const now = new Date('2026-10-12T10:00:00Z')
  const ref = { ...reference, title: 'Samsung Galaxy Tab S9+ 256GB', price: 600 }
  const product = cleanProduct({ name: 'Samsung Galaxy Tab S9+', family: [{ name: 'Galaxy Tab S9 FE', tier: 'lower', priceRatio: 0.5 }, { name: 'Galaxy Tab S9 Ultra', tier: 'higher', priceRatio: 1.5 }, 'Galaxy Tab S9'] }, ref)
  assert.deepEqual(tierFor({ title: 'Samsung Galaxy Tab S9 FE 128GB wifi' }, product), { name: 'Galaxy Tab S9 FE', tier: 'lower', priceRatio: 0.5 })
  assert.deepEqual(tierFor({ title: 'Tab S9 Ultra 512GB' }, product), { name: 'Galaxy Tab S9 Ultra', tier: 'higher', priceRatio: 1.5 })
  assert.deepEqual(tierFor({ title: 'Galaxy Tab S9 256GB' }, product), { name: 'Galaxy Tab S9', tier: 'same', priceRatio: 1 }, 'the tightest match wins over the FE and Ultra entries')
  assert.equal(tierFor({ title: 'Galaxy Tab S7' }, product), null, 'the model number must be there, two words out of three are not enough')
  assert.equal(tierFor({ title: 'Galaxy Tab S9' }, null), null)
  const alt = (id, title, price, extra) => ({ candidate: cand(id, title, price, extra), verdict: 'different', family: true, confidence: 0.9, redFlags: [], reason: '' })
  const results = [
    alt('fe', 'Galaxy Tab S9 FE 128GB', 290),
    alt('ultra', 'Galaxy Tab S9 Ultra 256GB', 700),
    alt('s9', 'Galaxy Tab S9 256GB', 540),
    alt('s7', 'Galaxy Tab S7 128GB', 200),
    { candidate: cand('cheap', 'Samsung Galaxy Tab S9+ 256GB', 120, { suspect: true }), verdict: 'same', family: false, confidence: 0.9, redFlags: [], reason: '' },
    { candidate: cand('cheapfe', 'Galaxy Tab S9 FE 128GB', 60, { suspect: true }), verdict: 'different', family: true, confidence: 0.9, redFlags: [], reason: '' },
  ]
  const { main, alternatives, suspects } = rankResults(results, now, { reference: ref, product })
  assert.deepEqual(main, [])
  assert.deepEqual(alternatives.map((r) => r.candidate.id).slice(-1), ['s7'], 'no tier → no deal index → last')
  const indexed = alternatives.slice(0, 3)
  for (let i = 1; i < indexed.length; i++) assert.ok(indexed[i - 1].dealIndex <= indexed[i].dealIndex, 'sorted by deal index')
  const fe = alternatives.find((r) => r.candidate.id === 'fe')
  assert.equal(fe.tier.tier, 'lower')
  assert.equal(fe.dealIndex, Math.round(fe.valueTotal / (600 * 0.5) * 1000) / 1000)
  const ultra = alternatives.find((r) => r.candidate.id === 'ultra')
  assert.equal(ultra.dealIndex, Math.round(ultra.valueTotal / 900 * 1000) / 1000)
  assert.ok(ultra.dealIndex < fe.dealIndex, 'the Ultra at 700 € is the better deal for its tier')
  const s7 = alternatives.find((r) => r.candidate.id === 's7')
  assert.deepEqual([s7.tier, s7.dealIndex], [null, null])
  // suspects, from either group, are set apart with the warning first
  assert.deepEqual(suspects.map((r) => r.candidate.id), ['cheapfe', 'cheap'])
  for (const s of suspects) assert.equal(s.risks[0], 'prezzo molto sotto il mercato: verifica')
  assert.deepEqual(suspects.map((r) => r.group), ['alternative', 'main'])
  // without a reference price there is no deal index, and the alternatives fall back to the score order
  const noPrice = rankResults(results.slice(0, 4), now, { reference: { ...ref, price: null }, product }).alternatives
  assert.ok(noPrice.every((r) => r.dealIndex == null))
  for (let i = 1; i < noPrice.length; i++) assert.ok(noPrice[i - 1].score <= noPrice[i].score)
})

test('search: offer curve from the channel floor to the asking price, with totals and a probability that never falls as the price rises', () => {
  const now = new Date('2026-10-12T10:00:00Z')
  const v = withCosts({ source: 'vinted', id: 'v', title: 'Galaxy Tab S9+', price: 520, buyerFee: 26.7, photo: 'x', shipping: {} })
  const curve = offerCurveFor(v, now)
  assert.equal(curve.id, 'vinted:v')
  assert.equal(curve.label, 'Galaxy Tab S9+')
  assert.equal(curve.points.length, 7, 'six steps = seven points, floor and asking price included')
  assert.equal(curve.points[0].price, 312)
  assert.deepEqual(curve.points[6], { price: 520, total: 550.2, probability: 1 })
  for (const p of curve.points) {
    assert.ok(p.probability > 0 && p.probability <= 1)
    assert.equal(p.total, Math.round((p.price + buyerFee('vinted', p.price).amount + CHANNELS.vinted.shippingEstimate) * 100) / 100)
  }
  for (let i = 1; i < curve.points.length; i++) {
    assert.ok(curve.points[i].price > curve.points[i - 1].price)
    assert.ok(curve.points[i].probability >= curve.points[i - 1].probability, 'a higher price is never less likely to be accepted')
  }
  assert.equal(offerCurveFor(v, now, { steps: 3 }).points.length, 4)
  // the engine's probability at a given price; none at the asking price (no offer needed) or under Vinted's cap
  assert.ok(Math.abs(probabilityAt(v, 416, now) - curve.points[3].probability) < 1e-9)
  assert.equal(probabilityAt(v, 520, now), null)
  assert.equal(probabilityAt(v, 100, now), null)
  assert.equal(probabilityAt(v, NaN, now), null)
  // Wallapop PRO seller or refurbished item: no offers, a single point at the asking price
  const pro = withCosts({ source: 'wallapop', id: 'w', title: 'x', price: 500, sellerBusiness: true, photo: 'x', shipping: { available: true } })
  assert.deepEqual(offerCurveFor(pro, now).points.map((p) => [p.price, p.probability]), [[500, 1]])
  // Subito has no floor: the points the engine cannot price (over 40% off) are left out, the rest stay in order
  const s = cand('s', 'x', 300)
  const sub = offerCurveFor(s, now).points
  assert.ok(sub.length >= 2 && sub.length <= 7)
  assert.ok(sub.every((p, i) => i === 0 || p.price > sub[i - 1].price))
  assert.equal(sub[sub.length - 1].price, 300)
  assert.deepEqual(offerCurveFor({ source: 'subito', id: 'n', title: 'x', price: null }, now).points, [])
})

test('search: family entries of the product card may be names or { name, tier, priceRatio } objects; the ratio is clamped and the list capped at four', () => {
  const card = cleanProduct({
    name: 'Samsung Galaxy Tab S9+',
    family: ['Galaxy Tab S9', { name: 'Galaxy Tab S9 FE+', tier: 'lower', priceRatio: 0.05 }, { name: 'Galaxy Tab S9 Ultra', tier: 'higher', priceRatio: 9 }, { name: '  ', tier: 'same', priceRatio: 1 }, { name: 'Galaxy Tab A9', tier: 'weird', priceRatio: 'x' }, { name: 'Galaxy Tab S8', tier: 'same', priceRatio: 1 }],
  }, reference)
  assert.deepEqual(card.family, [
    { name: 'Galaxy Tab S9', tier: 'same', priceRatio: 1 },
    { name: 'Galaxy Tab S9 FE+', tier: 'lower', priceRatio: 0.2 },
    { name: 'Galaxy Tab S9 Ultra', tier: 'higher', priceRatio: 3 },
    { name: 'Galaxy Tab A9', tier: 'same', priceRatio: 1 },
  ])
  assert.deepEqual(cleanProduct({ name: 'x', family: 'not a list' }, reference).family, [])
  assert.deepEqual(fallbackProduct(reference).family, [])
  // the schema asks the model for objects
  assert.equal(readModelJson(JSON.stringify({ name: 'x', brand: '', model: '', attributes: [], category: '', query: 'x', mustWords: [], accessoryWords: [], family: [{ name: 'Galaxy Tab S9', tier: 'same', priceRatio: 1 }] }), PRODUCT_SCHEMA).ok, true)
  assert.equal(readModelJson(JSON.stringify({ name: 'x', brand: '', model: '', attributes: [], category: '', query: 'x', mustWords: [], accessoryWords: [], family: ['Galaxy Tab S9'] }), PRODUCT_SCHEMA).ok, false)
  assert.match(productPrompt(reference).system, /family: .*tier \(lower = inferiore, same = pari, higher = superiore.*priceRatio/)
})
