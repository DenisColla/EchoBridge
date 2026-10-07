import { LEARNING, LEARNING_BANDS, LEARNING_TIME_GROUPS } from './constants.js'

/**
 * The learned profile: small corrections, fitted every month on the user's own outcomes, that the engine adds to its
 * acceptance logits. Without a profile (web app, tests, first month) the engine is unchanged.
 *
 *   logit' = slope × logit + intercept + time[group of the send window] + band[discount band]      (first offer)
 *   logit' = logit + counter + time[group of the send window]                                       (our counter)
 */
export const DEFAULT_PROFILE = Object.freeze({
  version: 1,
  id: 'default',
  month: null,
  createdAt: null,
  intercept: 0,
  slope: 1,
  time: Object.freeze(Object.fromEntries(LEARNING_TIME_GROUPS.map((g) => [g.id, 0]))),
  band: Object.freeze(Object.fromEntries(LEARNING_BANDS.map((b) => [b.id, 0]))),
  counter: 0,
  discountPct: LEARNING.DEFAULT_DISCOUNT_PCT,
  /** Posterior covariance of the first-offer parameters (keys of `profileParamKeys`), for failure-risk intervals. */
  cov: null,
  paramKeys: null,
  changes: [],
  basedOn: 0,
})

const finite = (v, fallback) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : fallback)
const clampTo = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v))

/** A stored profile (any version, possibly partial or tampered with) → a complete, bounded profile. */
export function normalizeProfile(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PROFILE }
  const B = LEARNING.BOUNDS
  return {
    ...DEFAULT_PROFILE,
    ...raw,
    intercept: clampTo(finite(raw.intercept, 0), B.intercept),
    slope: clampTo(finite(raw.slope, 1), B.slope),
    time: Object.fromEntries(LEARNING_TIME_GROUPS.map((g) => [g.id, clampTo(finite(raw.time && raw.time[g.id], 0), B.time)])),
    band: Object.fromEntries(LEARNING_BANDS.map((b) => [b.id, clampTo(finite(raw.band && raw.band[b.id], 0), B.band)])),
    counter: clampTo(finite(raw.counter, 0), B.counter),
    discountPct: clampTo(finite(raw.discountPct, LEARNING.DEFAULT_DISCOUNT_PCT), B.discountPct),
    changes: Array.isArray(raw.changes) ? raw.changes : [],
  }
}

export const timeGroupOf = (windowId) => (LEARNING_TIME_GROUPS.find((g) => g.windows.includes(windowId)) || LEARNING_TIME_GROUPS[2]).id

/** Same edges as riskBandFor (scoring.js), repeated here to keep this module free of engine imports. */
export const bandOf = (discountPct) => (discountPct < 15 ? 'low' : discountPct <= 30 ? 'medium' : 'high')

/** True when the profile changes at least one estimate (a default or empty profile is a no-op). */
export function profileIsActive(profile) {
  if (!profile) return false
  if (Math.abs(finite(profile.intercept, 0)) > 1e-9 || Math.abs(finite(profile.slope, 1) - 1) > 1e-9 || Math.abs(finite(profile.counter, 0)) > 1e-9) return true
  return Object.values(profile.time || {}).some((v) => Math.abs(finite(v, 0)) > 1e-9) || Object.values(profile.band || {}).some((v) => Math.abs(finite(v, 0)) > 1e-9)
}

/**
 * The extra factor row for a first offer, or null when the profile is absent or changes nothing.
 * `logit` is the engine's logit before the correction (base + capped factors).
 */
export function learnedOfferRow(profile, { logit, windowId, discountPct }) {
  if (!profileIsActive(profile)) return null
  const time = finite(profile.time && profile.time[timeGroupOf(windowId)], 0)
  const band = finite(profile.band && profile.band[bandOf(discountPct)], 0)
  const weight = (finite(profile.slope, 1) - 1) * logit + finite(profile.intercept, 0) + time + band
  if (Math.abs(weight) < 1e-9) return null
  return { id: 'learned', group: 'learned', label: 'Correzione dai tuoi esiti', weight, rawWeight: weight, learned: { time, band, intercept: finite(profile.intercept, 0), slope: finite(profile.slope, 1) } }
}

/** The extra factor row for our counter (seller accepts our number), or null. `windowId` is null for the lookahead. */
export function learnedCounterRow(profile, { windowId }) {
  if (!profileIsActive(profile)) return null
  const time = windowId ? finite(profile.time && profile.time[timeGroupOf(windowId)], 0) : 0
  const weight = finite(profile.counter, 0) + time
  if (Math.abs(weight) < 1e-9) return null
  return { id: 'learned', group: 'learned', label: 'Correzione dai tuoi esiti', weight, rawWeight: weight, learned: { time, counter: finite(profile.counter, 0) } }
}

/** Default target discount for a listing read from a link: the learned one, else the engine default (−20%). */
export const defaultDiscountFor = (profile) => Math.round(clampTo(finite(profile && profile.discountPct, LEARNING.DEFAULT_DISCOUNT_PCT), LEARNING.BOUNDS.discountPct))
