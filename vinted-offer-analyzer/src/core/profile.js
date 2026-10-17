import { COUNTER, LEARNING, LEARNING_DISCOUNT_KNOTS, LEARNING_TIME_GROUPS } from './constants.js'

/**
 * The learned profile: small corrections, fitted every month on the user's own outcomes, that the engine adds to its
 * acceptance logits, plus two counter-engine parameters. Without a profile (web app, tests, first month) the engine
 * is unchanged.
 *
 *   logit' = logit + (slope − 1)·(logit − c) + intercept + time[group] + disc(discount)    (first offer, c = SLOPE_CENTER)
 *   logit' = logit + counter + time[group of the send window]                                       (our counter)
 *   counterShare     how much this user's sellers concede in a counter, relative to eBay's 0,42 (stance reading)
 *   sellerReplyHours how long they take to answer (availability during the wait), null = engine default
 *
 * disc(d) is piecewise linear through the knots at 10/20/30% and flat outside: never a step at a band edge.
 */
const ZERO_TIME = Object.freeze(Object.fromEntries(LEARNING_TIME_GROUPS.map((g) => [g.id, 0])))
const ZERO_DISC = Object.freeze(Object.fromEntries(LEARNING_DISCOUNT_KNOTS.map((k) => [k.id, 0])))

export const DEFAULT_PROFILE = Object.freeze({
  version: 2,
  id: 'default',
  parentId: null,
  /** Parameters of the profile this one replaced (for the prequential rollback). */
  parent: null,
  month: null,
  createdAt: null,
  intercept: 0,
  slope: 1,
  time: ZERO_TIME,
  disc: ZERO_DISC,
  counter: 0,
  counterShare: 1,
  sellerReplyHours: null,
  discountPct: LEARNING.DEFAULT_DISCOUNT_PCT,
  /** Posterior covariance of the first-offer parameters (keys in `paramKeys`), for failure-risk intervals. */
  cov: null,
  paramKeys: null,
  changes: [],
  basedOn: 0,
  /** Prequential log Bayes factor against the parent, summed over the months this profile was active. */
  score: 0,
  scoreMonths: 0,
  /** Parameter families that may not move until the given month (after a rollback). */
  frozen: {},
})

const finite = (v, fallback) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : fallback)
const clampTo = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v))

/** Hat weights of a discount on the three knots (sum to 1; flat below 10% and above 30%). */
export function discKnotWeights(discountPct) {
  const d = finite(discountPct, 20)
  const ks = LEARNING_DISCOUNT_KNOTS
  const w = Object.fromEntries(ks.map((k) => [k.id, 0]))
  if (d <= ks[0].pct) w[ks[0].id] = 1
  else if (d >= ks[ks.length - 1].pct) w[ks[ks.length - 1].id] = 1
  else {
    for (let i = 0; i < ks.length - 1; i++) {
      if (d >= ks[i].pct && d <= ks[i + 1].pct) {
        const t = (d - ks[i].pct) / (ks[i + 1].pct - ks[i].pct)
        w[ks[i].id] = 1 - t
        w[ks[i + 1].id] = t
        break
      }
    }
  }
  return w
}

/** Nearest knot (for report tables). */
export const discKnotOf = (discountPct) => {
  const d = finite(discountPct, 20)
  return d < 15 ? 'd10' : d < 25 ? 'd20' : 'd30'
}

export const discOffset = (profile, discountPct) => {
  const w = discKnotWeights(discountPct)
  return Object.keys(w).reduce((s, id) => s + w[id] * finite(profile && profile.disc && profile.disc[id], 0), 0)
}

/**
 * Keeps the corrected acceptance non-increasing in the discount: between two knots the correction may rise by at most
 * 80% of what the engine's own curve falls over the same 10 points (scaled by the slope). Returns new knot values.
 */
export function monotoneDisc(disc, slope = 1) {
  const ks = LEARNING_DISCOUNT_KNOTS
  const values = ks.map((k) => finite(disc && disc[k.id], 0))
  let worst = 0
  for (let i = 0; i < ks.length - 1; i++) {
    const limit = LEARNING.DISC_MONOTONE_MARGIN * (ks[i + 1].pct - ks[i].pct) * Math.max(0.1, slope) * LEARNING.DISC_MIN_ENGINE_SLOPE
    worst = Math.max(worst, (values[i + 1] - values[i]) / limit)
  }
  const scale = worst > 1 ? 1 / worst : 1
  return Object.fromEntries(ks.map((k, i) => [k.id, values[i] * scale]))
}

/** A stored profile (any version, possibly partial or tampered with) → a complete, bounded profile. */
export function normalizeProfile(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PROFILE }
  const B = LEARNING.BOUNDS
  const slope = clampTo(finite(raw.slope, 1), B.slope)
  const disc = monotoneDisc(Object.fromEntries(LEARNING_DISCOUNT_KNOTS.map((k) => [k.id, clampTo(finite(raw.disc && raw.disc[k.id], 0), B.disc)])), slope)
  const hours = raw.sellerReplyHours == null ? null : finite(raw.sellerReplyHours, null)
  return {
    ...DEFAULT_PROFILE,
    ...raw,
    version: 2,
    intercept: clampTo(finite(raw.intercept, 0), B.intercept),
    slope,
    time: Object.fromEntries(LEARNING_TIME_GROUPS.map((g) => [g.id, clampTo(finite(raw.time && raw.time[g.id], 0), B.time)])),
    disc,
    counter: clampTo(finite(raw.counter, 0), B.counter),
    counterShare: clampTo(finite(raw.counterShare, 1), B.share),
    sellerReplyHours: hours == null ? null : clampTo(hours, B.latency),
    discountPct: clampTo(finite(raw.discountPct, LEARNING.DEFAULT_DISCOUNT_PCT), B.discountPct),
    changes: Array.isArray(raw.changes) ? raw.changes : [],
    frozen: raw.frozen && typeof raw.frozen === 'object' ? raw.frozen : {},
    score: finite(raw.score, 0),
    scoreMonths: finite(raw.scoreMonths, 0),
  }
}

/** The tunable parameters only (what a rollback restores). */
export const profileParams = (profile) => {
  const P = normalizeProfile(profile)
  return {
    intercept: P.intercept, slope: P.slope, time: { ...P.time }, disc: { ...P.disc }, counter: P.counter,
    counterShare: P.counterShare, sellerReplyHours: P.sellerReplyHours, discountPct: P.discountPct,
  }
}

export const timeGroupOf = (windowId) => (LEARNING_TIME_GROUPS.find((g) => g.windows.includes(windowId)) || LEARNING_TIME_GROUPS[2]).id

/** True when the profile changes at least one estimate (a default or empty profile is a no-op). */
export function profileIsActive(profile) {
  if (!profile) return false
  const off = (v, base = 0) => Math.abs(finite(v, base) - base) > 1e-9
  if (off(profile.intercept) || off(profile.slope, 1) || off(profile.counter) || off(profile.counterShare, 1)) return true
  if (profile.sellerReplyHours != null && Number.isFinite(Number(profile.sellerReplyHours))) return true
  return Object.values(profile.time || {}).some((v) => off(v)) || Object.values(profile.disc || {}).some((v) => off(v))
}

/**
 * The extra factor row for a first offer, or null when the profile is absent or changes nothing.
 * `logit` is the engine's logit before the correction (base + capped factors).
 */
export function learnedOfferRow(profile, { logit, windowId, discountPct }) {
  if (!profileIsActive(profile)) return null
  const time = finite(profile.time && profile.time[timeGroupOf(windowId)], 0)
  const disc = discOffset(profile, discountPct)
  const weight = (finite(profile.slope, 1) - 1) * (logit - LEARNING.SLOPE_CENTER) + finite(profile.intercept, 0) + time + disc
  if (Math.abs(weight) < 1e-9) return null
  return { id: 'learned', group: 'learned', label: 'Correzione dai tuoi esiti', weight, rawWeight: weight, learned: { time, disc, intercept: finite(profile.intercept, 0), slope: finite(profile.slope, 1) } }
}

/** The extra factor row for our counter (seller accepts our number), or null. `windowId` is null for the lookahead. */
export function learnedCounterRow(profile, { windowId }) {
  if (!profileIsActive(profile)) return null
  const time = windowId ? finite(profile.time && profile.time[timeGroupOf(windowId)], 0) : 0
  const weight = finite(profile.counter, 0) + time
  if (Math.abs(weight) < 1e-9) return null
  return { id: 'learned', group: 'learned', label: 'Correzione dai tuoi esiti', weight, rawWeight: weight, learned: { time, counter: finite(profile.counter, 0) } }
}

/** How much this user's sellers concede relative to the eBay mean (1 = as the engine assumes). */
export const counterShareOf = (profile) => (profile ? clampTo(finite(profile.counterShare, 1), LEARNING.BOUNDS.share) : 1)

/** Hours the seller takes to answer, learned or the engine default. */
export const sellerReplyHoursOf = (profile) => (profile && profile.sellerReplyHours != null && Number.isFinite(Number(profile.sellerReplyHours))
  ? clampTo(Number(profile.sellerReplyHours), LEARNING.BOUNDS.latency)
  : COUNTER.SELLER_REPLY_HOURS)

/** Default target discount for a listing read from a link: the learned one, else the engine default (−20%). */
export const defaultDiscountFor = (profile) => Math.round(clampTo(finite(profile && profile.discountPct, LEARNING.DEFAULT_DISCOUNT_PCT), LEARNING.BOUNDS.discountPct))
