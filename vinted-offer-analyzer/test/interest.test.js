import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  INTEREST, aiReferenceOf, buyPriceFor, cleanInterestCards, comparablesOf, interestPrompt, interestScore, learnFromVote, marketReferenceOf, pertinenceOf,
  rankByInterest, requiredMarginFor,
} from '../src/core/index.js'

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
  assert.deepEqual([cards['12'].category, cards['12'].pieces, cards['12'].weightKg, cards['11'].weightKg, cards['12'].newPrice, cards['12'].confidence, cards['12'].match, cards['12'].defects], ['altro', 1, 0, 0.8, 0, 0.3, null, ['graffi']])
  assert.deepEqual(cleanInterestCards(null, items), {})
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
