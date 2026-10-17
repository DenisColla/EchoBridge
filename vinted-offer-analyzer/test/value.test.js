import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  analyzeCounter, analyzeOffer, availabilityAfter, buildMessages, demandWeight, expectedPriceCurve, leversFor, marketFromRows,
  marketGapWeight, marketHazardMultiplier, normalizeCounterInput, normalizeInput, optimizeOffer, percentile, portfolioPlan,
  reservationPosterior, scoreAt, MARKET_TONE, TONES,
} from '../src/core/index.js'

// Sunday 4 October 2026, 16:00 local time; Wednesday 7 October 2026, 13:00.
const SUNDAY_AFTERNOON = new Date(2026, 9, 4, 16, 0)
const WEDNESDAY_LUNCH = new Date(2026, 9, 7, 13, 0)
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} ≠ ${b} (±${tol})`)

const base = { itemTitle: 'Nike Air Force 1', category: 'sneakers', listPrice: '100', targetPrice: '80', listingAge: 'weeks_1_2', sellerProfile: 'unknown', listingSignal: 'none' }

const row = (price, { verdict = 'same', source = 'vinted', title = 'Nike Air Force 1', fee = null, shipping = 3.5, expected = null } = {}) => {
  const buyerFee = fee ?? Math.round((price * 0.05 + 0.7) * 100) / 100
  const totalNow = Math.round((price + buyerFee + shipping) * 100) / 100
  return { verdict, candidate: { source, title, url: `https://x/${price}`, price, buyerFee, shippingCost: shipping }, totalNow, expectedTotal: expected ?? totalNow }
}

/* ───────── marketFromRows ───────── */

test('marketFromRows: linear percentiles, best row, price basis of the alternative, gap to the reference', () => {
  assert.equal(percentile([10, 20, 30, 40], 0.5), 25)
  assert.equal(percentile([10, 20, 30, 40], 0.25), 17.5)
  assert.equal(percentile([10, 20, 30, 40], 0.75), 32.5)
  // 80 with an expected total below the 70 row: the best row is the one with the lowest EXPECTED total.
  const rows = [row(70), row(80, { expected: 72, source: 'subito', title: 'AF1 bianche' }), row(90), row(100)]
  const m = marketFromRows(rows, { referencePrice: 100 })
  assert.equal(m.n, 4)
  assert.equal(m.sameCount, 4)
  assert.equal(m.medianPrice, 85)
  assert.equal(m.p25Price, 77.5)
  assert.equal(m.p75Price, 92.5)
  assert.equal(m.best.source, 'subito')
  assert.equal(m.best.title, 'AF1 bianche')
  assert.equal(m.best.price, 80)
  assert.equal(m.bestTotal, 72)
  assert.equal(m.bestAltPrice, Math.round((72 - 4.7 - 3.5) * 100) / 100)
  assert.equal(m.gapPct, Math.round((100 / 85 - 1) * 100))
  assert.equal(marketFromRows(rows).gapPct, null)
  // The total as listed now: median of totalNow.
  assert.equal(m.medianTotal, percentile(rows.map((r) => r.totalNow).sort((a, b) => a - b), 0.5))
})

test('marketFromRows: same rows win when there are at least three, variants fill in otherwise; null under two rows', () => {
  const withVariants = [row(50), row(60), row(70), row(300, { verdict: 'variant' })]
  assert.equal(marketFromRows(withVariants).n, 3)
  assert.equal(marketFromRows(withVariants).medianPrice, 60)
  const fewSame = [row(50), row(60), row(300, { verdict: 'variant' })]
  assert.equal(marketFromRows(fewSame).n, 3)
  assert.equal(marketFromRows(fewSame).sameCount, 2)
  assert.equal(marketFromRows([row(50)]), null)
  assert.equal(marketFromRows([row(50), row(60, { verdict: 'different' })]), null)
  assert.equal(marketFromRows([]), null)
  assert.equal(marketFromRows(null), null)
})

/* ───────── weights ───────── */

test('marketGapWeight: 0.9·ln(list/median) clamped to [−0.5, 0.6], 0 without a usable market', () => {
  const m = { n: 4, medianPrice: 100 }
  assert.equal(marketGapWeight(100, m), 0)
  near(marketGapWeight(120, m), 0.9 * Math.log(1.2), 1e-12)
  assert.equal(marketGapWeight(300, m), 0.6)
  assert.equal(marketGapWeight(30, m), -0.5)
  assert.equal(marketGapWeight(120, null), 0)
  assert.equal(marketGapWeight(120, { n: 1, medianPrice: 100 }), 0)
  assert.equal(marketGapWeight(120, { n: 3, medianPrice: 0 }), 0)
})

test('demandWeight: a small prior by favourites band', () => {
  assert.equal(demandWeight({ favourites: 0 }), 0.1)
  assert.equal(demandWeight({ favourites: 1 }), 0)
  assert.equal(demandWeight({ favourites: 3 }), 0)
  assert.equal(demandWeight({ favourites: 4 }), -0.15)
  assert.equal(demandWeight({ favourites: 9 }), -0.15)
  assert.equal(demandWeight({ favourites: 10 }), -0.3)
  assert.equal(demandWeight({ favourites: 40 }), -0.3)
  assert.equal(demandWeight({}), 0)
  assert.equal(demandWeight(null), 0)
  assert.equal(demandWeight({ favourites: NaN }), 0)
})

test('marketHazardMultiplier: 1.5 at or under p25, 0.7 at or over p75, linear in between, 1 without a market', () => {
  const m = { n: 4, p25Price: 80, p75Price: 120 }
  assert.equal(marketHazardMultiplier(70, m), 1.5)
  assert.equal(marketHazardMultiplier(80, m), 1.5)
  near(marketHazardMultiplier(100, m), 1.1, 1e-12)
  assert.equal(marketHazardMultiplier(120, m), 0.7)
  assert.equal(marketHazardMultiplier(200, m), 0.7)
  assert.equal(marketHazardMultiplier(100, null), 1)
  assert.equal(marketHazardMultiplier(100, undefined), 1)
})

/* ───────── scoring integration ───────── */

test('scoreAt adds the market and demand factors only when the input carries them, before the time factors', () => {
  const { input } = normalizeInput(base)
  const plain = scoreAt(input, SUNDAY_AFTERNOON, 0)
  assert.deepEqual(plain.factors.map((f) => f.id), ['category', 'interaction', 'gap', 'signal', 'age', 'wait', 'seller', 'time', 'month'])
  assert.equal(normalizeInput(base).input.signals, undefined)
  assert.equal(normalizeInput({ ...base, signals: {} }).input.signals, undefined)
  assert.equal(normalizeInput({ ...base, signals: { favourites: 'abc' } }).input.signals, undefined)
  assert.deepEqual(normalizeInput({ ...base, signals: { favourites: 0, sellerItems: '12', bundleDiscountPct: NaN } }).input.signals, { favourites: 0, sellerItems: 12 })

  const market = { n: 5, medianPrice: 80, p25Price: 70, p75Price: 95 }
  const withMarket = scoreAt({ ...input, market }, SUNDAY_AFTERNOON, 0)
  const ids = withMarket.factors.map((f) => f.id)
  assert.deepEqual(ids, ['category', 'interaction', 'gap', 'signal', 'age', 'wait', 'seller', 'market', 'time', 'month'])
  const mf = withMarket.factors.find((f) => f.id === 'market')
  assert.equal(mf.group, 'price')
  assert.equal(mf.label, 'Prezzo 25% sopra il mercato')
  near(mf.rawWeight, 0.9 * Math.log(100 / 80), 1e-12)
  assert.ok(withMarket.pAccept > plain.pAccept, 'a listing priced above its market tolerates a deeper discount')
  const below = scoreAt({ ...input, market: { ...market, medianPrice: 125 } }, SUNDAY_AFTERNOON, 0)
  assert.equal(below.factors.find((f) => f.id === 'market').label, 'Prezzo 20% sotto il mercato')
  assert.ok(below.pAccept < plain.pAccept)
  assert.equal(scoreAt({ ...input, market: { n: 1, medianPrice: 80 } }, SUNDAY_AFTERNOON, 0).factors.some((f) => f.id === 'market'), false)

  const withSignals = scoreAt({ ...input, signals: { favourites: 12 } }, SUNDAY_AFTERNOON, 0)
  assert.deepEqual(withSignals.factors.map((f) => f.id), ['category', 'interaction', 'gap', 'signal', 'age', 'wait', 'seller', 'demand', 'time', 'month'])
  const df = withSignals.factors.find((f) => f.id === 'demand')
  assert.equal(df.label, '12 preferiti')
  assert.equal(df.group, 'signal')
  assert.equal(df.rawWeight, -0.3)
  assert.equal(scoreAt({ ...input, signals: { favourites: 0 } }, SUNDAY_AFTERNOON, 0).factors.find((f) => f.id === 'demand').label, 'Nessun preferito')
  assert.equal(scoreAt({ ...input, signals: { favourites: 1 } }, SUNDAY_AFTERNOON, 0).factors.find((f) => f.id === 'demand').label, '1 preferito')
  assert.equal(scoreAt({ ...input, signals: { sellerItems: 5 } }, SUNDAY_AFTERNOON, 0).factors.some((f) => f.id === 'demand'), false)

  const both = scoreAt({ ...input, market, signals: { favourites: 0 } }, SUNDAY_AFTERNOON, 0)
  assert.deepEqual(both.factors.map((f) => f.id).slice(6, 10), ['seller', 'market', 'demand', 'time'])
})

test('analyzeOffer is byte-identical without a market (null or absent) and carries a market summary with one', () => {
  const plain = analyzeOffer(base, SUNDAY_AFTERNOON)
  assert.equal(JSON.stringify(analyzeOffer(base, SUNDAY_AFTERNOON, { market: null })), JSON.stringify(plain))
  assert.equal(JSON.stringify(analyzeOffer(base, SUNDAY_AFTERNOON, {})), JSON.stringify(plain))
  assert.equal(JSON.stringify(analyzeOffer({ ...base, signals: null }, SUNDAY_AFTERNOON)), JSON.stringify(plain))
  assert.equal('market' in plain, false)
  assert.equal('signals' in plain.input, false)
  assert.equal(plain.messages.length, 4)

  const market = marketFromRows([row(70), row(80), row(90), row(100)], { referencePrice: 100 })
  const r = analyzeOffer(base, SUNDAY_AFTERNOON, { market })
  assert.equal(r.kind, 'analysis')
  assert.equal(r.input.market, market)
  assert.deepEqual(Object.keys(r.market), ['n', 'medianPrice', 'p25Price', 'p75Price', 'gapPct', 'best'])
  assert.equal(r.market.medianPrice, 85)
  assert.equal(r.market.gapPct, Math.round((100 / 85 - 1) * 100))
  assert.ok(r.factors.rows.some((f) => f.id === 'market'))
  assert.equal(r.messages.length, 5)
  assert.equal(r.messages[4].tone, 'informato')
  // The hazard sees the market too: a listing at the top of its market lingers (×0.7), a bargain goes fast (×1.5).
  const { input } = normalizeInput(base)
  const dear = { ...input, market: { ...market, p25Price: 60, p75Price: 70 } }
  const bargain = { ...input, market: { ...market, p25Price: 110, p75Price: 130 } }
  assert.ok(availabilityAfter(dear, 7) > availabilityAfter(input, 7))
  assert.ok(availabilityAfter(bargain, 7) < availabilityAfter(input, 7))
  assert.equal(availabilityAfter({ ...input, market: null }, 7), availabilityAfter(input, 7))
  near(availabilityAfter(bargain, 1), 1 - 0.02 * 1.0 * 1.5, 1e-12)
  // over_cap inherits the market through the capped input.
  const capped = analyzeOffer({ ...base, targetPrice: '40' }, SUNDAY_AFTERNOON, { market })
  assert.equal(capped.kind, 'over_cap')
  assert.equal(capped.market.medianPrice, 85)

  const withSignals = analyzeOffer({ ...base, signals: { favourites: 15 } }, SUNDAY_AFTERNOON)
  assert.deepEqual(withSignals.input.signals, { favourites: 15 })
  assert.ok(withSignals.factors.rows.some((f) => f.id === 'demand'))
  assert.ok(withSignals.probability < plain.probability)
})

test('optimizeOffer accepts the market like the profile and is unchanged without it', () => {
  const plain = optimizeOffer(base, SUNDAY_AFTERNOON)
  assert.equal(JSON.stringify(optimizeOffer(base, SUNDAY_AFTERNOON, { market: null })), JSON.stringify(plain))
  const market = { n: 4, medianPrice: 70, p25Price: 60, p75Price: 80 }
  const withMarket = optimizeOffer(base, SUNDAY_AFTERNOON, { market })
  assert.equal(withMarket.ok, true)
  assert.ok(withMarket.current.probability > plain.current.probability, 'a listing far above its market is easier to negotiate')
})

/* ───────── messages ───────── */

test('buildMessages gains the fifth informato tone only with a market whose median is below the listing price', () => {
  const args = { itemTitle: 'Nike Air Force 1', listPrice: 100, targetPrice: 80, listingAge: { id: 'weeks_1_2' }, sendAt: new Date(2026, 9, 4, 21, 45) }
  assert.equal(buildMessages(args).length, 4)
  assert.equal(buildMessages({ ...args, market: null }).length, 4)
  assert.equal(buildMessages({ ...args, market: { n: 1, medianPrice: 60 } }).length, 4)
  assert.equal(buildMessages({ ...args, market: { n: 3, medianPrice: 110 } }).length, 4, 'a market above the listing is no argument')
  assert.equal(JSON.stringify(buildMessages({ ...args, market: null })), JSON.stringify(buildMessages(args)))
  for (const beforeOffer of [false, true]) {
    const msgs = buildMessages({ ...args, beforeOffer, market: { n: 3, medianPrice: 72.5 } })
    assert.equal(msgs.length, 5)
    assert.deepEqual(msgs.slice(0, 4).map((m) => m.tone), TONES.map((t) => t.id))
    assert.equal(msgs[4].tone, MARKET_TONE.id)
    assert.match(msgs[4].text, /^Ciao! /)
    assert.match(msgs[4].text, /intorno a 72,50 € su altri siti/)
    assert.match(msgs[4].text, /80 €/)
    assert.match(msgs[4].text, /"Nike Air Force 1"/)
    assert.match(msgs[4].text, /buona serata!$/)
    if (beforeOffer) assert.match(msgs[4].text, /ti invio subito l'offerta/)
    else assert.match(msgs[4].text, /ti ho appena inviato un'offerta/)
  }
  assert.deepEqual(TONES.map((t) => t.id), ['cordiale', 'diretto', 'impegno', 'motivato'], 'the counter tones are untouched')
})

/* ───────── expected price curve ───────── */

test('expectedPriceCurve: one point per sendable price, a minimum, full price as fallback, byte-identity of the analysis', () => {
  const curve = expectedPriceCurve(base, SUNDAY_AFTERNOON)
  assert.ok(curve)
  assert.equal(curve.listPrice, 100)
  assert.equal(curve.fallback, 100)
  assert.ok(curve.points.length >= 30 && curve.points.length <= 40, `${curve.points.length} points`)
  assert.ok(curve.points.every((p, i, arr) => i === 0 || p.price < arr[i - 1].price), 'prices strictly decrease (deduped)')
  assert.ok(curve.points.every((p) => p.probability > 0 && p.probability < 1))
  assert.ok(curve.points.every((p) => p.expected <= curve.fallback + 1e-9), 'expected never above the fallback')
  assert.ok(curve.points.every((p) => Math.abs(p.expected - (p.probability * p.price + (1 - p.probability) * curve.fallback)) < 0.006))
  const minExpected = Math.min(...curve.points.map((p) => p.expected))
  assert.equal(curve.best.expected, minExpected)
  assert.equal(curve.best, curve.points.find((p) => p.expected === minExpected), 'ties go to the lower discount')
  assert.ok(curve.best.discountPct > 1 && curve.best.discountPct < 40, `interior minimum at ${curve.best.discountPct}%`)
  assert.equal(curve.atTarget.price, 80)
  near(curve.savingVsList, 100 - curve.best.expected, 0.006)

  // A cheaper alternative never becomes the fallback (it is a separate choice, shown as a lever): the market still
  // changes the probabilities, so the points move, but the rest of the weight stays on buying here at full price.
  const market = marketFromRows([row(70, { expected: 70 }), row(80), row(90), row(100)], { referencePrice: 100 })
  assert.ok(market.bestAltPrice < 100)
  const withAlt = expectedPriceCurve(base, SUNDAY_AFTERNOON, { market })
  assert.equal(withAlt.fallback, 100)
  const p = withAlt.points.find((x) => x.price === 80)
  near(p.expected, p.probability * 80 + (1 - p.probability) * 100, 0.006)
  assert.ok(withAlt.points.every((x) => x.expected <= 100 + 1e-9))

  // Each point is exactly what analyzeOffer says for that target; the on-screen analysis is untouched.
  const at = analyzeOffer({ ...base, targetPrice: 80 }, SUNDAY_AFTERNOON)
  assert.equal(curve.atTarget.probability, at.probability)
  assert.equal(JSON.stringify(analyzeOffer(base, SUNDAY_AFTERNOON)), JSON.stringify(analyzeOffer(base, SUNDAY_AFTERNOON, { market: null })))

  assert.equal(expectedPriceCurve({ ...base, listPrice: '' }, SUNDAY_AFTERNOON), null)
  assert.equal(expectedPriceCurve({ ...base, targetPrice: '' }, SUNDAY_AFTERNOON).atTarget, null, 'no target: the curve still exists')
  const small = expectedPriceCurve({ ...base, listPrice: '12', targetPrice: '10' }, WEDNESDAY_LUNCH)
  assert.ok(small.points.every((p) => Math.round(p.price * 2) === p.price * 2), 'half-euro grid under 20 €')
})

/* ───────── levers ───────── */

test('leversFor: each rule fires on its condition, values sorted descending, bodies say what is an estimate', () => {
  const result = analyzeOffer(base, SUNDAY_AFTERNOON)
  const none = leversFor({ result, now: SUNDAY_AFTERNOON })
  // 1–2 weeks old (10 days): favourite_wait (≤ 14 days) and patience (≥ 7 days), nothing else.
  assert.deepEqual(none.map((l) => l.id).sort(), ['favourite_wait', 'patience'])
  const fav = none.find((l) => l.id === 'favourite_wait')
  assert.equal(fav.valueEur, 3.75, 'expected value: 25% of a 15% discount')
  assert.equal(fav.probability, 0.25)
  assert.deepEqual(fav.action, { kind: 'reminder', hours: 60, at: new Date(SUNDAY_AFTERNOON.getTime() + 60 * 3_600_000) })
  assert.match(fav.body, /48–72 ore/)
  assert.match(fav.body, /senza il limite del 40%/)
  const patience = none.find((l) => l.id === 'patience')
  assert.equal(patience.probability, 0.12)
  assert.equal(patience.action.hours, 168)
  assert.equal(patience.action.at.getTime(), SUNDAY_AFTERNOON.getTime() + 7 * 24 * 3_600_000)
  near(patience.valueEur, 0.12 * 0.1 * 100, 0.006)
  const pLost = 1 - Math.pow(1 - 0.02 * 1.0, 7)
  assert.equal(patience.body, `Aspetta 7 giorni: 12% di probabilità di un ribasso, ${Math.round(pLost * 100)}% di perderlo. Stima su medie di categoria, non sul singolo venditore.`)
  assert.ok(none.every((l) => /stima/i.test(l.body)))
  assert.ok(none[0].valueEur >= none[1].valueEur)

  // Fresh listing with a high probability: favourite_wait by age; no patience under 7 days.
  const fresh = analyzeOffer({ ...base, listingAge: 'today', targetPrice: '92' }, SUNDAY_AFTERNOON)
  assert.ok(fresh.probability >= 0.5)
  assert.deepEqual(leversFor({ result: fresh }).map((l) => l.id), ['favourite_wait'])
  // Old listing with a high probability: patience only, with the 2–4 weeks prior.
  const old = analyzeOffer({ ...base, listingAge: 'weeks_2_4', targetPrice: '92' }, SUNDAY_AFTERNOON)
  const oldLevers = leversFor({ result: old })
  assert.deepEqual(oldLevers.map((l) => l.id), ['patience'])
  assert.equal(oldLevers[0].probability, 0.2)
  assert.equal(leversFor({ result: analyzeOffer({ ...base, listingAge: 'over_month', targetPrice: '92' }, SUNDAY_AFTERNOON) })[0].probability, 0.15)

  // Market under p25: buy now; a cheaper alternative on another site.
  const market = marketFromRows([row(110, { expected: 85, source: 'subito', title: 'AF1 bianche 42' }), row(120), row(130), row(140)], { referencePrice: 100 })
  assert.ok(100 <= market.p25Price)
  const withMarket = leversFor({ result, market })
  const buyNow = withMarket.find((l) => l.id === 'market_buy_now')
  assert.ok(buyNow)
  assert.equal(buyNow.valueEur, market.medianPrice - 100)
  assert.match(buyNow.body, /Sotto il mercato|mediana 125 €/)
  assert.match(buyNow.title, /Sotto il mercato: compra subito/)
  // The alternative is compared with THIS listing negotiated the same way: p·target + (1−p)·list, fee and shipping.
  const hereTotal = Math.round(((result.probability * 80 + (1 - result.probability) * 100) * 1.05 + 0.7 + 3.5) * 100) / 100
  const alt = withMarket.find((l) => l.id === 'alternative')
  assert.ok(alt, `expected total 85 + 0.5 < ${hereTotal}`)
  near(alt.valueEur, hereTotal - 85, 0.006)
  assert.match(alt.body, /"AF1 bianche 42" su Subito/)
  assert.match(alt.body, /85 €/)
  assert.equal(withMarket[0].valueEur, Math.max(...withMarket.map((l) => l.valueEur)))
  // No alternative when its expected total is not cheaper than negotiating here.
  const dear = { ...market, best: { ...market.best, expectedTotal: hereTotal + 2 } }
  assert.equal(leversFor({ result, market: dear }).some((l) => l.id === 'alternative'), false)
  // Market hazard speeds up the loss in the patience lever.
  const patienceCheap = leversFor({ result, market: { ...market, p25Price: 120, p75Price: 140 } }).find((l) => l.id === 'patience')
  assert.ok(Number(patienceCheap.body.match(/(\d+)% di perderlo/)[1]) > Number(patience.body.match(/(\d+)% di perderlo/)[1]))

  // Bundle from the seller's items.
  const bundle = leversFor({ result, signals: { sellerItems: 7 } }).find((l) => l.id === 'bundle')
  assert.equal(bundle.valueEur, 6.75, 'expected value at 50%')
  assert.match(bundle.body, /7 articoli/)
  assert.equal(leversFor({ result, signals: { sellerItems: 7, bundleDiscountPct: 20 } }).find((l) => l.id === 'bundle').valueEur, 11.75, 'expected value at 50%')
  assert.equal(leversFor({ result, signals: { sellerItems: 1 } }).some((l) => l.id === 'bundle'), false)

  // Nothing without a usable result or form; the form alone is enough for the rules that do not need the analysis.
  assert.deepEqual(leversFor({ result: { ok: false, errors: {} } }), [])
  assert.deepEqual(leversFor({ result: null, form: base }).map((l) => l.id), ['patience'])
  assert.equal(leversFor({ result: analyzeOffer({ ...base, targetPrice: '40' }, SUNDAY_AFTERNOON) }).some((l) => l.id === 'favourite_wait'), false, 'over_cap: the cap advice already says so')
})

/* ───────── portfolio ───────── */

test('portfolioPlan: hand-checked two-row case, pAny, best single, never below a fallback it cannot beat', () => {
  const curves = [
    { id: 'a', label: 'A', points: [{ price: 60, total: 64, probability: 0.3 }, { price: 70, total: 74.5, probability: 0.7 }] },
    { id: 'b', label: 'B', points: [{ price: 65, total: 69.5, probability: 0.5 }] },
  ]
  const plan = portfolioPlan(curves, { fallbackTotal: 100 })
  // Combination (60 @ 0.3, 65 @ 0.5): E = 0.15·64 + 0.15·64 + 0.35·69.5 + 0.35·100 = 9.6 + 9.6 + 24.325 + 35 = 78.525.
  // Combination (70 @ 0.7, 65 @ 0.5): both 0.35 → 69.5; only A 0.35 → 74.5; only B 0.15 → 69.5; none 0.15 → 100:
  // E = 24.325 + 26.075 + 10.425 + 15 = 75.825 → the second wins.
  assert.deepEqual(plan.picks, [{ id: 'a', label: 'A', price: 70, total: 74.5, probability: 0.7 }, { id: 'b', label: 'B', price: 65, total: 69.5, probability: 0.5 }])
  near(plan.expectedMin, 75.83, 0.006)
  near(plan.pAny, 1 - 0.3 * 0.5, 1e-12)
  assert.equal(plan.fallbackTotal, 100)
  // Single rows: A at 70 → 0.7·74.5 + 0.3·100 = 82.15; A at 60 → 0.3·64 + 0.7·100 = 89.2; B → 0.5·69.5 + 50 = 84.75.
  assert.deepEqual(plan.bestSingle, { id: 'a', expected: 82.15 })
  near(plan.savingVsSingle, 82.15 - 75.825, 0.006)
  assert.ok(plan.savingVsSingle >= 0)

  // Points at or above the fallback are never offered; with nothing below the fallback there is no plan.
  const low = portfolioPlan(curves, { fallbackTotal: 70 })
  assert.deepEqual(low.picks.map((p) => p.total), [64, 69.5])
  assert.ok(low.expectedMin <= 70)
  assert.equal(portfolioPlan(curves, { fallbackTotal: 60 }), null)
  assert.equal(portfolioPlan([], { fallbackTotal: 100 }), null)
  assert.equal(portfolioPlan(curves, {}), null)
  // The expected minimum never beats the cheapest point and never exceeds the fallback.
  assert.ok(plan.expectedMin >= 64 && plan.expectedMin <= 100)
  // maxRows limits the rows; a third row never makes the plan worse.
  const three = [...curves, { id: 'c', label: 'C', points: [{ price: 68, total: 72, probability: 0.4 }] }]
  assert.ok(portfolioPlan(three, { fallbackTotal: 100 }).expectedMin <= plan.expectedMin + 1e-9)
  assert.equal(portfolioPlan(three, { fallbackTotal: 100, maxRows: 2 }).picks.length, 2)
})

/* ───────── reserve price ───────── */

test('reservationPosterior: monotone cdf on an 81-point grid, median between offer and counter, suggested price', () => {
  const prior = reservationPosterior({ listPrice: 60, history: [] })
  assert.equal(prior.grid.length, 81)
  assert.equal(prior.grid[0].price, 30)
  assert.equal(prior.grid[80].price, 60)
  assert.ok(prior.grid.every((g, i, arr) => i === 0 || g.cdf >= arr[i - 1].cdf), 'monotone cdf')
  near(prior.grid[80].cdf, 1, 1e-9)
  assert.ok(prior.p20 <= prior.median && prior.median <= prior.p80)
  assert.equal(prior.suggested, null, 'no seller answer yet')

  const post = reservationPosterior({ listPrice: 60, history: [{ side: 'buyer', price: 45 }, { side: 'seller', price: 58.5 }] })
  assert.ok(post.grid.every((g, i, arr) => i === 0 || g.cdf >= arr[i - 1].cdf))
  assert.ok(post.median > 45 && post.median <= 58.5, `median ${post.median}`)
  assert.ok(post.p20 > 45 - 1e-9 && post.p80 <= 58.5 + 1e-9, `p20 ${post.p20} p80 ${post.p80}`)
  assert.ok(post.suggested > 45 && post.suggested < 58.5, `suggested ${post.suggested}`)
  assert.ok(post.suggested >= 36)
  // Mass at or below the rejected offer is tiny, mass above the counter is tiny.
  const at45 = post.grid.find((g) => g.price >= 45)
  assert.ok(at45.cdf < 0.15, `cdf(45) = ${at45.cdf}`)
  const at585 = post.grid.find((g) => g.price >= 58.5)
  assert.ok(at585.cdf > 0.9, `cdf(58.5) = ${at585.cdf}`)
  // The suggestion minimises cdf·x + (1 − cdf)·cLast over the grid above 60% of list.
  const costOf = (g) => g.cdf * g.price + (1 - g.cdf) * 58.5
  const bestGrid = post.grid.filter((g) => g.price >= 36 - 1e-9).reduce((a, b) => (costOf(b) < costOf(a) - 1e-9 ? b : a))
  assert.equal(post.suggested, bestGrid.price)

  // A second round narrows the band; a pending (unanswered) buyer offer does not count as rejected.
  const two = reservationPosterior({ listPrice: 60, history: [{ side: 'buyer', price: 45 }, { side: 'seller', price: 58.5 }, { side: 'buyer', price: 50 }, { side: 'seller', price: 55 }] })
  assert.ok(two.median > 50 && two.median <= 55)
  assert.ok(two.p80 - two.p20 <= post.p80 - post.p20)
  const pending = reservationPosterior({ listPrice: 60, history: [{ side: 'buyer', price: 45 }, { side: 'seller', price: 58.5 }, { side: 'buyer', price: 50 }] })
  assert.equal(pending.median, post.median)
  // A refusal without a counter: the offer is rejected, the suggestion is read against the list price.
  const refused = reservationPosterior({ listPrice: 60, history: [{ side: 'buyer', price: 45 }, { side: 'seller', price: null }] })
  assert.ok(refused.median > 45)
  assert.ok(refused.suggested > 45 && refused.suggested < 60)
  assert.equal(reservationPosterior({ listPrice: 'abc', history: [] }), null)
})

/* ───────── counter integration ───────── */

test('analyzeCounter: the market caps the loss value at the best alternative and scales the hazard, unchanged without it', () => {
  const EX1 = {
    itemTitle: 'Nike Air Force 1', category: 'sneakers', listPrice: '60', previousOffer: '45', sellerCounter: '58,50',
    listingAge: 'weeks_1_2', sellerProfile: 'unknown', listingSignal: 'none', offerSentAt: new Date(2026, 9, 13, 21, 35), receivedAt: new Date(2026, 9, 13, 21, 40),
  }
  const NOW1 = new Date(2026, 9, 13, 21, 45)
  const plain = analyzeCounter(EX1, NOW1)
  assert.equal(JSON.stringify(analyzeCounter(EX1, NOW1, { market: null })), JSON.stringify(plain))
  const plainState = normalizeCounterInput(EX1, NOW1).state
  assert.equal(plainState.V, 63)
  assert.equal('market' in plainState, false)

  const market = { n: 4, medianPrice: 55, p25Price: 50, p75Price: 62, bestAltPrice: 52 }
  const state = normalizeCounterInput(EX1, NOW1, { market }).state
  assert.equal(state.market, market)
  assert.equal(state.V, 58.5, 'capped at max(S, bestAltPrice) = S')
  assert.equal(normalizeCounterInput(EX1, NOW1, { market: { ...market, bestAltPrice: 59 } }).state.V, 59)
  assert.equal(normalizeCounterInput(EX1, NOW1, { market: { ...market, bestAltPrice: 70 } }).state.V, 63, 'a dearer alternative changes nothing')
  assert.equal(normalizeCounterInput(EX1, NOW1, { market: { ...market, bestAltPrice: NaN } }).state.V, 63)
  near(state.hazard, plainState.hazard * marketHazardMultiplier(60, market), 1e-12)
  const withMarket = analyzeCounter(EX1, NOW1, { market })
  assert.equal(withMarket.ok, true)
  assert.notEqual(JSON.stringify(withMarket), JSON.stringify(plain))
})

test('review fixes: posterior never suggests a refused price, buy-now needs a real gap, alternative lever on the same basis, unknown age has no patience lever', () => {
  const refused = reservationPosterior({ listPrice: 100, history: [{ side: 'buyer', price: 95 }, { side: 'seller', price: null }] })
  assert.ok(refused.suggested > 95 && refused.suggested <= 100, `suggested ${refused.suggested}`)
  assert.ok(refused.median > 95, `median ${refused.median}`)
  const low = reservationPosterior({ listPrice: 100, history: [{ side: 'buyer', price: 50 }, { side: 'seller', price: 55 }] })
  assert.ok(low.suggested <= 55, 'never above his own counter')
  const two = reservationPosterior({ listPrice: 100, history: [{ side: 'buyer', price: 80 }, { side: 'seller', price: 95 }, { side: 'buyer', price: 90 }, { side: 'seller', price: 93 }] })
  assert.ok(two.suggested > 90 && two.suggested <= 93, `suggested ${two.suggested}`)

  const rowAt = (price) => ({ verdict: 'same', candidate: { source: 'vinted', title: 'x', url: 'https://www.vinted.it/items/1', price, buyerFee: 0.7 + 0.05 * price, shippingCost: 3.5 }, totalNow: price * 1.05 + 4.2, expectedTotal: price * 1.05 + 4.2 })
  const flat = marketFromRows([rowAt(100), rowAt(100), rowAt(100), rowAt(100)], { referencePrice: 100 })
  const resFlat = analyzeOffer({ ...base, listPrice: '100', targetPrice: '80' }, SUNDAY_AFTERNOON, { market: flat })
  const ids = leversFor({ result: resFlat, market: flat }).map((l) => l.id)
  assert.ok(!ids.includes('market_buy_now'), 'equal prices are not "below the market"')
  assert.ok(!ids.includes('alternative'), 'an identical listing is no alternative')
  const cheaper = marketFromRows([{ ...rowAt(60), expectedTotal: 60 }, rowAt(100), rowAt(100), rowAt(100)], { referencePrice: 100 })
  assert.ok(leversFor({ result: resFlat, market: cheaper }).some((l) => l.id === 'alternative'))

  const unknown = leversFor({ result: analyzeOffer({ ...base, listingAge: 'unknown', targetPrice: '80' }, SUNDAY_AFTERNOON) }).map((l) => l.id)
  assert.ok(!unknown.includes('patience'))
})
