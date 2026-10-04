import { NEGLIGIBLE_DISCOUNT_PCT, SUGGESTED_PRICE_TARGET, SUGGESTED_PRICE_TARGET_HIGH_BLOCK, VINTED } from './constants.js'
import { deviceOffsetMinutes, romeOffsetMinutes } from './dates.js'
import { buildMessages, recommendedToneFor } from './messages.js'
import { buildReasons, buildTips, buildVerdict, openingSentence } from './reasoning.js'
import { avoidWindows, avoidWindowsOn, pickMoments } from './scheduler.js'
import {
  attributeFactors, blockRiskAt, computeDiscountPct, findCategory, findListingAge, findListingSignal,
  riskBandFor, scoreAt, uncertaintyFor,
} from './scoring.js'

/**
 * Validates raw form values. Returns { ok, errors, input } where `input` is the
 * normalised object consumed by the scoring engine.
 */
export function normalizeInput(raw) {
  const errors = {}
  const listPrice = Number(String(raw.listPrice ?? '').replace(',', '.'))
  const targetPrice = Number(String(raw.targetPrice ?? '').replace(',', '.'))
  const category = findCategory(raw.category)

  if (!category) errors.category = 'Scegli una categoria.'
  if (!Number.isFinite(listPrice) || listPrice <= 0) errors.listPrice = 'Inserisci il prezzo di listino (maggiore di 0).'
  if (!Number.isFinite(targetPrice) || targetPrice <= 0) errors.targetPrice = 'Inserisci il prezzo che vorresti pagare.'
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

const priceStepFor = (listPrice) => (listPrice < 20 ? 0.5 : listPrice < 200 ? 1 : 5)

/**
 * Smallest price increase (from the target upward) whose best moment reaches the
 * target overall probability. Re-runs the scheduler at each candidate price.
 */
export function suggestPrice(input, now, targetProbability) {
  const step = priceStepFor(input.listPrice)
  let guard = 0
  for (let price = input.targetPrice + step; price < input.listPrice && guard < 600; price += step, guard++) {
    const candidate = withPrices(input, input.listPrice, Math.round(price * 100) / 100)
    const moments = pickMoments(candidate, now)
    if (moments.chosen.pOverall >= targetProbability) {
      return {
        price: candidate.targetPrice,
        discountPct: candidate.discountPct,
        probability: moments.chosen.pOverall,
        date: moments.chosen.date,
      }
    }
  }
  return null
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

function buildAnalysis(input, now) {
  const moments = pickMoments(input, now)
  const { chosen, nowSlot, sendNow } = moments
  const attribution = attributeFactors(chosen.score)
  const blockRisk = blockRiskAt(input, chosen.date)
  const blockRiskNow = blockRiskAt(input, nowSlot.date)
  const uncertainty = uncertaintyFor(input)
  const verdict = buildVerdict(chosen, sendNow, now)
  const twoStep = twoStepFor(input, chosen)
  const targetProbability = blockRisk.level === 'high' ? SUGGESTED_PRICE_TARGET_HIGH_BLOCK : SUGGESTED_PRICE_TARGET
  const suggestedPrice = chosen.pOverall < targetProbability ? suggestPrice(input, now, targetProbability) : null
  const ambition = moments.maxAccept < 0.15 ? 'unrealistic' : moments.maxAccept < 0.3 ? 'ambitious' : null

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
    alsoGood: moments.alsoGood,
    quick: moments.quick,
    alternatives: moments.alternatives,
    nowSlot,
    sendNow,
    timingMatters: moments.timingMatters,
    spread: moments.spread,
    horizon: moments.horizon,
    verdict,
    opening: openingSentence(input),
    reasons: buildReasons(input, chosen, attribution),
    factors: attribution,
    tips: buildTips({ input, moments, blockRisk, twoStep, chosen, now }),
    suggestedPrice,
    twoStep,
    messages: buildMessages({ ...input, sendAt: chosen.date }),
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
export function analyzeOffer(raw, now = new Date()) {
  const normalized = normalizeInput(raw)
  if (!normalized.ok) return { ok: false, errors: normalized.errors }
  const { input } = normalized

  if (input.discountPct <= 0) {
    return {
      ok: true,
      kind: 'no_offer_needed',
      input,
      now,
      message: 'Il prezzo che vorresti pagare è pari o superiore al prezzo di listino: compra direttamente, non serve nessuna offerta.',
    }
  }

  if (input.discountPct > VINTED.MAX_DISCOUNT_PCT) {
    const cappedPrice = Math.ceil(input.listPrice * (1 - VINTED.MAX_DISCOUNT_PCT / 100) * 2) / 2
    const capped = withPrices(input, input.listPrice, cappedPrice)
    return {
      ...buildAnalysis(capped, now),
      kind: 'over_cap',
      requestedInput: input,
      cappedPrice,
      message: `Vinted non accetta offerte sotto il ${100 - VINTED.MAX_DISCOUNT_PCT}% del prezzo: il minimo inviabile è ${cappedPrice} €. L'analisi qui sotto vale per quella cifra.`,
      capAdvice: [
        'Metti il like e aspetta: lo sconto proposto dal venditore non ha il limite del 40%.',
        'Scrivi un messaggio cordiale spiegando il tuo budget, senza criticare l\'articolo.',
        `Oppure alza il tuo target almeno a ${cappedPrice} € e invia l'offerta nel momento consigliato.`,
      ],
    }
  }

  return buildAnalysis(input, now)
}
