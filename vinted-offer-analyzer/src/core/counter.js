/**
 * Counter-offers: our reply when the seller answers our offer with his own price ("Fai il tuo prezzo").
 *
 * For every candidate price c and send moment t the engine computes E(c, t), the euros the buyer is expected to pay
 * in the end, over four outcomes: the seller accepts; he counters again and we follow a shrinking-step rule (one round
 * of lookahead); he declines or goes silent and we fall back to his price or the list price; the item sells to someone
 * else meanwhile (cost: the value of the item). It recommends the (c, t) with the lowest E, or accepting his price
 * when countering would save too little. Acceptance is the eBay field model (Backus et al. 2020) on the share of the
 * remaining gap we concede, plus the split bonus, the seller's stance and the existing time and month windows.
 * Every unknown Vinted rule (counter expiry, survival of his price after our new offer, round limit) is an explicit,
 * configurable assumption: see VINTED_ASSUMED and COUNTER in constants.js.
 *
 * Private helpers are prefixed `ctr` because the artifact bundler puts every module in one scope.
 */
import {
  CANONICAL_SLOTS, COUNTER, COUNTER_OPTION_LABELS, COUNTER_RECEIVED_AGO, NEGATIVE_CAP, POSITIVE_CAP, SELLER_STANCES, TIME_WINDOWS,
  TIMING_MATTERS_SPREAD, VINTED, VINTED_ASSUMED, ageHazardMultiplier,
} from './constants.js'
import { addDays, addMinutes, atTime, calendarDaysBetween, capitalize, ceilToMinutes, formatLongDate, formatTime, isSameDay, minutesOfDay, startOfDay } from './dates.js'
import { formatPoints, interpolate, ramp, squash, toPercent } from './math.js'
import { buildAcceptMessages, buildCounterMessages, formatEuro, recommendedCounterToneFor } from './messages.js'
import { buildVerdict } from './reasoning.js'
import { avoidWindowsOn } from './scheduler.js'
import { ageCurve, attributeFactors, effectiveWeekday, monthWindowAt, sellerWeight, timeWeight, timeWindowAt, uncertaintyFor } from './scoring.js'
import { buildWarnings, normalizeInput, parsePrice, priceStepFor } from './analyze.js'
import { counterShareOf, learnedCounterRow, sellerReplyHoursOf } from './profile.js'

const CTR_EPS = 1e-9
const ctrR2 = (v) => Math.round(v * 100) / 100
const ctrHours = (from, to) => (to.getTime() - from.getTime()) / 3_600_000
const ctrClamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const ctrCeilCent = (x) => Math.ceil(x * 100 - CTR_EPS) / 100
const ctrFloor5 = (d) => new Date(Math.floor(d.getTime() / 300_000) * 300_000)
const ctrPct = (v) => String(Math.round(v * 10) / 10).replace('.', ',')
/** Italian article before a percentage: "il 10%", "l'8%", "l'11%", "l'80%". */
const ctrIl = (n) => {
  const r = Math.round(n)
  if (r === 0) return 'lo '
  return r === 1 || r === 8 || r === 11 || (r >= 80 && r <= 89) ? "l'" : 'il '
}
const ctrApprox = (price, listPrice) => formatEuro(listPrice >= 200 ? Math.round(price) : Math.round(price * 10) / 10)

/* ───────── prices ───────── */

/** "30", "30%", "30,5" → 30 / 30.5. Negative, above 200 or junk → NaN. */
export const parsePercent = (raw) => {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 && raw <= 200 ? raw : NaN
  const s = String(raw ?? '').trim().replace('%', '').replace(/\s+/g, '').replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN
  const v = Number(s)
  return v <= 200 ? v : NaN
}

/** Seller counter typed as "% above my offer": 45 € + 30% = 58,50 €. Rounded to the cent, never to a price grid. */
export const counterFromPercent = (previousOffer, pct) => Math.round(previousOffer * (100 + pct)) / 100

const ctrGrid = (listPrice) => (listPrice < 200 ? 0.1 : 1)

/**
 * "Precise" amounts anchor harder than round ones (Mason et al. 2013) without looking odd:
 * under 200 € cents .30 / .70 / .80 or a whole euro that is not a multiple of 5; from 200 € integers not divisible by 5.
 */
export const isPrecisePrice = (price, listPrice) => {
  if (listPrice >= 200) {
    const r = Math.round(price)
    return Math.abs(price - r) < 1e-6 && r % 5 !== 0
  }
  const cents = Math.round(price * 100) % 100
  const euros = Math.floor(Math.round(price * 100) / 100)
  return cents === 30 || cents === 70 || cents === 80 || (cents === 0 && euros % 5 !== 0)
}

export const precisePricesIn = (lo, hi, listPrice) => {
  const out = []
  const g = ctrGrid(listPrice)
  for (let k = Math.ceil(lo / g - CTR_EPS); k * g <= hi + CTR_EPS; k++) {
    const v = ctrR2(k * g)
    if (isPrecisePrice(v, listPrice)) out.push(v)
  }
  return out
}

/** Largest precise price ≤ x and strictly above `floorExclusive`, or null. */
export const preciseBelow = (x, listPrice, floorExclusive = -Infinity) => {
  const g = ctrGrid(listPrice)
  for (let k = Math.floor(x / g + CTR_EPS); k * g > floorExclusive + CTR_EPS; k--) {
    const v = ctrR2(k * g)
    if (isPrecisePrice(v, listPrice)) return v
  }
  return null
}

/** Midpoint, rounded down to the cent (to the euro from 200 €). */
export const splitPrice = (a, b, listPrice) => {
  const exact = (a + b) / 2
  return listPrice >= 200 ? Math.round(exact - CTR_EPS) : Math.floor(exact * 100 + CTR_EPS) / 100
}

/** Backus' definition of an exact split: γ = 0,50 ± 0,005 of the gap (at least 1 cent, 0,50 € from 200 €). */
export const splitTolerance = (a, b, listPrice) =>
  listPrice >= 200 ? Math.max(COUNTER.SPLIT_TOLERANCE_SHARE * (b - a), 0.5) : Math.max(COUNTER.SPLIT_TOLERANCE_SHARE * (b - a), 0.01)

export const isSplitPrice = (price, a, b, listPrice) => Math.abs(price - (a + b) / 2) <= splitTolerance(a, b, listPrice) + CTR_EPS

/** For when Vinted refuses cents: nearest whole euro that is not a multiple of 5, ties to the lower one. */
export const wholeEuroFallback = (price) => {
  const options = [Math.floor(price), Math.ceil(price), Math.floor(price) - 1, Math.ceil(price) + 1].filter((v) => v % 5 !== 0)
  return options.sort((a, b) => Math.abs(a - price) - Math.abs(b - price) || a - b)[0]
}

/** What the buyer really pays (item + Vinted fee), shipping excluded. */
export const buyerTotal = (price) => ctrR2(price * (1 + VINTED.BUYER_FEE_PCT / 100) + VINTED.BUYER_FEE_FIXED)

/** Stance from the share of the gap the seller conceded (normalised to the first round). */
export const sellerStanceOf = (share) => {
  const t = COUNTER.STANCE_THRESHOLDS
  if (share <= t.hold) return 'hold'
  if (share <= t.firm) return 'firm'
  if (share < t.moving) return 'moving'
  return 'flexible'
}

/** Sellers concede less in later rounds (Keniston: 0,42 then 0,23): rescale to the first-round scale. */
/**
 * The seller's concession relative to a typical first-round one. `mult` (learned, default 1) says how much this
 * user's sellers concede compared with eBay's mean: conceding 42% of the gap is "average" only where 42% is average.
 */
const ctrNormShare = (share, roundIdx, mult = 1) => {
  const means = COUNTER.ROUND_MEAN_SHARE
  return Math.min(0.9, (share * (means[0] / means[Math.min(roundIdx, means.length - 1)])) / mult)
}

/* ───────── input ───────── */

const ctrDate = (v) => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isFinite(d.getTime()) ? d : null
}

const ctrMaxPrice = (raw) => {
  if (raw === undefined || raw === null || raw === '') return null
  const w = parsePrice(raw)
  return Number.isFinite(w) && w > 0 ? w : null
}

/**
 * Validates the raw form (strings, as forms provide them) and derives the negotiation state.
 * Returns { ok, errors, warnings, state }.
 */
export function normalizeCounterInput(raw, now = new Date(), options = {}) {
  const errors = {}
  const warnings = []
  const history = Array.isArray(raw.history) && raw.history.length
    ? raw.history.map((h) => ({ by: h.by, price: Number(h.price), at: ctrDate(h.at), isFinal: Boolean(h.isFinal), unc: Number(h.unc ?? h.receivedUncertaintyMinutes) || 0 }))
    : null
  let useHistory = false
  if (history) {
    useHistory = history.length >= 2 && history[0].by === 'buyer' && history[history.length - 1].by === 'seller'
      && history.every((h, i) => h.by === (i % 2 === 0 ? 'buyer' : 'seller') && Number.isFinite(h.price) && h.price > 0)
    if (!useHistory) errors.history = "La trattativa salvata non è valida: l'ultima mossa deve essere una controproposta del venditore."
  }
  const buyerEntries = useHistory ? history.filter((h) => h.by === 'buyer') : null
  const sellerEntries = useHistory ? history.filter((h) => h.by === 'seller') : null
  const previousRaw = useHistory
    ? buyerEntries[buyerEntries.length - 1].price
    : (raw.previousOffer !== undefined && raw.previousOffer !== null && raw.previousOffer !== '' ? raw.previousOffer : raw.targetPrice)

  const base = normalizeInput({ ...raw, targetPrice: previousRaw })
  if (!base.ok) {
    if (base.errors.category) errors.category = base.errors.category
    if (base.errors.listPrice) errors.listPrice = base.errors.listPrice
    if (base.errors.targetPrice) errors.previousOffer = "Inserisci l'offerta che hai inviato (ad esempio 45)."
  }

  const mode = raw.counterMode === 'pct' ? 'pct' : 'eur'
  const B0 = parsePrice(previousRaw)
  let S0 = NaN
  let enteredAs = null
  if (!history) {
    if (mode === 'pct') {
      const pct = parsePercent(raw.sellerCounter)
      if (Number.isFinite(pct) && Number.isFinite(B0)) S0 = counterFromPercent(B0, pct)
      enteredAs = { mode, value: pct }
    } else {
      S0 = parsePrice(raw.sellerCounter)
      enteredAs = { mode, value: S0 }
    }
    if (!Number.isFinite(S0) || S0 <= 0) errors.sellerCounter = 'Inserisci la controproposta del venditore (ad esempio 58,50 o 30%).'
  }
  if (Object.keys(errors).length) return { ok: false, errors, warnings, state: null }

  const input = options.profile ? { ...base.input, profile: options.profile } : base.input
  const L = input.listPrice
  const buyers = useHistory ? buyerEntries.map((h) => h.price) : [B0]
  const sellers = useHistory ? sellerEntries.map((h) => h.price) : [S0]
  const lastSeller = sellers[sellers.length - 1]
  if (lastSeller > L + CTR_EPS) {
    let message = 'La controproposta non può superare il prezzo di listino.'
    if (!useHistory && mode === 'pct') message = `La controproposta non può superare il prezzo di listino (${formatEuro(B0)} + ${ctrPct(enteredAs.value)}% = ${formatEuro(S0)}).`
    return { ok: false, errors: { sellerCounter: message }, warnings, state: null }
  }

  const k = sellers.length
  const n = buyers.length - 1
  const B = buyers[n]
  const Sprev = k >= 2 ? sellers[k - 2] : L
  const raised = lastSeller > Sprev + 0.009
  const S = raised ? Sprev : lastSeller
  if (raised) warnings.push({ id: 'seller_raised', text: `Ha alzato il prezzo rispetto alla sua proposta precedente: non inseguirlo, ragioniamo sui ${formatEuro(Sprev)}.` })
  const sigma = ctrR2(Sprev - S)
  const denominator = Sprev - B
  const share = denominator > CTR_EPS ? Math.max(0, sigma) / denominator : 1
  const shareNorm = ctrNormShare(share, k - 1, counterShareOf(options.profile))
  const stance = sellerStanceOf(shareNorm)

  // Times: history wins (saved items), then an explicit date, then the "quando l'hai ricevuta?" chip.
  let receivedAt = useHistory ? sellerEntries[k - 1].at : null
  let unc = receivedAt ? sellerEntries[k - 1].unc : 0
  if (!receivedAt) receivedAt = ctrDate(raw.receivedAt)
  if (!receivedAt) {
    const chip = COUNTER_RECEIVED_AGO.find((c) => c.id === raw.receivedAgo) || COUNTER_RECEIVED_AGO[0]
    receivedAt = addMinutes(now, -chip.minutes)
    unc = chip.halfWidth
  }
  if (receivedAt.getTime() > now.getTime()) receivedAt = new Date(now)
  const offerSentAt = (useHistory ? buyerEntries[n].at : null) || ctrDate(raw.offerSentAt)
  const latencyH = offerSentAt ? Math.max(5 / 60, ctrHours(offerSentAt, receivedAt)) : null

  const inactive = input.sellerProfile === 'inactive'
  const profile = inactive ? 'unknown' : input.sellerProfile
  const ageDays = input.listingAge.days + (offerSentAt ? Math.max(0, calendarDaysBetween(offerSentAt, now)) : 0)
  const hazard = input.category.dailySellRate * ageHazardMultiplier(ageDays)
    * (raw.competition ? COUNTER.COMPETITION_MULT : 1) * (raw.publicPrice ? COUNTER.PUBLIC_PRICE_MULT : 1)
  const W = ctrMaxPrice(raw.maxPrice)
  const Wcap = W ?? Infinity
  const V = ctrR2(Math.max(L * (1 + COUNTER.LOSS_PREMIUM), W ?? 0))
  const chat = raw.channel === 'chat'
  const theta = Boolean(raw.publicPrice) || chat
  const validityHours = options.validityHours === undefined ? VINTED_ASSUMED.COUNTER_VALIDITY_HOURS : options.validityHours
  const assumedExpiry = chat || validityHours == null ? null : addMinutes(receivedAt, validityHours * 60 - unc)
  const deadline = assumedExpiry ? addMinutes(assumedExpiry, -COUNTER.DEADLINE_MARGIN_MINUTES) : null
  const planHorizon = addMinutes(receivedAt, COUNTER.PLAN_HORIZON_HOURS * 60)
  const minDelayMinutes = inactive ? COUNTER.MIN_DELAY_INACTIVE_MINUTES : COUNTER.MIN_DELAY_MINUTES
  const tMin = ceilToMinutes(new Date(Math.max(addMinutes(now, 5).getTime(), addMinutes(receivedAt, minDelayMinutes).getTime())), 5)
  const goalPrice = raw.goalPrice === undefined || raw.goalPrice === null || raw.goalPrice === '' ? null : parsePrice(raw.goalPrice)

  if (B < L * (1 - VINTED.MAX_DISCOUNT_PCT / 100) - CTR_EPS) {
    warnings.push({ id: 'below_floor', text: 'Di solito Vinted non accetta offerte sotto il 60% del prezzo: controlla i numeri.' })
  }
  if (Number(raw.offersSentToday) >= COUNTER.DAILY_QUOTA_WARN) {
    warnings.push({ id: 'daily_quota', text: `Ti restano poche offerte oggi: Vinted ne consente ${VINTED.OFFERS_PER_DAY} al giorno.` })
  }
  warnings.push(...buildWarnings(now))

  const state = {
    raw, input, now, L, B, S, S0: S, raised, lastSeller, lastBuyerFinal: Boolean(useHistory && n >= 1 && buyerEntries[n].isFinal),
    expired: Boolean(assumedExpiry && assumedExpiry.getTime() <= now.getTime()),
    Sprev, sigma, share, shareNorm, stance, k, n, buyers, sellers, mode, enteredAs,
    receivedAt, unc, offerSentAt, latencyH, inactive, profile, ageDays, hazard, W, Wcap, V, chat, theta, validityHours,
    assumedExpiry, deadline, planHorizon, minDelayMinutes, tMin, minStep: priceStepFor(L), goalPrice: Number.isFinite(goalPrice) ? goalPrice : null,
    cache: new Map(),
  }
  return { ok: true, errors: {}, warnings, state }
}

/**
 * The line under the "controproposta" field while the user types: what the seller's number means.
 * Returns null until list price, previous offer and counter are all valid.
 */
export function counterPreview(raw) {
  const L = parsePrice(raw.listPrice)
  const B = parsePrice(raw.previousOffer !== undefined && raw.previousOffer !== '' ? raw.previousOffer : raw.targetPrice)
  if (!(L > 0) || !(B > 0)) return null
  const S = raw.counterMode === 'pct' ? counterFromPercent(B, parsePercent(raw.sellerCounter)) : parsePrice(raw.sellerCounter)
  if (!(S > 0)) return null
  if (S > L + CTR_EPS) return { S, overList: true, text: `${formatEuro(S)} supera il prezzo di listino (${formatEuro(L)}): controlla la cifra.` }
  if (S <= B + CTR_EPS) return { S, atOrBelowOffer: true, text: `${formatEuro(S)} è pari o sotto la tua offerta: puoi comprare subito.` }
  // Later rounds: the step is measured from his previous counter, not from the list price.
  const prev = Number(raw.sellerPrevious) > 0 ? Math.min(Number(raw.sellerPrevious), L) : L
  const from = prev < L - CTR_EPS ? 'dalla sua proposta precedente' : 'dal listino'
  const overPct = (S / B - 1) * 100
  const sigma = ctrR2(prev - S)
  const share = prev - B > CTR_EPS ? Math.max(0, sigma) / (prev - B) : 1
  const stance = sellerStanceOf(share)
  const moved = sigma > 0.009
    ? `è sceso di ${formatEuro(sigma)} ${from} (−${ctrPct((sigma / prev) * 100)}%), ${ctrIl(share * 100)}${Math.round(share * 100)}% della distanza`
    : sigma < -0.009 ? `ha alzato la cifra rispetto alla sua proposta precedente (${formatEuro(prev)})` : `non è sceso ${from}`
  const over = overPct < 0.5 ? 'appena sopra la tua offerta' : `${ctrIl(overPct)}${Math.round(overPct)}% sopra la tua offerta`
  return { S, overPct, sigma, share, stance, text: `${formatEuro(S)} · ${over} · ${moved}` }
}

/* ───────── acceptance model ───────── */

const ctrSellerLabel = (id) => ({ new_seller: 'Venditore nuovo', expert: 'Venditore esperto' })[id] || 'Venditore non indicato'

/**
 * Probability that the seller accepts our price against his price S (B = our last rejected offer, shareNorm = how much
 * he moved). `sendDate` = the real moment we send it, or null for the lookahead (our next counter).
 * The returned score has the shape attributeFactors() expects (base, pBase, pAccept, factors).
 */
export function counterAcceptance(state, side, price, sendDate = null) {
  const { B, S, shareNorm } = side
  const { input } = state
  const D = COUNTER.PRIOR_DAMPING
  const gapShare = (price - B) / (S - B)
  const core = COUNTER.CORE_INTERCEPT + COUNTER.CORE_SLOPE * (gapShare - 0.5)
  const isSplit = isSplitPrice(price, B, S, state.L)
  const split = isSplit ? COUNTER.SPLIT_BONUS * ramp(B / S, COUNTER.SPLIT_RATIO_RAMP[0], COUNTER.SPLIT_RATIO_RAMP[1]) : 0
  const ageToday = input.listingAge.id === 'unknown' ? 0 : ageCurve(state.ageDays) * input.category.ageMultiplier
  const mods = [
    { id: 'counter_stance', group: 'counter_stance', label: 'Quanto è sceso il venditore', weight: interpolate(COUNTER.STANCE_CURVE, shareNorm) },
    { id: 'category', group: 'category', label: `Categoria ${input.category.label.toLowerCase()}`, weight: D * input.category.weight },
    { id: 'signal', group: 'signal', label: input.listingSignal.id === 'none' ? 'Testo annuncio' : `Annuncio: ${input.listingSignal.label.toLowerCase()}`, weight: D * input.listingSignal.weight },
    { id: 'age', group: 'age', label: input.listingAge.id === 'unknown' ? 'Anzianità non indicata' : `Annuncio ${input.listingAge.label.toLowerCase()}`, weight: D * ageToday },
    { id: 'seller', group: 'seller', label: ctrSellerLabel(state.profile), weight: D * sellerWeight(state.profile, ((S - price) / S) * 100) },
  ]
  let hoursAfter = null
  let timeWindow = null
  let monthWindow
  if (sendDate) {
    hoursAfter = ctrHours(state.receivedAt, sendDate)
    timeWindow = timeWindowAt(sendDate)
    monthWindow = monthWindowAt(sendDate)
    const diff = Math.abs(minutesOfDay(sendDate) - minutesOfDay(state.receivedAt))
    const circular = Math.min(diff, 1440 - diff)
    const habit = hoursAfter >= COUNTER.HABIT_MIN_DELAY_HOURS && circular <= COUNTER.HABIT_TOLERANCE_MINUTES && state.unc <= COUNTER.HABIT_MAX_UNCERTAINTY_MINUTES
    mods.push(
      { id: 'time', group: 'time', label: timeWindow.label, weight: timeWeight(timeWindow, state.profile), window: timeWindow },
      { id: 'month', group: 'month', label: monthWindow.label, weight: monthWindow.weight, window: monthWindow },
      { id: 'counter_delay', group: 'counter_delay', label: 'Attesa prima di rispondere', weight: COUNTER.DELAY_PER_DOUBLING * Math.log2(ctrClamp(hoursAfter, COUNTER.DELAY_MIN_HOURS, COUNTER.DELAY_MAX_HOURS) / COUNTER.DELAY_REF_HOURS) },
      { id: 'counter_cooling', group: 'counter_cooling', label: 'La sua proposta invecchia', weight: COUNTER.COOLING * ramp(hoursAfter, COUNTER.COOLING_FROM_HOURS, COUNTER.COOLING_TO_HOURS) },
      { id: 'counter_habit', group: 'counter_habit', label: "All'ora in cui era sull'app", weight: habit ? COUNTER.HABIT : 0 },
      { id: 'counter_latency', group: 'counter_latency', label: 'Velocità della sua risposta', weight: state.latencyH == null ? 0 : ctrClamp(COUNTER.LATENCY_COEF * Math.log(state.latencyH / COUNTER.LATENCY_REF_HOURS), COUNTER.LATENCY_MIN, COUNTER.LATENCY_MAX) },
      { id: 'counter_message', group: 'counter_message', label: 'Messaggio con motivo e pagamento subito', weight: COUNTER.MESSAGE_BONUS },
      { id: 'counter_late', group: 'counter_late', label: 'Oltre le 24 ore', weight: state.assumedExpiry && sendDate > state.assumedExpiry ? COUNTER.LATE_PENALTY : 0 },
    )
  } else {
    monthWindow = monthWindowAt(state.now)
    mods.push(
      { id: 'time', group: 'time', label: 'Una buona fascia serale', weight: COUNTER.NEXT_ROUND_WINDOW },
      { id: 'month', group: 'month', label: monthWindow.label, weight: monthWindow.weight, window: monthWindow },
      { id: 'counter_message', group: 'counter_message', label: 'Messaggio con motivo e pagamento subito', weight: COUNTER.MESSAGE_BONUS },
    )
  }
  // Same caps as scoreAt: stacked modifiers stay plausible.
  const sumPos = mods.filter((m) => m.weight > 0).reduce((s, m) => s + m.weight, 0)
  const sumNeg = mods.filter((m) => m.weight < 0).reduce((s, m) => s + m.weight, 0)
  const posScale = sumPos > POSITIVE_CAP ? POSITIVE_CAP / sumPos : 1
  const negScale = sumNeg < NEGATIVE_CAP ? NEGATIVE_CAP / sumNeg : 1
  const capped = mods.map((m) => ({ ...m, rawWeight: m.weight, weight: m.weight > 0 ? m.weight * posScale : m.weight * negScale }))
  const factors = [{ id: 'split', group: 'split', label: 'Metà strada esatta', weight: split }, ...capped]
  const rawLogit = core + factors.reduce((s, f) => s + f.weight, 0)
  // Learned from this user's counters (monthly profile), after the caps like the first-offer correction.
  const learned = learnedCounterRow(input.profile, { windowId: timeWindow ? timeWindow.id : null })
  if (learned) factors.push(learned)
  const logit = learned ? rawLogit + learned.weight : rawLogit
  return {
    gapShare, core, isSplit, split, base: core, pBase: squash(core), logit, rawLogit, learnedWeight: learned ? learned.weight : 0, pAccept: squash(logit), factors,
    capped: posScale < 1 || negScale < 1, timeWindow, monthWindow, hoursAfter,
  }
}

/* ───────── what happens if he does not accept ───────── */

const ctrAvailability = (state, hours) => Math.pow(1 - state.hazard, Math.max(0, hours) / 24)
/** Pressing «Acquista» at x, or (over budget) losing the item. */
const ctrAccCost = (state, x) => (x <= state.Wcap + CTR_EPS ? x : state.V)
const ctrIsBelow = (state, x) => (x <= state.Wcap + CTR_EPS && x < state.S0 - 0.009 ? 1 : 0)
/** After a decline or silence: his price may survive (θ) or we re-offer it (φ), otherwise list price or walk away. */
const ctrFallback = (state, x) => (state.theta
  ? ctrAccCost(state, x)
  : COUNTER.RECOVER_PROB * ctrAccCost(state, x) + (1 - COUNTER.RECOVER_PROB) * (state.L <= state.Wcap + CTR_EPS ? state.L : state.V))
const ctrMinGap = (listPrice) => Math.max(0.5, ctrGrid(listPrice))

/**
 * Our counter number n+1 after the seller answered our last offer `cPrev` with S (deterministic, shrinking steps):
 * a final offer after a hold or on the third counter, the split when it is close, else a step ≤ 0,75× our last one.
 */
export function nextCounterMove(state, { cPrev, bPrev, S, Sprev, n }) {
  if (n >= COUNTER.MAX_BUYER_COUNTERS) return null
  const delta = cPrev - bPrev
  const G = S - cPrev
  const sigma = ctrR2(Sprev - S)
  const hi = Math.min(S - ctrMinGap(state.L), state.Wcap)
  if (hi <= cPrev + CTR_EPS) return null
  let price
  let isSplit = false
  let isFinal = false
  if (sigma <= 0.009 || n >= COUNTER.MAX_BUYER_COUNTERS - 1) {
    isFinal = true
    price = preciseBelow(Math.min(cPrev + COUNTER.FINAL_STEP * delta, hi), state.L, cPrev)
  } else if (G / 2 <= COUNTER.SHRINK_MAX * delta + CTR_EPS) {
    price = splitPrice(cPrev, S, state.L)
    isSplit = true
    if (price > hi) {
      price = preciseBelow(hi, state.L, cPrev)
      isSplit = false
    }
  } else {
    const step = ctrClamp(Math.max(COUNTER.SHRINK_MIN * delta, Math.min(sigma, G / 2)), state.minStep, COUNTER.SHRINK_MAX * delta)
    price = preciseBelow(Math.min(cPrev + step, hi), state.L, cPrev)
  }
  if (price == null || price - cPrev < 0.5 * state.minStep - CTR_EPS) return null
  return { price, isSplit, isFinal, step: ctrR2(price - cPrev) }
}

/** Cost and P(paying less than his price) if the seller does NOT accept our counter `price` sent from state `st`. */
function ctrAfterNoAccept(state, st, price, gapShare, isFinal, depthLeft) {
  const eager = ramp(gapShare, COUNTER.EAGER_RAMP[0], COUNTER.EAGER_RAMP[1])
  const counters = COUNTER.COUNTER_SHARE[st.stance]
  const hold = Math.min(COUNTER.HOLD_PROB_MAX, COUNTER.HOLD_PROB[st.stance] + COUNTER.EAGER_HOLD * eager)
  const move = COUNTER.MOVE_SHARE[st.stance] * (1 - COUNTER.EAGER_MOVE * eager)
  let S2 = ctrR2(price + (st.S - price) * (1 - move) * (isPrecisePrice(price, state.L) ? 1 - COUNTER.PRECISION_PULL : 1))
  S2 = Math.min(st.S, Math.max(S2, ctrR2(price + ctrMinGap(state.L))))
  const fallback = ctrFallback(state, st.S)
  let vHold
  let vMove
  if (isFinal || depthLeft <= 0) {
    vHold = { action: 'accept', cost: ctrAccCost(state, st.S), below: ctrIsBelow(state, st.S), price: st.S, sellerPrice: st.S }
    vMove = { action: 'accept', cost: ctrAccCost(state, S2), below: ctrIsBelow(state, S2), price: S2, sellerPrice: S2 }
  } else {
    const next = { cPrev: price, bPrev: st.B, Sprev: st.S, n: st.n + 1, roundIdx: st.roundIdx + 1 }
    vHold = ctrNode(state, { ...next, S: st.S }, depthLeft - 1)
    vMove = ctrNode(state, { ...next, S: S2 }, depthLeft - 1)
  }
  const cost = counters * (hold * vHold.cost + (1 - hold) * vMove.cost) + (1 - counters) * fallback
  const below = counters * (hold * vHold.below + (1 - hold) * vMove.below)
  return { cost, below, counters, hold, move, S2, vHold, vMove, fallback }
}

/** Lookahead node: the seller has just answered our cPrev with S → min(accept S, our deterministic next move). */
function ctrNode(state, st, depthLeft) {
  const accept = { action: 'accept', cost: ctrAccCost(state, st.S), below: ctrIsBelow(state, st.S), price: st.S, sellerPrice: st.S }
  const move = nextCounterMove(state, st)
  if (!move) return accept
  const share = st.Sprev - st.cPrev > CTR_EPS ? Math.max(0, st.Sprev - st.S) / (st.Sprev - st.cPrev) : 1
  const shareNorm = ctrNormShare(share, st.roundIdx, counterShareOf(state.input.profile))
  const stance = sellerStanceOf(shareNorm)
  const score = counterAcceptance(state, { B: st.cPrev, S: st.S, shareNorm }, move.price, null)
  const A = ctrAvailability(state, 24)
  const after = ctrAfterNoAccept(state, { B: st.cPrev, S: st.S, stance, n: st.n, roundIdx: st.roundIdx }, move.price, score.gapShare, move.isFinal, depthLeft)
  const cost = A * (score.pAccept * move.price + (1 - score.pAccept) * after.cost) + (1 - A) * state.V
  const below = A * (score.pAccept + (1 - score.pAccept) * after.below)
  const counter = { action: 'counter', cost, below, price: move.price, isSplit: move.isSplit, isFinal: move.isFinal, pAccept: score.pAccept, sellerPrice: st.S }
  return counter.cost < accept.cost - CTR_EPS ? counter : { ...accept, wouldCounter: counter }
}

/** Full evaluation of our counter `price` sent at `sendDate` from the current state (one round of lookahead). */
export function evaluateCounter(state, price, sendDate, { isFinal = false, depth = 1 } = {}) {
  const score = counterAcceptance(state, { B: state.B, S: state.S, shareNorm: state.shareNorm }, price, sendDate)
  const pRead = state.inactive ? COUNTER.INACTIVE_READ_FLOOR + (1 - COUNTER.INACTIVE_READ_FLOOR) * Math.exp(-score.hoursAfter / COUNTER.INACTIVE_READ_TAU_HOURS) : 1
  const pAccept = score.pAccept * pRead
  const pAvailable = ctrAvailability(state, ctrHours(state.now, sendDate) + sellerReplyHoursOf(state.input.profile))
  // The continuation does not depend on the send moment (the lookahead uses a typical window): memoise per price.
  if (!state.cache) state.cache = new Map()
  const key = `${price}|${isFinal ? 1 : 0}|${depth}`
  let after = state.cache.get(key)
  if (!after) {
    after = ctrAfterNoAccept(state, { B: state.B, S: state.S, stance: state.stance, n: state.n, roundIdx: state.k - 1 }, price, score.gapShare, isFinal, depth)
    state.cache.set(key, after)
  }
  const expectedPrice = pAvailable * (pAccept * price + (1 - pAccept) * after.cost) + (1 - pAvailable) * state.V
  const pBelowSeller = pAvailable * (pAccept + (1 - pAccept) * after.below)
  return { price, sendDate, score, pRead, pAccept, pAvailable, after, expectedPrice, pBelowSeller, isFinal }
}

/* ───────── candidate moments ───────── */

const ctrQuiet = (date) => {
  const m = minutesOfDay(date)
  return (m >= COUNTER.QUIET_FROM_MINUTES || m < COUNTER.QUIET_TO_MINUTES) && timeWindowAt(date).weight <= 0
}

/**
 * Moments worth considering: the earliest polite moment (≥ 60 min after his counter), the start and end of every
 * positive window, the canonical evening slots, his habitual minute, an 18:05 bridge, and the soft deadline, for
 * today and the next two days, within 30 h of his counter (72 h from now once it is stale); no quiet hours.
 */
export function buildCounterSlots(state, { stale = false, from = null, until = null } = {}) {
  const now = state.now
  const start = from || state.tMin
  const raw = [{ date: start, kind: from ? 'canonical' : start.getTime() - now.getTime() <= 10 * 60_000 ? 'now' : 'min_delay' }]
  const day0 = startOfDay(from || now)
  for (let d = 0; d <= 2; d++) {
    const day = addDays(day0, d)
    const weekday = effectiveWeekday(day)
    for (const w of TIME_WINDOWS.filter((x) => x.weight > 0 && x.days.includes(weekday))) {
      raw.push({ date: atTime(day, 0, w.from + 5), kind: 'window_start' }, { date: atTime(day, 0, w.to - 10), kind: 'window_end' })
    }
    for (const [hh, mm] of CANONICAL_SLOTS[weekday] || []) raw.push({ date: atTime(day, hh, mm), kind: 'canonical' })
    raw.push({ date: atTime(day, 0, Math.floor(minutesOfDay(state.receivedAt) / 5) * 5), kind: 'habit' })
    raw.push({ date: atTime(day, 18, 5), kind: 'bridge' })
  }
  if (state.deadline && !from) raw.push({ date: ctrFloor5(state.deadline), kind: 'deadline' })
  if (state.assumedExpiry && !from) raw.push({ date: ctrFloor5(addMinutes(state.assumedExpiry, -5)), kind: 'expiry' })
  const end = until || (stale ? addMinutes(now, COUNTER.STALE_PLAN_HOURS * 60) : state.planHorizon)
  const seen = new Set()
  const slots = []
  for (const s of raw.sort((a, b) => a.date - b.date || (a.kind === 'now' ? -1 : 0))) {
    const t = s.date.getTime()
    if (t < start.getTime() || t > end.getTime() || seen.has(t) || ctrQuiet(s.date)) continue
    seen.add(t)
    const tier = !state.assumedExpiry || stale || from ? 'on_time' : t <= state.deadline.getTime() ? 'on_time' : t <= state.assumedExpiry.getTime() ? 'tight' : 'late'
    slots.push({ ...s, tier, daysWaited: calendarDaysBetween(now, s.date), windowId: timeWindowAt(s.date).id })
  }
  return slots
}

/* ───────── candidate prices ───────── */

/** First counter: precise prices between a reciprocity floor and the midpoint (or only the split when the gap is tiny). */
function ctrFirstCandidates(state) {
  const { B, S, L } = state
  const G = S - B
  const split = splitPrice(B, S, L)
  const floor60 = ctrCeilCent(L * (1 - VINTED.MAX_DISCOUNT_PCT / 100))
  if (G <= Math.max(COUNTER.CLOSE_GAP_EUR, (COUNTER.CLOSE_GAP_PCT / 100) * L) + CTR_EPS) {
    return { mode: 'close', list: split <= state.Wcap + CTR_EPS ? [split] : [], split, lo: split, hi: split }
  }
  const lo = Math.max(B + Math.max(state.minStep, Math.min(state.sigma, COUNTER.RECIPROCITY_GAP_SHARE * G), COUNTER.MIN_FIRST_SHARE * G), floor60)
  const hi = Math.min(split, S - ctrMinGap(L), state.Wcap, state.stance === 'hold' ? B + COUNTER.HOLD_MAX_SHARE * G : Infinity)
  let list = precisePricesIn(lo, hi, L)
  if (split >= lo - CTR_EPS && split <= hi + CTR_EPS && !list.includes(split)) list.push(split)
  list.sort((a, b) => a - b)
  let mode = 'normal'
  if (!list.length && state.Wcap < lo && state.Wcap > B + state.minStep) {
    const c = preciseBelow(state.Wcap, L, B)
    if (c) {
      list = [c]
      mode = 'budget_final'
    }
  }
  return { mode, list, split, lo, hi }
}

/* ───────── prose ───────── */

const ctrDisclaimer = 'Quanto dura la sua proposta, quanti rilanci sono possibili e cosa succede alla sua cifra quando ne proponi una nuova non sono regole ufficiali di Vinted: il piano usa stime prudenti. Le probabilità vengono da studi su milioni di trattative online, adattate a Vinted.'
const ctrFavouriteTip = "Metti il cuore all'articolo: se abbassa il prezzo per tutti ti arriva l'avviso. Se non vuoi che sappia del tuo interesse, disattiva «Invia una notifica ai proprietari quando aggiungo i loro articoli ai preferiti»."

const ctrWhen = (date, now) => {
  const k = calendarDaysBetween(now, date)
  if (k === 0) return date.getHours() >= 17 ? 'stasera' : 'oggi'
  if (k === 1) return 'domani'
  return formatLongDate(date, now)
}

/**
 * How to buy at his price. «Acquista» shows his price only for a button counter that is still live: a chat price has
 * no offer object, a raised counter shows the new number, an old counter may be gone.
 */
const ctrBuyHow = (state, stale = false) => {
  const S = formatEuro(state.S)
  if (state.chat) return `fai tu un'offerta a ${S} con «Fai un'offerta»`
  if (state.raised && !state.theta) return `riproponi tu ${S} con «Fai un'offerta» (con «Acquista» pagheresti ${formatEuro(state.lastSeller)})`
  if (stale) return `se vedi ancora «Acquista» a ${S} usalo, altrimenti offri tu ${S} con «Fai un'offerta»`
  return `premi «Acquista» a ${S}`
}

const ctrAcceptLabel = (state, stale) => {
  const S = formatEuro(state.S)
  if (state.chat) return `Accetta: fai tu un'offerta a ${S} con «Fai un'offerta»`
  if (state.raised && !state.theta) return `Accetta: riproponi tu ${S} (con «Acquista» pagheresti ${formatEuro(state.lastSeller)})`
  if (stale) return `Accetta: se vedi ancora «Acquista» a ${S} usalo; se il pulsante non c'è più, offri tu ${S}`
  return `${COUNTER_OPTION_LABELS.accept} a ${S}`
}

const ctrBuyFooter = (state, stale) => `${capitalize(ctrBuyHow(state, stale))}, poi paga subito: il messaggio è facoltativo.`

function ctrAcceptOption(state, { stale = false, recommended = false } = {}) {
  const overBudget = state.S > state.Wcap + CTR_EPS
  return {
    id: 'accept', label: ctrAcceptLabel(state, stale), howToBuy: `${capitalize(ctrBuyHow(state, stale))}.`, isRecommended: recommended, price: state.S, isSplit: false, isFinal: false,
    isPrecise: false, wholeEuroFallback: null, stepUpEur: null, stepUpPct: null, stepDownEur: 0, stepDownPct: 0,
    discountFromListPct: ((state.L - state.S) / state.L) * 100, gapShare: null, pAccept: 1, pBelowSeller: null,
    expectedPrice: state.S, expectedSaving: null, totalWithFee: buyerTotal(state.S), landingPoint: state.S, overBudget,
    next: null, apply: null,
  }
}

const ctrNegotiation = (state) => ({
  listPrice: state.L, previousOffer: state.B, firstOffer: state.buyers[0], sellerCounter: state.S, sellerCounterRaw: state.lastSeller, sellerCounterEntered: state.enteredAs,
  round: state.k, buyerCountersSent: state.n, sellerStepEur: state.sigma, sellerStepPct: state.Sprev > 0 ? (state.sigma / state.Sprev) * 100 : 0,
  sellerConcessionShare: state.share, sellerConcessionShareNorm: state.shareNorm, sellerStance: state.stance, sellerStanceLabel: SELLER_STANCES[state.stance].label,
  sellerRaised: state.raised, counterOverOfferPct: (state.S / state.B - 1) * 100, gapEur: ctrR2(state.S - state.B), midpoint: (state.B + state.S) / 2,
  splitTolerance: splitTolerance(state.B, state.S, state.L), receivedAt: state.receivedAt, receivedUncertaintyMinutes: state.unc,
  latencyHours: state.latencyH, minutesSinceCounter: Math.max(0, Math.round(ctrHours(state.receivedAt, state.now) * 60)), tooSoonUntil: state.tMin,
  assumedExpiry: state.assumedExpiry, deadline: state.deadline, planHorizon: state.planHorizon, channel: state.chat ? 'chat' : 'button',
  sellerPriceSurvives: state.theta, maxPrice: state.W,
})

function ctrShortResult(state, warnings, kind, message, { stale = false } = {}) {
  const accept = ctrAcceptOption(state, { stale, recommended: kind === 'accept' || kind === 'accept_counter' })
  const tips = []
  if (kind === 'stop' || kind === 'walk_away') tips.push(ctrFavouriteTip)
  const buyNow = kind === 'accept' || kind === 'accept_counter'
  return {
    ok: true, kind, input: state.input, now: state.now, negotiation: ctrNegotiation(state), message, warnings,
    options: [accept], recommended: buyNow ? accept : null, tips,
    messages: buyNow ? buildAcceptMessages({ stale }) : [], recommendedTone: 'cordiale',
    messageFooter: buyNow ? ctrBuyFooter(state, stale) : null,
    disclaimer: ctrDisclaimer, reminders: [],
  }
}

/* ───────── analysis ───────── */

/**
 * Entry point. Returns { ok: false, errors } or a result whose `kind` is:
 * 'counter' (reply with a price), 'counter_stale' (same, after more than 30 h), 'accept' (countering saves too little),
 * 'accept_counter' (his price is at or below our offer or goal), 'walk_away' (over budget, no room), 'stop' (3 counters sent).
 * options: { preferredSendAt, forcePrice, validityHours } — forcePrice evaluates one price only (the UI's «Applica»).
 */
export function analyzeCounter(raw, now = new Date(), options = {}) {
  const norm = normalizeCounterInput(raw, now, options)
  if (!norm.ok) return { ok: false, errors: norm.errors }
  const state = norm.state
  const warnings = norm.warnings
  const { S, B, L } = state

  if (S <= B + CTR_EPS) {
    const extra = S < B - 0.5 ? ' Controlla la cifra: è sotto la tua offerta.' : ''
    return ctrShortResult(state, warnings, 'accept_counter', `È pari o sotto la tua offerta: ${ctrBuyHow(state)} e compra subito.${extra}`)
  }
  if (state.goalPrice != null && S <= state.goalPrice + CTR_EPS) {
    return ctrShortResult(state, warnings, 'accept_counter', `È già al tuo obiettivo: ${ctrBuyHow(state)} e compra subito.`)
  }
  if (state.n >= COUNTER.MAX_BUYER_COUNTERS) {
    return ctrShortResult(state, warnings, 'stop', `Hai già rilanciato tre volte: o compri a ${formatEuro(S)} o lasci perdere e riprovi tra 7–10 giorni.`)
  }
  // Our last offer was announced as the maximum: raising now would make it a bluff and cost credibility.
  if (state.n >= 1 && state.lastBuyerFinal) {
    const message = S <= state.Wcap + CTR_EPS
      ? `Avevi detto che ${formatEuro(B)} era il tuo massimo: rilanciare adesso ti toglierebbe credibilità. Se lo vuoi davvero, ${ctrBuyHow(state)}; altrimenti lascia perdere per ora e segui l'articolo.`
      : `Avevi detto che ${formatEuro(B)} era il tuo massimo e la sua cifra supera il tuo budget: lascia perdere per ora e segui l'articolo.`
    return ctrShortResult(state, warnings, 'stop', message)
  }

  const stale = ctrHours(state.receivedAt, now) > COUNTER.STALE_AFTER_HOURS
  if (stale) state.tMin = ceilToMinutes(addMinutes(now, 5), 5)

  // Candidate prices.
  let cand
  let move = null
  if (state.n >= 1) {
    move = nextCounterMove(state, { cPrev: B, bPrev: state.buyers[state.n - 1], S, Sprev: state.Sprev, n: state.n })
    cand = { mode: 'next', list: move ? [move.price] : [], split: splitPrice(B, S, L) }
  } else {
    cand = ctrFirstCandidates(state)
  }
  if (options.forcePrice != null && Number.isFinite(Number(options.forcePrice))) {
    const forced = ctrR2(Number(options.forcePrice))
    if (forced > B + CTR_EPS && forced < S - CTR_EPS && forced <= state.Wcap + CTR_EPS) {
      if (!cand.list.includes(forced)) cand = { ...cand, mode: cand.mode === 'budget_final' ? 'budget_final' : 'forced' }
      cand = { ...cand, list: [forced] }
    }
  }
  if (!cand.list.length) {
    if (S <= state.Wcap + CTR_EPS) return ctrShortResult(state, warnings, 'accept', `Non c'è spazio per un'altra offerta sensata: ${ctrBuyHow(state, stale || state.expired)}.`, { stale: stale || state.expired })
    return ctrShortResult(state, warnings, 'walk_away', `${formatEuro(S)} supera il tuo massimo e non c'è spazio per un'altra offerta: lascia perdere per ora e segui l'articolo.`)
  }
  const fixedFinal = Boolean(move && move.isFinal)
  const isFinalFor = (price) => fixedFinal || cand.mode === 'budget_final' || (state.n === 0 && state.stance === 'hold' && price !== null)

  // Score every (price, moment) once.
  const slots = buildCounterSlots(state, { stale })
  const evaluations = new Map()
  const evalAt = (price, date) => {
    const key = `${price}|${date.getTime()}`
    if (!evaluations.has(key)) evaluations.set(key, evaluateCounter(state, price, date, { isFinal: isFinalFor(price) }))
    return evaluations.get(key)
  }
  const bestRowAt = (date) => cand.list.map((p) => evalAt(p, date)).reduce((a, b) => (b.expectedPrice < a.expectedPrice - CTR_EPS ? b : a))
  const perSlot = slots.map((s) => {
    const best = bestRowAt(s.date)
    return { ...s, best, E: best.expectedPrice, window: timeWindowAt(s.date) }
  })
  // An inactive seller just replied and may vanish: while he is likely still online any window will do.
  const stillOnline = (s) => state.inactive && ctrHours(state.receivedAt, s.date) <= 2 * COUNTER.INACTIVE_READ_TAU_HOURS
  const eligible = perSlot.filter((s) => s.window.weight >= 0 || stillOnline(s))
  const tolOf = (E) => Math.max(COUNTER.NEAR_TIE_EUR, COUNTER.NEAR_TIE_SHARE * Math.max(0, S - E))
  const pick = (pool) => {
    const best = pool.reduce((a, b) => (b.E < a.E - CTR_EPS ? b : a))
    const threshold = best.E + tolOf(best.E)
    return { best, chosen: pool.filter((s) => s.E <= threshold + CTR_EPS).sort((a, b) => a.date - b.date)[0] }
  }

  let chosen
  let best
  let safeAlternative = null
  let alsoGood = null
  let forced = false
  let reapproach = null
  const onTime = eligible.filter((s) => s.tier === 'on_time')
  const tight = eligible.filter((s) => s.tier === 'tight')
  const late = eligible.filter((s) => s.tier === 'late')
  if (onTime.length) {
    const p = pick(onTime)
    chosen = p.chosen
    best = p.best
    const saving = Math.max(0, S - p.best.E)
    const bestTight = tight.length ? pick(tight).best : null
    const bestLate = late.length ? pick(late).best : null
    if (bestTight && bestTight.E < p.best.E - Math.max(COUNTER.TIGHT_GAIN_EUR, COUNTER.TIGHT_GAIN_SHARE * saving)) {
      safeAlternative = chosen
      chosen = bestTight
      best = bestTight
    } else if (bestLate && bestLate.E < p.best.E - Math.max(COUNTER.LATE_GAIN_EUR, COUNTER.LATE_GAIN_SHARE * saving)) {
      safeAlternative = chosen
      chosen = bestLate
      best = bestLate
    } else {
      const better = [bestTight, bestLate].filter(Boolean).sort((a, b) => a.E - b.E)[0]
      if (better && better.E < chosen.E - tolOf(chosen.E)) alsoGood = better
    }
  } else if (eligible.length) {
    const p = pick(eligible)
    chosen = p.chosen
    best = p.best
  } else if (perSlot.length) {
    const pool = perSlot.filter((s) => s.tier === 'on_time')
    const p = pick(pool.length ? pool : perSlot)
    chosen = p.best
    best = p.best
    forced = true
  } else {
    // Nothing between now and the horizon (e.g. a counter received at night, reopened the next night):
    // the first polite moment out of quiet hours, with its real tier.
    const date = ctrQuiet(state.tMin) ? ctrOutOfQuiet(state.tMin) : state.tMin
    const tier = !state.assumedExpiry || stale ? 'on_time' : date <= state.deadline ? 'on_time' : date <= state.assumedExpiry ? 'tight' : 'late'
    const row = bestRowAt(date)
    chosen = { date, kind: date.getTime() - now.getTime() <= 10 * 60_000 ? 'now' : 'min_delay', tier, daysWaited: calendarDaysBetween(now, date), windowId: timeWindowAt(date).id, best: row, E: row.expectedPrice, window: timeWindowAt(date) }
    best = chosen
    forced = tier !== 'late'
  }
  let pinned = false
  if (options.preferredSendAt) {
    const wanted = new Date(options.preferredSendAt).getTime()
    const near = [...eligible].sort((a, b) => Math.abs(a.date.getTime() - wanted) - Math.abs(b.date.getTime() - wanted))[0]
    if (near && Math.abs(near.date.getTime() - wanted) <= 3 * 3_600_000) {
      chosen = near
      pinned = true
      safeAlternative = null
      alsoGood = null
    }
  }
  if (forced) {
    const from = ceilToMinutes(addMinutes(state.planHorizon, 1), 5)
    const after = buildCounterSlots(state, { from, until: addMinutes(state.planHorizon, 24 * 60) })
      .filter((s) => timeWindowAt(s.date).weight >= 0)
      .map((s) => {
        const row = bestRowAt(s.date)
        return { ...s, best: row, E: row.expectedPrice, window: timeWindowAt(s.date) }
      })
    reapproach = after.length ? pick(after).chosen : null
  }

  // Options at the chosen moment.
  const rows = cand.list.map((p) => evalAt(p, chosen.date)).sort((a, b) => a.price - b.price)
  const bestE = Math.min(...rows.map((r) => r.expectedPrice))
  const saving = Math.max(0, S - bestE)
  const balanced = rows.find((r) => r.expectedPrice <= bestE + CTR_EPS)
  const boldRow = rows.find((r) => r.expectedPrice <= bestE + COUNTER.BOLD_BAND_SHARE * saving + CTR_EPS && r.score.gapShare >= COUNTER.BOLD_MIN_SHARE - CTR_EPS)
  const bold = boldRow && balanced.price - boldRow.price >= state.minStep - CTR_EPS ? boldRow : null
  const splitRow = rows.find((r) => r.score.isSplit)
  const splitOption = splitRow && splitRow !== balanced && splitRow.price > balanced.price ? splitRow : null
  const thetaAcc = Math.max(L < COUNTER.SMALL_ITEM_EUR ? COUNTER.MIN_SAVING_EUR_SMALL : COUNTER.MIN_SAVING_EUR, (COUNTER.MIN_SAVING_PCT / 100) * S)
  const acceptWins = options.forcePrice == null && S <= state.Wcap + CTR_EPS && S - balanced.expectedPrice < thetaAcc
  const kind = stale ? 'counter_stale' : acceptWins ? 'accept' : 'counter'

  // Re-score the reported moments at the recommended price, so that their differences mean something.
  const recPrice = balanced.price
  const view = (slot) => {
    if (!slot) return null
    const e = evalAt(recPrice, slot.date)
    return {
      date: slot.date, kind: slot.kind, tier: slot.tier, daysWaited: slot.daysWaited, windowId: slot.windowId, score: e.score,
      pAccept: e.pAccept, pAvailable: e.pAvailable, pOverall: e.pAccept * e.pAvailable, expectedPrice: e.expectedPrice, bestPriceHere: slot.best.price,
      expiresAt: addMinutes(slot.date, VINTED.OFFER_VALIDITY_HOURS * 60),
    }
  }
  const optimal = view(chosen)
  const nowRow = perSlot.find((s) => s.kind === 'now')
  const nowView = view(nowRow || { date: state.tMin, kind: 'min_delay', tier: 'on_time', daysWaited: calendarDaysBetween(now, state.tMin), windowId: timeWindowAt(state.tMin).id, best: balanced })

  // "Adesso?"
  const nowWindow = timeWindowAt(now)
  const minutesSince = Math.max(0, Math.round(ctrHours(state.receivedAt, now) * 60))
  let reason
  if (chosen.kind === 'now') reason = 'chosen'
  else if (now < addMinutes(state.receivedAt, state.minDelayMinutes)) reason = 'too_soon'
  else if (nowWindow.weight < 0) reason = 'avoid_window'
  else if (!nowRow) reason = 'quiet'
  else if (nowRow.E <= chosen.E + tolOf(chosen.E) || nowView.expectedPrice - optimal.expectedPrice < 0.01) reason = 'close_enough'
  else reason = 'worse'
  const deltaPoints = Math.round((nowView.pAccept - optimal.pAccept) * 100)
  const optimalAt = isSameDay(optimal.date, now) ? `alle ${formatTime(optimal.date)}` : `${formatLongDate(optimal.date, now)} alle ${formatTime(optimal.date)}`
  const nowText = {
    chosen: 'Adesso è il momento giusto: invia ora.',
    too_soon: `Adesso no: ti ha risposto ${minutesSince <= 1 ? 'un minuto' : `${minutesSince} minuti`} fa. Rispondere a caldo gli dice che hai fretta: aspetta almeno fino alle ${formatTime(state.tMin)}.`,
    avoid_window: `Adesso no: è ${nowWindow.label.toLowerCase()}, una fascia sfavorevole per trattare.`,
    quiet: "Adesso no: è tardi, meglio non scrivergli a quest'ora.",
    close_enough: 'Puoi anche inviare adesso: la differenza è minima.',
    worse: deltaPoints < 0
      ? `Adesso andrebbe, ma ${optimalAt} hai ${formatPoints(-deltaPoints).replace(/^\+/, '')} in più.`
      : `Adesso andrebbe, ma ${optimalAt} in media paghi ${formatEuro(nowView.expectedPrice - optimal.expectedPrice)} in meno.`,
  }[reason]
  const sendNow = {
    ok: reason === 'chosen' || reason === 'close_enough', reason, text: nowText, deltaPoints, slot: nowView, window: nowView.score.timeWindow,
    windowEndsAt: addMinutes(startOfDay(nowView.date), nowView.score.timeWindow.to),
  }

  const verdict = buildVerdict(optimal, sendNow, now, view(best), { subject: 'la nuova offerta' })
  const timing = {
    tier: optimal.tier, pastAssumedExpiry: optimal.tier === 'late', deadlineForcesBadWindow: forced, stale,
    expiryImminent: Boolean(state.deadline && state.deadline > now && ctrHours(now, state.deadline) <= 1),
  }
  const others = []
  const seenDays = new Set([startOfDay(chosen.date).getTime()])
  for (const s of [...eligible].sort((a, b) => a.E - b.E)) {
    const key = startOfDay(s.date).getTime()
    if (seenDays.has(key)) continue
    seenDays.add(key)
    others.push(s)
  }
  const spreadPool = [optimal, view(alsoGood), ...others.map(view)].filter(Boolean).map((v) => v.pAccept)
  timing.spread = spreadPool.length ? Math.max(...spreadPool) - Math.min(...spreadPool) : 0
  timing.timingMatters = timing.spread >= TIMING_MATTERS_SPREAD
  timing.otherMoments = others.slice(0, 3).map(view).sort((a, b) => a.date - b.date)

  // Options.
  const optionFrom = (row, id) => {
    const after = row.after
    const ifHolds = after.vHold.action === 'counter'
      ? { action: 'counter', price: after.vHold.price, isFinal: after.vHold.isFinal, isSplit: after.vHold.isSplit, pAccept: after.vHold.pAccept, sellerPrice: S }
      : { action: 'accept', price: S, sellerPrice: S }
    const ifMoves = after.vMove.action === 'counter'
      ? { action: 'counter', sellerPrice: after.S2, price: after.vMove.price, isFinal: after.vMove.isFinal, isSplit: after.vMove.isSplit, pAccept: after.vMove.pAccept }
      : { action: 'accept', sellerPrice: after.S2, price: after.S2 }
    const isSplit = row.score.isSplit
    const chosenByUser = id === 'balanced' && options.forcePrice != null
    const label = chosenByUser
      ? 'La tua scelta'
      : id === 'balanced'
        ? (acceptWins ? (isSplit ? COUNTER_OPTION_LABELS.split : 'Nuova offerta') : isSplit ? `${COUNTER_OPTION_LABELS.split} · consigliata` : COUNTER_OPTION_LABELS.balanced)
        : COUNTER_OPTION_LABELS[id]
    const whole = Math.abs(row.price - Math.round(row.price)) > 1e-6 ? wholeEuroFallback(row.price) : null
    return {
      id, label, isRecommended: false, isChosen: chosenByUser, price: row.price, isSplit, isFinal: row.isFinal, isPrecise: isPrecisePrice(row.price, L), wholeEuroFallback: whole,
      stepUpEur: ctrR2(row.price - B), stepUpPct: ((row.price - B) / B) * 100, stepDownEur: ctrR2(S - row.price), stepDownPct: ((S - row.price) / S) * 100,
      discountFromListPct: ((L - row.price) / L) * 100, gapShare: row.score.gapShare, pAccept: row.pAccept, pBelowSeller: row.pBelowSeller,
      expectedPrice: row.expectedPrice, expectedSaving: S <= state.Wcap + CTR_EPS ? S - row.expectedPrice : null, totalWithFee: buyerTotal(row.price),
      landingPoint: (row.price + S) / 2, overBudget: false, next: row.isFinal ? { final: true, ifHolds: null, ifMoves: null } : { final: false, ifHolds, ifMoves },
      apply: { counterPrice: row.price, preferredSendAt: optimal.date },
      // For the monthly learning loop: the engine's logit before the learned correction, at the planned moment.
      learning: { rawLogit: row.score.rawLogit, learnedWeight: row.score.learnedWeight, pRead: row.pRead, windowId: row.score.timeWindow ? row.score.timeWindow.id : null },
    }
  }
  const balancedOption = optionFrom(balanced, 'balanced')
  const acceptOption = ctrAcceptOption(state, { stale: stale || state.expired, recommended: acceptWins })
  const optionList = [bold && optionFrom(bold, 'bold'), balancedOption, splitOption && optionFrom(splitOption, 'split'), acceptOption].filter(Boolean)
  const recommended = acceptWins ? acceptOption : balancedOption
  if (!acceptWins && options.forcePrice == null) balancedOption.isRecommended = true

  // Factors at the recommended price and moment.
  const recRow = evalAt(recPrice, optimal.date)
  const factors = attributeFactors(recRow.score)
  const uncertainty = uncertaintyFor(state.input)
  const probability = acceptWins ? 1 : recRow.pAccept

  const ctx = { state, stale, optimal, balanced: balancedOption, bold: bold ? optionList.find((o) => o.id === 'bold') : null, acceptWins, saving: S - balanced.expectedPrice, forced, reapproach: view(reapproach), safeAlternative: view(safeAlternative), alsoGood: view(alsoGood), cand }
  const lines = ctrLines(ctx)
  const isSplit = balancedOption.isSplit
  const isFinal = balancedOption.isFinal
  const messages = acceptWins
    ? buildAcceptMessages({ stale })
    : buildCounterMessages({ itemTitle: state.input.itemTitle, price: recPrice, previousOffer: B, firstOffer: state.buyers[0], sendAt: optimal.date, isSplit, isFinal, stale, total: buyerTotal(recPrice) })
  const recommendedTone = acceptWins ? 'cordiale' : recommendedCounterToneFor({ isSplit, isFinal, stance: state.stance, premium: state.input.category.premium })
  const hero = acceptWins
    ? { title: `Accetta e compra a ${formatEuro(S)}`, sublabel: `${capitalize(ctrBuyHow(state, stale || state.expired))} adesso: aspettare non fa risparmiare e qualcuno potrebbe comprarlo prima.` }
    : { title: `Rispondi con ${formatEuro(recPrice)}`, sublabel: verdict.headline }

  const result = {
    ok: true, kind, input: state.input, now, warnings, negotiation: ctrNegotiation(state),
    options: optionList, recommended, optimal, best: view(best), alsoGood: view(alsoGood), safeAlternative: view(safeAlternative), reapproach: view(reapproach),
    nowSlot: nowView, sendNow, pinned, timing, verdict: { ...verdict, hero }, probability,
    probabilityRange: [Math.max(0.01, probability - uncertainty), Math.min(0.99, probability + uncertainty)],
    components: { pAccept: recRow.score.pAccept, pAvailable: recRow.pAvailable, pRead: recRow.pRead },
    factors: { ...factors, baseLabel: `Il tuo passo: ${ctrIl(recRow.score.gapShare * 100)}${Math.round(recRow.score.gapShare * 100)}% della distanza` },
    candidates: { mode: cand.mode, prices: cand.list, lo: cand.lo ?? null, hi: cand.hi ?? null },
    reasons: ctrReasons(ctx), tips: ctrTips(ctx), ladder: lines.ladder, plan: lines.plan, lines,
    messages, recommendedTone, messageBeforeOffer: false,
    messageFooter: acceptWins ? ctrBuyFooter(state, stale || state.expired) : "Prima invia la nuova offerta con «Fai un'offerta» nella chat, poi incolla subito il messaggio.",
    avoidToday: avoidWindowsOn(optimal.date), nowInAvoid: nowWindow.weight < 0, disclaimer: ctrDisclaimer,
  }
  result.reminders = buildCounterReminders(result)
  return result
}

/* ───────── explanation strings ───────── */

function ctrLines(ctx) {
  const { state, optimal, balanced, bold, stale } = ctx
  const { L, S, B } = state
  const now = state.now
  const price = balanced.price
  const over = (x) => x > state.Wcap + CTR_EPS
  const maxText = state.W != null ? formatEuro(state.W) : ''
  const lines = {}

  // Deadline: never promise a button that may be gone or that shows another price.
  if (state.chat) lines.deadline = "Te l'ha scritta in chat: non scade, ma intanto qualcun altro può comprarlo."
  else if (stale) lines.deadline = `Sono passate più di ${COUNTER.STALE_AFTER_HOURS} ore: ${ctrBuyHow(state, true)}. Una tua nuova cifra vale come una nuova offerta.`
  else if (state.expired) lines.deadline = `La sua proposta potrebbe essere già scaduta (alle ${formatTime(state.assumedExpiry)}; Vinted non indica una scadenza ufficiale): ${ctrBuyHow(state, true)}.`
  else if (state.assumedExpiry) lines.deadline = `La sua proposta potrebbe scadere ${formatLongDate(state.assumedExpiry, now)} alle ${formatTime(state.assumedExpiry)} (Vinted non indica una scadenza ufficiale): finché non rispondi ${state.raised && !state.theta ? `puoi riproporgli tu ${formatEuro(S)}` : `puoi ancora comprarla a ${formatEuro(S)} con «Acquista»`}.`
  else lines.deadline = `Vinted non indica una scadenza ufficiale: finché non rispondi ${state.raised && !state.theta ? `puoi riproporgli tu ${formatEuro(S)}` : `puoi comprarla a ${formatEuro(S)} con «Acquista»`}, ma intanto qualcun altro può comprarlo.`

  if (over(S)) lines.risk = `La sua cifra è sopra il tuo massimo (${maxText}): se la tua offerta non passa, lasci perdere senza aver perso nulla.`
  else if (state.theta) lines.risk = `La sua cifra resta disponibile: se la tua nuova offerta non passa, puoi ancora ${state.chat ? `offrirgli tu ${formatEuro(S)}` : `comprare a ${formatEuro(S)}`}.`
  else if (L - S < 0.009) lines.risk = `È fermo al prezzo pieno: se la tua offerta non passa, puoi sempre comprare a ${formatEuro(L)}${over(L) ? ', ma è sopra il tuo massimo' : ''}.`
  else if (over(L)) lines.risk = `Inviando la nuova offerta, la sua proposta a ${formatEuro(S)} potrebbe non essere più acquistabile: nel caso peggiore gliela riproponi tu.`
  else lines.risk = `Inviando la nuova offerta, la sua proposta a ${formatEuro(S)} potrebbe non essere più acquistabile: nel caso peggiore gliela riproponi tu o compri a ${formatEuro(L)}. Rischi al massimo ${formatEuro(L - S)}.`

  lines.totals = ctx.acceptWins
    ? `Con la commissione Vinted (${VINTED.BUYER_FEE_PCT}% + ${formatEuro(VINTED.BUYER_FEE_FIXED)}) paghi ${formatEuro(buyerTotal(S))}, spedizione esclusa.`
    : `Con la commissione Vinted (${VINTED.BUYER_FEE_PCT}% + ${formatEuro(VINTED.BUYER_FEE_FIXED)}) paghi ${formatEuro(buyerTotal(price))} invece di ${formatEuro(buyerTotal(S))}, spedizione esclusa.`

  if (ctx.alsoGood && !ctx.acceptWins) {
    const d = Math.round((ctx.alsoGood.pAccept - optimal.pAccept) * 100)
    const at = isSameDay(ctx.alsoGood.date, optimal.date) ? `Alle ${formatTime(ctx.alsoGood.date)}` : `${capitalize(formatLongDate(ctx.alsoGood.date, now))} alle ${formatTime(ctx.alsoGood.date)}`
    const gain = formatPoints(d).replace(/^\+/, '')
    if (d > 0) {
      if (ctx.alsoGood.tier === 'on_time') lines.alsoGood = `${at} avresti ${gain} in più.`
      else if (ctx.alsoGood.tier === 'tight') lines.alsoGood = `${at} avresti ${gain} in più, ma sei a ridosso delle ${state.validityHours} ore: la sua proposta potrebbe scadere alle ${formatTime(state.assumedExpiry)}.`
      else lines.alsoGood = `${at} avresti ${gain} in più, ma sei oltre le ${state.validityHours} ore: la sua proposta potrebbe essere già scaduta (alle ${formatTime(state.assumedExpiry)}).`
    }
  }

  if (optimal.tier === 'tight') {
    const expiry = state.assumedExpiry ? ` (la sua proposta potrebbe scadere alle ${formatTime(state.assumedExpiry)})` : ''
    lines.tier = ctx.safeAlternative
      ? `È al limite delle ${state.validityHours} ore${expiry}: se preferisci stare sul sicuro, ${formatLongDate(ctx.safeAlternative.date, now)} alle ${formatTime(ctx.safeAlternative.date)} (${formatPoints(Math.round((ctx.safeAlternative.pAccept - optimal.pAccept) * 100))}).`
      : `È al limite delle ${state.validityHours} ore${expiry}: se puoi, rispondi prima.`
  } else if (optimal.tier === 'late') {
    lines.tier = `Dopo le ${state.validityHours} ore la sua proposta potrebbe non valere più: la tua sarà letta come una nuova offerta.`
  }
  if (ctx.forced) {
    const re = ctx.reapproach ? `${formatLongDate(ctx.reapproach.date, now)} alle ${formatTime(ctx.reapproach.date)}` : 'nei prossimi giorni'
    const when = optimal.kind === 'now' ? 'adesso' : `${ctrWhen(optimal.date, now)} alle ${formatTime(optimal.date)}`
    lines.tier = `La sua proposta potrebbe scadere prima della prossima fascia buona: rispondi ${when}, oppure riprova come nuova offerta ${re}.`
  }

  if (bold && !ctx.acceptWins) {
    lines.whyNotLower = `Puoi tentare ${formatEuro(bold.price)}: se accetta risparmi altri ${formatEuro(price - bold.price)}, ma succede circa ${ctrIl(bold.pAccept * 100)}${toPercent(bold.pAccept)}% delle volte e in media pagheresti ${formatEuro(bold.expectedPrice)}.`
  }

  // E dopo? Every price it names is checked against the budget, and the way to buy matches the channel.
  if (ctx.acceptWins) {
    lines.plan = [`Compra subito: ${ctrBuyHow(state, stale || state.expired)} (${formatEuro(buyerTotal(S))} con la commissione). Chi paga per primo se lo aggiudica.`]
  } else {
    const plan = [`Se accetta: paga subito (${formatEuro(buyerTotal(price))}).`]
    const next = balanced.next
    const holdAccept = over(S)
      ? `è sopra il tuo massimo (${maxText}): lascia perdere e segui l'articolo`
      : `${ctrBuyHow(state)}, se lo vuoi ancora`
    if (next && next.final) {
      plan.push(`Se resta a ${formatEuro(S)}: era la tua ultima offerta. ${over(S) ? `È sopra il tuo massimo: lascia perdere e segui l'articolo.` : `${capitalize(ctrBuyHow(state))} se lo vuoi ancora, altrimenti lascia stare per qualche giorno.`}`)
    } else if (next) {
      plan.push(next.ifHolds.action === 'counter'
        ? `Se resta a ${formatEuro(S)}: ${next.ifHolds.isFinal ? 'ultima offerta' : 'rilancia a'} ${formatEuro(next.ifHolds.price)}${next.ifHolds.isFinal ? ', poi basta' : ''}.`
        : `Se resta a ${formatEuro(S)}: ${holdAccept}.`)
      const moved = ctrApprox(next.ifMoves.sellerPrice, L)
      plan.push(next.ifMoves.action === 'counter'
        ? `Se scende verso ${moved}: ${next.ifMoves.isSplit ? 'chiudi a metà strada, circa' : next.ifMoves.isFinal ? 'ultima offerta, circa' : 'sali a circa'} ${ctrApprox(next.ifMoves.price, L)}.`
        : over(next.ifMoves.sellerPrice) ? `Se scende verso ${moved}: è ancora sopra il tuo massimo, lascia stare.` : `Se scende verso ${moved}: accetta.`)
    }
    const refusal = []
    if (!over(S)) refusal.push(L - S < 0.009 ? `compra a ${formatEuro(L)} con «Acquista»` : state.theta ? (state.chat ? `offrigli tu ${formatEuro(S)} con «Fai un'offerta»` : `compra a ${formatEuro(S)} con «Acquista»`) : `riproponi ${formatEuro(S)}`)
    if (!state.theta && L - S >= 0.009 && !over(L)) refusal.push(`compra a ${formatEuro(L)}`)
    plan.push(refusal.length ? `Se rifiuta: ${refusal.join(' o ')}, se lo vuoi ancora.` : "Se rifiuta: lascia perdere per ora e segui l'articolo.")
    lines.plan = plan
  }

  // Ladder: every step with euros and percentages.
  const first = state.buyers[0]
  const steps = [`Listino ${formatEuro(L)}`, `tua offerta ${formatEuro(first)} (−${ctrPct(((L - first) / L) * 100)}%)`]
  for (let i = 0; i < state.sellers.length; i++) {
    const s = Math.min(state.sellers[i], i === 0 ? L : state.sellers[i - 1])
    const b = state.buyers[i]
    const fromList = ((L - s) / L) * 100
    steps.push(`sua controproposta ${formatEuro(s)} (+${ctrPct((s / b - 1) * 100)}% sulla tua, −${ctrPct(fromList)}% dal listino)`)
    if (i + 1 < state.buyers.length) steps.push(`tua offerta ${formatEuro(state.buyers[i + 1])}`)
  }
  if (!ctx.acceptWins) {
    steps.push(`tua nuova offerta ${formatEuro(price)} (+${formatEuro(price - B)}, +${ctrPct(((price - B) / B) * 100)}%; −${formatEuro(S - price)}, −${ctrPct(((S - price) / S) * 100)}% dalla sua)`)
    const next = balanced.next
    if (next && !next.final && next.ifHolds.action === 'counter' && next.ifHolds.isFinal) steps.push(`se resta fermo, ultima offerta ${formatEuro(next.ifHolds.price)}`)
  }
  lines.ladder = `${steps.join(' → ')}.`
  return lines
}

function ctrReasons(ctx) {
  const { state, optimal, balanced, acceptWins } = ctx
  const out = []
  const now = state.now
  const sharePct = Math.round(state.share * 100)
  const typical = Math.round(COUNTER.ROUND_MEAN_SHARE[Math.min(state.k - 1, COUNTER.ROUND_MEAN_SHARE.length - 1)] * counterShareOf(state.input.profile) * 20) * 5
  const sigma = formatEuro(state.sigma)
  const share = `${ctrIl(sharePct)}${sharePct}% della distanza`
  if (acceptWins) {
    out.push(ctx.saving < 0.01
      ? `Rilanciare non ti farebbe risparmiare nulla in media: accetta e ${ctrBuyHow(state, ctx.stale || state.expired)} adesso.`
      : `In media risparmieresti solo ${formatEuro(ctx.saving)}: accetta e ${ctrBuyHow(state, ctx.stale || state.expired)} adesso.`)
  }
  // The seller: a description, plus advice only when we are going to counter.
  if (state.raised) out.push(`Ha alzato la cifra rispetto alla sua proposta precedente: non inseguirlo, ragioniamo sui ${formatEuro(state.S)}.`)
  else if (state.stance === 'hold') {
    const what = state.sigma < 0.01 ? 'Il venditore non è sceso affatto' : `Il venditore è sceso solo di ${sigma}, quasi niente`
    out.push(acceptWins ? `${what}.` : `${what}: fai una sola offerta finale, poi lascia stare per qualche giorno.`)
  } else if (state.stance === 'firm') out.push(`Il venditore è sceso solo di ${sigma} (${share}; di solito si scende del ${typical}% circa)${acceptWins ? '.' : ': è rigido e difficilmente scenderà ancora da solo.'}`)
  else if (state.stance === 'moving') out.push(`Il venditore è sceso di ${sigma} (${share})${acceptWins ? '.' : ': è disposto a trattare, ma non ha fretta.'}`)
  else out.push(`Il venditore è sceso di ${sigma} (${share}): è pronto a chiudere.${!acceptWins && !balanced.isSplit && !balanced.isFinal ? ' Puoi salire poco e lasciare che scenda ancora.' : ''}`)
  if (acceptWins) return out.slice(0, 3)

  const price = formatEuro(balanced.price)
  const gapPct = Math.round(balanced.gapShare * 100)
  if (balanced.isFinal) {
    if (ctx.cand.mode === 'budget_final') out.push(`È la tua ultima offerta: ${price} è il massimo del budget che hai indicato.`)
    else if (state.n === 0) out.push('È la tua ultima offerta: la sua cifra non si è mossa, quindi fai un solo passo chiaro e fermati.')
    else out.push('È la tua ultima offerta: un passo più piccolo del precedente gli fa capire che sei al limite.')
  } else if (balanced.isSplit) {
    const lower = ctx.cand.list.some((p) => p < balanced.price - CTR_EPS)
    out.push(`${price} è a metà strada tra la tua offerta e la sua: è la proposta che i venditori accettano più spesso.${lower ? ' Salire di meno farebbe scendere molto le probabilità e in media pagheresti di più.' : ''}`)
  } else {
    out.push(`Sali di ${formatEuro(balanced.stepUpEur)} (+${ctrPct(balanced.stepUpPct)}%), ${ctrIl(gapPct)}${gapPct}% della distanza: abbastanza per farlo rispondere, senza regalargli la metà strada.`)
  }

  const window = optimal.score.timeWindow
  const when = ctrWhen(optimal.date, now)
  const hoursAfter = optimal.score.hoursAfter
  const at = `${when} alle ${formatTime(optimal.date)}`
  if (ctx.forced) out.push(`Rispondi ${optimal.kind === 'now' ? 'adesso' : at}: dopo, la sua proposta potrebbe essere scaduta.`)
  else if (state.inactive) out.push(hoursAfter <= 2 ? `Entra di rado: rispondi mentre è ancora online, ${at}.` : `Entra di rado: rispondi ${at}, quando è più probabile che riapra l'app.`)
  else if (hoursAfter >= 12) out.push(`Rispondere dopo qualche ora, ${at} (${window.label.toLowerCase()}), aumenta le accettazioni: una risposta immediata segnala fretta.`)
  else if (optimal.kind === 'now') out.push(`Rispondi adesso: è passata almeno un'ora dalla sua risposta e sei in una fascia ${window.weight > 0 ? 'favorevole' : 'neutra'}.`)
  else out.push(`Rispondi ${at} (${window.label.toLowerCase()}): è passata almeno un'ora dalla sua risposta e aspettare oltre non migliora il prezzo atteso.`)
  return out.slice(0, 3)
}

function ctrTips(ctx) {
  const { state, optimal, balanced, stale } = ctx
  const tips = []
  if (state.stance === 'hold' && !ctx.acceptWins) {
    tips.push(state.sigma < 1
      ? "Non si è mosso di un euro: se rifiuta, metti il cuore all'articolo e riprova tra 7–10 giorni; le offerte fatte più avanti ottengono prezzi migliori."
      : "È sceso pochissimo: se rifiuta, metti il cuore all'articolo e riprova tra 7–10 giorni; le offerte fatte più avanti ottengono prezzi migliori.")
  }
  const pLost = 1 - optimal.pAvailable
  if (pLost >= 0.05 && !ctx.acceptWins) tips.push(`C'è circa ${ctrIl(pLost * 100)}${toPercent(pLost)}% di probabilità che qualcun altro lo compri prima: se ci tieni molto, ${state.S <= state.Wcap + CTR_EPS ? `compralo ora a ${formatEuro(state.S)}` : 'non aspettare troppo'}.`)
  if (!ctx.acceptWins && balanced.wholeEuroFallback != null) tips.push(`Se Vinted non accetta i centesimi, usa ${formatEuro(balanced.wholeEuroFallback)}.`)
  if (ctx.forced) tips.push(`La sua proposta potrebbe scadere prima della prossima fascia buona: se non puoi rispondere ${optimal.kind === 'now' ? 'adesso' : `alle ${formatTime(optimal.date)}`}, riprova più tardi come nuova offerta${ctx.reapproach ? ` (${formatLongDate(ctx.reapproach.date, state.now)} alle ${formatTime(ctx.reapproach.date)})` : ''}.`)
  if (stale) tips.push('Sono passate molte ore: se il venditore non risponde entro un giorno, scrivigli due righe senza cambiare cifra.')
  tips.push(ctrFavouriteTip)
  return tips
}

/* ───────── reminders ───────── */

const ctrOutOfQuiet = (date) => {
  const m = minutesOfDay(date)
  if (m >= COUNTER.QUIET_FROM_MINUTES) return atTime(addDays(startOfDay(date), 1), 0, COUNTER.QUIET_TO_MINUTES)
  if (m < COUNTER.QUIET_TO_MINUTES) return atTime(startOfDay(date), 0, COUNTER.QUIET_TO_MINUTES)
  return date
}

/** First moment ≥ date inside a positive window (scanning the next three days), else the date itself. */
const ctrNextPositive = (date) => {
  if (timeWindowAt(date).weight > 0) return date
  for (let d = 0; d <= 3; d++) {
    const day = addDays(startOfDay(date), d)
    const starts = TIME_WINDOWS.filter((w) => w.weight > 0 && w.days.includes(effectiveWeekday(day))).map((w) => atTime(day, 0, w.from + 5)).sort((a, b) => a - b)
    const hit = starts.find((t) => t.getTime() >= date.getTime())
    if (hit) return hit
  }
  return date
}

/**
 * Local notifications for the plan. Before sending: «invia la nuova offerta» 10 minutes before the moment and, when an
 * expiry is assumed, a last call 15 minutes before it. After «Ho inviato» (`sentAt`): a nudge after 24 h (in a good
 * window) and a give-up note after 72 h. Nothing fires in quiet hours (moved to 07:00; a deadline call is dropped).
 */
export function buildCounterReminders(result, { sentAt = null, title = null } = {}) {
  if (!result || !result.ok || !result.optimal) return []
  const name = (title ?? (result.input && result.input.itemTitle)) || "l'articolo"
  const price = result.recommended && result.recommended.id !== 'accept' ? formatEuro(result.recommended.price) : null
  const out = []
  if (!sentAt) {
    if (price) {
      const at0 = addMinutes(result.optimal.date, -10)
      let at = ctrQuiet(at0) ? ctrOutOfQuiet(at0) : at0
      if (at.getTime() > result.optimal.date.getTime()) at = at0
      out.push({ kind: 'counter_send', at, title: 'Tra 10 minuti: invia la nuova offerta', body: `${name}: proponi ${price} con il messaggio pronto.${result.optimal.tier === 'tight' ? ' È al limite delle 24 ore.' : ''}` })
    }
    const expiry = result.negotiation.assumedExpiry
    if (expiry) {
      const at = addMinutes(expiry, -15)
      const m = minutesOfDay(at)
      const quiet = m >= COUNTER.QUIET_FROM_MINUTES || m < COUNTER.QUIET_TO_MINUTES
      if (!quiet && at.getTime() > addMinutes(result.optimal.date, 10).getTime()) {
        out.push({ kind: 'counter_deadline', at, title: 'La sua controproposta potrebbe scadere', body: `Rispondi o accettala entro le ${formatTime(expiry)}.` })
      }
    }
    return out
  }
  const sent = new Date(sentAt)
  out.push({ kind: 'counter_followup', at: ctrOutOfQuiet(ctrNextPositive(addMinutes(sent, COUNTER.FOLLOWUP_HOURS * 60))), title: `Nessuna risposta per ${name}?`, body: 'Mandagli due righe: non serve una nuova offerta.' })
  out.push({ kind: 'counter_giveup', at: ctrOutOfQuiet(addMinutes(sent, COUNTER.GIVEUP_HOURS * 60)), title: 'Trattativa ferma', body: "Segui l'articolo con il cuore e riprova tra qualche giorno." })
  return out
}
