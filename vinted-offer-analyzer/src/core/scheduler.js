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
export function pickMoments(input, now) {
  const horizon = horizonFor(input)
  const evaluated = buildCandidateSlots(input, now, horizon).map((s) => evaluateSlot(input, s))
  // "Now" competes only when the current window is not unfavourable: we never recommend sending at 2 AM.
  const eligible = evaluated.filter((s) => s.kind !== 'now' || s.score.timeWindow.weight >= 0)
  const ranking = [...eligible].sort(byUtilityThenDate)
  const best = ranking[0]
  const threshold = best.utility - Math.max(NEAR_TIE_ABS, NEAR_TIE_REL * best.utility)
  const chosen = [...eligible.filter((s) => s.utility >= threshold)].sort((a, b) => a.date - b.date)[0]
  const alsoGood = !isSameDay(best.date, chosen.date) && best.utility > chosen.utility ? best : null

  const nowSlot = evaluated.find((s) => s.kind === 'now')
  const sendNow = {
    slot: nowSlot,
    ok: chosen.kind === 'now' || nowSlot.pOverall >= chosen.pOverall - SEND_NOW_TOLERANCE,
    deltaPoints: Math.round((nowSlot.pOverall - chosen.pOverall) * 100),
    window: nowSlot.score.timeWindow,
    windowEndsAt: atTime(nowSlot.date, Math.floor(nowSlot.score.timeWindow.to / 60) % 24, nowSlot.score.timeWindow.to % 60),
  }

  const hoursToChosen = (chosen.date.getTime() - now.getTime()) / 3_600_000
  const quick = hoursToChosen > QUICK_ALTERNATIVE_MIN_HOURS
    ? [...eligible.filter((s) => s.date.getTime() < chosen.date.getTime() && s.date.getTime() - now.getTime() <= 48 * 3_600_000)].sort(byUtilityThenDate)[0] || null
    : null

  // Best slot per distinct day, excluding the chosen day (and "now").
  const seenDays = new Set([startOfDay(chosen.date).getTime()])
  const alternatives = []
  for (const s of ranking) {
    const key = startOfDay(s.date).getTime()
    if (seenDays.has(key) || s.kind === 'now') continue
    seenDays.add(key)
    alternatives.push(s)
    if (alternatives.length >= 3) break
  }

  const topDays = [chosen, ...alternatives].slice(0, 5).map((s) => s.pOverall)
  const spread = Math.max(...topDays) - Math.min(...topDays)
  const maxAccept = Math.max(...evaluated.map((s) => s.score.pAccept))

  return { horizon, chosen, best, alsoGood, quick, alternatives, nowSlot, sendNow, ranking, spread, timingMatters: spread >= TIMING_MATTERS_SPREAD, maxAccept }
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

/** Negative windows that apply on the given day. */
export const avoidWindowsOn = (date) => {
  const day = effectiveWeekday(date)
  return TIME_WINDOWS.filter((w) => w.weight < 0 && w.days.includes(day)).sort((a, b) => a.from - b.from).map(describeWindow)
}
