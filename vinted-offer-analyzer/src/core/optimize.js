import { VINTED } from './constants.js'
import { formatLongDate, formatRelativeDay, formatTime, isSameDay } from './dates.js'
import { formatEuro } from './messages.js'
import { maxReachable, normalizeInput, priceStepFor, withContext, withPrices } from './analyze.js'
import { evaluateSlot, pickMoments } from './scheduler.js'

const roundGoal = (v) => Math.round(v * 100) / 100

/**
 * The next goal above the current probability: +10 points, never above what this listing can reach (`pMax`, the
 * analysis' `maxProbability`; 0,95 when unknown). Goals are relative (engine-spec §7): a fixed 70% is out of reach for
 * most cheap listings once the prior stopped promising it.
 */
export const nextGoalFor = (p, pMax = 0.95) => roundGoal(Math.min(Math.max(p, pMax), p + 0.1))

/** Legacy absolute goals (web OptimizeCard, older mobile builds); the app offers goalChoicesFor(result) instead. */
export const GOAL_CHOICES = [0.5, 0.6, 0.7, 0.8, 0.9]

/**
 * The goals the optimiser offers for an analysis: +10 points, +20 points and the ceiling (the probability at the top of
 * the price grid, `result.maxProbability`), each capped at the ceiling and only when above the current probability;
 * the ceiling's label says the discount it stands for («il massimo (−3%)»). A step that lands on the ceiling is shown
 * as the ceiling. Returns [{ id, label, probability, deltaPoints }].
 */
export function goalChoicesFor(result) {
  if (!result || !result.ok || result.kind === 'no_offer_needed' || !Number.isFinite(result.probability)) return []
  const p = result.probability
  const pMax = Number.isFinite(result.maxProbability) ? Math.max(p, result.maxProbability) : Math.max(p, 0.95)
  const maxDiscount = result.ceiling ? Math.round(result.ceiling.discountPct) : null
  const raw = [
    { id: 'plus10', label: '+10 punti', probability: Math.min(pMax, p + 0.1) },
    { id: 'plus20', label: '+20 punti', probability: Math.min(pMax, p + 0.2) },
    { id: 'max', label: maxDiscount != null ? `il massimo (−${maxDiscount}%)` : 'il massimo', probability: pMax },
  ]
  const rounded = raw.map((g) => ({ ...g, probability: roundGoal(g.probability) })).filter((g) => g.probability > p + 0.005)
  // Duplicates resolve toward the ceiling: «+20 punti» that equals the maximum is shown as the maximum.
  return rounded
    .filter((g, i) => !rounded.slice(i + 1).some((later) => Math.abs(later.probability - g.probability) < 0.005))
    .map((g) => ({ ...g, deltaPoints: Math.round((g.probability - p) * 100) }))
}

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
 * `market` (value.js marketFromRows) is attached to the input like `profile`.
 */
export function optimizeOffer(raw, now = new Date(), { targetProbability = null, profile = null, market = null, exactSendAt = null } = {}) {
  const normalized = normalizeInput(raw)
  if (!normalized.ok) return { ok: false, errors: normalized.errors }
  let input = withContext(normalized.input, { profile, market })
  if (input.discountPct <= 0) return { ok: false, reason: 'no_offer_needed' }
  let capped = false
  if (input.discountPct > VINTED.MAX_DISCOUNT_PCT) {
    input = withPrices(input, input.listPrice, Math.ceil(input.listPrice * (1 - VINTED.MAX_DISCOUNT_PCT / 100) * 100) / 100)
    capped = true
  }

  // `exactSendAt`: the test variation on screen is the starting point, so "go back to the best moment" is an option.
  const current = pickMoments(input, now, { exactSendAt })
  const currentP = current.chosen.pOverall
  const ceiling = maxReachable(input, now, { exactSendAt })
  const target = targetProbability || nextGoalFor(currentP, Math.max(currentP, ceiling ? ceiling.probability : 0))
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
