import {
  AGE_CURVE, BASE_CURVE, CATEGORIES, GAP_CURVE, INACTIVE_TIME_DAMPING, LISTING_AGES, LISTING_SIGNALS,
  MONTH_END_WEIGHT, MONTH_START_WEIGHT, MONTH_WINDOWS, NEGATIVE_CAP, NEUTRAL_WINDOW, POSITIVE_CAP,
  RISK_BANDS, TIME_WINDOWS, UNCERTAINTY_MAX, UNCERTAINTY_PER_UNKNOWN,
} from './constants.js'
import { clamp, interpolate, interpolateLogit, ramp, squash } from './math.js'
import { daysInMonth, isItalianHoliday, minutesOfDay } from './dates.js'

export const findCategory = (id) => CATEGORIES.find((c) => c.id === id) || null
export const findListingAge = (id) => LISTING_AGES.find((a) => a.id === id) || LISTING_AGES[0]
export const findListingSignal = (id) => LISTING_SIGNALS.find((s) => s.id === id) || LISTING_SIGNALS[0]

export const computeDiscountPct = (listPrice, targetPrice) =>
  listPrice > 0 ? ((listPrice - targetPrice) / listPrice) * 100 : 0

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

export const gapWeight = (listPrice, targetPrice) => interpolate(GAP_CURVE, Math.max(0, listPrice - targetPrice))

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
  return TIME_WINDOWS.find((w) => w.days.includes(day) && minutes >= w.from && minutes < w.to) || NEUTRAL_WINDOW
}

/** Inactive sellers read the offer at a random moment: timing barely matters for them. */
export const timeWeight = (window, sellerProfileId) =>
  window.weight * (sellerProfileId === 'inactive' ? INACTIVE_TIME_DAMPING : 1)

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
    { id: 'gap', group: 'price', label: `Differenza di ${Math.round(listPrice - targetPrice)} €`, weight: gapWeight(listPrice, targetPrice) },
    { id: 'signal', group: 'signal', label: listingSignal.id === 'none' ? 'Testo annuncio' : `Annuncio: ${listingSignal.label.toLowerCase()}`, weight: signalWeight(listingSignal) },
    { id: 'age', group: 'age', label: listingAge.id === 'unknown' ? 'Anzianità non indicata' : `Annuncio ${listingAge.label.toLowerCase()}`, weight: age.today },
    { id: 'wait', group: 'age', label: daysWaited > 0 ? `Attesa di ${daysWaited} ${daysWaited === 1 ? 'giorno' : 'giorni'}` : 'Nessuna attesa', weight: age.wait },
    { id: 'seller', group: 'seller', label: sellerLabel(sellerProfile), weight: sellerWeight(sellerProfile, discountPct) },
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
  return {
    base,
    logit: total,
    pAccept: squash(total),
    pBase: squash(base),
    factors,
    capped: posScale < 1 || negScale < 1,
    timeWindow,
    monthWindow,
    ageDays: listingAge.days + daysWaited,
  }
}

const sellerLabel = (id) =>
  ({ new_seller: 'Venditore nuovo', expert: 'Venditore esperto', inactive: 'Venditore inattivo' })[id] || 'Venditore non indicato'

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
