import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  INTEREST, aiReferenceOf, buyPriceFor, calibrationOf, cleanInterestCards, comparablesOf, interestPrompt, interestScore, learnFromVote, listingFactsOf, lookupCouldMatter,
  lookupWorthOf, lotOf, marketReferenceOf, parseVintedItemHtml, pertinenceOf, rankByInterest, referenceAmong, requiredMarginFor, seriesPiecesOf,
} from '../src/core/index.js'
import { readFileSync } from 'node:fs'

const card = (category, extra = {}) => ({ category, kind: '', brand: '', model: '', variant: '', query: '', words: [], defects: [], pieces: 1, weightKg: 0, newPrice: 0, usedLow: 0, usedHigh: 0, confidence: 0.8, risks: [], match: null, ...extra })
const market = (value) => ({ value, median: value * 1.15, n: 12, source: 'market' })
const find = (price, extra = {}) => ({ id: '1', title: 'Articolo', condition: 'Ottime', price, favourites: null, ...extra })

// The user's ten choices of 17 November 2026: «a quale prezzo d'annuncio lo compreresti per rivenderlo?»
const CHOICES = [
  ['Samsung Galaxy S25 Ultra 256 GB', 'telefoni', 590, 405, 0.5],
  ['Nintendo Switch OLED', 'console_giochi', 200, 130, 1.5],
  ['Sony WH-1000XM5', 'audio', 150, 100, 0.8],
  ['Kindle Paperwhite 11', 'tablet_ereader_wearable', 70, 40, 0.4],
  ['Chainsaw Man 1–11', 'fumetti_manga', 34, 19, 2],
  ['Harry Potter cofanetto', 'libri', 65, 34, 4.5],
  ['adidas Samba OG', 'sneakers', 48, 25, 1.2],
  ['The North Face Nuptse', 'abbigliamento', 150, 85, 1.5],
  ['Garmin Forerunner 255', 'sport', 150, 90, 0.3],
  ['LEGO 75257 Millennium Falcon', 'lego_collezionismo', 100, 62, 3],
]

test('interest: at the price the user chose every one of his ten articles is «da comprare»', () => {
  for (const [name, category, resale, chosen, kg] of CHOICES) {
    const s = interestScore(find(chosen), { card: card(category, { weightKg: kg }), ref: market(resale) })
    assert.ok(s.total >= 70 && s.total < 85, `${name} at ${chosen}: ${s.total}`)
    assert.equal(s.label, 'da comprare', name)
    assert.equal(s.provisional, false)
    assert.ok(s.margin.profit >= INTEREST.MIN_PROFIT, name)
    // his price and the engine's buying price are the same within a few euro (the shipping differs a little)
    assert.ok(Math.abs(s.target.buy - chosen) <= Math.max(3, chosen * 0.05), `${name}: buy ${s.target.buy} vs ${chosen}`)
  }
})

test('interest: a little above his price it is «da trattare» with the offer that makes it a buy; at break-even it is «lascia»', () => {
  for (const [name, category, resale, chosen, kg] of CHOICES) {
    const above = interestScore(find(Math.round(chosen * 1.15)), { card: card(category, { weightKg: kg }), ref: market(resale) })
    assert.equal(above.label, 'da trattare', `${name}: ${above.total}`)
    assert.ok(above.reasons.some((r) => /Con un'offerta a/.test(r)), name)
    const even = interestScore(find(Math.floor((resale - 0.7 - above.shipping) / 1.05)), { card: card(category, { weightKg: kg }), ref: market(resale) })
    assert.equal(even.label, 'lascia', `${name}: ${even.total}`)
  }
})

test('interest: well under his price, with hearts and a tag still on, it is an «affare»', () => {
  for (const [name, category, resale, chosen, kg] of CHOICES) {
    const s = interestScore(find(Math.round(chosen * 0.8), { condition: 'Nuovo con cartellino', favourites: 14 }), { card: card(category, { weightKg: kg }), ref: market(resale) })
    assert.ok(s.total >= 85, `${name}: ${s.total}`)
    assert.equal(s.label, 'affare')
  }
})

test('interest: the margin asked is 27% where the resale is sure and 35% elsewhere', () => {
  assert.deepEqual(['telefoni', 'console_giochi', 'audio', 'lego_collezionismo', 'fumetti_manga'].map(requiredMarginFor), [27, 27, 27, 27, 27])
  assert.deepEqual(['libri', 'sneakers', 'abbigliamento', 'sport', 'tablet_ereader_wearable', 'altro'].map(requiredMarginFor), [35, 35, 35, 35, 35, 35])
  assert.equal(buyPriceFor(590, 5, 27), 404.5)
  assert.equal(buyPriceFor(7.5, 3, 35), null)
})

test('interest: a value only the AI estimated makes the score provisional, no value stops it at 55, a broken article at 40', () => {
  const good = find(80, { condition: 'Nuovo con cartellino', favourites: 30 })
  const ai = aiReferenceOf(card('audio', { usedLow: 170, usedHigh: 200 }))
  assert.deepEqual(ai, { value: 153, median: 185, n: 0, source: 'ai' })
  const provisional = interestScore(good, { card: card('audio'), ref: ai })
  assert.deepEqual([provisional.total, provisional.provisional, provisional.label], [70, true, 'da comprare'])
  assert.ok(provisional.reasons[0].includes('stima dell\'AI'))
  const unknown = interestScore(good, { card: card('audio'), ref: null })
  assert.ok(unknown.total <= 55 && unknown.provisional)
  const lost = interestScore(good, { card: card('altro', { risks: ['non_identificato'] }), ref: ai })
  assert.ok(lost.total <= 55)
  const broken = interestScore(find(40, { title: 'Sony WH-1000XM5 non funziona' }), { card: card('audio'), ref: market(150) })
  assert.ok(broken.total <= 40 && broken.reasons.some((r) => /difettoso/.test(r)))
  assert.equal(aiReferenceOf(card('audio')), null)
})

test('interest: an article too cheap to leave a margin alone says so; a fake-prone one loses points', () => {
  const book = interestScore(find(5, { favourites: 29 }), { card: card('libri'), ref: market(7.5) })
  assert.equal(book.label, 'lascia')
  assert.ok(book.reasons.some((r) => /vale in lotto/.test(r)))
  const plain = interestScore(find(85), { card: card('abbigliamento'), ref: market(150) })
  const fake = interestScore(find(85), { card: card('abbigliamento', { risks: ['falso'] }), ref: market(150) })
  assert.equal(plain.total - fake.total, 12)
  assert.ok(fake.reasons.some((r) => /originale/.test(r)))
})

test('interest: in a hunt the match with what is searched replaces the user\'s tastes', () => {
  const same = interestScore(find(100), { card: card('audio'), ref: market(150), match: 'si' })
  const variant = interestScore(find(100), { card: card('audio'), ref: market(150), match: 'variante' })
  const other = interestScore(find(100), { card: card('audio'), ref: market(150), match: 'no' })
  assert.ok(same.total > variant.total && variant.total > other.total)
  assert.ok(other.total <= 40)
  assert.deepEqual([same.parts.pertinenza, variant.parts.pertinenza, other.parts.pertinenza], [1, 0.6, 0.1])
})

test('interest: the user\'s kind — categories, words, sizes, thumbs', () => {
  const f = { id: '1', title: 'Persepolis edizione integrale', brand: '', size: null, price: 8 }
  assert.equal(pertinenceOf(f, card('fumetti_manga'), null), 0.7)
  assert.equal(pertinenceOf(f, card('fumetti_manga'), { categories: ['fumetti_manga', 'libri'] }), 0.85)
  assert.equal(pertinenceOf(f, card('fumetti_manga'), { categories: ['telefoni'] }), 0.45)
  assert.equal(pertinenceOf(f, card('fumetti_manga'), { categories: ['fumetti_manga'], words: ['Persepolis', 'zerocalcare'] }), 1)
  assert.equal(pertinenceOf({ ...f, vote: -1 }, card('fumetti_manga'), { categories: ['fumetti_manga'] }), 0.1)
  assert.equal(pertinenceOf({ ...f, vote: 1 }, card('telefoni'), { categories: ['libri'] }), 1)
  const shoe = { id: '2', title: 'adidas Samba OG', brand: 'adidas', size: '42', price: 30 }
  assert.ok(Math.abs(pertinenceOf(shoe, card('sneakers'), { sizes: ['42', '43'] }) - 0.75) < 1e-9)
  assert.ok(Math.abs(pertinenceOf(shoe, card('sneakers'), { sizes: ['38'] }) - 0.6) < 1e-9)
  let likes = learnFromVote({}, shoe, card('sneakers', { brand: 'adidas' }), 1)
  likes = learnFromVote(likes, shoe, card('sneakers', { brand: 'adidas' }), 1)
  assert.deepEqual(likes, { 'brand:adidas': 2, 'cat:sneakers': 2 })
  assert.ok(pertinenceOf(shoe, card('sneakers', { brand: 'adidas' }), { likes }) > 0.7)
  assert.ok(pertinenceOf(shoe, card('sneakers', { brand: 'adidas' }), { likes: { 'brand:adidas': -2 } }) < 0.7)
})

test('interest: the prompt carries titles, conditions and prices, never a contact; the answer is cleaned', () => {
  const items = [{ id: '11', title: 'Sony WH-1000XM5 scrivimi al 3331234567', brand: 'Sony', size: null, condition: 'Ottime', price: 110 }, { id: '12', title: 'Cover S25', brand: '', condition: 'Buone', price: 4 }]
  const prompt = interestPrompt(items, { target: 'sony wh-1000xm5' })
  assert.ok(prompt.text.includes('#11 | Sony WH-1000XM5') && prompt.text.includes('110 €') && prompt.text.includes('L\'utente cerca: «sony wh-1000xm5»'))
  assert.ok(!prompt.text.includes('3331234567'))
  assert.equal(prompt.schemaName, 'schede_interesse')
  const cards = cleanInterestCards({ items: [
    { id: '#11', categoria: 'audio', tipo: 'cuffie over-ear', marca: 'Sony', modello: 'WH-1000XM5', variante: '', cerca: 'sony wh-1000xm5', parole: ['1000XM5', 'x', 'y', 'z'], difetti: [], pezzi: 1, peso_kg: 0.8, nuovo: 230, usato_min: 180, usato_max: 140, fiducia: 1.4, rischi: ['falso', 'inventato'], corrisponde: 'si' },
    { id: '12', categoria: 'boh', tipo: 'cover', marca: '', modello: '', variante: '', cerca: '', parole: [], difetti: ['graffi'], pezzi: 0, peso_kg: -2, nuovo: -3, usato_min: 0, usato_max: 0, fiducia: 'alta', rischi: ['ricambio_accessorio'], corrisponde: 'forse' },
    { id: '99', categoria: 'audio' }, { id: '11', categoria: 'libri' },
  ] }, items)
  assert.deepEqual(Object.keys(cards), ['11', '12'])
  assert.deepEqual([cards['11'].category, cards['11'].words, cards['11'].usedLow, cards['11'].usedHigh, cards['11'].confidence, cards['11'].risks, cards['11'].match], ['audio', ['1000xm5', 'x', 'y'], 140, 180, 1, ['falso'], 'si'])
  assert.deepEqual([cards['12'].category, cards['12'].pieces, cards['12'].weightKg, cards['11'].weightKg, cards['12'].newPrice, cards['12'].confidence, cards['12'].match, cards['12'].defects], ['altro', 1, 0, 0.8, 0, 0.85, null, ['graffi']])
  assert.deepEqual(cleanInterestCards(null, items), {})
  // what a model gets wrong in a long answer is forgiven, card by card
  const loose = cleanInterestCards({ items: [
    { id: 11, categoria: 'audio', parole: '1000xm5, sony', nuovo: '230,00 €', usato_min: '150', usato_max: '1.180', fiducia: 'alta', pezzi: '2', peso_kg: '0,8', rischi: 'falso', corrisponde: 'Sì' },
    { id: '12', fiducia: 85 },
  ] }, items)
  assert.deepEqual([loose['11'].words, loose['11'].newPrice, loose['11'].usedLow, loose['11'].usedHigh, loose['11'].confidence, loose['11'].pieces, loose['11'].weightKg, loose['11'].risks, loose['11'].match, loose['11'].kind],
    [['1000xm5', 'sony'], 230, 150, 1180, 0.85, 2, 0.8, ['falso'], 'si', ''])
  assert.deepEqual([loose['12'].category, loose['12'].confidence, loose['12'].words, loose['12'].usedLow], ['altro', 0.85, [], 0])
})

test('interest: the same product among the results of a search, and its lower quartile', () => {
  const c = (id, title, price, condition = 'Ottime') => ({ source: 'vinted', id, title, brand: 'Sony', price, condition })
  const candidates = [
    c('1', 'Sony WH-1000XM5 nere', 150), c('2', 'Cuffie Sony WH1000XM5', 160), c('3', 'Sony wh-1000xm5 come nuove', 170), c('4', 'Sony WH-1000XM5 argento', 180), c('5', 'sony 1000xm5', 145),
    c('6', 'Custodia per Sony WH-1000XM5', 12), c('7', 'Sony WH-1000XM4', 120), c('8', 'Sony WH-1000XM5 non funziona', 40), c('9', 'Sony WH-1000XM5 sigillate', 230, 'Nuovo con cartellino'),
    c('10', 'Sony WH-1000XM5', 155), c('11', 'Lotto 2 cuffie Sony WH-1000XM5', 280),
  ]
  const xm5 = card('audio', { words: ['1000xm5'] })
  const prices = comparablesOf(candidates, xm5, { id: '10', title: 'Sony WH-1000XM5', condition: 'Ottime', band: 'used' })
  assert.deepEqual(prices.sort((a, b) => a - b), [145, 150, 160, 170, 180])
  assert.deepEqual(marketReferenceOf(prices), { value: 150, median: 160, n: 5, source: 'market' })
  assert.equal(marketReferenceOf([10, 20]), null)
  assert.deepEqual(marketReferenceOf([100, 110, 120, 130, 900]), { value: 107.5, median: 115, n: 4, source: 'market' })
  assert.deepEqual(comparablesOf(candidates, card('audio'), { id: '10', title: 'Sony WH-1000XM5' }), [])
})

test('interest: the list — best score first, a sure one before a provisional one', () => {
  const ranked = rankByInterest([
    { id: 'a', score: { total: 70, provisional: true, margin: { profit: 30 } }, lastSeen: 1 }, { id: 'b', score: { total: 88, provisional: false, margin: { profit: 10 } }, lastSeen: 1 },
    { id: 'c', score: { total: 70, provisional: false, margin: { profit: 5 } }, lastSeen: 1 }, { id: 'd', lastSeen: 9 },
  ])
  assert.deepEqual(ranked.map((f) => f.id), ['b', 'c', 'a', 'd'])
})

test('interest: shipping by the weight the card estimates, never under what a valuable article costs to send', () => {
  const ship = (category, weightKg) => interestScore(find(50), { card: card(category, { weightKg }), ref: market(100) }).shipping
  assert.deepEqual([ship('libri', 0.4), ship('libri', 4.5), ship('sport', 20), ship('telefoni', 0.3), ship('console_giochi', 1.5), ship('libri', 0), ship('lego_collezionismo', 0)], [3, 6, 10, 5, 6, 3, 6])
})

/* ───────── lots and prices far from the reference (1.18.2, from the diary of 17 November 2026) ───────── */

const cand = (id, title, price, condition = 'Ottime') => ({ source: 'vinted', id: String(id), title, brand: '', price, condition })

test('interest: how many volumes a title sells', () => {
  const cases = [
    ['Ken il guerriero Deluxe Edition 1-4', 4], ['One Piece 98', 1], ['Naruto vol. 1 2 3', 3], ['Harry Potter 1/7', 7], ['Death Note 12 volumi', 12],
    ['Tex dal 500 al 510', 11], ['Diario di una schiappa 3 e 4', 2], ['Demon Slayer vol.1-23 + fanbook', 23], ['Dragon Ball 1-2-3', 3], ['One Piece 1 – 10', 10],
    ['Topolino n° 3 4 5', 3], ['Lotto 5 libri gialli', 5],
    // not counts: an age, a title made of numbers, a volume and an edition, a year, an ISBN, a volume number before a word
    ['Libro bambini 3-6 anni', 1], ['24/7 il capitalismo', 1], ['Volume 1 edizione 2', 1], ['Il nome della rosa 1980', 1], ['978-88-04-12345 Mondadori', 1],
    ['Naruto 12 manga planet', 1], ["L'estate in cui Hikaru é morto", 1],
    // a lot that does not say how many
    ['Lotto fumetti Dylan Dog', null], ['Berserk serie completa', null],
  ]
  for (const [title, pieces] of cases) assert.equal(seriesPiecesOf(title), pieces, title)
})

test('interest: what kind of lot a find is', () => {
  const manga = card('fumetti_manga')
  assert.deepEqual(lotOf({ title: 'Ken il guerriero Deluxe Edition 1-4' }, manga), { pieces: 4, series: true, comparable: true })
  assert.deepEqual(lotOf({ title: 'One Piece 98' }, manga), { pieces: 1, series: true, comparable: true })
  // the title does not say: what the AI understood
  assert.deepEqual(lotOf({ title: 'Il Signore degli Anelli trilogia' }, card('libri', { pieces: 3 })), { pieces: 3, series: true, comparable: true })
  assert.deepEqual(lotOf({ title: 'Berserk serie completa' }, manga), { pieces: null, series: true, comparable: false })
  assert.deepEqual(lotOf({ title: 'Berserk serie completa' }, card('fumetti_manga', { pieces: 41 })), { pieces: 41, series: true, comparable: true })
  // outside a series a lot is a thing of its own: the AI's estimate of the whole stays
  assert.deepEqual(lotOf({ title: 'Lotto 5 magliette Nike' }, card('abbigliamento', { pieces: 5 })), { pieces: 5, series: false, comparable: false })
  assert.deepEqual(lotOf({ title: 'Stock magliette' }, card('abbigliamento')), { pieces: null, series: false, comparable: false })
  assert.deepEqual(lotOf({ title: 'Sony WH-1000XM5' }, card('audio')), { pieces: 1, series: false, comparable: true })
})

test('interest: «Ken il guerriero Deluxe Edition 1-4» at 130 € is compared volume by volume, not with single volumes', () => {
  const ken = { id: '1', title: 'Ken il guerriero Deluxe Edition 1-4', condition: 'Nuovo con cartellino', price: 130, favourites: 7 }
  const c = card('fumetti_manga', { words: ['ken', 'guerriero', 'deluxe'], query: 'ken il guerriero deluxe edition', pieces: 4, weightKg: 2.5, usedLow: 60, usedHigh: 80 })
  const results = [
    cand(2, 'Ken il guerriero deluxe edition 3', 20), cand(3, 'Ken il Guerriero Deluxe Edition vol. 7', 22), cand(4, 'ken il guerriero deluxe 1', 24), cand(5, 'Ken il guerriero Deluxe 12', 21),
    cand(6, 'Ken il guerriero deluxe edition 1-10', 190), cand(7, 'Ken il guerriero Deluxe 1/6', 108), cand(8, 'Ken il guerriero deluxe serie completa', 300),
    cand(9, 'Ken il guerriero Deluxe 5 e 6', 40), cand(10, 'Ken il guerriero edizione Star Comics 4', 5),
  ]
  // one volume of each listing: 20, 22, 24, 21, 19, 18, (unknown lot left out), 20; «Star Comics» has no «deluxe»
  assert.deepEqual(comparablesOf(results, c, ken).sort((a, b) => a - b), [18, 19, 20, 20, 21, 22, 24])
  const ref = marketReferenceOf(comparablesOf(results, c, ken), { pieces: 4 })
  assert.deepEqual(ref, { value: 78, median: 80, n: 7, source: 'market', unit: 19.5, pieces: 4 })
  const s = interestScore(ken, { card: c, ref })
  assert.equal(s.label, 'lascia')
  assert.match(s.reasons[0], /^Rivendendo a 78 € \(4 pezzi a 19,50 €, da 7 annunci\) perdi /)
  assert.equal(s.unsure, null)
  // a single volume is compared with single volumes only, whatever their number
  const one = { id: '99', title: 'Ken il guerriero Deluxe Edition 2', condition: 'Ottime', price: 15 }
  assert.deepEqual(comparablesOf(results, { ...c, pieces: 1 }, one).sort((a, b) => a - b), [20, 21, 22, 24])
})

test('interest: a lot outside a series, or of unknown size, has no market of its own', () => {
  const shirts = { id: '1', title: 'Lotto 5 magliette Nike', condition: 'Buone', price: 30 }
  const c = card('abbigliamento', { words: ['nike'], pieces: 5 })
  assert.deepEqual(comparablesOf([cand(2, 'Maglietta Nike', 10), cand(3, 'T-shirt Nike', 12), cand(4, 'Nike maglia', 9)], c, shirts), [])
  // a single shirt still leaves the lots out
  assert.deepEqual(comparablesOf([cand(2, 'Maglietta Nike', 10), cand(3, 'Lotto magliette Nike', 40), cand(4, 'Nike maglia', 9)], { ...c, pieces: 1 }, { ...shirts, title: 'Maglietta Nike' }), [10, 9])
})

test('interest: a hunt reads its market from its own results, piece by piece', () => {
  const c = (pieces = 1) => card('fumetti_manga', { pieces, match: 'si' })
  const others = [
    { id: '2', title: 'Chainsaw Man 3', price: 4, card: c() }, { id: '3', title: 'Chainsaw Man 5', price: 4.5, card: c() }, { id: '4', title: 'Chainsaw Man 1-11', price: 38.5, card: c(11) },
    { id: '5', title: 'Chainsaw Man lotto', price: 20, card: c() }, { id: '6', title: 'Chainsaw Man 8', price: 5, card: c() },
  ]
  // a lot of 11: 4, 4.5, 3.5, 5 a volume (the lot of unknown size is left out) → the lower quartile 3.875 × 11
  assert.deepEqual(referenceAmong({ id: '1', title: 'Chainsaw Man 1–11', price: 19 }, c(11), others), { value: 42.63, median: 46.75, n: 4, source: 'market', unit: 3.88, pieces: 11 })
  // a single volume: the singles only
  assert.deepEqual(referenceAmong({ id: '1', title: 'Chainsaw Man 2', price: 3 }, c(), others), { value: 4.25, median: 4.5, n: 3, source: 'market' })
  assert.equal(referenceAmong({ id: '1', title: 'Chainsaw Man lotto', price: 3 }, c(), others), null)
})

test('interest: asked many times what the same thing sells for is «da verificare», not a loss stated as a fact', () => {
  // the diary: «L'estate in cui Hikaru é morto» at 46.80 €, the AI priced one volume (about 8-10 €)
  const hikaru = { id: '1', title: "L'estate in cui Hikaru é morto", condition: 'Ottime', price: 46.8, favourites: 13 }
  const c = card('libri', { usedLow: 8, usedHigh: 10 })
  const s = interestScore(hikaru, { card: c, ref: aiReferenceOf(c) })
  assert.equal(s.unsure, 'prezzo')
  assert.equal(s.label, 'da verificare')
  assert.ok(s.total >= INTEREST.CHECK_MIN && s.total <= INTEREST.UNKNOWN_CAP && INTEREST.UNKNOWN_CAP < 55)
  assert.equal(s.reasons[0], "Chiesto 4,7 volte la stima dell'AI (10 €): forse un lotto o un'edizione particolare, da aprire")
  assert.ok(!s.reasons.some((r) => /perdi|vale in lotto/.test(r)))
  assert.equal(s.margin, null)
  // the same with the market of the single volume read
  const m = interestScore(hikaru, { card: c, ref: { value: 5.5, median: 6, n: 20, source: 'market' } })
  assert.equal(m.reasons[0], "Chiesto 7,8 volte il prezzo di 20 annunci uguali (6 €): forse un lotto o un'edizione particolare, da aprire")
  assert.deepEqual([m.label, m.unsure, m.provisional], ['da verificare', 'prezzo', false])
  // dear, but the same thing: a loss, said as such (the diary's kettlebell at 50 € against 25-30 €)
  const bell = interestScore({ id: '2', title: 'Kettlebel 12 kg', condition: 'Buone', price: 50, favourites: 8 }, { card: card('sport', { usedLow: 25, usedHigh: 30, weightKg: 12 }), ref: aiReferenceOf(card('sport', { usedLow: 25, usedHigh: 30 })) })
  assert.deepEqual([bell.label, bell.unsure], ['lascia', null])
  assert.match(bell.reasons[0], /perdi 40,70 €/)
  // cheap things are never «odd»: a 9 € comic against an estimate of 3 €
  assert.equal(interestScore({ id: '3', title: 'Fumetto', condition: 'Ottime', price: 9 }, { card: card('fumetti_manga', { usedLow: 2, usedHigh: 3 }), ref: aiReferenceOf(card('fumetti_manga', { usedLow: 2, usedHigh: 3 })) }).unsure, null)
})

test('interest: what cannot be judged is never «da trattare»', () => {
  const good = find(80, { condition: 'Nuovo con cartellino', favourites: 60 })
  const none = interestScore(good, { card: card('audio'), ref: null })
  assert.deepEqual([none.label, none.unsure], ['da verificare', 'riferimento'])
  assert.ok(none.total <= 54)
  const lost = interestScore(good, { card: card('altro', { risks: ['non_identificato'] }), ref: market(200) })
  assert.deepEqual([lost.label, lost.unsure], ['da verificare', 'identita'])
  // thumbs down or broken: left, whatever is unknown
  assert.equal(interestScore({ ...good, vote: -1 }, { card: card('audio'), ref: null }).label, 'lascia')
})

test('interest: a resale value too low for any margin says so in the right words', () => {
  const s = interestScore(find(4, { favourites: 29 }), { card: card('libri'), ref: aiReferenceOf(card('libri', { usedLow: 3, usedHigh: 4 })) })
  assert.ok(s.reasons.includes('Si rivende a troppo poco per lasciare un margine da solo: vale in lotto'))
})

test('interest: «12kg» and «12 kg» are the same words', () => {
  const bell = { id: '1', title: 'Kettlebel 12 kg', condition: 'Buone', price: 50 }
  const c = card('sport', { words: ['kettlebell', '12kg'] })
  const results = [cand(2, 'Kettlebell 12kg ghisa', 25), cand(3, 'kettlebell 12 kg', 28), cand(4, 'Kettlebell 12 Kg Domyos', 22), cand(5, 'Kettlebell 8 kg', 15), cand(6, 'Kettlebell 20kg', 40)]
  assert.deepEqual(comparablesOf(results, c, bell), [25, 28, 22])
})

test('interest: which searches of the market come first', () => {
  const worth = (price, favourites, score) => lookupWorthOf({ price, favourites }, score)
  // close to a buy before everything; then a price the estimate does not explain; then hearts and money
  const near = worth(20, 0, { total: 60, unsure: null })
  const odd = worth(46.8, 13, { total: 50, unsure: 'prezzo' })
  const wanted = worth(9, 58, { total: 35, unsure: null })
  const dear = worth(130, 7, { total: 35, unsure: null })
  const plain = worth(4, 0, { total: 35, unsure: null })
  assert.ok(near > odd && odd > wanted && wanted > dear && dear > plain, JSON.stringify([near, odd, wanted, dear, plain].map(Math.round)))
})

/* ───────── the user's own scores and what the list shows (1.19.0, his choices of 18 November 2026) ───────── */

test('interest: the list shows from 55 and tells from 70', () => {
  assert.deepEqual([INTEREST.SHOW_MIN, INTEREST.TELL_MIN], [55, 70])
  // The labels he acts on start where the list starts and where he is told.
  assert.deepEqual(INTEREST.LABELS.map(([min]) => min), [85, 70, 55, 0])
})

test('interest: «da trattare» only when an offer Vinted allows makes it a buy', () => {
  // The diary of 18 November: «Zerocalcare un polpo alla gola» at 6 €, 19 listings alike at 12 €: a buy only at
  // 3 €, half the price, when Vinted lets an offer go down to 60%. It was «da trattare» at 61.
  const polpo = interestScore({ id: '1', title: 'Zerocalcare un polpo alla gola', condition: 'Nuovo senza cartellino', price: 6, favourites: 2 }, { card: card('fumetti_manga', { weightKg: 0.4 }), ref: { value: 12, median: 14, n: 19, source: 'market' } })
  assert.ok(polpo.reasons.some((r) => /sotto il minimo d'offerta/.test(r)))
  assert.ok(polpo.total < INTEREST.SHOW_MIN, String(polpo.total))
  assert.equal(polpo.label, 'lascia')
  // A resale value too low for any buying price: the same.
  const cheap = interestScore(find(3, { condition: 'Nuovo con cartellino', favourites: 50 }), { card: card('libri'), ref: market(7) })
  assert.ok(cheap.total < INTEREST.SHOW_MIN && cheap.label === 'lascia')
  // An offer within what Vinted allows keeps it «da trattare» (the same diary: 44 volumes at 60 €, worth 88 €).
  const orfani = interestScore({ id: '2', title: 'Lotto fumetti Orfani (44 volumi)', condition: 'Ottime', price: 60, favourites: 1 }, { card: card('fumetti_manga', { pieces: 44, weightKg: 12 }), ref: { value: 88, median: 110, n: 13, source: 'market', unit: 2, pieces: 44 } })
  assert.equal(orfani.label, 'da trattare')
  assert.ok(orfani.reasons.some((r) => /Con un'offerta a 50,50 € \(−16%\) è da comprare/.test(r)), orfani.reasons.join(' | '))
})

test('interest: what his own scores teach — a third after one, most after five, never more than twelve points', () => {
  assert.deepEqual(calibrationOf([]), { n: 0, global: 0, byCategory: {} })
  assert.deepEqual(calibrationOf(null), { n: 0, global: 0, byCategory: {} })
  const up = (n, category = 'fumetti_manga', by = 7) => Array.from({ length: n }, (_, i) => ({ id: String(i), category, system: 58, user: 58 + by }))
  // one score of +7: its category moves by a third of it, the other categories hardly at all
  assert.deepEqual(calibrationOf(up(1)), { n: 1, global: 0.2, byCategory: { fumetti_manga: 2.3 } })
  // five alike: about 70% for the category, and the others begin to follow
  assert.deepEqual(calibrationOf(up(5)), { n: 5, global: 3.2, byCategory: { fumetti_manga: 5 } })
  // twenty: the category is almost there, and never past the limit however far he goes
  assert.equal(calibrationOf(up(20)).byCategory.fumetti_manga, 6.4)
  assert.equal(calibrationOf(up(20, 'sport', 40)).byCategory.sport, INTEREST.CALIBRATION_MAX)
  assert.equal(calibrationOf(up(20, 'sport', -40)).byCategory.sport, -INTEREST.CALIBRATION_MAX)
  // two categories that say the opposite stay apart, and the rest does not move
  const both = calibrationOf([...up(4, 'fumetti_manga', 8), ...up(4, 'sport', -8)])
  assert.deepEqual(both, { n: 8, global: 0, byCategory: { fumetti_manga: 5.3, sport: -5.3 } })
  // the day's own case: one pair of shoes scored 14 under the engine does not move the headphones
  const shoes = calibrationOf([{ category: 'sneakers', system: 89, user: 75 }])
  assert.deepEqual(shoes, { n: 1, global: -0.5, byCategory: { sneakers: -4.7 } })
  assert.equal(interestScore(find(100), { card: card('audio'), ref: market(150), calibration: shoes }).shift, 0)
  // what is not a pair of scores is left out
  assert.equal(calibrationOf([{ category: 'sport', system: 50 }, { category: 'sport', user: 'x', system: 50 }, null]).n, 0)
})

test('interest: his scores move the scores of the category, within what is known of the price', () => {
  const calibration = { n: 5, global: 2, byCategory: { fumetti_manga: 6 } }
  const manga = { id: '1', title: 'Manga', condition: 'Ottime', price: 60, favourites: 1 }
  const c = card('fumetti_manga', { weightKg: 9 })
  const ref = { value: 88, median: 110, n: 13, source: 'market' }
  const plain = interestScore(manga, { card: c, ref })
  const moved = interestScore(manga, { card: c, ref, calibration })
  assert.deepEqual([moved.total - plain.total, moved.base, moved.shift, moved.rated], [6, plain.total, 6, false])
  // a category he never scored takes what he says of everything
  const other = interestScore(find(100), { card: card('audio'), ref: market(150), calibration })
  assert.equal(other.total - other.base, 2)
  // a value only the AI estimated still stops at 70, what cannot be judged under 55, a thumb down at 40
  const good = find(80, { condition: 'Nuovo con cartellino', favourites: 30 })
  const ai = aiReferenceOf(card('audio', { usedLow: 170, usedHigh: 200 }))
  assert.equal(interestScore(good, { card: card('audio'), ref: ai, calibration: { n: 9, global: 12, byCategory: {} } }).total, 70)
  assert.ok(interestScore(good, { card: card('audio'), ref: null, calibration: { n: 9, global: 12, byCategory: {} } }).total <= INTEREST.UNKNOWN_CAP)
  assert.ok(interestScore({ ...good, vote: -1 }, { card: card('audio'), ref: market(200), calibration: { n: 9, global: 12, byCategory: {} } }).total <= INTEREST.REJECTED_CAP)
})

test('interest: the score he gives to an article is that article\'s score, and says what the engine\'s was', () => {
  const manga = { id: '1', title: 'Manga', condition: 'Ottime', price: 60, favourites: 1 }
  const c = card('fumetti_manga', { weightKg: 9 })
  const ref = { value: 88, median: 110, n: 13, source: 'market' }
  const mine = interestScore(manga, { card: c, ref })
  const his = interestScore({ ...manga, rated: 72 }, { card: c, ref, calibration: { n: 3, global: 5, byCategory: {} } })
  assert.deepEqual([his.total, his.rated, his.label, his.base, his.shift], [72, true, 'da comprare', mine.total, 0])
  assert.equal(his.reasons[0], `Il tuo voto: 72 (il mio era ${mine.total})`)
  // also on what the engine could not judge: his word is his
  const unknown = interestScore({ ...manga, rated: 80 }, { card: c, ref: null })
  assert.deepEqual([unknown.total, unknown.label, unknown.rated], [80, 'da comprare', true])
  assert.equal(interestScore({ ...manga, rated: mine.total }, { card: c, ref }).reasons[0], `Il tuo voto: ${mine.total}, come il mio`)
})

/* ───────── the listing's own page, and the searches worth making (1.20) ───────── */

const itemPage = () => readFileSync(new URL('./fixtures/vinted-item-2026-10.html', import.meta.url), 'utf8')

test('interest: what the page of a listing says is kept without the seller\'s name', () => {
  const facts = listingFactsOf(parseVintedItemHtml(itemPage()))
  assert.deepEqual(facts, {
    price: 22, description: 'Prima edizione grande formato Coconino, 2 volumi', category: 'Libri e media Fumetti, manga e graphic novel',
    ageDays: 21, sellerDays: 0.5833333333333334, reviews: 144, rating: 4.9, business: false, reserved: false, oldPrice: null, says: 'none',
  })
  assert.ok(!JSON.stringify(facts).match(/username|sellerPath|profilo/i))
  // a page that carries no listing (Vinted's check, an error) gives nothing
  assert.equal(listingFactsOf(parseVintedItemHtml('<html><title>Just a moment…</title></html>')), null)
  assert.equal(listingFactsOf(null), null)
  // what the seller wrote about offers is read from title and description
  assert.equal(listingFactsOf({ title: 'Giacca', listPrice: 30, description: 'Prezzo non trattabile, no offerte' }).says, 'fixed_price')
  assert.equal(listingFactsOf({ title: 'Giacca', listPrice: 30, description: 'Svuoto armadio, accetto offerte' }).says, 'clearing_out')
  // contacts written in a description never travel on
  assert.ok(!listingFactsOf({ title: 'Giacca', listPrice: 30, description: 'scrivimi al 3331234567 o a nome@esempio.it' }).description.match(/3331234567|esempio\.it/))
})

test('interest: the description of the page goes to the AI for the second card', () => {
  const facts = listingFactsOf(parseVintedItemHtml(itemPage()))
  const text = interestPrompt([{ id: '9', title: 'Charles Burns, Black Hole', condition: 'Ottime', price: 22, page: facts }, { id: '10', title: 'Altro', condition: 'Buone', price: 5 }]).text
  assert.ok(text.includes('#9 | Charles Burns, Black Hole | marca: n.d. | taglia: n.d. | condizioni: Ottime | 22 € | descrizione: Prima edizione grande formato Coconino, 2 volumi'))
  assert.ok(text.includes('#10 | Altro | marca: n.d. | taglia: n.d. | condizioni: Buone | 5 €\n'))
  assert.ok(interestPrompt([]).system.includes('descrizione scritta dal venditore'))
})

test('interest: the seller, once the page is read — solid, away, a fixed price, open to offers', () => {
  const hole = { id: '9', title: 'Charles Burns, Black Hole', condition: 'Ottime', price: 22, favourites: 4 }
  const c = card('fumetti_manga', { weightKg: 1.5, pieces: 2 })
  const ref = { value: 40, median: 46, n: 9, source: 'market' }
  const page = listingFactsOf(parseVintedItemHtml(itemPage()))
  const unread = interestScore(hole, { card: c, ref })
  assert.deepEqual([unread.read, unread.seller, unread.parts.venditore], [false, null, 0.7])
  // 144 reviews at 4.9, seen today: a solid seller, said so
  const solid = interestScore({ ...hole, page }, { card: c, ref })
  assert.deepEqual([solid.read, solid.seller, solid.parts.venditore, solid.label], [true, 'expert', 1, 'da comprare'])
  assert.ok(solid.total > unread.total && solid.reasons.includes('Venditore solido (144 recensioni)'))
  // not seen for twenty days: he may never ship — not listed, whatever the price
  const away = interestScore({ ...hole, page: { ...page, sellerDays: 20 } }, { card: c, ref })
  assert.deepEqual([away.label, away.seller, away.reasons[1]], ['lascia', 'inactive', 'Venditore assente da 20 giorni: può non spedire'])
  assert.ok(away.total < INTEREST.SHOW_MIN)
  // «prezzo non trattabile» where an offer would be needed: not «da trattare»
  const dear = { ...hole, price: 26 }
  const open = interestScore({ ...dear, page: { ...page, says: 'open_to_offers' } }, { card: c, ref })
  const plain = interestScore({ ...dear, page: { ...page, says: 'none' } }, { card: c, ref })
  const fixed = interestScore({ ...dear, page: { ...page, says: 'fixed_price' } }, { card: c, ref })
  assert.equal(plain.label, 'da trattare')
  assert.ok(open.parts.trattabilita > plain.parts.trattabilita && open.reasons.includes('L\'annuncio invita a fare offerte'))
  assert.deepEqual([fixed.label, fixed.reasons[1]], ['lascia', 'Il venditore scrive che il prezzo non è trattabile'])
  // a fixed price that is already a buy stays a buy
  assert.equal(interestScore({ ...hole, page: { ...page, says: 'fixed_price' } }, { card: c, ref }).label, 'da comprare')
})

test('interest: a search of the market is made only where it could change the verdict', () => {
  const ask = (title, price, favourites, c) => {
    const f = { id: '1', title, condition: 'Ottime', price, favourites }
    return lookupCouldMatter(f, c, interestScore(f, { card: c, ref: aiReferenceOf(c) }))
  }
  const c = (category, usedLow, usedHigh, extra = {}) => card(category, { usedLow, usedHigh, words: ['x'], ...extra })
  // the day's own deal: the AI said 8-15 €, the market 20 €. It must still be searched.
  assert.equal(ask('Chainsaw Man Christmas variant', 10, 3, c('fumetti_manga', 8, 15)), true)
  assert.equal(ask('Zerocalcare un polpo alla gola', 6, 2, c('fumetti_manga', 6, 11)), true)
  assert.equal(ask('Kettlebell 6 kg', 12, 26, c('sport', 8, 14, { weightKg: 6 })), true)
  // a price the estimate does not explain: searched, to know what it is
  assert.equal(ask("L'estate in cui Hikaru é morto", 46.8, 13, c('libri', 8, 10)), true)
  // nothing to gain even at twice the estimate: not searched
  assert.equal(ask('Qualcuno con cui correre', 4, 29, c('libri', 3, 5)), false)
  assert.equal(ask('Kettlebel 12 kg', 50, 8, c('sport', 25, 30, { weightKg: 12 })), false)
  assert.equal(ask('Tappeto imbottito gommato', 15, 0, c('casa', 8, 12, { weightKg: 3 })), false)
  // with no estimate at all: only what is not a trifle
  assert.equal(ask('Fumetto', 4, 0, c('fumetti_manga', 0, 0)), false)
  assert.equal(ask('black Monday', 20, 0, c('fumetti_manga', 0, 0)), true)
  assert.equal(lookupCouldMatter({ id: '1', price: 10 }, null), false)
})

/* ───────── from the diary of «novità» (1.20.1, 18 November 2026) ───────── */

test('interest: a few listings worth much more than the AI thought are not shouted as an «affare»', () => {
  // «Contratto con Dio» at 15 €: six listings at 35 €, the AI (sure of itself) said 8-12 €. It was «affare» at 95.
  const eisner = { id: '1', title: 'libro fumetto Contratto con Dio di Will Eisner', condition: 'Ottime', price: 15, favourites: 56 }
  const c = card('fumetti_manga', { usedLow: 8, usedHigh: 12, weightKg: 0.5, confidence: 0.85 })
  const s = interestScore(eisner, { card: c, ref: { value: 35, median: 38, n: 6, source: 'market' } })
  assert.deepEqual([s.total, s.label, s.disputed, s.provisional], [70, 'da comprare', true, false])
  assert.equal(s.reasons[1], "Solo 6 annunci di confronto, e l'AI stimava 8 €–12 €: controlla che sia la stessa edizione")
  // many listings: the market is believed (the variant of 18 November: the AI said 8-15 €, 42 listings said 20 €)
  const variant = interestScore({ id: '2', title: 'Chainsaw Man Christmas variant', condition: 'Nuovo con cartellino', price: 10, favourites: 3 }, { card: card('fumetti_manga', { usedLow: 8, usedHigh: 15, weightKg: 0.3 }), ref: { value: 20, median: 24, n: 42, source: 'market' } })
  assert.equal(variant.disputed, false)
  assert.ok(variant.total > 70, String(variant.total))
  // few listings that agree with the AI: believed too (three volumes at 280 €, the AI said 150-220 €)
  const trans = interestScore({ id: '3', title: 'Absolute Transmetropolitan Volume 1/2/3', condition: 'Nuovo senza cartellino', price: 150, favourites: 58 }, { card: card('fumetti_manga', { usedLow: 150, usedHigh: 220, pieces: 3, weightKg: 6 }), ref: { value: 280, median: 300, n: 3, source: 'market', unit: 93.34, pieces: 3 } })
  assert.equal(trans.disputed, false)
  assert.ok(trans.total > 70)
  // with no estimate of the AI's there is nothing to dispute
  assert.equal(interestScore(eisner, { card: card('fumetti_manga'), ref: { value: 35, median: 38, n: 6, source: 'market' } }).disputed, false)
})

test('interest: singular and plural are one word when listings are compared', () => {
  const plate = { id: '1', title: 'Disco 5kg', condition: 'Buone', price: 8 }
  const results = [cand(2, 'Dischi ghisa 5 kg Decathlon', 9), cand(3, 'disco in ghisa 5kg', 10), cand(4, 'DISCHI 5 KG coppia', 12), cand(5, 'Disco 10 kg', 20), cand(6, 'Discoteca anni 80 5 kg di vinili', 30)]
  // the diary: «disco», «5 kg» found none of twelve results, all written «dischi»
  assert.deepEqual(comparablesOf(results, card('sport', { words: ['disco', '5 kg'] }), plate), [9, 10, 12])
  assert.deepEqual(comparablesOf([cand(2, 'Maglie termiche Quechua', 8), cand(3, 'maglia termica quechua M', 9), cand(4, 'Maglione Quechua', 15)], card('abbigliamento', { words: ['maglia', 'quechua'] }), { id: '1', title: 'Maglia termica', condition: 'Buone', price: 5 }), [8, 9])
  // a word is found inside another only when digits follow it
  assert.deepEqual(comparablesOf([cand(2, 'Playstation5 slim', 300), cand(3, 'Sambarose adidas', 40)], card('console_giochi', { words: ['playstation'] }), { id: '1', title: 'Playstation 5', condition: 'Ottime', price: 250 }), [300])
  // short words and model names are compared as they are
  assert.deepEqual(comparablesOf([cand(2, 'Samsung S25 Ultra', 500), cand(3, 'Samsung S25', 400)], card('telefoni', { words: ['s25', 'ultra'] }), { id: '1', title: 'S25 Ultra', condition: 'Ottime', price: 450 }), [500])
})

test('interest: the AI is asked for the words that tell a product from its siblings', () => {
  const system = interestPrompt([]).system
  assert.ok(system.includes('quelle che lo distinguono dagli altri della stessa marca o serie'))
  assert.ok(system.includes('mai il tipo di oggetto né il colore'))
  assert.ok(system.includes('["ballata","salato"] e non ["corto","maltese"]'))
  assert.ok(system.includes('senza dire quale volume o modello'))
})

test('a declared defect is said in the reasons and lowers what the market says it sells for (1.20.2)', () => {
  // The diary of 18 November: «Contratto con Dio» at 15 € against listings at 35 €; the description said it was
  // underlined in pen on the first pages, and the score (95) did not.
  const book = find(15, { title: 'Contratto con Dio di Will Eisner', favourites: 56 })
  const many = { value: 35, median: 38, n: 12, source: 'market' }
  const clean = interestScore(book, { card: card('fumetti_manga'), ref: many })
  const marked = interestScore(book, { card: card('fumetti_manga', { defects: ['sottolineature a penna nelle prime pagine'] }), ref: many })
  assert.equal(clean.margin.resale, 35)
  assert.equal(marked.margin.resale, 30.8)
  assert.ok(marked.margin.profit < clean.margin.profit)
  assert.ok(marked.total < clean.total)
  assert.match(marked.reasons[0], /30,80 € \(12 annunci uguali a 35 €, −12% per i difetti\)/)
  assert.equal(marked.reasons[1], 'Difetti dichiarati: sottolineature a penna nelle prime pagine')
  assert.ok(!clean.reasons.some((r) => /Difetti/.test(r)))
  // Never more than DEFECT_CUT_MAX, however many are listed.
  const worn = interestScore(book, { card: card('fumetti_manga', { defects: ['a', 'b', 'c', 'd'] }), ref: many })
  assert.equal(worn.margin.resale, 24.5)
  // The AI's own estimate has read the description already: said, not cut twice.
  const guess = { value: 20, source: 'ai' }
  const guessed = interestScore(book, { card: card('fumetti_manga', { defects: ['macchia in copertina'], usedLow: 18, usedHigh: 25 }), ref: guess })
  assert.equal(guessed.margin.resale, 20)
  assert.ok(guessed.reasons.includes('Difetti dichiarati: macchia in copertina'))
})
