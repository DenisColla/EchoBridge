import {
  AGE_CURVE, BASE_CURVE, CATEGORIES, DOM_SIGNAL_SCALE, GAP_EUR_CURVE, HOLIDAY_WINDOW_LABELS, HOLIDAY_WINDOW_WHY, INACTIVE_TIME_DAMPING, LISTING_AGES, LISTING_SIGNALS,
  MONTH_END_WEIGHT, MONTH_START_WEIGHT, MONTH_WINDOWS, NEGATIVE_CAP, NEUTRAL_WINDOW, POSITIVE_CAP, PRICE_BAND_CURVE,
  RISK_BANDS, SIGNAL_THRESHOLDS, SIGNAL_WEIGHTS, TIME_WINDOWS, UNCERTAINTY_MAX, UNCERTAINTY_PER_UNKNOWN,
} from './constants.js'
import { clamp, interpolate, interpolateLogit, ramp, squash } from './math.js'
import { daysInMonth, isItalianHoliday, minutesOfDay } from './dates.js'
import { learnedOfferRow } from './profile.js'

export const findCategory = (id) => CATEGORIES.find((c) => c.id === id) || null
export const findListingAge = (id) => LISTING_AGES.find((a) => a.id === id) || LISTING_AGES[0]
export const findListingSignal = (id) => LISTING_SIGNALS.find((s) => s.id === id) || LISTING_SIGNALS[0]

/** Quantised to 1e-6 so that exact 15% / 30% / 40% offers on decimal prices do not drift across a band edge. */
export const computeDiscountPct = (listPrice, targetPrice) =>
  listPrice > 0 ? Math.round(((listPrice - targetPrice) / listPrice) * 100 * 1e6) / 1e6 : 0

/** < 15% low · 15–30% (inclusive) medium · > 30% high */
export const riskBandFor = (discountPct) => {
  if (discountPct < 15) return RISK_BANDS[0]
  if (discountPct <= 30) return RISK_BANDS[1]
  return RISK_BANDS[2]
}

export const baseLogitFor = (discountPct) => interpolateLogit(BASE_CURVE, discountPct)

/* ───────── individual factors (logit units) ───────── */

export const categoryWeight = (category) => (category ? category.weight : 0)

/** Premium categories punish, disposable ones tolerate, aggressive discounts. Ramps between 25% and 35%. */
export const interactionWeight = (category, discountPct) => {
  if (!category) return 0
  const r = ramp(discountPct, 25, 35)
  if (category.premium) return -0.4 * r
  if (category.disposable) return 0.15 * r
  return 0
}

/** Price band of the listing: cheap items leave the seller nothing to gain from a discount, expensive ones leave room. */
export const priceBandWeight = (listPrice) => interpolate(PRICE_BAND_CURVE, Math.max(0, listPrice))

/** The absolute euro gap weighs on its own only when it is large (60 € and more). */
export const gapEuroWeight = (listPrice, targetPrice) => interpolate(GAP_EUR_CURVE, Math.max(0, listPrice - targetPrice))

export const signalWeight = (signal) => (signal ? signal.weight : 0)

export const ageCurve = (days) => interpolate(AGE_CURVE, days)

/**
 * Two components: the listing's age today, and how much the seller softens while we wait.
 * For an unknown age we assume nothing today and let waiting count half (capped).
 */
export const ageWeights = (listingAge, category, daysWaited) => {
  const mult = category ? category.ageMultiplier : 1
  const today = listingAge.id === 'unknown' ? 0 : ageCurve(listingAge.days) * mult
  let wait = (ageCurve(listingAge.days + daysWaited) - ageCurve(listingAge.days)) * mult
  if (listingAge.id === 'unknown') wait = Math.min(0.15, wait * 0.5)
  return { today, wait }
}

/** Expert sellers accept small discounts gladly and refuse aggressive ones; ramps avoid cliffs. */
export const sellerWeight = (sellerProfileId, discountPct) => {
  switch (sellerProfileId) {
    case 'new_seller':
      return 0.2
    case 'expert':
      if (discountPct <= 10) return 0.15
      if (discountPct <= 20) return 0.15 - 0.25 * ramp(discountPct, 10, 20)
      if (discountPct <= 25) return -0.1
      return -0.1 - 0.25 * ramp(discountPct, 25, 35)
    default:
      return 0
  }
}

/** Holidays behave like Sundays. */
export const effectiveWeekday = (date) => (isItalianHoliday(date) ? 0 : date.getDay())

export const timeWindowAt = (date) => {
  const day = effectiveWeekday(date)
  const minutes = minutesOfDay(date)
  const window = TIME_WINDOWS.find((w) => w.days.includes(day) && minutes >= w.from && minutes < w.to) || NEUTRAL_WINDOW
  if (day !== date.getDay() && HOLIDAY_WINDOW_LABELS[window.id]) {
    return { ...window, label: HOLIDAY_WINDOW_LABELS[window.id], why: HOLIDAY_WINDOW_WHY, holiday: true }
  }
  return window
}

/** Inactive sellers read the offer at a random moment: timing barely matters for them. */
export const timeWeight = (window, sellerProfileId) =>
  window.weight * (sellerProfileId === 'inactive' ? INACTIVE_TIME_DAMPING : 1)

/* ───────── market and demand (cross-channel search, listing signals) ───────── */

/**
 * Logit weight of the listing's price against its market (median of comparable listings found elsewhere): a listing
 * priced above its market tolerates deeper discounts, one priced below it does not. 0.9·ln(list / median), clamped to
 * [−0.5, +0.6]; 0 without a market or with fewer than two comparable listings. Lives here (not in value.js) because
 * value.js imports analyze.js, which imports this module.
 */
export const marketGapWeight = (listPrice, market) => {
  if (!market || !(market.n >= 2) || !(market.medianPrice > 0) || !(listPrice > 0)) return 0
  return clamp(0.9 * Math.log(listPrice / market.medianPrice), -0.5, 0.6)
}

/** A DOM-only weight under its scale: an explicit 0 when the scale is 0 (never −0, which trips strict comparisons). */
const scaledWeight = (weight, scale) => (scale === 0 ? 0 : weight * scale)

/** The hearts on the listing: favourites (cross-channel search) first, else the DOM's «interessati»; null without either. */
export const heartsOf = (signals) => {
  if (!signals) return null
  if (Number.isFinite(signals.favourites)) return { n: signals.favourites, source: 'favourites' }
  if (Number.isFinite(signals.interested)) return { n: signals.interested, source: 'interested' }
  return null
}

/**
 * Demand prior from the hearts on the listing: none → the seller is glad of any interest (+0.1); 4–9 → he can wait
 * (−0.15); 10 or more → he expects to sell at his price (−0.3); a listing under 3 days old with 3 or more → −0.3.
 * Deliberately small: a prior not yet calibrated on outcomes. The DOM's «interessati» count weighs DOM_SIGNAL_SCALE
 * (0 until a hydrated fixture exists). 0 without a finite count. `ageDays` is the listing's age today (optional).
 */
export const demandWeight = (signals, ageDays = null) => {
  const hearts = heartsOf(signals)
  if (!hearts) return 0
  const W = SIGNAL_WEIGHTS.demand
  const T = SIGNAL_THRESHOLDS
  const n = hearts.n
  let w
  if (Number.isFinite(ageDays) && ageDays < T.freshDays && n >= T.freshHearts) w = W.fresh
  else if (n <= 0) w = W.none
  else if (n < T.someHearts) w = W.few
  else if (n < T.manyHearts) w = W.some
  else w = W.many
  return hearts.source === 'interested' ? scaledWeight(w, DOM_SIGNAL_SCALE.interested) : w
}

/** Hours since the seller cut the price, from `signals.priceDrop.hoursAgo` or `priceDropHoursAgo`; null when unknown. */
const dropHoursOf = (signals) => {
  if (!signals) return null
  if (signals.priceDrop && typeof signals.priceDrop === 'object' && Number.isFinite(signals.priceDrop.hoursAgo)) return signals.priceDrop.hoursAgo
  return Number.isFinite(signals.priceDropHoursAgo) ? signals.priceDropHoursAgo : null
}
export const priceDroppedOf = (signals) => Boolean(signals && (signals.priceDropped === true || (signals.priceDrop && typeof signals.priceDrop === 'object') || dropHoursOf(signals) !== null))

/**
 * A price already cut (DOM only, so scaled by DOM_SIGNAL_SCALE.reduced): ≥ 48 h ago the seller is «in modalità
 * vendita» (+0.15), under 48 h he has just moved and will not move again (−0.2); with the drop's age unknown, 0.
 */
export const reducedWeight = (signals) => {
  if (!priceDroppedOf(signals)) return 0
  const hours = dropHoursOf(signals)
  if (hours === null) return 0
  const w = hours >= SIGNAL_THRESHOLDS.recentDropHours ? SIGNAL_WEIGHTS.reduced.settled : SIGNAL_WEIGHTS.reduced.recent
  return scaledWeight(w, DOM_SIGNAL_SCALE.reduced)
}

/**
 * Views (DOM only, scaled by DOM_SIGNAL_SCALE.views): a listing ≥ 14 days old seen under twice a day is dead (+0.1);
 * ≥ 150 views with at most 2 hearts is over-priced and the seller knows (+0.1); ≥ 30 views a day in its first 3 days
 * is hot (−0.1). 0 without a finite count or a known age.
 */
export const viewsWeight = (signals, ageDays) => {
  if (!signals || !Number.isFinite(signals.views) || !Number.isFinite(ageDays)) return 0
  const T = SIGNAL_THRESHOLDS
  const W = SIGNAL_WEIGHTS.views
  const perDay = signals.views / Math.max(1, ageDays)
  const hearts = heartsOf(signals)
  let w = 0
  if (ageDays >= T.deadAgeDays && perDay < T.deadViewsPerDay) w = W.dead
  else if (signals.views >= T.overpricedViews && hearts && hearts.n <= T.overpricedHearts) w = W.overpriced
  else if (ageDays < T.hotDays && perDay >= T.hotViewsPerDay) w = W.hot
  return scaledWeight(w, DOM_SIGNAL_SCALE.views)
}

/**
 * Multiplier on the daily sell-through hazard from the listing's place in its market: a bargain (at or under the first
 * quartile) sells fast (×1.5), an expensive listing (at or over the third quartile) lingers (×0.7), linear in between.
 * 1 without a market.
 */
export const marketHazardMultiplier = (listPrice, market) => {
  if (!market || !(market.n >= 2) || !Number.isFinite(market.p25Price) || !Number.isFinite(market.p75Price) || !(listPrice > 0)) return 1
  if (listPrice <= market.p25Price) return 1.5
  if (listPrice >= market.p75Price) return 0.7
  return 1.5 - 0.8 * ((listPrice - market.p25Price) / (market.p75Price - market.p25Price))
}

/**
 * Extra factors that exist only when the input carries a market or listing signals: nothing is appended otherwise, so
 * the factor list of a plain form is unchanged. The signal rows are priors (`prior: true`, engine-spec §3.2): the UI
 * labels them «stima» and the record stores them for a later fit; the DOM-only ones weigh 0 for now (DOM_SIGNAL_SCALE).
 */
const contextFactors = (input) => {
  const { listPrice, market, signals, listingAge } = input
  const extra = []
  if (market && market.n >= 2 && market.medianPrice > 0) {
    const gapPct = Math.round((listPrice / market.medianPrice - 1) * 100)
    const label = gapPct === 0 ? 'Prezzo in linea con il mercato' : gapPct > 0 ? `Prezzo ${gapPct}% sopra il mercato` : `Prezzo ${-gapPct}% sotto il mercato`
    extra.push({ id: 'market', group: 'price', label, weight: marketGapWeight(listPrice, market) })
  }
  if (!signals) return extra
  const ageDays = listingAge && listingAge.id !== 'unknown' ? listingAge.days : null
  const hearts = heartsOf(signals)
  if (hearts) {
    const n = hearts.n
    const word = hearts.source === 'favourites' ? ['preferito', 'preferiti'] : ['interessato', 'interessati']
    const label = n <= 0 ? `Nessun ${word[0]}` : n === 1 ? `1 ${word[0]}` : `${n} ${word[1]}`
    extra.push({ id: 'demand', group: 'signal', label, weight: demandWeight(signals, ageDays), prior: true, source: hearts.source })
  }
  if (priceDroppedOf(signals)) {
    const hours = dropHoursOf(signals)
    const label = hours === null ? 'Prezzo già ribassato' : hours < SIGNAL_THRESHOLDS.recentDropHours ? 'Prezzo ribassato da poco' : 'Prezzo ribassato da tempo'
    extra.push({ id: 'reduced', group: 'signal', label, weight: reducedWeight(signals), prior: true })
  }
  if (Number.isFinite(signals.views)) {
    extra.push({ id: 'views', group: 'signal', label: `${signals.views} visualizzazioni`, weight: viewsWeight(signals, ageDays), prior: true })
  }
  if (Number.isFinite(signals.sellerItems)) {
    const n = signals.sellerItems
    extra.push({ id: 'seller_items', group: 'signal', label: n === 1 ? 'Il venditore ha 1 articolo' : `Il venditore ha ${n} articoli`, weight: scaledWeight(SIGNAL_WEIGHTS.sellerItems, DOM_SIGNAL_SCALE.sellerItems), prior: true })
  }
  return extra
}

/** Month-end effect anchored to the last day (short months shift earlier), with ramps instead of cliffs. */
export const monthWindowAt = (date) => {
  const day = date.getDate()
  const daysToEnd = daysInMonth(date) - day
  if (daysToEnd <= 6) return { ...MONTH_WINDOWS.end, weight: MONTH_END_WEIGHT }
  if (daysToEnd <= 13) return { ...MONTH_WINDOWS.late, weight: MONTH_END_WEIGHT * (1 - (daysToEnd - 6) / 7) }
  if (day <= 5) return { ...MONTH_WINDOWS.start, weight: MONTH_START_WEIGHT }
  if (day <= 8) return { ...MONTH_WINDOWS.start, weight: MONTH_START_WEIGHT * (1 - (day - 5) / 3) }
  return { ...MONTH_WINDOWS.mid, weight: 0 }
}

/* ───────── full score at a given send moment ───────── */

/**
 * Scores the offer if sent at `sendDate`, `daysWaited` days from now.
 * Returns the base logit, the (capped) factor list in a fixed order, the total logit and pAccept.
 * `input.market` (from value.js marketFromRows) and `input.signals` ({ favourites }) add a factor each when present.
 */
export function scoreAt(input, sendDate, daysWaited = 0) {
  const { discountPct, category, listingAge, sellerProfile, listingSignal, listPrice, targetPrice } = input
  const base = baseLogitFor(discountPct)
  const timeWindow = timeWindowAt(sendDate)
  const monthWindow = monthWindowAt(sendDate)
  const age = ageWeights(listingAge, category, daysWaited)

  const raw = [
    { id: 'category', group: 'category', label: category ? `Categoria ${category.label.toLowerCase()}` : 'Categoria', weight: categoryWeight(category) },
    { id: 'interaction', group: 'category', label: category && category.premium ? 'Sconto alto su categoria di valore' : 'Categoria tollerante agli sconti alti', weight: interactionWeight(category, discountPct) },
    { id: 'price_band', group: 'price', label: `Prezzo in annuncio ${formatBandPrice(listPrice)}`, weight: priceBandWeight(listPrice) },
    { id: 'gap_eur', group: 'price', label: `Differenza di ${Math.round(listPrice - targetPrice)} €`, weight: gapEuroWeight(listPrice, targetPrice) },
    { id: 'signal', group: 'signal', label: listingSignal.id === 'none' ? 'Testo annuncio' : `Annuncio: ${listingSignal.label.toLowerCase()}`, weight: signalWeight(listingSignal) },
    { id: 'age', group: 'age', label: listingAge.id === 'unknown' ? 'Anzianità non indicata' : `Annuncio ${listingAge.label.toLowerCase()}`, weight: age.today },
    { id: 'wait', group: 'age', label: daysWaited > 0 ? `Attesa di ${daysWaited} ${daysWaited === 1 ? 'giorno' : 'giorni'}` : 'Nessuna attesa', weight: age.wait },
    { id: 'seller', group: 'seller', label: sellerLabel(sellerProfile), weight: sellerWeight(sellerProfile, discountPct) },
    // Market and demand factors only when the input carries them (empty otherwise, so the list is unchanged).
    ...contextFactors(input),
    { id: 'time', group: 'time', label: timeWindow.label, weight: timeWeight(timeWindow, sellerProfile), window: timeWindow },
    { id: 'month', group: 'month', label: monthWindow.label, weight: monthWindow.weight, window: monthWindow },
  ]

  // Cap the stacked modifiers so that extreme combinations stay plausible.
  const sumPos = raw.filter((f) => f.weight > 0).reduce((s, f) => s + f.weight, 0)
  const sumNeg = raw.filter((f) => f.weight < 0).reduce((s, f) => s + f.weight, 0)
  const posScale = sumPos > POSITIVE_CAP ? POSITIVE_CAP / sumPos : 1
  const negScale = sumNeg < NEGATIVE_CAP ? NEGATIVE_CAP / sumNeg : 1
  const factors = raw.map((f) => ({ ...f, rawWeight: f.weight, weight: f.weight > 0 ? f.weight * posScale : f.weight * negScale }))

  const total = base + factors.reduce((s, f) => s + f.weight, 0)
  // The learned correction (monthly profile) comes after the caps: it measures how this user's sellers really answer.
  const learned = learnedOfferRow(input.profile, { logit: total, windowId: timeWindow.id, discountPct })
  const logit = learned ? total + learned.weight : total
  return {
    base,
    logit,
    rawLogit: total,
    learnedWeight: learned ? learned.weight : 0,
    pAccept: squash(logit),
    pBase: squash(base),
    factors: learned ? [...factors, learned] : factors,
    capped: posScale < 1 || negScale < 1,
    timeWindow,
    monthWindow,
    ageDays: listingAge.days + daysWaited,
  }
}

const sellerLabel = (id) =>
  ({ new_seller: 'Venditore nuovo', expert: 'Venditore esperto', quiet: 'Venditore poco attivo', inactive: 'Venditore inattivo' })[id] || 'Venditore non indicato'

const formatBandPrice = (listPrice) => `${(Number.isInteger(listPrice) ? String(listPrice) : listPrice.toFixed(2)).replace('.', ',')} €`

/**
 * Sequential attribution in the fixed factor order: each row is the probability
 * change when that factor is added on top of the previous ones, so rows sum
 * exactly to pAccept − pBase (rounding drift is folded into the biggest row).
 */
export function attributeFactors(score) {
  let running = score.base
  let prev = squash(running)
  const rows = []
  for (const f of score.factors) {
    if (f.weight === 0 && f.group !== 'time' && f.group !== 'month') continue
    running += f.weight
    const p = squash(running)
    rows.push({ ...f, deltaPoints: Math.round((p - prev) * 100) })
    prev = p
  }
  const basePct = Math.round(score.pBase * 100)
  const totalPct = Math.round(score.pAccept * 100)
  const drift = totalPct - basePct - rows.reduce((s, r) => s + r.deltaPoints, 0)
  if (drift !== 0 && rows.length) {
    const idx = rows.reduce((best, r, i) => (Math.abs(r.deltaPoints) > Math.abs(rows[best].deltaPoints) ? i : best), 0)
    rows[idx].deltaPoints += drift
  }
  return { basePct, totalPct, rows }
}

/* ───────── risk of a blunt refusal or block (separate from acceptance) ───────── */

export function blockRiskAt(input, sendDate) {
  const { discountPct, category, sellerProfile, listingSignal } = input
  const reasons = []
  let score = 0
  const aggressive = 2 * ramp(discountPct, 27, 33)
  if (aggressive > 0) {
    score += aggressive
    reasons.push(discountPct > 30 ? 'Sconto oltre il 30%' : 'Sconto a ridosso del 30%')
  }
  if (discountPct >= 38) {
    score += 0.5
    reasons.push('Sconto al limite consentito da Vinted')
  }
  if (category && category.premium) {
    score += 1
    reasons.push('Categoria di valore: il venditore conosce il prezzo')
  }
  if (listingSignal && listingSignal.blockScore) {
    score += listingSignal.blockScore
    reasons.push('L\'annuncio dice "prezzo non trattabile"')
  }
  if (sellerProfile === 'new_seller') {
    score += 0.5
    reasons.push('Venditore alle prime vendite: può reagire d\'impulso')
  }
  if (sellerProfile === 'expert') score -= 0.5
  const w = timeWindowAt(sendDate)
  if (w.weight < 0) {
    score += 2 * -w.weight
    reasons.push(`Invio in una fascia sfavorevole (${w.label.toLowerCase()})`)
  }
  const level = score < 1 ? 'low' : score < 2.5 ? 'medium' : 'high'
  const labels = { low: 'Basso', medium: 'Medio', high: 'Alto' }
  return { level, label: labels[level], score, reasons }
}

/** ± percentage points of uncertainty from the optional inputs left blank. */
export function uncertaintyFor(input) {
  let unknowns = 0
  if (input.listingAge.id === 'unknown') unknowns++
  if (!input.sellerProfile || input.sellerProfile === 'unknown') unknowns++
  return clamp(unknowns * UNCERTAINTY_PER_UNKNOWN, 0, UNCERTAINTY_MAX)
}
