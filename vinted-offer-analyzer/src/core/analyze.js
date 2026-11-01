import { LISTING_AGES, NEGLIGIBLE_DISCOUNT_PCT, SUGGESTED_PRICE_FLOOR, SUGGESTED_PRICE_SHARE_OF_MAX, VINTED } from './constants.js'
import { deviceOffsetMinutes, romeOffsetMinutes } from './dates.js'
import { decisionGate, messagePolicyFor, offerTierFor } from './gate.js'
import { buildMessages, formatEuro, recommendedToneFor } from './messages.js'
import { policyFitsListing } from './policy.js'
import { buildReasons, buildTimingNote, buildTips, buildVerdict, openingSentence } from './reasoning.js'
import { predictiveInterval } from './profile.js'
import { avoidWindows, avoidWindowsOn, pickMoments } from './scheduler.js'
import {
  attributeFactors, blockRiskAt, computeDiscountPct, findCategory, findListingAge, findListingSignal,
  riskBandFor, scoreAt, uncertaintyFor,
} from './scoring.js'

// The gate, the tier and the message policy live in gate.js; they are re-exported here so callers that know the
// contract «reofferBlock is exported from analyze.js» find them without a second import.
export * from './gate.js'

/**
 * Below this discount (or euro gap) an offer is pointless: buy at list price, or ask for shipping included / a bundle.
 * 2 € is the fixed cost of bargaining for the seller (engine-spec §2.1): under it even a yes is not worth the exchange.
 */
const MIN_MEANINGFUL_DISCOUNT_PCT = 0.5
export const MIN_MEANINGFUL_GAP_EUR = 2

/**
 * Parses a price typed the Italian way: "12,50", "1.200", "1.200,50", "45 €".
 * Returns NaN for anything that is not a plain decimal number.
 */
export function parsePrice(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN
  let s = String(raw ?? '').trim().replace(/€/g, '').replace(/\s+/g, '')
  if (!s) return NaN
  if (s.includes('.') && s.includes(',')) {
    // Both separators: the last one is the decimal mark.
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '') // Italian thousands separator
  } else {
    s = s.replace(',', '.')
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN
  return Number(s)
}

/**
 * Validates raw form values. Returns { ok, errors, input } where `input` is the
 * normalised object consumed by the scoring engine.
 */
export function normalizeInput(raw) {
  const errors = {}
  const listPrice = parsePrice(raw.listPrice)
  const targetPrice = parsePrice(raw.targetPrice)
  const category = findCategory(raw.category)

  if (!category) errors.category = 'Scegli una categoria.'
  if (!Number.isFinite(listPrice) || listPrice <= 0) errors.listPrice = 'Inserisci il prezzo di listino (maggiore di 0, ad esempio 12,50).'
  if (!Number.isFinite(targetPrice) || targetPrice <= 0) errors.targetPrice = 'Inserisci il prezzo che vorresti pagare (ad esempio 10).'
  if (Object.keys(errors).length) return { ok: false, errors, input: null }

  const signals = normalizeSignals(raw.signals)
  const listingAge = findListingAge(raw.listingAge)
  const link = typeof raw.link === 'string' ? raw.link.trim() : ''
  const policy = currentPolicy(raw.policy, listPrice, listingAge, signals)
  return { ok: true, errors: {}, input: withPrices({
    itemTitle: (raw.itemTitle || '').trim(),
    category,
    listingAge,
    sellerProfile: raw.sellerProfile || 'unknown',
    listingSignal: findListingSignal(raw.listingSignal),
    // Listing signals (favourites, seller's other items, DOM readings) ride on the input only when the form carries one.
    ...(signals ? { signals } : {}),
    // The link (gate rule 7 looks up earlier offers on the same listing) and the policy that proposed the ask (the
    // gate's «non offrire» wording, the arms' d₀), when the form carries them and the policy still fits the listing.
    ...(link ? { link } : {}),
    ...(policy ? { policy } : {}),
  }, listPrice, targetPrice) }
}

/** The LISTING_AGES bucket a day count read from the page falls in (extract.js listingAgeGuess), or null. */
const listingAgeBucketOf = (days) => LISTING_AGES.find((a) => a.maxDays !== null && days < a.maxDays) || null

/**
 * The policy that rode on the form (buildFormFromExtraction) is kept only while it still describes the listing: the
 * user may have edited the price or the age since, and the gate would otherwise speak with a stale «non offrire» and
 * the arms sit around a stale d₀. The age is read as the gate reads it (the DOM's day count first); the form's bucket
 * is scored at a representative count that may sit one tier away from the exact count the policy was built on (30
 * days online is «più di un mese» on the form and the table's middle tier), so that count wins while the form still
 * shows the bucket it maps to.
 */
const currentPolicy = (raw, listPrice, listingAge, signals) => {
  const policy = raw && typeof raw === 'object' ? raw : null
  if (!policy) return null
  const own = Number.isFinite(policy.ageDays) ? policy.ageDays : null
  const ownBucket = own !== null ? listingAgeBucketOf(own) : null
  const ageDays = signals && Number.isFinite(signals.uploadedDays) ? signals.uploadedDays
    : ownBucket && ownBucket.id === listingAge.id ? own
      : listingAge.id === 'unknown' ? null : listingAge.days
  return policyFitsListing(policy, { listPrice, ageDays }) ? policy : null
}

const SIGNAL_NUMBER_KEYS = ['favourites', 'interested', 'views', 'sellerItems', 'bundleDiscountPct', 'oldPrice', 'lastSeenDays', 'uploadedDays', 'priceDropHoursAgo']
const SIGNAL_BOOLEAN_KEYS = ['priceDropped', 'reserved', 'vacation', 'bundleOffered', 'sellerBusiness', 'bundleInterest']

/**
 * The listing signals a form may carry (extract.js parseVintedItemHtml, the search's favourites, the user's flags),
 * normalised: finite numbers (form strings accepted), booleans, and `priceDrop: { from, to, hoursAgo }` with its finite
 * fields. Null when nothing usable is there, so a plain form scores exactly as before.
 */
export function normalizeSignals(raw) {
  if (!raw || typeof raw !== 'object') return null
  const out = {}
  const num = (v) => {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : v
    return typeof n === 'number' && Number.isFinite(n) ? n : null
  }
  for (const key of SIGNAL_NUMBER_KEYS) {
    const v = num(raw[key])
    if (v !== null) out[key] = v
  }
  for (const key of SIGNAL_BOOLEAN_KEYS) if (typeof raw[key] === 'boolean') out[key] = raw[key]
  if (raw.priceDrop && typeof raw.priceDrop === 'object') {
    const drop = {}
    for (const key of ['from', 'to', 'hoursAgo']) {
      const v = num(raw.priceDrop[key])
      if (v !== null) drop[key] = v
    }
    out.priceDrop = drop
    if (out.priceDropped === undefined) out.priceDropped = true
  }
  return Object.keys(out).length ? out : null
}

/** The market summary attached to an analysis: the figures the UI shows next to the verdict. `gapPct` is relative to this listing. */
const marketSummary = (market, listPrice) => ({
  n: market.n,
  medianPrice: market.medianPrice,
  p25Price: market.p25Price,
  p75Price: market.p75Price,
  gapPct: market.medianPrice > 0 ? Math.round((listPrice / market.medianPrice - 1) * 100) : null,
  best: market.best || null,
})

/** Derives discount and risk band from the two prices. */
export const withPrices = (input, listPrice, targetPrice) => {
  const discountPct = computeDiscountPct(listPrice, targetPrice)
  return { ...input, listPrice, targetPrice, discountPct, riskBand: riskBandFor(discountPct) }
}

/** Price grid used when searching prices: 0,50 € under 20 €, 1 € under 200 €, then 5 €. */
export const priceStepFor = (listPrice) => (listPrice < 20 ? 0.5 : listPrice < 200 ? 1 : 5)

/**
 * Smallest price increase (from the target upward) whose best moment reaches the
 * target overall probability. Probes the top of the range first so that an
 * unreachable target costs one scheduler run, then bisects the price grid.
 */
export function suggestPrice(input, now, targetProbability, { exactSendAt = null } = {}) {
  const step = priceStepFor(input.listPrice)
  const steps = Math.floor((input.listPrice - input.targetPrice) / step) - (Number.isInteger((input.listPrice - input.targetPrice) / step) ? 1 : 0)
  if (steps < 1) return null
  const evaluate = (i) => {
    const candidate = withPrices(input, input.listPrice, Math.round((input.targetPrice + i * step) * 100) / 100)
    // Same moment as the analysis on screen (a test variation pins its own moment).
    const moments = pickMoments(candidate, now, { exactSendAt })
    return { candidate, moments, ok: moments.chosen.pOverall >= targetProbability }
  }
  let hi = evaluate(steps)
  if (!hi.ok) return null
  let lo = 0 // index 0 is the user's own target, known to be below the target probability
  let hiIndex = steps
  while (hiIndex - lo > 1) {
    const mid = Math.floor((lo + hiIndex) / 2)
    const probe = evaluate(mid)
    if (probe.ok) { hi = probe; hiIndex = mid } else lo = mid
  }
  return {
    price: hi.candidate.targetPrice,
    discountPct: hi.candidate.discountPct,
    probability: hi.moments.chosen.pOverall,
    date: hi.moments.chosen.date,
  }
}

/**
 * The best overall probability this listing can reach: the offer at the top of the price grid (one step under the list
 * price, the same point suggestPrice probes first), at its own best moment. Relative goals (the suggested price, the
 * optimiser's goals) are set against it, never against a fixed percentage the listing may not be able to reach at all.
 * Null when the user's target already sits at the top of the grid.
 */
export function maxReachable(input, now, { exactSendAt = null } = {}) {
  const step = priceStepFor(input.listPrice)
  const price = Math.round((input.listPrice - step) * 100) / 100
  if (!(price > input.targetPrice)) return null
  const candidate = withPrices(input, input.listPrice, price)
  const moments = pickMoments(candidate, now, { exactSendAt })
  return { price, discountPct: candidate.discountPct, probability: moments.chosen.pOverall, date: moments.chosen.date }
}

/** Opening/closing prices for a two-step negotiation, only when the opening offer is still credible and sendable. */
export function twoStepFor(input, chosen) {
  if (input.riskBand.id !== 'high') return null
  let openingPrice = Math.round(input.targetPrice * 0.94)
  if (openingPrice % 5 === 0) openingPrice -= 1
  if (openingPrice <= 0 || openingPrice >= input.targetPrice) return null
  const probe = withPrices(input, input.listPrice, openingPrice)
  if (probe.discountPct > VINTED.MAX_DISCOUNT_PCT) return null
  const score = scoreAt(probe, chosen.date, chosen.daysWaited)
  if (score.pAccept < 0.2) return null
  if (blockRiskAt(probe, chosen.date).level === 'high') return null
  return { openingPrice, closingPrice: input.targetPrice, openingProbability: score.pAccept, openingDiscountPct: probe.discountPct }
}

export function buildWarnings(now) {
  const warnings = []
  if (deviceOffsetMinutes(now) !== romeOffsetMinutes(now)) {
    warnings.push({ id: 'timezone', text: 'Il tuo orologio non è sull\'ora italiana: le fasce orarie sono pensate per venditori in Italia, ricalcola gli orari di conseguenza.' })
  }
  return warnings
}

/**
 * «Compra»: no analysis, but the gate still says why (rule 2 under the market, else rule 3), so the UI leads with the
 * same decision it would lead with on an analysed offer.
 */
const noOfferNeeded = (input, now, message, options = {}) => {
  const gate = decisionGate(input, null, { records: options.records || null, now, link: input.link || null })
  return { ok: true, kind: 'no_offer_needed', input, now, message, gate: gate.kind === 'buy_now' ? gate : { ...gate, kind: 'buy_now', rule: 3 } }
}

/** pickMoments' own options: the analysis options minus what the gate and the message policy read. */
const momentOptions = ({ preferredSendAt = null, exactSendAt = null } = {}) => ({ preferredSendAt, exactSendAt })

function buildAnalysis(input, now, options = {}) {
  const moments = pickMoments(input, now, momentOptions(options))
  const { chosen, nowSlot, sendNow } = moments
  const attribution = attributeFactors(chosen.score)
  const blockRisk = blockRiskAt(input, chosen.date)
  const blockRiskNow = blockRiskAt(input, nowSlot.date)
  const uncertainty = uncertaintyFor(input)
  // The gate (ten ordered rules), the tier (on the corrected probability) and the message policy come before the
  // verdict: the headline leads with the gate whenever it says anything but «offer».
  const gate = decisionGate(input, moments, { records: options.records || null, now, link: input.link || null })
  const tier = offerTierFor(chosen.pOverall)
  const messagePolicy = messagePolicyFor(input, gate, input.signals || null, { tier, key: options.key || null, month: options.month || null, otherItem: options.otherItem || null })
  const messageBeforeOffer = messagePolicy.assigned === 'message_first'
  const verdict = buildVerdict(chosen, sendNow, now, moments.best, { gate })
  const twoStep = twoStepFor(input, chosen)
  // Relative goal (engine-spec §7): the suggested price aims at a share of the BEST probability this listing can reach,
  // never below the floor. A fixed 55% was unreachable on most cheap listings once the prior stopped promising it.
  const exactSendAt = chosen.exact ? chosen.date : null
  const ceiling = maxReachable(input, now, { exactSendAt })
  const maxProbability = Math.max(chosen.pOverall, ceiling ? ceiling.probability : 0)
  const targetProbability = Math.max(SUGGESTED_PRICE_FLOOR, SUGGESTED_PRICE_SHARE_OF_MAX * maxProbability)
  const suggestedPrice = chosen.pOverall < targetProbability ? suggestPrice(input, now, targetProbability, { exactSendAt }) : null
  const ambition = moments.maxAccept < 0.15 ? 'unrealistic' : moments.maxAccept < 0.3 ? 'ambitious' : null
  // Honest range: the posterior uncertainty of the learned correction (or its prior, before any outcome), not the
  // ±4 points per blank field, which stays as the hint «indica … per restringerla».
  const probabilityRange = predictiveInterval({ probability: chosen.pOverall, optimal: chosen, input }, input.profile || null)
  const messages = buildMessages({ ...input, sendAt: chosen.date, beforeOffer: messageBeforeOffer, market: input.market, signals: input.signals || null, otherItem: options.otherItem || null })
  // The policy's tone when the analysis carries that template, else the plain recommendation.
  const recommendedTone = messages.some((m) => m.tone === messagePolicy.tone) ? messagePolicy.tone : recommendedToneFor(input)

  return {
    ok: true,
    kind: 'analysis',
    input,
    now,
    probability: chosen.pOverall,
    probabilityRange,
    gate,
    tier,
    messagePolicy,
    maxProbability,
    targetProbability,
    ceiling,
    uncertainty,
    components: { pAccept: chosen.score.pAccept, pAvailable: chosen.pAvailable, pRead: chosen.pRead },
    riskBand: input.riskBand,
    ambition,
    negligibleDiscount: input.discountPct < NEGLIGIBLE_DISCOUNT_PCT,
    blockRisk,
    blockRiskNow,
    optimal: chosen,
    best: moments.best,
    alsoGood: moments.alsoGood,
    quick: moments.quick,
    alternatives: moments.alternatives,
    nowSlot,
    sendNow,
    pinned: moments.pinned,
    timingMatters: moments.timingMatters,
    timingNote: buildTimingNote(moments, chosen),
    spread: moments.spread,
    horizon: moments.horizon,
    verdict,
    opening: openingSentence(input, moments.timingMatters),
    reasons: buildReasons(input, chosen, attribution),
    factors: attribution,
    tips: buildTips({ input, blockRisk, twoStep, chosen, now, messageBeforeOffer }),
    suggestedPrice,
    twoStep,
    messageBeforeOffer,
    messages,
    recommendedTone,
    avoid: avoidWindows(),
    avoidToday: avoidWindowsOn(chosen.date),
    nowInAvoid: nowSlot.score.timeWindow.weight < 0,
    warnings: buildWarnings(now),
    // Only when the caller passed a market (value.js marketFromRows): the result is otherwise unchanged.
    ...(input.market ? { market: marketSummary(input.market, input.listPrice) } : {}),
  }
}

/** The learned profile and the market ride on the input, so every scoreAt / hazard call (slots, price search, two-step) sees them. */
export const withContext = (input, { profile = null, market = null } = {}) => {
  let out = input
  if (profile) out = { ...out, profile }
  if (market) out = { ...out, market }
  return out
}

/**
 * Entry point: raw form values + current date → full analysis for the UI.
 * kinds: 'analysis' | 'no_offer_needed' | 'over_cap' (discount above Vinted's 40% limit).
 * options: { profile, market, preferredSendAt, exactSendAt, records, key, month, otherItem } — `market` is the summary
 * from value.js marketFromRows; `records` the saved offers (gate rule 7: no re-offer on a listing that just said no);
 * `key` and `month` (explorationKey, monthKeyOf) make the optional message policy a deterministic coin per listing and
 * month. Every result carries `gate` ({ kind, rule, reason, alternative, waitHours }); an analysis also `tier`
 * ({ id, label }) and `messagePolicy` ({ mode, rule, tone, randomised, propensity, assigned }).
 */
export function analyzeOffer(raw, now = new Date(), options = {}) {
  const normalized = normalizeInput(raw)
  if (!normalized.ok) return { ok: false, errors: normalized.errors }
  const input = withContext(normalized.input, options)

  if (input.discountPct <= 0) {
    return noOfferNeeded(input, now, 'Il prezzo che vorresti pagare è pari o superiore al prezzo di listino: compra direttamente, non serve nessuna offerta.', options)
  }
  if (input.discountPct < MIN_MEANINGFUL_DISCOUNT_PCT || input.listPrice - input.targetPrice < MIN_MEANINGFUL_GAP_EUR) {
    return noOfferNeeded(input, now, `Risparmieresti solo ${formatEuro(input.listPrice - input.targetPrice)}: compra a prezzo pieno, oppure chiedi la spedizione inclusa o un lotto con un altro articolo. Un'offerta così piccola non vale lo scambio.`, options)
  }

  if (input.discountPct > VINTED.MAX_DISCOUNT_PCT) {
    const cappedPrice = Math.ceil(input.listPrice * (1 - VINTED.MAX_DISCOUNT_PCT / 100) * 100) / 100
    if (input.listPrice - cappedPrice < MIN_MEANINGFUL_GAP_EUR) {
      return noOfferNeeded(input, now, 'Su un prezzo così basso non esiste un\'offerta inviabile: compra direttamente.', options)
    }
    const capped = withPrices(input, input.listPrice, cappedPrice)
    return {
      ...buildAnalysis(capped, now, options),
      kind: 'over_cap',
      requestedInput: input,
      cappedPrice,
      message: `Vinted non accetta offerte sotto il ${100 - VINTED.MAX_DISCOUNT_PCT}% del prezzo: il minimo inviabile è ${formatEuro(cappedPrice)}. L'analisi qui sotto vale per quella cifra.`,
      capAdvice: [
        'Metti il like e aspetta: lo sconto proposto dal venditore non ha il limite del 40%.',
        'Scrivi un messaggio cordiale spiegando il tuo budget, senza criticare l\'articolo.',
        `Oppure alza il tuo target almeno a ${formatEuro(cappedPrice)} e invia l'offerta nel momento consigliato.`,
      ],
    }
  }

  return buildAnalysis(input, now, options)
}
