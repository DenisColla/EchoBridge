/**
 * Value layer (1.6.0): what the buyer gains from each move, in euros, once the cross-channel search has described the
 * market and the listing page has given its signals (favourites, the seller's other items).
 *
 * - marketFromRows: the ranking rows of the search → a market summary (percentiles, best alternative) that analyzeOffer,
 *   optimizeOffer, analyzeCounter and buildMessages accept as `market`.
 * - expectedPriceCurve: expected price paid as a function of the discount asked, with the best alternative as fallback.
 * - leversFor: the moves beyond the single offer (buy now, the alternative, favourite and wait, bundle, patience).
 * - portfolioPlan: one offer per listing on several comparable listings, chosen to minimise the expected price paid.
 * - reservationPosterior: the seller's reserve price after his counters, on a grid (a soft Bayesian update).
 *
 * Every probability that is a prior rather than a calibrated estimate says so in the text. The scoring weights that the
 * market and the signals add (marketGapWeight, demandWeight, marketHazardMultiplier) live in scoring.js and are re-exported.
 */
import { CATEGORIES, VINTED, ageHazardMultiplier } from './constants.js'
import { analyzeOffer, normalizeInput, parsePrice, priceStepFor } from './analyze.js'
import { baseLogitFor, computeDiscountPct, marketHazardMultiplier } from './scoring.js'
import { formatEuro } from './messages.js'
import { roundTo, squash } from './math.js'

export { marketGapWeight, demandWeight, marketHazardMultiplier } from './scoring.js'

const valR2 = (v) => Math.round(v * 100) / 100
const valFinite = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback)
/** A history price: null, undefined and '' are "no price" (Number(null) would be 0). */
const valPrice = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v))
const SOURCE_LABELS = { vinted: 'Vinted', subito: 'Subito', wallapop: 'Wallapop', ebay: 'eBay' }
const sourceLabel = (source) => SOURCE_LABELS[source] || (source ? String(source).charAt(0).toUpperCase() + String(source).slice(1) : 'altro sito')

/** Linear-interpolated percentile (p in [0, 1]) of a sorted ascending array. */
export function percentile(sorted, p) {
  if (!sorted.length) return NaN
  const idx = p * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

/* ───────── market summary ───────── */

/**
 * Market summary from the ranking rows of the cross-channel search (search.js rankResults):
 * rows = [{ verdict: 'same' | 'variant', candidate: { source, title, url, price, buyerFee, shippingCost }, totalNow, expectedTotal }].
 * Uses the 'same' rows when there are at least three, otherwise same + variant; null with fewer than two usable rows.
 * Percentiles are linear-interpolated over candidate.price; `medianTotal` is the median of the totals as listed now;
 * `best` is the row with the lowest expected total after negotiation, `bestTotal` that total and `bestAltPrice` its
 * price basis (expected total minus the row's fee and shipping): what the buyer would pay the other seller for the item.
 * `gapPct` = how far `referencePrice` (the listing on screen) sits above (+) or below (−) the median, or null.
 */
export function marketFromRows(rows, { referencePrice = null } = {}) {
  const usable = (Array.isArray(rows) ? rows : []).filter((r) => r && r.candidate && (r.verdict === 'same' || r.verdict === 'variant')
    && Number.isFinite(r.candidate.price) && r.candidate.price > 0)
  const same = usable.filter((r) => r.verdict === 'same')
  const pool = same.length >= 3 ? same : usable
  if (pool.length < 2) return null

  const prices = pool.map((r) => r.candidate.price).sort((a, b) => a - b)
  const totalOf = (r) => valFinite(r.totalNow, r.candidate.price + valFinite(r.candidate.buyerFee) + valFinite(r.candidate.shippingCost))
  const expectedOf = (r) => valFinite(r.expectedTotal, totalOf(r))
  const totals = pool.map(totalOf).sort((a, b) => a - b)
  const bestRow = pool.reduce((a, b) => (expectedOf(b) < expectedOf(a) - 1e-9 || (Math.abs(expectedOf(b) - expectedOf(a)) <= 1e-9 && totalOf(b) < totalOf(a)) ? b : a))
  const c = bestRow.candidate
  const medianPrice = valR2(percentile(prices, 0.5))
  const bestTotal = valR2(expectedOf(bestRow))
  return {
    n: pool.length,
    sameCount: same.length,
    medianPrice,
    p25Price: valR2(percentile(prices, 0.25)),
    p75Price: valR2(percentile(prices, 0.75)),
    medianTotal: valR2(percentile(totals, 0.5)),
    bestTotal,
    bestAltPrice: valR2(bestTotal - valFinite(c.buyerFee) - valFinite(c.shippingCost)),
    best: { source: c.source || null, title: c.title || '', url: c.url || null, price: c.price, totalNow: valR2(totalOf(bestRow)), expectedTotal: bestTotal },
    gapPct: Number.isFinite(referencePrice) && referencePrice > 0 && medianPrice > 0 ? Math.round((referencePrice / medianPrice - 1) * 100) : null,
  }
}

/* ───────── expected price curve ───────── */

/**
 * Expected price paid as a function of the discount asked (integer percentages 1..maxDiscountPct): each point runs the
 * full analysis at that target (same moment, profile and market as the one on screen) and weighs the price by its
 * overall probability, the fallback by the rest. The fallback is the best alternative's price basis when the market has
 * one below the listing price, otherwise the listing price itself (buy here at full price).
 * Returns { listPrice, fallback, points: [{ discountPct, price, probability, expected }], best, atTarget, savingVsList }
 * (best = lowest expected, ties to the lower discount; atTarget = the point nearest the form's own target) or null
 * when the form is invalid or no discount is sendable.
 */
export function expectedPriceCurve(form, now, { profile = null, market = null, maxDiscountPct = VINTED.MAX_DISCOUNT_PCT } = {}) {
  const ownTarget = parsePrice(form && form.targetPrice)
  const probe = normalizeInput({ ...form, targetPrice: Number.isFinite(ownTarget) && ownTarget > 0 ? ownTarget : form && form.listPrice })
  if (!probe.ok) return null
  const listPrice = probe.input.listPrice
  const step = priceStepFor(listPrice)
  const alt = market && Number.isFinite(market.bestAltPrice) ? market.bestAltPrice : null
  const fallback = alt !== null && alt < listPrice ? alt : listPrice
  const options = { ...(profile ? { profile } : {}), ...(market ? { market } : {}) }

  const points = []
  const seen = new Set()
  for (let d = 1; d <= maxDiscountPct; d++) {
    const price = valR2(roundTo(listPrice * (1 - d / 100), step))
    if (price <= 0 || price >= listPrice || seen.has(price)) continue
    seen.add(price)
    const result = analyzeOffer({ ...form, targetPrice: price }, now, options)
    if (!result.ok || result.kind !== 'analysis') continue
    const p = result.probability
    points.push({ discountPct: result.input.discountPct, price, probability: p, expected: valR2(p * price + (1 - p) * fallback) })
  }
  if (!points.length) return null
  const best = points.reduce((a, b) => (b.expected < a.expected ? b : a))
  const atTarget = Number.isFinite(ownTarget) && ownTarget > 0
    ? points.reduce((a, b) => (Math.abs(b.price - ownTarget) < Math.abs(a.price - ownTarget) ? b : a))
    : null
  return { listPrice, fallback, points, best, atTarget, savingVsList: valR2(listPrice - best.expected) }
}

/* ───────── levers ───────── */

/** Buyer total on Vinted for a price: commission 5% + 0,70 €, shipping excluded. */
const vintedTotal = (price) => valR2(price * (1 + VINTED.BUYER_FEE_PCT / 100) + VINTED.BUYER_FEE_FIXED)

/** Prior probability of a price drop of 10% or more within 7 days, by listing age (not yet calibrated on outcomes). */
const dropPriorFor = (days) => (days < 14 ? 0.12 : days <= 30 ? 0.2 : 0.15)

/**
 * The moves beyond the single offer, each with its estimated value in euros. `result` is an analyzeOffer result
 * (any kind), `form` the raw form it came from (fallback when the result carries no input), `market` from
 * marketFromRows, `signals` = { favourites, sellerItems, bundleDiscountPct }.
 * Returns [{ id, title, body, valueEur, probability, action }] sorted by value (nulls last):
 * market_buy_now · alternative · favourite_wait · bundle · patience. Every body says what is an estimate.
 * `action` is null or { kind: 'reminder', hours, at } (at = `now` + hours, for the UI's notification).
 */
export function leversFor({ result, form = null, market = null, signals = {}, now = new Date() }) {
  let input = result && result.ok && result.input ? result.input : null
  if (!input && form) {
    const n = normalizeInput(form)
    input = n.ok ? n.input : null
  }
  if (!input) return []
  const L = input.listPrice
  const days = input.listingAge.days
  const sig = signals || {}
  const hasMarket = market && market.n >= 2 && Number.isFinite(market.medianPrice)
  const reminder = (hours) => ({ kind: 'reminder', hours, at: new Date(now.getTime() + hours * 3_600_000) })
  const levers = []

  if (hasMarket && Number.isFinite(market.p25Price) && L <= market.p25Price) {
    levers.push({
      id: 'market_buy_now',
      title: 'Sotto il mercato: compra subito',
      body: `L'annuncio costa meno del quarto più economico degli annunci simili (mediana ${formatEuro(market.medianPrice)}): a questo prezzo sparisce in fretta e un'offerta rischia di farti perdere l'articolo. Stima su ${market.n} annunci trovati altrove.`,
      valueEur: valR2(market.medianPrice - L),
      probability: null,
      action: null,
    })
  }

  const best = hasMarket && market.best && Number.isFinite(market.best.expectedTotal) ? market.best : null
  const listTotal = vintedTotal(L)
  if (best && best.expectedTotal + 0.5 < listTotal) {
    levers.push({
      id: 'alternative',
      title: `Alternativa su ${sourceLabel(best.source)}`,
      body: `${best.title ? `"${best.title}"` : 'Lo stesso modello'} su ${sourceLabel(best.source)} dovrebbe costare circa ${formatEuro(best.expectedTotal)} tutto compreso dopo la trattativa, contro ${formatEuro(listTotal)} qui a prezzo pieno con la commissione. Stima: dipende da come risponde l'altro venditore.`,
      valueEur: valR2(listTotal - best.expectedTotal),
      probability: null,
      action: null,
    })
  }

  if (result && result.kind === 'analysis' && (result.probability < 0.5 || days <= 14)) {
    levers.push({
      id: 'favourite_wait',
      title: 'Metti nei preferiti e aspetta',
      body: 'Metti nei preferiti e aspetta 48–72 ore: i venditori mandano sconti a chi ha messo il cuore, senza il limite del 40%. La probabilità (25%) e lo sconto (15%) sono una stima non ancora calibrata.',
      valueEur: valR2(0.15 * L),
      probability: 0.25,
      action: reminder(60),
    })
  }

  if (Number.isFinite(sig.sellerItems) && sig.sellerItems >= 2) {
    const pct = Number.isFinite(sig.bundleDiscountPct) && sig.bundleDiscountPct > 0 ? sig.bundleDiscountPct : 10
    levers.push({
      id: 'bundle',
      title: 'Chiedi un prezzo per due articoli',
      body: `Il venditore ha ${sig.sellerItems} articoli in vendita: chiedi un prezzo per due pezzi insieme, risparmi una spedizione e lo sconto sul lotto si ottiene più facilmente. Stima: ${pct}% sul lotto più 3,50 € di spedizione.`,
      valueEur: valR2((pct / 100) * L + 3.5),
      probability: null,
      action: null,
    })
  }

  if (days >= 7) {
    const pDrop = dropPriorFor(days)
    const category = input.category || CATEGORIES.find((c) => c.id === 'other')
    const rate = category.dailySellRate * ageHazardMultiplier(days) * marketHazardMultiplier(L, market)
    const pLost = 1 - Math.pow(1 - rate, 7)
    levers.push({
      id: 'patience',
      title: 'Aspetta 7 giorni',
      body: `Aspetta 7 giorni: ${Math.round(pDrop * 100)}% di probabilità di un ribasso, ${Math.round(pLost * 100)}% di perderlo. Stima su medie di categoria, non sul singolo venditore.`,
      valueEur: valR2(pDrop * 0.1 * L),
      probability: pDrop,
      action: reminder(7 * 24),
    })
  }

  return levers.sort((a, b) => {
    if (a.valueEur === null && b.valueEur === null) return 0
    if (a.valueEur === null) return 1
    if (b.valueEur === null) return -1
    return b.valueEur - a.valueEur
  })
}

/* ───────── portfolio of offers ───────── */

/**
 * One offer per listing on up to `maxRows` comparable listings, chosen to minimise the expected price paid.
 * curves = [{ id, label, points: [{ price, total, probability }] }], points sorted by price (at most 10 each).
 * Every combination of points is enumerated (≤ 10^3), and for each the 2^k acceptance subsets with probability
 * Π p · Π (1 − p): the buyer pays the lowest total among the accepted offers, or `fallbackTotal` when none accepts.
 * Points at or above the fallback are never worth offering and are dropped. Returns { picks, pAny, expectedMin,
 * fallbackTotal, bestSingle: { id, expected }, savingVsSingle } or null without usable curves.
 */
export function portfolioPlan(curves, { fallbackTotal, maxRows = 3 } = {}) {
  if (!Number.isFinite(fallbackTotal)) return null
  const rows = (Array.isArray(curves) ? curves : [])
    .map((c) => ({
      id: c.id,
      label: c.label || '',
      points: (Array.isArray(c.points) ? c.points : []).filter((p) => Number.isFinite(p.total) && Number.isFinite(p.probability)
        && p.probability >= 0 && p.probability <= 1 && p.total < fallbackTotal).slice(0, 10),
    }))
    .filter((c) => c.points.length)
    .slice(0, maxRows)
  if (!rows.length) return null

  const expectedMinOf = (picks) => {
    const k = picks.length
    let expected = 0
    for (let mask = 0; mask < 1 << k; mask++) {
      let prob = 1
      let payoff = fallbackTotal
      for (let i = 0; i < k; i++) {
        if (mask & (1 << i)) {
          prob *= picks[i].probability
          payoff = Math.min(payoff, picks[i].total)
        } else {
          prob *= 1 - picks[i].probability
        }
      }
      expected += prob * payoff
    }
    return expected
  }

  let bestPicks = null
  let bestE = Infinity
  const idx = rows.map(() => 0)
  for (;;) {
    const picks = rows.map((r, i) => r.points[idx[i]])
    const e = expectedMinOf(picks)
    if (e < bestE - 1e-9) { bestE = e; bestPicks = picks }
    let i = rows.length - 1
    while (i >= 0 && ++idx[i] >= rows[i].points.length) idx[i--] = 0
    if (i < 0) break
  }

  const singles = rows.map((r) => ({ id: r.id, expected: Math.min(...r.points.map((p) => p.probability * p.total + (1 - p.probability) * fallbackTotal)) }))
  const bestSingle = singles.reduce((a, b) => (b.expected < a.expected ? b : a))
  const pAny = 1 - bestPicks.reduce((acc, p) => acc * (1 - p.probability), 1)
  return {
    picks: bestPicks.map((p, i) => ({ id: rows[i].id, label: rows[i].label, price: p.price, total: p.total, probability: p.probability })),
    pAny,
    expectedMin: valR2(bestE),
    fallbackTotal,
    bestSingle: { id: bestSingle.id, expected: valR2(bestSingle.expected) },
    savingVsSingle: valR2(bestSingle.expected - bestE),
  }
}

/* ───────── seller's reserve price ───────── */

const RESERVE_GRID_POINTS = 81
const RESERVE_FLOOR_SHARE = 0.5
const RESERVE_REJECT_FACTOR = 0.08
const RESERVE_COUNTER_FACTOR = 0.05
const RESERVE_PDF_FLOOR = 1e-4
const RESERVE_SUGGEST_MIN_SHARE = 0.6

/**
 * Posterior of the seller's reserve price on a grid of 81 prices from 50% to 100% of the listing price.
 * Prior: the first-offer base curve read as P(reserve ≤ x) (its differences are the pdf, floored at 1e-4).
 * history = [{ side: 'buyer' | 'seller', price }] in order: a buyer offer answered by a seller entry (a counter or,
 * with no price, a refusal) multiplies the mass at or below it by 0,08 (a soft "reserve > b"); a seller counter c
 * multiplies the mass above it by 0,05 (a soft "reserve ≤ c"). Returns { median, p20, p80, grid: [{ price, cdf }],
 * suggested }: `suggested` minimises cdf(x)·x + (1 − cdf(x))·cLast over x ≥ 60% of list (cLast = his last counter, or
 * the list price), null until he has answered at least once.
 */
export function reservationPosterior({ listPrice, history = [] }) {
  const L = parsePrice(listPrice)
  if (!Number.isFinite(L) || L <= 0) return null
  const lo = RESERVE_FLOOR_SHARE * L
  const dx = (L - lo) / (RESERVE_GRID_POINTS - 1)
  const grid = Array.from({ length: RESERVE_GRID_POINTS }, (_, i) => lo + i * dx)
  const F0 = (x) => squash(baseLogitFor(computeDiscountPct(L, x)))
  const pdf = grid.map((x) => Math.max(RESERVE_PDF_FLOOR, F0(x) - F0(x - dx)))

  const moves = (Array.isArray(history) ? history : []).filter((h) => h && (h.side === 'buyer' || h.side === 'seller'))
  let lastCounter = null
  let answered = false
  for (let i = 0; i < moves.length; i++) {
    const h = moves[i]
    const price = valPrice(h.price)
    if (h.side === 'buyer') {
      if (!Number.isFinite(price) || i === moves.length - 1 || moves[i + 1].side !== 'seller') continue
      for (let g = 0; g < grid.length; g++) if (grid[g] <= price + 1e-9) pdf[g] *= RESERVE_REJECT_FACTOR
    } else {
      answered = true
      if (!Number.isFinite(price)) continue
      lastCounter = price
      for (let g = 0; g < grid.length; g++) if (grid[g] > price + 1e-9) pdf[g] *= RESERVE_COUNTER_FACTOR
    }
  }

  const mass = pdf.reduce((s, v) => s + v, 0)
  let acc = 0
  const cdf = pdf.map((v) => (acc += v / mass))
  const quantile = (q) => valR2(grid[Math.max(0, cdf.findIndex((c) => c >= q - 1e-12))])
  let suggested = null
  if (answered) {
    const cLast = lastCounter ?? L
    let bestCost = Infinity
    for (let g = 0; g < grid.length; g++) {
      if (grid[g] < RESERVE_SUGGEST_MIN_SHARE * L - 1e-9) continue
      const cost = cdf[g] * grid[g] + (1 - cdf[g]) * cLast
      if (cost < bestCost - 1e-9) { bestCost = cost; suggested = valR2(grid[g]) }
    }
  }
  return { median: quantile(0.5), p20: quantile(0.2), p80: quantile(0.8), grid: grid.map((x, g) => ({ price: valR2(x), cdf: cdf[g] })), suggested }
}
