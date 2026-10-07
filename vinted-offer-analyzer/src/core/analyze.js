import { NEGLIGIBLE_DISCOUNT_PCT, SUGGESTED_PRICE_TARGET, SUGGESTED_PRICE_TARGET_HIGH_BLOCK, VINTED } from './constants.js'
import { deviceOffsetMinutes, romeOffsetMinutes } from './dates.js'
import { buildMessages, formatEuro, recommendedToneFor } from './messages.js'
import { buildReasons, buildTimingNote, buildTips, buildVerdict, openingSentence } from './reasoning.js'
import { avoidWindows, avoidWindowsOn, pickMoments, readProbability } from './scheduler.js'
import {
  attributeFactors, blockRiskAt, computeDiscountPct, findCategory, findListingAge, findListingSignal,
  riskBandFor, scoreAt, uncertaintyFor,
} from './scoring.js'

/** Below this discount (or euro gap) an offer is pointless: buy at list price. */
const MIN_MEANINGFUL_DISCOUNT_PCT = 0.5
const MIN_MEANINGFUL_GAP_EUR = 0.5

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

  return { ok: true, errors: {}, input: withPrices({
    itemTitle: (raw.itemTitle || '').trim(),
    category,
    listingAge: findListingAge(raw.listingAge),
    sellerProfile: raw.sellerProfile || 'unknown',
    listingSignal: findListingSignal(raw.listingSignal),
  }, listPrice, targetPrice) }
}

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
export function suggestPrice(input, now, targetProbability) {
  const step = priceStepFor(input.listPrice)
  const steps = Math.floor((input.listPrice - input.targetPrice) / step) - (Number.isInteger((input.listPrice - input.targetPrice) / step) ? 1 : 0)
  if (steps < 1) return null
  const evaluate = (i) => {
    const candidate = withPrices(input, input.listPrice, Math.round((input.targetPrice + i * step) * 100) / 100)
    const moments = pickMoments(candidate, now)
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

const noOfferNeeded = (input, now, message) => ({ ok: true, kind: 'no_offer_needed', input, now, message })

function buildAnalysis(input, now, options = {}) {
  const moments = pickMoments(input, now, options)
  const { chosen, nowSlot, sendNow } = moments
  const attribution = attributeFactors(chosen.score)
  const blockRisk = blockRiskAt(input, chosen.date)
  const blockRiskNow = blockRiskAt(input, nowSlot.date)
  const uncertainty = uncertaintyFor(input)
  const verdict = buildVerdict(chosen, sendNow, now, moments.best)
  const twoStep = twoStepFor(input, chosen)
  // The read probability is the one factor a higher price cannot change, so the price target is scaled by it.
  const targetProbability = (blockRisk.level === 'high' ? SUGGESTED_PRICE_TARGET_HIGH_BLOCK : SUGGESTED_PRICE_TARGET) * readProbability(input)
  const suggestedPrice = chosen.pOverall < targetProbability ? suggestPrice(input, now, targetProbability) : null
  const ambition = moments.maxAccept < 0.15 ? 'unrealistic' : moments.maxAccept < 0.3 ? 'ambitious' : null
  const messageBeforeOffer = blockRisk.level === 'high' || input.sellerProfile === 'inactive'

  return {
    ok: true,
    kind: 'analysis',
    input,
    now,
    probability: chosen.pOverall,
    probabilityRange: [Math.max(0.01, chosen.pOverall - uncertainty), Math.min(0.99, chosen.pOverall + uncertainty)],
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
    messages: buildMessages({ ...input, sendAt: chosen.date, beforeOffer: messageBeforeOffer }),
    recommendedTone: recommendedToneFor(input),
    avoid: avoidWindows(),
    avoidToday: avoidWindowsOn(chosen.date),
    nowInAvoid: nowSlot.score.timeWindow.weight < 0,
    warnings: buildWarnings(now),
  }
}

/**
 * Entry point: raw form values + current date → full analysis for the UI.
 * kinds: 'analysis' | 'no_offer_needed' | 'over_cap' (discount above Vinted's 40% limit).
 */
export function analyzeOffer(raw, now = new Date(), options = {}) {
  const normalized = normalizeInput(raw)
  if (!normalized.ok) return { ok: false, errors: normalized.errors }
  const { input } = normalized

  if (input.discountPct <= 0) {
    return noOfferNeeded(input, now, 'Il prezzo che vorresti pagare è pari o superiore al prezzo di listino: compra direttamente, non serve nessuna offerta.')
  }
  if (input.discountPct < MIN_MEANINGFUL_DISCOUNT_PCT || input.listPrice - input.targetPrice < MIN_MEANINGFUL_GAP_EUR) {
    return noOfferNeeded(input, now, `Lo sconto richiesto è simbolico (${formatEuro(input.listPrice - input.targetPrice)}): compra a prezzo pieno o chiedi la spedizione inclusa, un'offerta non ha senso.`)
  }

  if (input.discountPct > VINTED.MAX_DISCOUNT_PCT) {
    const cappedPrice = Math.ceil(input.listPrice * (1 - VINTED.MAX_DISCOUNT_PCT / 100) * 100) / 100
    if (input.listPrice - cappedPrice < MIN_MEANINGFUL_GAP_EUR) {
      return noOfferNeeded(input, now, 'Su un prezzo così basso non esiste un\'offerta inviabile: compra direttamente.')
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
