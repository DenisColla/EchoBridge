import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeCounter, ceilingPriceFor, parseVintedItemHtml, purchaseCost, resaleMarginOf, shippingEstimateFor, strategyFor, strategySnapshot, vintedBuyerFee } from '../src/core/index.js'
import { budgetOfItem, counterRawFor } from '../mobile/src/services/counterInput.js'

const now = new Date(2026, 10, 16, 10, 0)
const form = (listPrice, category = 'books', extra = {}) => ({ itemTitle: 'Articolo', category, listPrice: String(listPrice), targetPrice: '', listingAge: 'weeks_1_2', sellerProfile: 'unknown', listingSignal: 'none', ...extra })

test('costs: Vinted\'s protection is 0,70 € + 5% of the price, to the cent on the user\'s own listings', () => {
  // Price → «incl. la commissione Vinted», read on six real listings (15–16 Nov 2026).
  for (const [price, withFee] of [[6, 7], [9, 10.15], [12.6, 13.93], [20, 21.7], [31, 33.25], [200, 210.7]]) {
    assert.equal(purchaseCost(price, 0).total, withFee, `${price} €`)
  }
  // The user's own words: about 8% on a cheap article, 5% on an 800 € phone («circa 40 € in più»).
  assert.equal(vintedBuyerFee(800), 40.7)
  assert.equal(vintedBuyerFee(15), 1.45)
  assert.equal(vintedBuyerFee(0), null)
  assert.deepEqual(purchaseCost(5, 2.29), { price: 5, fee: 0.95, shipping: 2.29, total: 8.24 })
  // Shipping when the listing does not say: a book 3 €, a high-end phone 10 €.
  assert.equal(shippingEstimateFor({ category: 'books', listPrice: 6 }).amount, 3)
  assert.equal(shippingEstimateFor({ category: 'electronics', listPrice: 800 }).amount, 10)
  assert.equal(shippingEstimateFor({ category: 'sneakers', listPrice: 40 }).amount, 4.5)
  assert.equal(shippingEstimateFor({ category: 'luxury', listPrice: 200 }).amount, 7)
  assert.equal(shippingEstimateFor({}).source, 'estimate')
})

test('costs: the ceiling is the highest price that does not lose when the article is sold again', () => {
  // Sold again at 22 €, shipping 3 €: 17,43 € + 1,57 € + 3 € = 22,00 €, to the cent (the protection is rounded).
  assert.equal(ceilingPriceFor(22, 3), 17.43)
  assert.equal(purchaseCost(17.43, 3).total, 22)
  assert.ok(purchaseCost(17.44, 3).total > 22)
  assert.deepEqual(resaleMarginOf(15, 3, 22), { total: 19.45, margin: 2.55, marginPct: 11.6 })
  // A margin asked on top: 20% of the resale kept.
  assert.equal(ceilingPriceFor(100, 5, 20), 70.76)
  // A 6 € book with 2,29 € of shipping: the fixed costs leave 2,87 €; nothing when they eat the whole resale.
  assert.equal(ceilingPriceFor(6, 2.29), 2.87)
  assert.equal(ceilingPriceFor(2.5, 2.29), 0)
  assert.equal(ceilingPriceFor(null, 3), 0)
})

test('costs: the listing\'s own «Spedizione da…» is read', () => {
  assert.equal(parseVintedItemHtml('<div><h3>Spedizione</h3><span>da 2,29 €</span></div>').shippingFrom, 2.29)
  assert.equal(parseVintedItemHtml('<div>Spedizione</div><div>da 10 €</div>').shippingFrom, 10)
  assert.equal(parseVintedItemHtml('<div>Spedizione rapida</div><p>Libro da collezione, 15 € trattabili</p>').shippingFrom, null)
  assert.equal(parseVintedItemHtml('<p>Nessun costo indicato</p>').shippingFrom, null)
})

test('strategy: every proposal carries what it costs in all and where a counter-offer would land', () => {
  const s = strategyFor(form(22), now, {})
  assert.equal(s.goal, 'keep')
  assert.deepEqual([s.costs.shipping.amount, s.costs.shipping.source, s.costs.resale.amount, s.costs.resale.source, s.costs.fee], [3, 'estimate', 22, 'listing', 1.8])
  for (const o of s.options) {
    assert.equal(o.total, purchaseCost(o.price, 3).total)
    assert.equal(o.margin, Math.round((22 - o.total) * 100) / 100)
    assert.equal(o.landing, o.counterPrice)
    assert.ok(o.landing > o.price && o.landingTotal > o.total)
    assert.equal(o.safe, o.price <= s.costs.ceiling)
  }
  // The shipping of the page wins over the estimate, a typed one over both; a typed resale over the listing price.
  assert.deepEqual(strategyFor(form(22), now, { extraction: { shippingFrom: 2.29 } }).costs.shipping, { amount: 2.29, source: 'page' })
  assert.equal(strategyFor(form(22), now, { extraction: { shippingFrom: 2.29 }, shipping: 5 }).costs.shipping.source, 'user')
  assert.deepEqual(strategyFor(form(22), now, { resale: 30 }).costs.resale, { amount: 30, source: 'user' })
  assert.equal(strategyFor(form(22), now, { market: { n: 6, p25Price: 18, medianPrice: 25, p75Price: 30 } }).costs.resale.source, 'market')
  // «Per me» leaves the proposals as they were before the costs were known.
  const before = strategyFor(form(22), now, { goal: 'keep' }).options.map((o) => o.price)
  assert.deepEqual(s.options.map((o) => o.price), before)
})

test('strategy: to sell again, no proposal costs more than the resale gives back', () => {
  const keep = strategyFor(form(22), now, { goal: 'keep' })
  const resell = strategyFor(form(22), now, { goal: 'resell' })
  assert.deepEqual([resell.costs.ceiling, resell.costs.reachable, resell.costs.noMargin], [17.43, true, false])
  // The dearest proposal is at the ceiling, the others open below it: none loses, all are deeper than «per me».
  assert.ok(resell.options.every((o) => o.safe && o.margin >= 0), JSON.stringify(resell.options.map((o) => [o.price, o.margin])))
  assert.equal(resell.options[0].price, 17)
  assert.ok(resell.options[0].price < keep.options[0].price)
  for (let i = 1; i < resell.options.length; i++) assert.ok(resell.options[i].price < resell.options[i - 1].price)
  assert.ok(resell.options.every((o) => o.price >= resell.costs.floor))
  // The recommended one gains the most on average, a refusal costing nothing.
  const best = resell.options.find((o) => o.recommended)
  assert.ok(best.expectedMargin > 0)
  assert.ok(resell.options.every((o) => o.expectedMargin <= best.expectedMargin + 0.01 * 22))
  // An 800 € phone: 40,70 € of protection and 10 € of shipping; the ceiling is 751,71 € and the proposals stay under it.
  const phone = strategyFor(form(800, 'electronics'), now, { goal: 'resell' })
  assert.deepEqual([phone.costs.fee, phone.costs.shipping.amount, phone.costs.ceiling], [40.7, 10, 751.71])
  assert.ok(phone.options.every((o) => o.price <= 751.71 && o.safe))
  // The counter-offer lands above the opening: the user's «per arrivare a 7 propongo 6».
  assert.ok(phone.options.every((o) => o.landing > o.price))
})

test('strategy: when the fixed costs eat the margin the app says so instead of inventing an offer', () => {
  // The listing of the screenshot: 6 €, shipping from 2,29 €. Sold again at 6 € it can only lose.
  const book = strategyFor(form(6), now, { goal: 'resell', extraction: { shippingFrom: 2.29 } })
  assert.deepEqual([book.costs.ceiling, book.costs.floor, book.costs.reachable, book.costs.noMargin], [2.87, 3.6, false, true])
  assert.ok(book.options.every((o) => o.margin < 0 && !o.safe))
  // The proposals are the usual ones (the user may want it for himself); one is still recommended.
  assert.deepEqual(book.options.map((o) => o.price), strategyFor(form(6), now, { goal: 'keep', extraction: { shippingFrom: 2.29 } }).options.map((o) => o.price))
  assert.ok(book.options.some((o) => o.recommended))
  // The same book, worth 15 € to the user: every proposal gains, and the likeliest deal is the best one.
  const worth = strategyFor(form(6), now, { goal: 'resell', resale: 15, extraction: { shippingFrom: 2.29 } })
  assert.deepEqual([worth.costs.reachable, worth.costs.noMargin, worth.costs.ceiling], [true, false, 11.44])
  assert.ok(worth.options.every((o) => o.margin > 6))
  assert.equal(worth.options.find((o) => o.recommended).id, 'prudente')
  // The figure the user typed rides along with its own total and margin.
  const own = strategyFor(form(22), now, { goal: 'resell', customPrice: 14 })
  const tua = own.options.find((o) => o.id === 'tua')
  assert.deepEqual([tua.total, tua.margin, tua.safe], [18.4, 3.6, true])
})

test('strategy: what is saved with the offer, and the budget it gives to the reply to a counter-offer', () => {
  const s = strategyFor(form(22), now, { goal: 'resell' })
  const snap = strategySnapshot(s)
  const chosen = s.options.find((o) => o.id === s.chosenId)
  assert.deepEqual([snap.goal, snap.total, snap.margin, snap.shipping, snap.shippingSource, snap.resale, snap.resaleSource, snap.ceiling], ['resell', chosen.total, chosen.margin, 3, 'estimate', 22, 'listing', 17.43])
  const item = { id: 'x', status: 'sent', listPrice: 22, targetPrice: 15, negotiation: [{ by: 'buyer', price: 15, at: '2026-11-15T20:38:20.000Z' }], strategy: snap, form: form(22, 'books', { targetPrice: '15' }) }
  assert.equal(budgetOfItem(item), 17.43)
  assert.equal(budgetOfItem({ ...item, strategy: { ...snap, goal: 'keep' } }), null)
  assert.equal(budgetOfItem({ ...item, strategy: null }), null)
  // The seller answers 20 €: over the ceiling. The plan never accepts it and never raises above 17,43 €.
  const raw = counterRawFor(item, 20, { previousOffer: 15 })
  assert.equal(raw.maxPrice, '17,43')
  const plan = analyzeCounter(raw, now, {})
  assert.equal(plan.ok, true)
  assert.ok(plan.recommended.id !== 'accept', plan.recommended.id)
  assert.ok(!Number.isFinite(plan.recommended.price) || plan.recommended.price <= 17.43, String(plan.recommended.price))
  // Without a ceiling the planner is free, as before.
  assert.equal(counterRawFor({ ...item, strategy: null }, 20).maxPrice, '')
})
