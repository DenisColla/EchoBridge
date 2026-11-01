import { COUNTER, ENGINE_VERSION, LEARNING, LEARNING_DISCOUNT_KNOTS, LEARNING_TIME_GROUPS } from './constants.js'
import { squash } from './math.js'

/**
 * The learned profile: small corrections, fitted on the user's own outcomes, that the engine adds to its acceptance
 * logits, plus two counter-engine parameters. Without a profile (web app, tests, first offers) the engine is unchanged.
 *
 *   logit' = logit + (slope − 1)·(logit − c) + intercept + dslope·(d − 20)/10 + time[group] + disc(d)   (first offer)
 *   logit' = logit + counter + time[group of the send window]                                            (our counter)
 *   counterShare     how much this user's sellers concede in a counter, relative to eBay's 0,42 (stance reading)
 *   sellerReplyHours how long they take to answer (availability during the wait), null = engine default
 *
 * Version 3 (engine 1.4.0): `intercept` and `dslope` are re-fitted live on every outcome (learning.js liveProfile) and
 * stamped with the engine they were fitted against; the other families keep the monthly, gated path. A profile fitted
 * against another engine version drops its first-offer corrections when normalised, so a new prior is never summed
 * with a stale correction. disc(d) is piecewise linear through the knots at 10/20/30% and flat outside.
 */
const ZERO_TIME = Object.freeze(Object.fromEntries(LEARNING_TIME_GROUPS.map((g) => [g.id, 0])))
const ZERO_DISC = Object.freeze(Object.fromEntries(LEARNING_DISCOUNT_KNOTS.map((k) => [k.id, 0])))

/** Discount at which the live slope correction is zero (per 10 points away from it). */
export const DSLOPE_CENTER_PCT = 20

export const DEFAULT_PROFILE = Object.freeze({
  version: 3,
  id: 'default',
  parentId: null,
  /** Parameters of the profile this one replaced (monthly history). */
  parent: null,
  month: null,
  createdAt: null,
  /** Engine version the first-offer corrections were fitted against. */
  engine: ENGINE_VERSION,
  intercept: 0,
  /** Live correction per 10 points of discount away from 20%. */
  dslope: 0,
  slope: 1,
  time: ZERO_TIME,
  disc: ZERO_DISC,
  counter: 0,
  counterShare: 1,
  sellerReplyHours: null,
  discountPct: LEARNING.DEFAULT_DISCOUNT_PCT,
  /**
   * Learned shift of the policy table (policy.js), points, monthly and bounded (engine-spec §2.3): the deepest shift at
   * which this user's sellers still accept as often as the plain engine expects at the table's own ask.
   */
  discountShift: 0,
  /** Posterior covariance of the first-offer parameters (keys in `paramKeys`), for the predictive interval. */
  cov: null,
  paramKeys: null,
  changes: [],
  basedOn: 0,
  /** Prequential log Bayes factor against the parent, summed over the months this profile was active (monthly path). */
  score: 0,
  scoreMonths: 0,
  /** Parameter families that may not move until the given month (after a monthly rollback). */
  frozen: {},
  /** Live path: when the live values were last applied, which checkpoint they are judged against, freeze deadline. */
  appliedAt: null,
  checkpointId: null,
  frozenUntil: null,
  /** Why the live values are frozen: 'rollback' (they predicted worse than the checkpoint) or 'undo' (the user). */
  frozenReason: null,
  live: false,
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

/** Nearest knot (for report tables and the live slope's discount arms). */
export const discKnotOf = (discountPct) => {
  const d = finite(discountPct, 20)
  return d < 15 ? 'd10' : d < 25 ? 'd20' : 'd30'
}

export const discOffset = (profile, discountPct) => {
  const w = discKnotWeights(discountPct)
  return Object.keys(w).reduce((s, id) => s + w[id] * finite(profile && profile.disc && profile.disc[id], 0), 0)
}

/** The live slope term: dslope per 10 points of discount away from 20%. */
export const dslopeFeature = (discountPct) => (finite(discountPct, DSLOPE_CENTER_PCT) - DSLOPE_CENTER_PCT) / 10
export const dslopeOffset = (profile, discountPct) => finite(profile && profile.dslope, 0) * dslopeFeature(discountPct)

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

/** First-offer parameters a stale (other-engine) profile loses; counter parameters stay. */
const FIRST_OFFER_RESET = { intercept: 0, dslope: 0, slope: 1, time: ZERO_TIME, disc: ZERO_DISC, cov: null, paramKeys: null, basedOn: 0, appliedAt: null, frozenUntil: null, frozenReason: null, live: false }

/**
 * Fitted against another engine: a stamped `engine` that is not the running one, or a stored v2 profile (no stamp, the
 * 1.3.0 prior). A bare object with neither (hand-built corrections, tests) is taken as current.
 */
export const profileIsStale = (raw) => Boolean(raw) && typeof raw === 'object'
  && ((raw.engine != null && raw.engine !== ENGINE_VERSION) || (raw.engine == null && raw.version != null && Number(raw.version) < DEFAULT_PROFILE.version))

/**
 * A stored profile (any version, possibly partial or tampered with) → a complete, bounded profile. A profile fitted
 * against another engine (profileIsStale) keeps only its counter-side values: its first-offer corrections were fitted
 * against another prior and the live fit re-estimates them on the new one.
 */
export function normalizeProfile(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PROFILE }
  const stale = profileIsStale(raw)
  const src = stale ? { ...raw, ...FIRST_OFFER_RESET, engine: ENGINE_VERSION } : raw
  const B = LEARNING.BOUNDS
  const slope = clampTo(finite(src.slope, 1), B.slope)
  const disc = monotoneDisc(Object.fromEntries(LEARNING_DISCOUNT_KNOTS.map((k) => [k.id, clampTo(finite(src.disc && src.disc[k.id], 0), B.disc)])), slope)
  const hours = src.sellerReplyHours == null ? null : finite(src.sellerReplyHours, null)
  return {
    ...DEFAULT_PROFILE,
    ...src,
    version: DEFAULT_PROFILE.version,
    engine: ENGINE_VERSION,
    intercept: clampTo(finite(src.intercept, 0), B.intercept),
    dslope: clampTo(finite(src.dslope, 0), B.dslope),
    slope,
    time: Object.fromEntries(LEARNING_TIME_GROUPS.map((g) => [g.id, clampTo(finite(src.time && src.time[g.id], 0), B.time)])),
    disc,
    counter: clampTo(finite(src.counter, 0), B.counter),
    counterShare: clampTo(finite(src.counterShare, 1), B.share),
    sellerReplyHours: hours == null ? null : clampTo(hours, B.latency),
    discountPct: clampTo(finite(src.discountPct, LEARNING.DEFAULT_DISCOUNT_PCT), B.discountPct),
    discountShift: clampTo(finite(src.discountShift, 0), B.discountShift),
    changes: Array.isArray(src.changes) ? src.changes : [],
    frozen: src.frozen && typeof src.frozen === 'object' ? src.frozen : {},
    score: finite(src.score, 0),
    scoreMonths: finite(src.scoreMonths, 0),
    basedOn: finite(src.basedOn, 0),
    appliedAt: src.appliedAt || null,
    checkpointId: src.checkpointId || null,
    frozenUntil: src.frozenUntil || null,
    frozenReason: src.frozenReason || null,
    live: Boolean(src.live),
  }
}

/** The tunable parameters only (what a rollback restores). */
export const profileParams = (profile) => {
  const P = normalizeProfile(profile)
  return {
    intercept: P.intercept, dslope: P.dslope, slope: P.slope, time: { ...P.time }, disc: { ...P.disc }, counter: P.counter,
    counterShare: P.counterShare, sellerReplyHours: P.sellerReplyHours, discountPct: P.discountPct, discountShift: P.discountShift,
  }
}

export const timeGroupOf = (windowId) => (LEARNING_TIME_GROUPS.find((g) => g.windows.includes(windowId)) || LEARNING_TIME_GROUPS[2]).id

/** True when the profile changes at least one estimate (a default or empty profile is a no-op). */
export function profileIsActive(profile) {
  if (!profile) return false
  const off = (v, base = 0) => Math.abs(finite(v, base) - base) > 1e-9
  if (off(profile.intercept) || off(profile.dslope) || off(profile.slope, 1) || off(profile.counter) || off(profile.counterShare, 1) || off(profile.discountShift)) return true
  if (profile.sellerReplyHours != null && Number.isFinite(Number(profile.sellerReplyHours))) return true
  return Object.values(profile.time || {}).some((v) => off(v)) || Object.values(profile.disc || {}).some((v) => off(v))
}

/** True when the FIRST-OFFER correction changes something (counter-side values do not touch the first-offer estimate). */
export function firstOfferCorrected(profile) {
  if (!profile) return false
  const off = (v, base = 0) => Math.abs(finite(v, base) - base) > 1e-9
  return off(profile.intercept) || off(profile.dslope) || off(profile.slope, 1)
    || Object.values(profile.time || {}).some((v) => off(v)) || Object.values(profile.disc || {}).some((v) => off(v))
}

/**
 * The extra factor row for a first offer, or null when the profile is absent or changes nothing.
 * `logit` is the engine's logit before the correction (base + capped factors).
 */
export function learnedOfferRow(profile, { logit, windowId, discountPct }) {
  if (!profileIsActive(profile)) return null
  const time = finite(profile.time && profile.time[timeGroupOf(windowId)], 0)
  const disc = discOffset(profile, discountPct)
  const dslope = dslopeOffset(profile, discountPct)
  const weight = (finite(profile.slope, 1) - 1) * (logit - LEARNING.SLOPE_CENTER) + finite(profile.intercept, 0) + dslope + time + disc
  if (Math.abs(weight) < 1e-9) return null
  return { id: 'learned', group: 'learned', label: 'Correzione dai tuoi esiti', weight, rawWeight: weight, learned: { time, disc, dslope, intercept: finite(profile.intercept, 0), slope: finite(profile.slope, 1) } }
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

/* ───────── correction features and the predictive interval ───────── */

/**
 * Feature value of a first-offer correction parameter for a record-like object { rawLogit, discountPct, timeGroup,
 * discW }: 1 for the intercept, (d − 20)/10 for dslope, the engine logit minus its centre for the slope, group and knot
 * indicators for the offsets. Shared by the fit (learning.js) and the interval below.
 */
export const correctionFeature = (key, r) => {
  if (key === 'intercept') return 1
  if (key === 'dslope') return dslopeFeature(r.discountPct)
  if (key === 'slope') return r.rawLogit - LEARNING.SLOPE_CENTER
  const [kind, id] = String(key).split('.')
  if (kind === 'time') return r.timeGroup === id ? 1 : 0
  if (kind === 'disc') return ((r.discW || discKnotWeights(r.discountPct))[id]) || 0
  return 0
}

/** Default prior covariance of the live parameters [intercept, dslope] when nothing was learned yet. */
export const PRIOR_LIVE_KEYS = Object.freeze(['intercept', 'dslope'])
export const priorLiveCov = () => [[LEARNING.PRIOR_SD.intercept ** 2, 0], [0, LEARNING.PRIOR_SD.dslope ** 2]]

/** Posterior sd of the correction at this offer: √(xᵀΣx) over the profile's cov, or the prior when there is none. */
export function correctionSd(profile, r) {
  const P = profile && Array.isArray(profile.cov) && Array.isArray(profile.paramKeys) && profile.cov.length === profile.paramKeys.length ? profile : null
  const keys = P ? P.paramKeys : PRIOR_LIVE_KEYS
  const cov = P ? P.cov : priorLiveCov()
  const x = keys.map((key) => correctionFeature(key, r))
  let v = 0
  for (let i = 0; i < x.length; i++) {
    for (let j = 0; j < x.length; j++) v += x[i] * ((cov[i] && cov[i][j]) || 0) * x[j]
  }
  return Math.sqrt(Math.max(0, v))
}

/**
 * Honest interval of the headline probability (engine-spec §7): 80% band k · squash(z ± 1,28·sd), sd from the live
 * posterior covariance (or the prior N(0, 1,0²) × N(0, 0,35²) when the profile has none). `result` is an analysis
 * (its optimal slot carries z, k and the window); `n` = outcomes the band is based on (0 = not yet verified).
 * `level` is the two-sided coverage: 0,8 by default, 0,9 for the failure-risk band.
 */
export function predictiveInterval(result, profile = null, { level = 0.8 } = {}) {
  if (!result || !result.optimal || !result.optimal.score) return null
  const { optimal, input } = result
  const score = optimal.score
  const z = score.logit
  const k = optimal.pAvailable * optimal.pRead
  const r = { rawLogit: score.rawLogit ?? z, discountPct: input.discountPct, timeGroup: timeGroupOf(score.timeWindow.id), discW: discKnotWeights(input.discountPct) }
  const sd = correctionSd(profile, r)
  const zq = level >= 0.9 ? 1.645 : 1.28
  const low = Math.max(0.01, k * squash(z - zq * sd))
  const high = Math.min(0.99, k * squash(z + zq * sd))
  const n = profile && Array.isArray(profile.cov) ? finite(profile.basedOn, 0) : 0
  return { low: Math.min(low, result.probability ?? low), high: Math.max(high, result.probability ?? high), n, sd }
}
