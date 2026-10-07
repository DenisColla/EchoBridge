import { VINTED } from './constants.js'
import { formatLongDate, formatRelativeDay, formatTime, isSameDay } from './dates.js'
import { formatEuro } from './messages.js'
import { normalizeInput, priceStepFor, withPrices } from './analyze.js'
import { evaluateSlot, pickMoments } from './scheduler.js'

/** Next "round" goal above the current probability: 63% → 70%, 88% → 93%, capped at 95%. */
export const nextGoalFor = (p) => {
  if (p >= 0.9) return 0.95
  return Math.min(0.9, Math.ceil((p + 0.03) * 10) / 10)
}

export const GOAL_CHOICES = [0.5, 0.6, 0.7, 0.8, 0.9]

const roundPrice = (v) => Math.round(v * 100) / 100

const bestByProbability = (moments) =>
  [...moments.eligible].sort((a, b) => b.pOverall - a.pOverall || a.date - b.date)[0]

/** Smallest grid index i in [1, n] whose predicate holds (predicate is monotone in i), or null. */
function bisect(n, predicate) {
  if (n < 1 || !predicate(n)) return null
  let lo = 0
  let hi = n
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (predicate(mid)) hi = mid
    else lo = mid
  }
  return hi
}

const describeSlot = (slot, now) =>
  slot.kind === 'now' ? 'adesso' : `${formatLongDate(slot.date, now)} alle ${formatTime(slot.date)} (${formatRelativeDay(slot.date, now)})`

/**
 * Finds the cheapest ways to reach a target overall probability: waiting for a
 * better moment, raising the offer, or both. Every option carries what to apply
 * (`targetPrice`, `preferredSendAt`) so the UI can re-run the analysis with it.
 */
export function optimizeOffer(raw, now = new Date(), { targetProbability = null } = {}) {
  const normalized = normalizeInput(raw)
  if (!normalized.ok) return { ok: false, errors: normalized.errors }
  let input = normalized.input
  if (input.discountPct <= 0) return { ok: false, reason: 'no_offer_needed' }
  let capped = false
  if (input.discountPct > VINTED.MAX_DISCOUNT_PCT) {
    input = withPrices(input, input.listPrice, Math.ceil(input.listPrice * (1 - VINTED.MAX_DISCOUNT_PCT / 100) * 100) / 100)
    capped = true
  }

  const current = pickMoments(input, now)
  const currentP = current.chosen.pOverall
  const target = targetProbability || nextGoalFor(currentP)
  const step = priceStepFor(input.listPrice)
  const gridSize = Math.max(0, Math.ceil((input.listPrice - input.targetPrice) / step) - 1)
  const priceAt = (i) => roundPrice(Math.min(input.listPrice - step, input.targetPrice + i * step))

  const options = []
  const makeOption = (id, label, { price, slot, probability, changes, momentsOf }) => ({
    id,
    label,
    price,
    discountPct: withPrices(input, input.listPrice, price).discountPct,
    slot,
    slotLabel: describeSlot(slot, now),
    probability,
    deltaPoints: Math.round((probability - currentP) * 100),
    priceIncrease: roundPrice(price - input.targetPrice),
    daysWaited: slot.daysWaited,
    changes,
    apply: { targetPrice: price, preferredSendAt: slot.date.toISOString() },
    reachesTarget: probability >= target,
    momentsOf,
  })

  // Lever 1: only wait for the best moment in the horizon.
  const waitSlot = bestByProbability(current)
  if (waitSlot && waitSlot !== current.chosen && waitSlot.pOverall > currentP + 0.005) {
    options.push(makeOption('wait', 'Aspetta il momento migliore', {
      price: input.targetPrice,
      slot: waitSlot,
      probability: waitSlot.pOverall,
      changes: [`Invia ${describeSlot(waitSlot, now)} invece di ${describeSlot(current.chosen, now)}`],
    }))
  }

  // Lever 2: only raise the offer, keeping the recommended moment.
  const chosenSlot = current.chosen
  const pAtPrice = (i) => evaluateSlot(withPrices(input, input.listPrice, priceAt(i)), chosenSlot).pOverall
  const priceIdx = bisect(gridSize, (i) => pAtPrice(i) >= target)
  if (priceIdx !== null) {
    const price = priceAt(priceIdx)
    options.push(makeOption('price', 'Alza un po\' l\'offerta', {
      price,
      slot: chosenSlot,
      probability: pAtPrice(priceIdx),
      changes: [`Offri ${formatEuro(price)} invece di ${formatEuro(input.targetPrice)} (+${formatEuro(roundPrice(price - input.targetPrice))})`],
    }))
  }

  // Lever 3: smallest raise combined with the best moment at that price.
  const momentsCache = new Map()
  const momentsAt = (i) => {
    if (!momentsCache.has(i)) momentsCache.set(i, pickMoments(withPrices(input, input.listPrice, priceAt(i)), now))
    return momentsCache.get(i)
  }
  const comboIdx = bisect(gridSize, (i) => bestByProbability(momentsAt(i)).pOverall >= target)
  if (comboIdx !== null) {
    const m = momentsAt(comboIdx)
    const slot = bestByProbability(m)
    const price = priceAt(comboIdx)
    const duplicate = options.some((o) => Math.abs(o.price - price) < 0.001 && isSameDay(o.slot.date, slot.date) && o.slot.date.getTime() === slot.date.getTime())
    if (!duplicate) {
      options.push(makeOption('combined', 'Alza un po\' e scegli il momento', {
        price,
        slot,
        probability: slot.pOverall,
        changes: [
          `Offri ${formatEuro(price)} invece di ${formatEuro(input.targetPrice)} (+${formatEuro(roundPrice(price - input.targetPrice))})`,
          `Invia ${describeSlot(slot, now)}`,
        ],
      }))
    }
  }

  // Ceiling: the most the model can reach without paying list price.
  const topMoments = gridSize >= 1 ? momentsAt(gridSize) : current
  const topSlot = bestByProbability(topMoments)
  const maxAchievable = makeOption('max', 'Il massimo raggiungibile', {
    price: gridSize >= 1 ? priceAt(gridSize) : input.targetPrice,
    slot: topSlot,
    probability: topSlot.pOverall,
    changes: gridSize >= 1
      ? [`Offri ${formatEuro(priceAt(gridSize))}`, `Invia ${describeSlot(topSlot, now)}`]
      : [`Invia ${describeSlot(topSlot, now)}`],
  })

  const reaching = options.filter((o) => o.reachesTarget)
  // Cheapest first: less money, then fewer days of waiting.
  reaching.sort((a, b) => a.priceIncrease - b.priceIncrease || a.daysWaited - b.daysWaited)
  const partial = options.filter((o) => !o.reachesTarget).sort((a, b) => b.probability - a.probability)

  return {
    ok: true,
    capped,
    target,
    current: { probability: currentP, price: input.targetPrice, slot: current.chosen, slotLabel: describeSlot(current.chosen, now) },
    reachable: reaching.length > 0,
    options: reaching,
    partial,
    maxAchievable,
    recommended: reaching[0] || null,
  }
}
