import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { analyzeOffer, categoryGuess, experienceOf, momentFor, planFor, sellerProfileFor, strategyFor, strategySnapshot, wardrobeStats } from '../src/core/index.js'

const HISTORY = JSON.parse(readFileSync(new URL('./fixtures/backup-2026-10.json', import.meta.url), 'utf8'))
const NOW = new Date(2026, 10, 4, 9, 45)
const form = (over = {}) => ({ itemTitle: 'Fumetto', link: 'https://www.vinted.it/items/123-x', category: 'books', listPrice: '10', targetPrice: '8', listingAge: 'today', sellerProfile: 'unknown', listingSignal: 'none', ...over })

test('strategy: never «compra e basta» — a cheap fresh listing gets three real offers', () => {
  const s = strategyFor(form(), NOW, { records: HISTORY, extraction: { uploadedDays: 0.5, sellerLastSeenDays: 0.02, sellerFeedbackCount: 12 } })
  assert.ok(s.ok)
  assert.equal(s.result.kind, 'analysis')
  assert.equal(s.result.gate.kind, 'offer')
  assert.deepEqual(s.options.map((o) => o.id), ['prudente', 'consigliata', 'audace'])
  for (let i = 0; i < s.options.length; i++) {
    const o = s.options[i]
    assert.ok(o.price < 10 && o.price >= 6, `${o.id} ${o.price}`)
    assert.ok(o.probability > 0 && o.probability < 1)
    assert.ok(o.expectedPrice <= 10 && o.expectedPrice >= o.price)
    if (i) assert.ok(o.price < s.options[i - 1].price && o.discountPct > s.options[i - 1].discountPct)
  }
  assert.equal(s.options.filter((o) => o.recommended).length, 1)
  assert.equal(s.moment.kind, 'now')
  // The old engine would have refused: gap under 2 € is «no offer» without the best-price option.
  assert.equal(analyzeOffer(form({ targetPrice: '8,5' }), NOW).kind, 'no_offer_needed')
  assert.equal(analyzeOffer(form({ targetPrice: '8,5' }), NOW, { bestPrice: true }).kind, 'analysis')
})

test('strategy: the old gate rules become advice, only reserved or holiday still stop the offer', () => {
  const fixed = analyzeOffer(form({ listPrice: '30', targetPrice: '25', listingSignal: 'fixed_price' }), NOW, { bestPrice: true })
  assert.equal(fixed.gate.kind, 'offer')
  assert.equal(fixed.gate.advice.rule, 4)
  assert.equal(analyzeOffer(form({ listPrice: '30', targetPrice: '25', listingSignal: 'fixed_price' }), NOW).gate.kind, 'favourite_wait')
  const reserved = analyzeOffer(form({ listPrice: '30', targetPrice: '25', signals: { reserved: true } }), NOW, { bestPrice: true })
  assert.equal(reserved.gate.kind, 'wait')
  assert.equal(reserved.gate.rule, 1)
})

test('seller profile: traits decide facile / medio / difficile, and the type moves price, odds and moves', () => {
  const easy = sellerProfileFor({ form: form({ listingSignal: 'clearing_out' }), extraction: { sellerFeedbackCount: 3, sellerLastSeenDays: 0.01, uploadedDays: 1 } })
  assert.equal(easy.type, 'facile')
  assert.ok(easy.traits.some((t) => t.id === 'clearing_out'))
  const hard = sellerProfileFor({ form: form({ listPrice: '180', listingSignal: 'fixed_price', category: 'luxury' }), extraction: { sellerBusiness: true, sellerFeedbackCount: 420, condition: 'Nuovo con etichetta' } })
  assert.equal(hard.type, 'difficile')
  assert.equal(hard.archetype.id, 'pro')
  const mid = sellerProfileFor({ form: form({ listPrice: '45' }), extraction: { sellerFeedbackCount: 20 } })
  assert.equal(mid.type, 'medio')
  // Wardrobe: many cheap items = «accumulatore che svuota»; many dear ones = reseller.
  const hoard = wardrobeStats({ itemCount: '132 articoli', prices: ['3,00 €', 5, 4, 8, 10, 12, 6, 2], ageDays: [90, 120, 80, 200, 10, 70, 65, 400], bundleText: 'Sconto sui lotti fino al 20%' })
  assert.equal(hoard.itemCount, 132)
  assert.equal(hoard.medianPrice, 5.5)
  assert.equal(hoard.bundleDiscountPct, 20)
  const p = sellerProfileFor({ form: form(), wardrobe: hoard })
  assert.equal(p.archetype.id, 'hoarder')
  assert.ok(['hoarder', 'stale_stock', 'bundle'].every((id) => p.traits.some((t) => t.id === id)))
  assert.equal(wardrobeStats(null), null)
  assert.equal(wardrobeStats({}), null)

  const base = form({ listPrice: '40', targetPrice: '34', listingAge: 'weeks_1_2' })
  const a = strategyFor(base, NOW, { seller: { ...easy, type: 'facile' } })
  const b = strategyFor(base, NOW, { seller: { ...hard, type: 'difficile' } })
  const price = (s, id) => s.options.find((o) => o.id === id).price
  assert.ok(price(a, 'consigliata') < price(b, 'consigliata'), 'easier seller → bolder centre')
  assert.deepEqual(a.plan.map((x) => x.id), ['offer'])
  assert.deepEqual(b.plan.map((x) => x.id), ['heart', 'offer', 'message'])
  assert.match(b.plan[2].text, /pago subito/)
  assert.deepEqual(planFor({ type: 'medio', price: 12, title: 'x' }).map((x) => x.id), ['heart', 'offer', 'message'])
  assert.equal(b.result.messagePolicy.assigned, 'offer_direct')
})

test('strategy: the user\'s own history by depth of discount pulls the odds (deep asks never passed)', () => {
  const exp = experienceOf(HISTORY)
  assert.ok(exp.d40.n >= 3)
  assert.equal(exp.d40.accepted, 0)
  assert.ok(exp.d20.n >= 3)
  const withHistory = strategyFor(form({ listPrice: '30', listingAge: 'weeks_1_2' }), NOW, { records: HISTORY })
  const without = strategyFor(form({ listPrice: '30', listingAge: 'weeks_1_2' }), NOW, {})
  const bold = (s) => s.options.find((o) => o.id === 'audace')
  assert.ok(bold(withHistory).probability < bold(without).probability)
  assert.deepEqual(experienceOf(null).d10, { n: 0, accepted: 0, countered: 0 })
})

test('strategy: moment, chosen option and snapshot', () => {
  assert.equal(momentFor({ extraction: { sellerLastSeenDays: 0.01, uploadedDays: 40 }, now: new Date(2026, 10, 4, 2, 0) }).kind, 'now')
  assert.equal(momentFor({ extraction: { uploadedDays: 1 }, now: new Date(2026, 10, 4, 3, 0) }).kind, 'morning')
  assert.equal(momentFor({ extraction: { uploadedDays: 40, sellerLastSeenDays: 0.4 }, now: NOW }).kind, 'slot')
  const s = strategyFor(form({ listPrice: '34' }), NOW, { chosen: 'audace' })
  assert.equal(s.chosenId, 'audace')
  assert.equal(s.result.input.targetPrice, s.options.find((o) => o.id === 'audace').price)
  const snap = strategySnapshot(s)
  assert.equal(snap.option, 'audace')
  assert.equal(snap.sellerType, s.seller.type)
  assert.equal(strategyFor({ listPrice: '' }, NOW).ok, false)
})

test('category: comics and books are «Libri e fumetti», not collectibles', () => {
  assert.equal(categoryGuess({ categoryText: 'Libri e media Fumetti, manga e graphic novel', title: 'Pyongyang' }).id, 'books')
  assert.equal(categoryGuess({ categoryText: 'Intrattenimento Carte collezionabili', title: 'Charizard' }).id, 'collectible')
})
