import {
  CANONICAL_SLOTS, HORIZON_AVAILABILITY_FLOOR, HORIZON_MAX_DAYS, HORIZON_MIN_DAYS, HORIZON_STALE_LISTING_DAYS,
  IMPATIENCE_PER_DAY, INACTIVE_READ_PROBABILITY, JITTER_MINUTES, NEAR_TIE_ABS, NEAR_TIE_REL,
  QUICK_ALTERNATIVE_MIN_HOURS, SEND_NOW_TOLERANCE, TIME_WINDOWS, TIMING_MATTERS_SPREAD, VINTED, ageHazardMultiplier,
} from './constants.js'
import { addDays, addMinutes, atTime, calendarDaysBetween, ceilToMinutes, formatDayList, formatRange, isSameDay, startOfDay } from './dates.js'
import { hashString } from './math.js'
import { effectiveWeekday, scoreAt, timeWindowAt } from './scoring.js'

/* ───────── availability & response ───────── */

/** Daily probability that the item sells to someone else on day `j` from now. */
export const hazardAt = (input, j) => {
  const rate = input.category ? input.category.dailySellRate : 0.015
  return rate * ageHazardMultiplier(input.listingAge.days + j)
}

/** Probability that the item is still available after `days` days. */
export const availabilityAfter = (input, days) => {
  let p = 1
  for (let j = 0; j < days; j++) p *= 1 - hazardAt(input, j)
  return p
}

/** Probability that the seller even opens the offer before it lapses. */
export const readProbability = (input) => (input.sellerProfile === 'inactive' ? INACTIVE_READ_PROBABILITY : 1)

/** Days ahead worth considering: stop when the item would likely be gone; stale listings do not justify long waits. */
export function horizonFor(input) {
  let k = 0
  while (k < HORIZON_MAX_DAYS && availabilityAfter(input, k + 1) >= HORIZON_AVAILABILITY_FLOOR) k++
  let horizon = Math.max(HORIZON_MIN_DAYS, Math.min(HORIZON_MAX_DAYS, k))
  if (input.listingAge.id === 'over_month') horizon = Math.min(horizon, HORIZON_STALE_LISTING_DAYS)
  return horizon
}

/* ───────── candidate moments ───────── */

/** Deterministic per-offer minute offset so that different items do not all land on 21:45. */
export const jitterFor = (input) => {
  const key = [input.category && input.category.id, input.listPrice, input.targetPrice, input.listingAge.id, input.sellerProfile, input.listingSignal.id].join('|')
  return JITTER_MINUTES[hashString(key) % JITTER_MINUTES.length]
}

/**
 * Enumerates candidate send moments: "now" (always, with its true window weight)
 * plus the canonical evening/weekend slots of each day up to the horizon.
 */
export function buildCandidateSlots(input, now, horizonDays) {
  const nowDate = ceilToMinutes(addMinutes(now, 5), 5)
  const nowSlot = { date: nowDate, daysWaited: calendarDaysBetween(now, nowDate), kind: 'now', windowId: timeWindowAt(nowDate).id }
  const slots = [nowSlot]
  const jitter = jitterFor(input)
  const today = startOfDay(now)
  for (let k = 0; k <= horizonDays; k++) {
    const day = addDays(today, k)
    const times = CANONICAL_SLOTS[effectiveWeekday(day)] || []
    for (const [hh, mm] of times) {
      const canonical = atTime(day, hh, mm)
      let date = atTime(day, hh, mm + jitter)
      if (timeWindowAt(date).id !== timeWindowAt(canonical).id) date = canonical
      if (date.getTime() <= now.getTime()) continue
      const windowId = timeWindowAt(date).id
      if (isSameDay(date, nowDate) && windowId === nowSlot.windowId) continue
      slots.push({ date, daysWaited: k, kind: 'canonical', windowId })
    }
  }
  return slots
}

export function evaluateSlot(input, slot) {
  const score = scoreAt(input, slot.date, slot.daysWaited)
  const pAvailable = availabilityAfter(input, slot.daysWaited)
  const pRead = readProbability(input)
  const pOverall = score.pAccept * pAvailable * pRead
  const utility = pOverall * Math.pow(IMPATIENCE_PER_DAY, slot.daysWaited)
  return { ...slot, score, pAvailable, pRead, pOverall, utility, expiresAt: addMinutes(slot.date, VINTED.OFFER_VALIDITY_HOURS * 60) }
}

/* ───────── choice ───────── */

const byUtilityThenDate = (a, b) => b.utility - a.utility || a.date - b.date

/**
 * Chooses the moment to recommend. Among near-ties (within 1.5pp or 3% of the
 * best utility) the earliest wins, so the verdict does not flip by weeks on noise.
 */
export function pickMoments(input, now, { preferredSendAt = null } = {}) {
  const horizon = horizonFor(input)
  const evaluated = buildCandidateSlots(input, now, horizon).map((s) => evaluateSlot(input, s))
  // "Now" competes only when neither the current instant nor the +5 min send moment sits in an unfavourable window.
  const nowIsFavourable = timeWindowAt(now).weight >= 0
  const eligible = evaluated.filter((s) => s.kind !== 'now' || (nowIsFavourable && s.score.timeWindow.weight >= 0))
  const ranking = [...eligible].sort(byUtilityThenDate)
  const best = ranking[0]
  const threshold = best.utility - Math.max(NEAR_TIE_ABS, NEAR_TIE_REL * best.utility)
  let chosen = [...eligible.filter((s) => s.utility >= threshold)].sort((a, b) => a.date - b.date)[0]
  // The caller (e.g. the optimizer's "Applica") may pin a specific moment: use the nearest candidate within 3 hours.
  let pinned = false
  if (preferredSendAt) {
    const wanted = new Date(preferredSendAt).getTime()
    const nearest = [...eligible].sort((a, b) => Math.abs(a.date.getTime() - wanted) - Math.abs(b.date.getTime() - wanted))[0]
    if (nearest && Math.abs(nearest.date.getTime() - wanted) <= 3 * 3_600_000) {
      chosen = nearest
      pinned = true
    }
  }
  // A strictly better slot (any day, even later the same evening) is reported alongside the recommendation.
  const alsoGood = best !== chosen && best.utility > chosen.utility ? best : null

  const nowSlot = evaluated.find((s) => s.kind === 'now')
  const nowEligible = eligible.includes(nowSlot)
  const closeEnough = nowSlot.pOverall >= chosen.pOverall - SEND_NOW_TOLERANCE
  const sendNow = {
    slot: nowSlot,
    ok: chosen.kind === 'now' || (nowEligible && closeEnough),
    reason: chosen.kind === 'now' ? 'chosen' : !nowEligible ? 'avoid_window' : closeEnough ? 'close_enough' : 'worse',
    deltaPoints: Math.round((nowSlot.pOverall - chosen.pOverall) * 100),
    window: nowSlot.score.timeWindow,
    windowEndsAt: addMinutes(startOfDay(nowSlot.date), nowSlot.score.timeWindow.to),
  }

  const hoursToChosen = (chosen.date.getTime() - now.getTime()) / 3_600_000
  const quick = hoursToChosen > QUICK_ALTERNATIVE_MIN_HOURS
    ? [...eligible.filter((s) => s.kind !== 'now' && s.daysWaited < chosen.daysWaited && s.date.getTime() - now.getTime() <= 48 * 3_600_000)].sort(byUtilityThenDate)[0] || null
    : null

  // Best slot per distinct day, excluding "now" and the days already shown (chosen, alsoGood, quick); listed chronologically.
  const seenDays = new Set([chosen, alsoGood, quick].filter(Boolean).map((s) => startOfDay(s.date).getTime()))
  const alternatives = []
  for (const s of ranking) {
    const key = startOfDay(s.date).getTime()
    if (seenDays.has(key) || s.kind === 'now') continue
    seenDays.add(key)
    alternatives.push(s)
    if (alternatives.length >= 3) break
  }
  alternatives.sort((a, b) => a.date - b.date)

  const topDays = [chosen, ...(alsoGood ? [alsoGood] : []), ...alternatives].slice(0, 5).map((s) => s.pOverall)
  const spread = Math.max(...topDays) - Math.min(...topDays)
  const maxAccept = Math.max(...evaluated.map((s) => s.score.pAccept))

  return { horizon, chosen, best, alsoGood, quick, alternatives, nowSlot, sendNow, ranking, eligible, spread, timingMatters: spread >= TIMING_MATTERS_SPREAD, maxAccept, pinned }
}

/* ───────── windows to avoid ───────── */

const describeWindow = (w) => ({
  id: w.id,
  label: w.label,
  weight: w.weight,
  rangeLabel: formatRange(w.from, w.to),
  daysLabel: formatDayList(w.days),
  why: w.why,
})

/** All negative windows, worst first. */
export const avoidWindows = () => TIME_WINDOWS.filter((w) => w.weight < 0).sort((a, b) => a.weight - b.weight).map(describeWindow)

/** Negative windows that apply on the given day, worst first. */
export const avoidWindowsOn = (date) => {
  const day = effectiveWeekday(date)
  return TIME_WINDOWS.filter((w) => w.weight < 0 && w.days.includes(day)).sort((a, b) => a.weight - b.weight || a.from - b.from).map(describeWindow)
}
