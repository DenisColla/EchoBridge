/**
 * Monthly learning loop. Pure functions over the saved offers (the app's "da comprare" list plus archived items):
 *
 *   dataset      every first offer and every counter with its outcome, re-scored by the current engine at the moment
 *                it was really sent (so the fit always measures the engine the user is running);
 *   fit          Bayesian logistic correction of the engine (MAP + Laplace) with priors centred on "no change",
 *                older months down-weighted by a half-life;
 *   profile      the correction actually applied next month: each value moves toward the fit only with enough data
 *                and by a bounded step, so a handful of offers a month never swings the engine;
 *   discount     the default starting discount that maximises the expected saving under the corrected engine;
 *   exploration  a deterministic, flagged ±1 h / ±2 points variation on about 1 offer in 5 (the data a fit needs);
 *   failure risk the probability that an offer fails even at the recommended moment and price, with reasons;
 *   report       the month's numbers and the workbook (.xlsx) the app exports.
 *
 * No Math.random, no clock reads: every function takes `now`. Same inputs → same output.
 */
import { ENGINE_VERSION, LEARNING, LEARNING_BANDS, LEARNING_TIME_GROUPS, VINTED } from './constants.js'
import { analyzeOffer, normalizeInput, priceStepFor, withPrices } from './analyze.js'
import { MONTHS_IT, WEEKDAYS_IT, calendarDaysBetween, minutesOfDay, pad2 } from './dates.js'
import { clamp, formatSignedPoints, hashString, squash } from './math.js'
import { formatEuro } from './messages.js'
import { DEFAULT_PROFILE, bandOf, normalizeProfile, timeGroupOf } from './profile.js'
import { availabilityAfter, readProbability } from './scheduler.js'
import { scoreAt, timeWindowAt } from './scoring.js'
import { buildXlsx } from './xlsx.js'

const DAY_MS = 86_400_000
const MONTH_DAYS = 30.44

const lrnDate = (v) => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isFinite(d.getTime()) ? d : null
}
const lrnIso = (v) => {
  const d = lrnDate(v)
  return d ? d.toISOString() : null
}
const lrnR2 = (x) => Math.round(x * 100) / 100
const lrnR4 = (x) => Math.round(x * 10000) / 10000
const lrnSigma = (z) => 1 / (1 + Math.exp(-z))
/** Inverse of squash(): logit whose squashed value is p (engine probabilities live in [0,03, 0,97]). */
export const unsquash = (p) => {
  const q = clamp((p - 0.03) / 0.94, 1e-6, 1 - 1e-6)
  return Math.log(q / (1 - q))
}
const lrnClip = (p) => clamp(p, 1e-6, 1 - 1e-6)
const lrnMean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)
const lrnMedian = (xs) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/* ───────── months ───────── */

export const monthKeyOf = (date) => {
  const d = lrnDate(date)
  return d ? `${d.getFullYear()}-${pad2(d.getMonth() + 1)}` : null
}
const lrnMonthParts = (key) => {
  const [y, m] = String(key).split('-').map(Number)
  return { y, m }
}
export const monthStartOf = (key) => {
  const { y, m } = lrnMonthParts(key)
  return new Date(y, m - 1, 1)
}
export const shiftMonth = (key, delta) => {
  const { y, m } = lrnMonthParts(key)
  return monthKeyOf(new Date(y, m - 1 + delta, 1))
}
export const monthLabel = (key) => {
  const { y, m } = lrnMonthParts(key)
  return `${MONTHS_IT[m - 1]} ${y}`
}

/**
 * Closed months still to report, oldest first (at most `max`, the most recent ones).
 * The first run only initialises: there is nothing to compare yet, the first report comes at the end of this month.
 */
export function dueMonths(lastProcessed, now, max = LEARNING.MAX_CATCH_UP_MONTHS) {
  const previous = shiftMonth(monthKeyOf(now), -1)
  if (!lastProcessed) return []
  const out = []
  for (let k = shiftMonth(lastProcessed, 1); k <= previous; k = shiftMonth(k, 1)) out.push(k)
  return out.slice(-max)
}

/* ───────── decision snapshot (stored with the item when it is saved) ───────── */

/** What the engine recommended and why, frozen at save time: the report compares it with what really happened. */
export function decisionSnapshot(result, { now, profile = null, exploration = null } = {}) {
  if (!result || !result.optimal) return null
  const { input, optimal } = result
  const score = optimal.score
  return {
    engine: ENGINE_VERSION,
    at: lrnIso(now),
    profileId: profile && profile.id ? profile.id : 'default',
    price: input.targetPrice,
    listPrice: input.listPrice,
    discountPct: input.discountPct,
    band: bandOf(input.discountPct),
    recommendedAt: lrnIso(optimal.date),
    slotKind: optimal.kind,
    daysWaited: optimal.daysWaited,
    windowId: score.timeWindow.id,
    timeGroup: timeGroupOf(score.timeWindow.id),
    monthWindowId: score.monthWindow.id,
    rawLogit: score.rawLogit ?? score.logit,
    learnedWeight: score.learnedWeight || 0,
    k: optimal.pAvailable * optimal.pRead,
    probability: result.probability,
    blockRisk: result.blockRisk ? result.blockRisk.level : null,
    exploration: exploration || null,
  }
}

/* ───────── dataset ───────── */

const FIRST_SUCCESS = new Set(['accepted', 'bought'])
const FIRST_FAIL = new Set(['declined', 'no_reply', 'sold_other', 'countered'])
const FINAL_LOST = new Set(['declined', 'no_reply', 'sold_other', 'abandoned'])

/** Re-scores the first offer with the CURRENT engine (no profile) at the moment it was sent. */
function lrnRescore(item, sentAt) {
  const form = item.form
  if (!form) return null
  const raw = { ...form, targetPrice: item.targetPrice != null ? String(item.targetPrice).replace('.', ',') : form.targetPrice }
  const norm = normalizeInput(raw)
  if (!norm.ok || norm.input.discountPct <= 0) return null
  const input = norm.input
  const created = lrnDate(item.createdAt) || sentAt
  const daysWaited = Math.max(0, calendarDaysBetween(created, sentAt))
  const score = scoreAt(input, sentAt, daysWaited)
  return { input, daysWaited, rawLogit: score.logit, k: availabilityAfter(input, daysWaited) * readProbability(input), windowId: score.timeWindow.id }
}

const lastActivity = (item) => {
  const times = [item.outcomeAt, item.sentAt, ...(item.negotiation || []).map((e) => e.at)].map(lrnDate).filter(Boolean)
  return times.length ? new Date(Math.max(...times.map((d) => d.getTime()))) : null
}

/** The counter rounds of a negotiation: each seller counter, our reply to it and what happened to our reply. */
function lrnRounds(item, final, now) {
  const h = Array.isArray(item.negotiation) ? item.negotiation : []
  const rounds = []
  for (let i = 1; i < h.length; i++) {
    const e = h[i]
    if (e.by !== 'seller' || h[i - 1].by !== 'buyer') continue
    const B = Number(h[i - 1].price)
    // A seller who RAISED his price is stored at his previous (effective) price; the raw number is what he asked.
    const S = Number(e.rawPrice != null ? e.rawPrice : e.price)
    const prevSeller = h.slice(0, i).filter((x) => x.by === 'seller').pop()
    const Sprev = prevSeller ? Number(prevSeller.price) : Number(item.listPrice)
    const sentB = lrnDate(h[i - 1].at)
    const gotS = lrnDate(e.at)
    const reply = h[i + 1] && h[i + 1].by === 'buyer' ? h[i + 1] : null
    let replyAccepted = null
    let replyImplicit = false
    if (reply) {
      const replyPrice = Number(reply.price)
      if (h[i + 2]) replyAccepted = false
      else if (final.closed) replyAccepted = Math.abs(Number(item.finalPrice) - replyPrice) < 0.011
      else if (final.lost) replyAccepted = false
      else {
        const at = lrnDate(reply.at)
        if (at && now.getTime() - at.getTime() > LEARNING.COUNTER_NO_REPLY_AFTER_DAYS * DAY_MS) {
          replyAccepted = false
          replyImplicit = true
        }
      }
    }
    const replyAt = reply ? lrnDate(reply.at) : null
    const pRead = reply && Number.isFinite(Number(reply.pRead)) && Number(reply.pRead) > 0 ? Number(reply.pRead) : 1
    const replyRawLogit = !reply ? null
      : Number.isFinite(Number(reply.rawLogit)) ? Number(reply.rawLogit)
        : Number.isFinite(Number(reply.pAccept)) ? unsquash(Number(reply.pAccept) / pRead) - (Number(reply.learnedWeight) || 0) : null
    const replyWindow = reply ? (reply.windowId || (replyAt ? timeWindowAt(replyAt).id : null)) : null
    rounds.push({
      index: rounds.length + 1,
      buyerPrice: B,
      sellerPrice: S,
      sellerPrevious: Sprev,
      sellerRaisePct: B > 0 ? (S / B - 1) * 100 : null,
      sellerGapShare: Sprev - B > 0.009 ? clamp((Sprev - S) / (Sprev - B), -1, 1) : null,
      latencyH: sentB && gotS ? Math.max(0, (gotS.getTime() - sentB.getTime()) / 3_600_000) : null,
      receivedAt: lrnIso(gotS),
      replyPrice: reply ? Number(reply.price) : null,
      replyAt: lrnIso(replyAt),
      replyRaisePct: reply && B > 0 ? (Number(reply.price) / B - 1) * 100 : null,
      replyGapShare: reply && S - B > 0.009 ? (Number(reply.price) - B) / (S - B) : null,
      replyIsSplit: reply ? Boolean(reply.isSplit) : null,
      replyIsFinal: reply ? Boolean(reply.isFinal) : null,
      replyPAccept: reply && Number.isFinite(Number(reply.pAccept)) ? Number(reply.pAccept) : null,
      replyRawLogit,
      replyPRead: pRead,
      replyWindowId: replyWindow,
      replyTimeGroup: replyWindow ? timeGroupOf(replyWindow) : null,
      replyAccepted,
      replyImplicit,
    })
  }
  return rounds
}

/** One saved item → one learning record (first offer, rounds, final state), or null for items never sent. */
export function learningRecord(item, now) {
  if (!item || typeof item !== 'object') return null
  const status = item.status || 'planned'
  const history = Array.isArray(item.negotiation) ? item.negotiation : []
  // When the first offer's send time is unknown (an item created from the counter screen), the record still counts
  // for the negotiation numbers, dated at the seller's first counter, but stays out of the first-offer calibration.
  const knownSentAt = lrnDate(item.sentAt) || (status !== 'planned' && history[0] && !history[0].planned ? lrnDate(history[0].at) : null)
  const firstSeller = history.find((e) => e.by === 'seller')
  const sentAt = knownSentAt || (status !== 'planned' ? lrnDate(firstSeller && firstSeller.at) || lrnDate(item.outcomeAt) || lrnDate(item.createdAt) : null)
  if (!sentAt) return null
  const sentKnown = Boolean(knownSentAt)
  const decision = item.decision || null
  const listPrice = Number(item.listPrice)
  const price = Number(item.targetPrice)
  const discountPct = Number.isFinite(Number(item.discountPct)) ? Number(item.discountPct) : listPrice > 0 ? ((listPrice - price) / listPrice) * 100 : 0
  const quiet = now.getTime() - (lastActivity(item) || sentAt).getTime() > LEARNING.NO_REPLY_AFTER_DAYS * DAY_MS
  const hasSeller = history.some((e) => e.by === 'seller')

  let first = item.firstOutcome || null
  if (!first && (FIRST_SUCCESS.has(status) || FIRST_FAIL.has(status))) first = status
  if (!first && hasSeller) first = 'countered'
  let implicit = false
  if (!first && status === 'sent' && quiet) {
    first = 'no_reply'
    implicit = true
  }
  const y = first == null || first === 'abandoned' || !sentKnown ? null : FIRST_SUCCESS.has(first) ? 1 : 0

  const closed = item.finalPrice != null && Number.isFinite(Number(item.finalPrice)) && FIRST_SUCCESS.has(status)
  let lost = FINAL_LOST.has(status)
  let lostImplicit = false
  if (!closed && !lost && (status === 'sent' || status === 'countered') && quiet) {
    lost = true
    lostImplicit = true
  }
  const final = { closed, lost }
  const finalPrice = closed ? Number(item.finalPrice) : null
  const rescored = sentKnown ? lrnRescore(item, sentAt) : null
  const rawLogit = rescored ? rescored.rawLogit
    : decision && Number.isFinite(decision.rawLogit) ? decision.rawLogit
      : Number.isFinite(Number(item.probability)) ? unsquash(Number(item.probability)) : null
  const k = rescored ? rescored.k : decision && Number.isFinite(decision.k) ? decision.k : 1
  const windowId = rescored ? rescored.windowId : timeWindowAt(sentAt).id
  const recommendedAt = decision ? lrnDate(decision.recommendedAt) : null
  const delayMinutes = recommendedAt && sentKnown && item.sentAtSource !== 'imputed' ? Math.round((sentAt.getTime() - recommendedAt.getTime()) / 60000) : null
  const firstOutcomeAt = lrnDate(item.firstOutcomeAt) || (hasSeller ? lrnDate((history.find((e) => e.by === 'seller') || {}).at) : null) || (first && !implicit ? lrnDate(item.outcomeAt) : null)
  const rounds = lrnRounds(item, final, now)

  return {
    id: item.id,
    title: item.title || '',
    link: item.link || '',
    category: item.category || (item.form && item.form.category) || '',
    sellerProfile: item.form ? item.form.sellerProfile || 'unknown' : 'unknown',
    listingAge: item.form ? item.form.listingAge || 'unknown' : 'unknown',
    listPrice,
    price,
    discountPct,
    band: bandOf(discountPct),
    sentAt,
    sentKnown,
    sentAtSource: item.sentAtSource || (sentKnown ? 'tap' : 'unknown'),
    month: monthKeyOf(sentAt),
    weekday: sentAt.getDay(),
    minuteOfDay: minutesOfDay(sentAt),
    windowId,
    timeGroup: timeGroupOf(windowId),
    recommendedAt,
    delayMinutes,
    onTime: delayMinutes == null ? null : Math.abs(delayMinutes) <= 60,
    rawLogit,
    k,
    input: rescored ? rescored.input : null,
    daysWaited: rescored ? rescored.daysWaited : 0,
    pShown: Number.isFinite(Number(item.probability)) ? Number(item.probability) : decision ? decision.probability : null,
    first,
    implicit,
    y,
    latencyFirstH: firstOutcomeAt ? Math.max(0, (firstOutcomeAt.getTime() - sentAt.getTime()) / 3_600_000) : null,
    status,
    closed,
    lost,
    lostImplicit,
    pending: !closed && !lost,
    finalPrice,
    savingEur: closed ? lrnR2(listPrice - finalPrice) : null,
    savingShare: closed && listPrice > 0 ? (listPrice - finalPrice) / listPrice : null,
    rounds,
    exploration: decision && decision.exploration ? decision.exploration : null,
    profileId: decision ? decision.profileId : 'default',
    deletedAt: item.deletedAt || null,
  }
}

/** All records, newest first. `items` may include archived (deleted) items: they keep their history. */
export function buildDataset(items, now) {
  const seen = new Set()
  const records = []
  for (const item of items || []) {
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    const r = learningRecord(item, now)
    if (r) records.push(r)
  }
  return records.sort((a, b) => b.sentAt - a.sentAt)
}

/** Half-life weight of an observation `date` seen from `now`. */
export const recencyWeight = (date, now) => Math.pow(0.5, Math.max(0, (now.getTime() - date.getTime()) / DAY_MS / MONTH_DAYS) / LEARNING.HALF_LIFE_MONTHS)

/* ───────── linear algebra for tiny systems ───────── */

/** Solves A x = b (A small and positive definite) by Gaussian elimination with partial pivoting. */
function lrnSolve(A, b) {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-12) return null
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  const x = new Array(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n]
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]
    x[r] = s / M[r][r]
  }
  return x
}

const lrnInverse = (A) => {
  const n = A.length
  const cols = []
  for (let j = 0; j < n; j++) {
    const e = new Array(n).fill(0)
    e[j] = 1
    const x = lrnSolve(A, e)
    if (!x) return null
    cols.push(x)
  }
  return A.map((_, i) => cols.map((c) => c[i]))
}

/* ───────── the fit ───────── */

/** Feature value of record `r` for parameter `key` (slope multiplies the engine's own logit). */
const lrnFeature = (key, r) => {
  if (key === 'intercept') return 1
  if (key === 'slope') return r.rawLogit
  const [kind, id] = key.split('.')
  if (kind === 'time') return r.timeGroup === id ? 1 : 0
  if (kind === 'band') return r.band === id ? 1 : 0
  return 0
}
const lrnPriorSd = (key) => LEARNING.PRIOR_SD[key.split('.')[0]] || 0.35

/**
 * MAP fit of  p = k · squash(rawLogit + Σ θ_j x_j)  with independent normal priors θ_j ~ N(0, sd_j²), by Fisher scoring.
 * Returns { theta: {key: value}, cov, keys, iterations } (cov = inverse Fisher information at the optimum).
 */
export function fitCorrection(records, keys, weights) {
  const m = keys.length
  const theta = new Array(m).fill(0)
  const precision = keys.map((key) => 1 / lrnPriorSd(key) ** 2)
  let H = null
  let iterations = 0
  for (; iterations < 60; iterations++) {
    const g = theta.map((t, j) => -precision[j] * t)
    H = keys.map((_, i) => keys.map((__, j) => (i === j ? precision[i] : 0)))
    records.forEach((r, idx) => {
      const w = weights[idx]
      if (!(w > 0)) return
      const x = keys.map((key) => lrnFeature(key, r))
      const z = r.rawLogit + x.reduce((s, v, j) => s + v * theta[j], 0)
      const s = lrnSigma(z)
      const p = lrnClip(r.k * (0.03 + 0.94 * s))
      const dp = r.k * 0.94 * s * (1 - s)
      const info = (dp * dp) / (p * (1 - p))
      const resid = ((r.y - p) / (p * (1 - p))) * dp
      for (let i = 0; i < m; i++) {
        if (x[i] === 0) continue
        g[i] += w * resid * x[i]
        for (let j = 0; j < m; j++) if (x[j] !== 0) H[i][j] += w * info * x[i] * x[j]
      }
    })
    const delta = lrnSolve(H, g)
    if (!delta) break
    const biggest = Math.max(...delta.map(Math.abs))
    const scale = biggest > 1 ? 1 / biggest : 1 // damped steps: separable data must not explode
    for (let j = 0; j < m; j++) theta[j] += scale * delta[j]
    if (biggest < 1e-8) break
  }
  const cov = H ? lrnInverse(H) : null
  return { theta: Object.fromEntries(keys.map((k, j) => [k, theta[j]])), cov, keys, iterations }
}

/** Predicted probability of record `r` under a profile (or the raw engine with profile = null). */
export function predictWith(profile, r) {
  if (!profile) return lrnClip(r.k * squash(r.rawLogit))
  const P = normalizeProfile(profile)
  const z = P.slope * r.rawLogit + P.intercept + (P.time[r.timeGroup] || 0) + (P.band[r.band] || 0)
  return lrnClip(r.k * squash(z))
}

export const logLoss = (pairs) => (pairs.length ? -pairs.reduce((s, [p, y]) => s + (y ? Math.log(lrnClip(p)) : Math.log(1 - lrnClip(p))), 0) / pairs.length : null)
export const brierScore = (pairs) => (pairs.length ? pairs.reduce((s, [p, y]) => s + (p - y) ** 2, 0) / pairs.length : null)

/** Reliability table: predicted vs observed per probability bin. */
export function reliabilityTable(pairs) {
  const edges = LEARNING.RELIABILITY_BINS
  const bins = []
  for (let i = 0; i < edges.length - 1; i++) {
    const inBin = pairs.filter(([p]) => p >= edges[i] && p < edges[i + 1])
    bins.push({
      from: edges[i],
      to: Math.min(1, edges[i + 1]),
      n: inBin.length,
      predicted: inBin.length ? lrnMean(inBin.map(([p]) => p)) : null,
      observed: inBin.length ? inBin.filter(([, y]) => y).length / inBin.length : null,
    })
  }
  const n = pairs.length
  const ece = n ? bins.reduce((s, b) => s + (b.n ? (b.n / n) * Math.abs(b.predicted - b.observed) : 0), 0) : null
  return { bins, ece }
}

/**
 * Fits the first-offer correction on every decided first offer (weighted by recency), in two stages:
 *   1. intercept (and slope, only with enough data): the general shift between the engine and this user's sellers;
 *   2. time-group and discount-band offsets on what stage 1 leaves unexplained, centred (weighted by data) so that
 *      they only express differences BETWEEN groups.
 * Fitting them jointly would let a general shift leak into the groups that happen to hold the data (most offers go
 * out in the best evenings), making untried windows look better and moving the schedule for no reason.
 * The covariance is block-diagonal (stage 1, stage 2): enough for the failure-risk interval.
 */
export function fitFirstOffers(records, now) {
  const decided = records.filter((r) => r.y != null && Number.isFinite(r.rawLogit))
  const weights = decided.map((r) => recencyWeight(r.sentAt, now))
  const total = weights.reduce((s, w) => s + w, 0)
  const keys1 = ['intercept']
  if (total >= LEARNING.MIN_EFFECTIVE.slope) keys1.push('slope')
  const keys2 = [...LEARNING_TIME_GROUPS.map((g) => `time.${g.id}`), ...LEARNING_BANDS.map((b) => `band.${b.id}`)]
  const keys = [...keys1, ...keys2]
  const nEff = Object.fromEntries(keys.map((key) => [key, decided.reduce((s, r, i) => s + weights[i] * (key === 'intercept' || key === 'slope' ? 1 : lrnFeature(key, r)), 0)]))
  if (!decided.length) return { theta: Object.fromEntries(keys.map((k) => [k, 0])), cov: null, keys, iterations: 0, nEff, n: 0, weightTotal: 0, decided, weights }
  const s1 = fitCorrection(decided, keys1, weights)
  const shifted = decided.map((r) => ({ ...r, rawLogit: r.rawLogit * (1 + (s1.theta.slope || 0)) + s1.theta.intercept }))
  const s2 = fitCorrection(shifted, keys2, weights)
  // Sum-to-zero (weighted by data) within time groups and within bands: only contrasts between groups survive.
  for (const prefix of ['time.', 'band.']) {
    const ks = keys2.filter((k) => k.startsWith(prefix) && nEff[k] > 0)
    const wsum = ks.reduce((acc, k) => acc + nEff[k], 0)
    if (!wsum) continue
    const mean = ks.reduce((acc, k) => acc + nEff[k] * s2.theta[k], 0) / wsum
    for (const k of ks) s2.theta[k] -= mean
  }
  const m = keys.length
  const cov = s1.cov && s2.cov ? keys.map((_, i) => keys.map((__, j) => {
    if (i < keys1.length && j < keys1.length) return s1.cov[i][j]
    if (i >= keys1.length && j >= keys1.length) return s2.cov[i - keys1.length][j - keys1.length]
    return 0
  })) : null
  return { theta: { ...s1.theta, ...s2.theta }, cov: cov && cov.length === m ? cov : null, keys, iterations: s1.iterations + s2.iterations, nEff, n: decided.length, weightTotal: total, decided, weights }
}

/** One-parameter fit of the counter correction (time-group offsets taken from the first-offer profile). */
export function fitCounters(records, now, timeOffsets = {}) {
  const rows = []
  for (const r of records) {
    for (const round of r.rounds) {
      if (round.replyAccepted == null || !Number.isFinite(round.replyRawLogit)) continue
      const at = lrnDate(round.replyAt) || r.sentAt
      rows.push({ y: round.replyAccepted ? 1 : 0, z: round.replyRawLogit + (timeOffsets[round.replyTimeGroup] || 0), k: round.replyPRead, w: recencyWeight(at, now) })
    }
  }
  const sd = LEARNING.PRIOR_SD.counter
  let c = 0
  let info = 1 / sd ** 2
  for (let it = 0; it < 60 && rows.length; it++) {
    let g = -c / sd ** 2
    info = 1 / sd ** 2
    for (const row of rows) {
      const s = lrnSigma(row.z + c)
      const p = lrnClip(row.k * (0.03 + 0.94 * s))
      const dp = row.k * 0.94 * s * (1 - s)
      g += row.w * ((row.y - p) / (p * (1 - p))) * dp
      info += row.w * (dp * dp) / (p * (1 - p))
    }
    const step = clamp(g / info, -1, 1)
    c += step
    if (Math.abs(step) < 1e-8) break
  }
  return { theta: c, sd: Math.sqrt(1 / info), n: rows.length, nEff: rows.reduce((s, r) => s + r.w, 0) }
}

/**
 * The default starting discount that maximises the expected saving share (of list price), averaged over the user's
 * own items, under the corrected engine:
 *   ES(d) = p(d)·d + (1 − p(d))·[q(d)·ρ·d − (1 − q(d))·LOSS]
 * p(d) = corrected acceptance at discount d (same item, same moment); q = share of failed first offers that still
 * closed; ρ = their saving relative to the first discount; both smoothed with priors (LEARNING).
 */
export function optimalDiscount(records, profile, now, { priorsOnly = false } = {}) {
  const P = normalizeProfile(profile)
  const usable = records.filter((r) => r.y != null && r.input && r.listPrice > 0)
  const weights = usable.map((r) => recencyWeight(r.sentAt, now))
  const nEff = weights.reduce((s, w) => s + w, 0)
  const W0 = LEARNING.CONTINUATION_PRIOR_WEIGHT
  const fails = priorsOnly ? [] : records.filter((r) => r.y === 0 && (r.closed || r.lost))
  const fw = fails.map((r) => recencyWeight(r.sentAt, now))
  const q = (fails.reduce((s, r, i) => s + fw[i] * (r.closed ? 1 : 0), 0) + LEARNING.CLOSE_AFTER_FAIL_PRIOR * W0) / (fw.reduce((s, w) => s + w, 0) + W0)
  const later = fails.map((r, i) => ({ r, w: fw[i] })).filter(({ r }) => r.closed && r.discountPct > 0)
  const rho = (later.reduce((s, { r, w }) => s + w * clamp(r.savingShare / (r.discountPct / 100), 0, 1.2), 0) + LEARNING.CONTINUATION_RATIO_PRIOR * W0) / (later.reduce((s, { w }) => s + w, 0) + W0)
  const [rampFrom, rampTo] = LEARNING.AGGRESSIVE_RAMP_PCT
  const [lo, hi] = LEARNING.BOUNDS.discountPct
  const curve = []
  for (let d = lo; d <= hi; d++) {
    const qd = q * (1 - 0.5 * clamp((d - rampFrom) / (rampTo - rampFrom), 0, 1))
    const share = d / 100
    let es = 0
    let pSum = 0
    usable.forEach((r, i) => {
      const price = Math.round(r.listPrice * (1 - share) * 100) / 100
      const input = withPrices(r.input, r.listPrice, price)
      const z0 = scoreAt(input, r.sentAt, r.daysWaited).logit
      const z = P.slope * z0 + P.intercept + (P.time[r.timeGroup] || 0) + (P.band[bandOf(d)] || 0)
      const p = r.k * squash(z)
      es += weights[i] * (p * share + (1 - p) * (qd * rho * share - (1 - qd) * LEARNING.LOSS_COST_SHARE))
      pSum += weights[i] * p
    })
    curve.push({ discountPct: d, expectedSavingShare: nEff ? es / nEff : null, pAccept: nEff ? pSum / nEff : null })
  }
  const best = nEff ? curve.reduce((a, b) => (b.expectedSavingShare > a.expectedSavingShare + 1e-9 ? b : a)) : null
  return { target: best ? best.discountPct : null, curve, closeAfterFail: q, continuationRatio: rho, nEff, n: usable.length }
}

/* ───────── from fit to next month's profile (guardrails) ───────── */

const PARAM_LABELS = {
  intercept: 'Correzione generale della probabilità',
  slope: 'Fiducia nelle differenze tra offerte',
  counter: 'Correzione delle tue controproposte',
  discountPct: 'Sconto di partenza suggerito',
}
const paramLabel = (key) => {
  if (PARAM_LABELS[key]) return PARAM_LABELS[key]
  const [kind, id] = key.split('.')
  if (kind === 'time') return `Fascia: ${(LEARNING_TIME_GROUPS.find((g) => g.id === id) || { label: id }).label}`
  if (kind === 'band') return `${(LEARNING_BANDS.find((b) => b.id === id) || { label: id }).label}`
  return key
}
const getParam = (P, key) => {
  if (key === 'intercept' || key === 'slope' || key === 'counter' || key === 'discountPct') return P[key]
  const [kind, id] = key.split('.')
  return P[kind][id]
}
const setParam = (P, key, value) => {
  if (key === 'intercept' || key === 'slope' || key === 'counter' || key === 'discountPct') P[key] = value
  else {
    const [kind, id] = key.split('.')
    P[kind] = { ...P[kind], [id]: value }
  }
}

/**
 * Next month's profile. Each parameter moves from its current value toward the fit's target only when it has enough
 * weighted outcomes, when the gap exceeds half a posterior sd, by at most MAX_STEP, inside BOUNDS; tiny moves are
 * skipped. If the active profile predicted last month worse than the plain engine, every learned value is first
 * halved (cautious rollback).
 * Returns { profile, changes: [{ key, label, from, to, target, nEff, minEffective, status, reason }], rollback }.
 */
export function proposeProfile({ previous, firstFit, counterFit, records = [], month, now, lastMonthRecords = [] }) {
  const prev = normalizeProfile(previous)
  const next = normalizeProfile({ ...prev, time: { ...prev.time }, band: { ...prev.band } })
  // Rollback check on last month's decided first offers.
  const pairsActive = lastMonthRecords.filter((r) => r.y != null && Number.isFinite(r.rawLogit)).map((r) => [predictWith(prev, r), r.y])
  const pairsDefault = lastMonthRecords.filter((r) => r.y != null && Number.isFinite(r.rawLogit)).map((r) => [predictWith(null, r), r.y])
  const llActive = logLoss(pairsActive)
  const llDefault = logLoss(pairsDefault)
  const rollback = pairsActive.length >= 6 && llActive != null && llDefault != null && llActive > llDefault + 0.05
  if (rollback) {
    next.intercept /= 2
    next.slope = 1 + (next.slope - 1) / 2
    next.counter /= 2
    for (const g of Object.keys(next.time)) next.time[g] /= 2
    for (const b of Object.keys(next.band)) next.band[b] /= 2
  }

  const changes = []
  const sdOf = (key) => {
    const i = firstFit.keys.indexOf(key)
    return i >= 0 && firstFit.cov && firstFit.cov[i] ? Math.sqrt(Math.max(0, firstFit.cov[i][i])) : null
  }
  const consider = (key, target, nEff, kind, sd = null) => {
    const from = getParam(next, key)
    const minEffective = LEARNING.MIN_EFFECTIVE[kind]
    const maxStep = kind === 'discount' ? LEARNING.MAX_STEP.discountPct : LEARNING.MAX_STEP[kind]
    const bounds = kind === 'discount' ? LEARNING.BOUNDS.discountPct : LEARNING.BOUNDS[kind]
    const minChange = kind === 'discount' ? LEARNING.MIN_CHANGE_DISCOUNT_PCT : LEARNING.MIN_CHANGE
    const base = { key, label: paramLabel(key), from: lrnR4(from), target: target == null ? null : lrnR4(target), nEff: lrnR2(nEff || 0), minEffective }
    if ((nEff || 0) < minEffective) {
      return changes.push({ ...base, to: lrnR4(from), status: 'waiting_data', reason: `Servono almeno ${minEffective} esiti pesati (ne hai ${String(lrnR2(nEff || 0)).replace('.', ',')}).` })
    }
    if (target == null || !Number.isFinite(target)) return changes.push({ ...base, to: lrnR4(from), status: 'waiting_data', reason: 'Nessun esito utile.' })
    const wanted = clamp(target, bounds[0], bounds[1])
    // Evidence gate: no move while the current value sits within half a posterior sd of the target (noise).
    if (sd != null && Math.abs(wanted - from) < 0.5 * sd) {
      return changes.push({ ...base, to: lrnR4(from), status: 'unchanged', reason: 'Differenza dentro il margine di incertezza: resta com\'è.' })
    }
    const step = clamp(wanted - from, -maxStep, maxStep)
    const to = kind === 'discount' ? Math.round((from + step) * 2) / 2 : lrnR4(from + step)
    if (Math.abs(to - from) < minChange) return changes.push({ ...base, to: lrnR4(from), status: 'unchanged', reason: 'Già allineato ai tuoi esiti.' })
    setParam(next, key, to)
    return changes.push({ ...base, to, status: Math.abs(wanted - from) > maxStep + 1e-9 ? 'capped' : 'applied', reason: Math.abs(wanted - from) > maxStep + 1e-9 ? `Spostato del massimo consentito in un mese; il resto il mese prossimo se i dati lo confermano.` : 'Allineato ai tuoi esiti.' })
  }

  consider('intercept', firstFit.theta.intercept, firstFit.nEff.intercept, 'intercept', sdOf('intercept'))
  consider('slope', firstFit.keys.includes('slope') ? 1 + firstFit.theta.slope : null, firstFit.nEff.slope ?? firstFit.weightTotal, 'slope', sdOf('slope'))
  for (const g of LEARNING_TIME_GROUPS) consider(`time.${g.id}`, firstFit.theta[`time.${g.id}`], firstFit.nEff[`time.${g.id}`], 'time', sdOf(`time.${g.id}`))
  for (const b of LEARNING_BANDS) consider(`band.${b.id}`, firstFit.theta[`band.${b.id}`], firstFit.nEff[`band.${b.id}`], 'band', sdOf(`band.${b.id}`))
  consider('counter', counterFit ? counterFit.theta : null, counterFit ? counterFit.nEff : 0, 'counter', counterFit ? counterFit.sd : null)
  // Starting discount, with next month's corrections in place. Only what the data change moves it: the optimum under
  // the corrected engine and the observed continuation, minus the optimum under the plain engine and the priors
  // (the engine's own curve already produced the default; it must not drift by construction).
  const withData = optimalDiscount(records, next, now)
  const priorsOnly = optimalDiscount(records, DEFAULT_PROFILE, now, { priorsOnly: true })
  const discountTarget = withData.target != null && priorsOnly.target != null ? LEARNING.DEFAULT_DISCOUNT_PCT + (withData.target - priorsOnly.target) : null
  consider('discountPct', discountTarget, withData.nEff, 'discount')
  const discountFit = { ...withData, priorsOnlyTarget: priorsOnly.target, learnedTarget: discountTarget }

  const moved = changes.filter((c) => c.status === 'applied' || c.status === 'capped')
  next.version = DEFAULT_PROFILE.version
  next.id = moved.length || rollback ? `${month}` : prev.id
  next.month = moved.length || rollback ? month : prev.month
  next.createdAt = moved.length || rollback ? lrnIso(now) : prev.createdAt
  next.changes = moved
  next.basedOn = firstFit.n
  next.paramKeys = firstFit.keys
  next.cov = firstFit.cov ? firstFit.cov.map((row) => row.map(lrnR4)) : null
  return { profile: next, changes, rollback, logLossActive: llActive, logLossDefault: llDefault, discountFit }
}

/* ───────── exploration (flagged variations that make the fit possible) ───────── */

export const EXPLORATION_ARMS = [
  { id: 'later', kind: 'time', minutes: 60, label: 'un\'ora dopo il momento migliore' },
  { id: 'earlier', kind: 'time', minutes: -60, label: 'un\'ora prima del momento migliore' },
  { id: 'deeper', kind: 'discount', points: 2, label: '2 punti di sconto in più' },
  { id: 'softer', kind: 'discount', points: -2, label: '2 punti di sconto in meno' },
]

/** Stable key of an offer for exploration: the link, else title and prices. */
export const explorationKey = (raw) => {
  const link = String((raw && raw.link) || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[?#].*$/, '')
  return link || [raw && raw.itemTitle, raw && raw.listPrice, raw && raw.category].map((v) => String(v || '').trim().toLowerCase()).join('|')
}

/** Deterministic: the same offer in the same month always gets the same answer (no flip-flop on re-analysis). */
export function explorationArmFor(key, month, { enabled = true, share = LEARNING.EXPLORE_SHARE } = {}) {
  if (!enabled || !key || !month) return null
  const u = (hashString(`${key}|${month}|explore`) % 10000) / 10000
  if (u >= share) return null
  return EXPLORATION_ARMS[hashString(`${key}|${month}|arm`) % EXPLORATION_ARMS.length]
}

const lrnQuiet = (date) => {
  const m = minutesOfDay(date)
  return m >= 23 * 60 || m < 7 * 60
}

/** One try of an arm; null when it is not safe or not meaningful. */
function lrnTryArm(raw, base, arm, now, options) {
  if (arm.kind === 'time') {
    const at = new Date(base.optimal.date.getTime() + arm.minutes * 60000)
    if (at.getTime() < now.getTime() + 10 * 60000) return null
    if (lrnQuiet(at) && !lrnQuiet(base.optimal.date)) return null
    const result = analyzeOffer(raw, now, { ...options, exactSendAt: at, preferredSendAt: null })
    if (!result.ok || result.kind !== base.kind) return null
    const cost = base.probability - result.probability
    if (cost > LEARNING.EXPLORE_MAX_COST + 1e-9) return null
    return { result, cost, price: base.input.targetPrice, at }
  }
  const L = base.input.listPrice
  const step = priceStepFor(L)
  const wantedPct = base.input.discountPct + arm.points
  if (wantedPct < 5 || wantedPct > VINTED.MAX_DISCOUNT_PCT - 0.01) return null
  let price = Math.round((L * (1 - wantedPct / 100)) / step) * step
  price = Math.round(price * 100) / 100
  // At least one price step in the arm's direction.
  if (arm.points > 0 && price > base.input.targetPrice - step + 1e-9) price = Math.round((base.input.targetPrice - step) * 100) / 100
  if (arm.points < 0 && price < base.input.targetPrice + step - 1e-9) price = Math.round((base.input.targetPrice + step) * 100) / 100
  if (!(price > 0) || price >= L) return null
  if (((L - price) / L) * 100 > VINTED.MAX_DISCOUNT_PCT) return null
  const raw2 = { ...raw, targetPrice: String(price).replace('.', ',') }
  const result = analyzeOffer(raw2, now, { ...options, preferredSendAt: base.optimal.date })
  if (!result.ok || result.kind !== 'analysis') return null
  const cost = base.probability - result.probability
  if (cost > LEARNING.EXPLORE_MAX_COST + 1e-9) return null
  return { result, cost, price, at: result.optimal.date }
}

/**
 * Applies the offer's exploration arm to a fresh analysis. Tries the arm, then the opposite arm of the same kind,
 * then the time arms. Returns { result, exploration } or null (no variation this time).
 */
export function exploreOffer(raw, base, arm, now, options = {}) {
  if (!arm || !base || !base.ok || base.kind !== 'analysis' || !base.optimal) return null
  const opposite = EXPLORATION_ARMS.find((a) => a.kind === arm.kind && a.id !== arm.id)
  const order = [arm, opposite, ...EXPLORATION_ARMS.filter((a) => a.kind === 'time' && a.id !== arm.id && a !== opposite)].filter(Boolean)
  for (const a of order) {
    const tried = lrnTryArm(raw, base, a, now, options)
    if (!tried) continue
    const exploration = {
      arm: a.id,
      kind: a.kind,
      label: a.label,
      requestedArm: arm.id,
      base: { price: base.input.targetPrice, at: lrnIso(base.optimal.date), probability: base.probability },
      price: tried.price,
      at: lrnIso(tried.at),
      costPoints: Math.round(tried.cost * 100),
    }
    return { result: { ...tried.result, exploration }, exploration }
  }
  return null
}

/* ───────── failure risk ───────── */

const lrnLevel = (pFail) => (pFail >= 0.6 ? 'high' : pFail >= 0.35 ? 'medium' : 'low')

/**
 * Probability that this offer fails even at the recommended moment and price, a 90% range, the reasons and what the
 * user's own history says. `records` = buildDataset(...) (optional).
 */
export function failureRiskFor(result, { profile = null, records = null } = {}) {
  if (!result || !result.ok || !result.optimal || result.kind === 'no_offer_needed') return null
  const { optimal, input } = result
  const p = result.probability
  const k = optimal.pAvailable * optimal.pRead
  const z = optimal.score.logit
  let lo = result.probabilityRange ? result.probabilityRange[0] : p
  let hi = result.probabilityRange ? result.probabilityRange[1] : p
  const P = profile ? normalizeProfile(profile) : null
  let basis = 'engine'
  if (P && P.cov && Array.isArray(P.paramKeys) && P.cov.length === P.paramKeys.length) {
    const r = { rawLogit: optimal.score.rawLogit ?? z, timeGroup: timeGroupOf(optimal.score.timeWindow.id), band: bandOf(input.discountPct) }
    const x = P.paramKeys.map((key) => lrnFeature(key, r))
    let v = 0
    for (let i = 0; i < x.length; i++) for (let j = 0; j < x.length; j++) v += x[i] * P.cov[i][j] * x[j]
    const sd = Math.sqrt(Math.max(0, v))
    lo = Math.min(lo, k * squash(z - 1.645 * sd))
    hi = Math.max(hi, k * squash(z + 1.645 * sd))
    basis = 'history'
  } else {
    // Without outcomes the engine's weights are still unvalidated for this user's sellers: say so with a wide range.
    lo = Math.min(lo, Math.max(0.01, p - 0.12))
    hi = Math.max(hi, Math.min(0.99, p + 0.12))
  }
  const reasons = []
  const negatives = (result.factors && result.factors.rows ? result.factors.rows : []).filter((f) => f.deltaPoints < 0).sort((a, b) => a.deltaPoints - b.deltaPoints)
  if (input.discountPct >= 15) reasons.push({ id: 'discount', text: `Sconto del ${Math.round(input.discountPct)}%: parte da ${result.factors.basePct}% di accettazione` })
  for (const f of negatives.slice(0, 3)) reasons.push({ id: f.id, text: `${f.label}: ${formatSignedPoints(f.deltaPoints)} punti` })
  if (optimal.pAvailable < 0.9) reasons.push({ id: 'available', text: `Può essere venduto ad altri prima: resta disponibile al ${Math.round(optimal.pAvailable * 100)}%` })
  if (optimal.pRead < 0.99) reasons.push({ id: 'read', text: `Venditore inattivo: potrebbe non leggere l'offerta (${Math.round(optimal.pRead * 100)}%)` })
  if (result.blockRisk && result.blockRisk.level !== 'low') reasons.push({ id: 'block', text: `Rischio di rifiuto secco ${result.blockRisk.label.toLowerCase()}` })

  let similar = null
  let closeAfterFail = null
  if (Array.isArray(records) && records.length) {
    const band = bandOf(input.discountPct)
    const same = records.filter((r) => r.y != null && r.band === band)
    if (same.length >= 3) similar = { n: same.length, successes: same.filter((r) => r.y === 1).length, band }
    const failed = records.filter((r) => r.y === 0 && (r.closed || r.lost))
    if (failed.length >= 3) closeAfterFail = { n: failed.length, closed: failed.filter((r) => r.closed).length }
  }
  const pFail = 1 - p
  const plan = []
  if (pFail >= 0.35) plan.push('Se arriva una controproposta, non accettarla subito: usa «Ha fatto una controproposta» per la tua mossa.')
  if (pFail >= 0.5 && input.discountPct > 20) plan.push('Se rifiuta, riprova tra qualche giorno con 2–3 punti di sconto in meno.')
  if (optimal.pRead < 0.99) plan.push('Con un venditore inattivo scrivi prima un messaggio: l\'offerta da sola rischia di scadere senza risposta.')
  return {
    pSuccess: p,
    pFail,
    range: [Math.max(0, 1 - hi), Math.min(1, 1 - lo)],
    level: lrnLevel(pFail),
    basis,
    reasons: reasons.slice(0, 5),
    similar,
    closeAfterFail,
    plan,
  }
}

/* ───────── monthly report ───────── */

const OUTCOME_LABELS = {
  accepted: 'Accettata', bought: 'Comprato', countered: 'Controproposta', declined: 'Rifiutata', no_reply: 'Nessuna risposta',
  sold_other: 'Venduto ad altri', abandoned: 'Lasciato perdere', sent: 'In attesa', planned: 'Da inviare',
}
const finalLabel = (r) => (r.closed ? 'Affare concluso' : r.lost ? (r.lostImplicit ? 'Perso (nessuna notizia da 7 giorni)' : 'Perso') : 'In corso')

const groupStats = (records, keyOf, ids, profileBefore, profileAfter, kind) => ids.map(({ id, label }) => {
  const rs = records.filter((r) => r.y != null && keyOf(r) === id && Number.isFinite(r.rawLogit))
  const expected = rs.reduce((s, r) => s + predictWith(profileBefore, r), 0)
  const successes = rs.filter((r) => r.y === 1).length
  return {
    id, label, n: rs.length, successes, expected: lrnR2(expected), observedRate: rs.length ? successes / rs.length : null,
    expectedRate: rs.length ? expected / rs.length : null, oe: lrnR2(successes - expected),
    before: kind ? profileBefore[kind][id] : null, after: kind ? profileAfter[kind][id] : null,
  }
})

/**
 * The month's report. `items` = current list + archive; `month` = 'YYYY-MM'; `previous` = profile active during the
 * month. The fit uses ALL history up to `now` (late outcomes of earlier months included); the month's numbers use the
 * offers sent in that month. Returns everything the workbook and the app's report card show.
 */
export function monthlyReport({ items, month, now, previous = null, profileHistory = [], explorationEnabled = true }) {
  const records = buildDataset(items, now)
  const inMonth = records.filter((r) => r.month === month)
  const prev = normalizeProfile(previous)

  const firstFit = fitFirstOffers(records, now)
  const counterFit = fitCounters(records, now, prev.time)
  const proposal = proposeProfile({ previous: prev, firstFit, counterFit, records, month, now, lastMonthRecords: inMonth })
  const next = proposal.profile
  const discountFit = proposal.discountFit

  const decided = inMonth.filter((r) => r.y != null)
  const pairsShown = decided.filter((r) => r.pShown != null).map((r) => [r.pShown, r.y])
  const pairsRaw = decided.filter((r) => Number.isFinite(r.rawLogit)).map((r) => [predictWith(null, r), r.y])
  const pairsNext = decided.filter((r) => Number.isFinite(r.rawLogit)).map((r) => [predictWith(next, r), r.y])
  const rounds = inMonth.flatMap((r) => r.rounds.map((round) => ({ ...round, record: r })))
  const replies = rounds.filter((x) => x.replyPrice != null)
  const closed = inMonth.filter((r) => r.closed)
  const lost = inMonth.filter((r) => r.lost)
  const count = (first) => inMonth.filter((r) => r.first === first).length

  const summary = {
    offersSent: inMonth.length,
    decidedFirst: decided.length,
    accepted: count('accepted') + count('bought'),
    countered: count('countered'),
    declined: count('declined'),
    noReply: count('no_reply'),
    noReplyImplicit: inMonth.filter((r) => r.implicit).length,
    soldOther: count('sold_other'),
    pending: inMonth.filter((r) => r.pending).length,
    closedDeals: closed.length,
    lostDeals: lost.length,
    closeRate: closed.length + lost.length ? closed.length / (closed.length + lost.length) : null,
    firstAcceptRate: decided.length ? decided.filter((r) => r.y === 1).length / decided.length : null,
    predictedFirstAccept: pairsShown.length ? lrnMean(pairsShown.map(([p]) => p)) : null,
    counterRate: decided.length ? decided.filter((r) => r.first === 'countered').length / decided.length : null,
    sellerCounters: rounds.length,
    ourCounters: replies.length,
    ourCountersAccepted: replies.filter((x) => x.replyAccepted === true).length,
    avgSellerRaisePct: lrnMean(rounds.map((x) => x.sellerRaisePct).filter(Number.isFinite)),
    avgSellerGapShare: lrnMean(rounds.map((x) => x.sellerGapShare).filter(Number.isFinite)),
    avgOurRaisePct: lrnMean(replies.map((x) => x.replyRaisePct).filter(Number.isFinite)),
    avgRoundsClosed: closed.length ? lrnMean(closed.map((r) => r.rounds.length)) : null,
    medianLatencyH: lrnMedian([...inMonth.map((r) => r.latencyFirstH), ...rounds.map((x) => x.latencyH)].filter(Number.isFinite)),
    totalSavedEur: lrnR2(closed.reduce((s, r) => s + r.savingEur, 0)),
    avgSavingEur: closed.length ? lrnR2(lrnMean(closed.map((r) => r.savingEur))) : null,
    avgSavingPct: closed.length ? lrnMean(closed.map((r) => r.savingShare)) : null,
    avgFirstDiscountPct: inMonth.length ? lrnMean(inMonth.map((r) => r.discountPct)) / 100 : null,
    onTimeShare: inMonth.filter((r) => r.onTime != null).length ? inMonth.filter((r) => r.onTime).length / inMonth.filter((r) => r.onTime != null).length : null,
    explored: inMonth.filter((r) => r.exploration).length,
  }

  const calibration = {
    n: decided.length,
    brierShown: brierScore(pairsShown),
    logLossShown: logLoss(pairsShown),
    brierEngine: brierScore(pairsRaw),
    logLossEngine: logLoss(pairsRaw),
    brierNext: brierScore(pairsNext),
    logLossNext: logLoss(pairsNext),
    reliability: reliabilityTable(pairsShown.length ? pairsShown : pairsRaw),
    allTime: {
      n: firstFit.n,
      logLossEngine: logLoss(firstFit.decided.map((r) => [predictWith(null, r), r.y])),
      logLossNext: logLoss(firstFit.decided.map((r) => [predictWith(next, r), r.y])),
    },
  }

  const byTimeGroup = groupStats(records, (r) => r.timeGroup, LEARNING_TIME_GROUPS, prev, next, 'time')
  const byBand = groupStats(records, (r) => r.band, LEARNING_BANDS, prev, next, 'band')
  const exploration = [{ id: 'none', label: 'Nessuna variante' }, ...EXPLORATION_ARMS].map((arm) => {
    const rs = records.filter((r) => r.y != null && Number.isFinite(r.rawLogit) && (arm.id === 'none' ? !r.exploration : r.exploration && r.exploration.arm === arm.id))
    const expected = rs.reduce((s, r) => s + predictWith(prev, r), 0)
    const successes = rs.filter((r) => r.y === 1).length
    const saving = rs.filter((r) => r.closed)
    return { id: arm.id, label: arm.label, n: rs.length, successes, expected: lrnR2(expected), oe: lrnR2(successes - expected), avgSavingPct: saving.length ? lrnMean(saving.map((r) => r.savingShare)) : null }
  })

  const notes = []
  if (!records.length) notes.push('Nessuna offerta inviata finora: segna «Inviata» e l\'esito di ogni offerta, il motore impara solo dai tuoi esiti.')
  else if (firstFit.n < LEARNING.MIN_EFFECTIVE.intercept) notes.push(`Esiti ancora pochi (${firstFit.n}): il motore resta quello di base finché non ne raccoglie almeno ${LEARNING.MIN_EFFECTIVE.intercept}.`)
  if (summary.pending) notes.push(`${summary.pending} ${summary.pending === 1 ? 'trattativa è ancora aperta' : 'trattative sono ancora aperte'}: gli esiti che arriveranno entrano nel calcolo del mese prossimo.`)
  if (summary.noReplyImplicit) notes.push(`${summary.noReplyImplicit} ${summary.noReplyImplicit === 1 ? 'offerta senza esito da oltre 7 giorni è contata' : 'offerte senza esito da oltre 7 giorni sono contate'} come «nessuna risposta».`)
  if (proposal.rollback) notes.push('Il mese scorso le correzioni hanno stimato peggio del motore di base: le ho dimezzate prima di ricalcolarle.')
  if (!explorationEnabled) notes.push('Le varianti di test sono spente: il motore impara più lentamente sugli orari e sugli sconti.')

  return {
    month,
    label: monthLabel(month),
    generatedAt: lrnIso(now),
    engine: ENGINE_VERSION,
    summary,
    calibration,
    byTimeGroup,
    byBand,
    exploration,
    discount: discountFit,
    counterFit,
    firstFit: { keys: firstFit.keys, theta: firstFit.theta, nEff: firstFit.nEff, n: firstFit.n },
    changes: proposal.changes,
    rollback: proposal.rollback,
    previousProfile: prev,
    nextProfile: next,
    profileHistory,
    records,
    inMonth,
    notes,
    trend: monthlyTrend(records, proposal.changes.some((c) => c.status === 'applied' || c.status === 'capped') ? [...profileHistory, next] : profileHistory),
  }
}

/** One row per month of history: the month-after-month view of the results. */
export function monthlyTrend(records, profileHistory = []) {
  const months = [...new Set(records.map((r) => r.month))].sort()
  return months.map((m) => {
    const rs = records.filter((r) => r.month === m)
    const decided = rs.filter((r) => r.y != null)
    const closed = rs.filter((r) => r.closed)
    const lost = rs.filter((r) => r.lost)
    const applied = profileHistory.find((p) => p && p.month === m)
    return {
      month: m,
      label: monthLabel(m),
      offers: rs.length,
      firstAcceptRate: decided.length ? decided.filter((r) => r.y === 1).length / decided.length : null,
      predicted: decided.filter((r) => r.pShown != null).length ? lrnMean(decided.filter((r) => r.pShown != null).map((r) => r.pShown)) : null,
      closed: closed.length,
      lost: lost.length,
      closeRate: closed.length + lost.length ? closed.length / (closed.length + lost.length) : null,
      avgSavingPct: closed.length ? lrnMean(closed.map((r) => r.savingShare)) : null,
      totalSavedEur: lrnR2(closed.reduce((s, r) => s + r.savingEur, 0)),
      changesApplied: applied && Array.isArray(applied.changes) ? applied.changes.length : 0,
    }
  })
}

/** Short text lines for the app's report card and the monthly notification. */
export function reportHeadline(report) {
  const s = report.summary
  const moved = report.changes.filter((c) => c.status === 'applied' || c.status === 'capped')
  const parts = [`${s.offersSent} ${s.offersSent === 1 ? 'offerta' : 'offerte'}`]
  if (s.closedDeals) parts.push(`${s.closedDeals} ${s.closedDeals === 1 ? 'affare' : 'affari'} (${formatEuro(s.totalSavedEur)} risparmiati)`)
  parts.push(moved.length ? `${moved.length} ${moved.length === 1 ? 'correzione applicata' : 'correzioni applicate'}` : 'motore invariato')
  return parts.join(' · ')
}

/* ───────── workbook ───────── */

const pctOrNull = (x) => (x == null || !Number.isFinite(x) ? null : x)
const yesNo = (b) => (b == null ? '' : b ? 'Sì' : 'No')

/** The month's .xlsx: summary, offers, negotiations, time and discount groups, calibration, tests, engine changes, trend. */
export function reportWorkbook(report) {
  const s = report.summary
  const c = report.calibration
  const summaryRows = [
    ['Offerte inviate nel mese', s.offersSent, 'num'],
    ['Prime offerte con esito', s.decidedFirst, 'num'],
    ['Accettate subito', s.accepted, 'num'],
    ['Controproposte ricevute alla prima offerta', s.countered, 'num'],
    ['Rifiutate', s.declined, 'num'],
    ['Nessuna risposta (di cui presunte)', `${s.noReply} (${s.noReplyImplicit})`, 'text'],
    ['Vendute ad altri', s.soldOther, 'num'],
    ['Trattative ancora aperte', s.pending, 'num'],
    ['Affari conclusi', s.closedDeals, 'num'],
    ['Affari persi', s.lostDeals, 'num'],
    ['Tasso di chiusura (conclusi / decisi)', pctOrNull(s.closeRate), 'pct'],
    ['Accettazione reale della prima offerta', pctOrNull(s.firstAcceptRate), 'pct'],
    ['Accettazione stimata dal motore', pctOrNull(s.predictedFirstAccept), 'pct'],
    ['Quota di prime offerte con controproposta', pctOrNull(s.counterRate), 'pct'],
    ['Controproposte del venditore (tutti i giri)', s.sellerCounters, 'num'],
    ['Salita media della controproposta sulla tua offerta', pctOrNull(s.avgSellerRaisePct == null ? null : s.avgSellerRaisePct / 100), 'pct'],
    ['Quota media della distanza concessa dal venditore', pctOrNull(s.avgSellerGapShare), 'pct'],
    ['Tue controproposte inviate', s.ourCounters, 'num'],
    ['Tue controproposte accettate', s.ourCountersAccepted, 'num'],
    ['Tua salita media nelle controproposte', pctOrNull(s.avgOurRaisePct == null ? null : s.avgOurRaisePct / 100), 'pct'],
    ['Giri medi negli affari conclusi', s.avgRoundsClosed, 'num'],
    ['Tempo di risposta mediano (ore)', s.medianLatencyH == null ? null : lrnR2(s.medianLatencyH), 'num'],
    ['Sconto medio della prima offerta', pctOrNull(s.avgFirstDiscountPct), 'pct'],
    ['Risparmio medio sugli affari conclusi', pctOrNull(s.avgSavingPct), 'pct'],
    ['Risparmio medio per affare', s.avgSavingEur, 'eur'],
    ['Risparmio totale', s.totalSavedEur, 'eur'],
    ['Offerte inviate in orario (±60 min)', pctOrNull(s.onTimeShare), 'pct'],
    ['Offerte con variante di test', s.explored, 'num'],
    ['Errore delle stime (Brier, più basso è meglio)', c.brierShown == null ? null : lrnR4(c.brierShown), 'num'],
    ['Errore delle stime con le nuove correzioni (Brier)', c.brierNext == null ? null : lrnR4(c.brierNext), 'num'],
  ]
  const sheets = [
    {
      name: 'Riepilogo',
      title: `Offerte Vinted · ${report.label}`,
      note: `Generato il ${String(report.generatedAt).slice(0, 10)} · motore ${report.engine} · ${reportHeadline(report)}`,
      columns: [{ header: 'Voce', width: 52 }, { header: 'Valore', width: 18 }],
      rows: summaryRows.map((r) => [r[0], lrnTyped(r[1], r[2])]),
    },
    {
      name: 'Offerte',
      columns: [
        { header: 'Articolo', width: 34 }, { header: 'Categoria', width: 14 }, { header: 'Listino', format: 'eur' }, { header: 'Prima offerta', format: 'eur' },
        { header: 'Sconto', format: 'pct' }, { header: 'Inviata', format: 'datetime', width: 17 }, { header: 'Consigliata', format: 'datetime', width: 17 },
        { header: 'Scarto (min)', format: 'int' }, { header: 'Giorno', width: 11 }, { header: 'Fascia', width: 30 }, { header: 'Stima mostrata', format: 'pct' },
        { header: 'Stima motore oggi', format: 'pct' }, { header: 'Stima corretta', format: 'pct' }, { header: 'Prima risposta', width: 18 }, { header: 'Ore alla risposta', format: 'num' },
        { header: 'Controproposte', format: 'int' }, { header: 'Prima controproposta', format: 'eur' }, { header: 'Salita controproposta', format: 'pct' },
        { header: 'Prezzo finale', format: 'eur' }, { header: 'Risparmio', format: 'eur' }, { header: 'Risparmio %', format: 'pct' }, { header: 'Esito', width: 30 },
        { header: 'Variante di test', width: 24 }, { header: 'Venditore', width: 12 }, { header: 'Link', width: 40 },
      ],
      rows: report.inMonth.map((r) => {
        const firstRound = r.rounds[0]
        const group = LEARNING_TIME_GROUPS.find((g) => g.id === r.timeGroup)
        return [
          r.title || 'Senza titolo', r.category, r.listPrice, r.price, r.discountPct / 100, r.sentAt, r.recommendedAt, r.delayMinutes, WEEKDAYS_IT[r.weekday],
          group ? group.label : r.timeGroup, r.pShown, Number.isFinite(r.rawLogit) ? predictWith(null, r) : null, Number.isFinite(r.rawLogit) ? predictWith(report.nextProfile, r) : null,
          r.first ? `${OUTCOME_LABELS[r.first] || r.first}${r.implicit ? ' (presunta)' : ''}` : 'In attesa', r.latencyFirstH == null ? null : lrnR2(r.latencyFirstH),
          r.rounds.length, firstRound ? firstRound.sellerPrice : null, firstRound && Number.isFinite(firstRound.sellerRaisePct) ? firstRound.sellerRaisePct / 100 : null,
          r.finalPrice, r.savingEur, r.savingShare, finalLabel(r), r.exploration ? r.exploration.label : '', r.sellerProfile, r.link,
        ]
      }),
    },
    {
      name: 'Trattative',
      columns: [
        { header: 'Articolo', width: 34 }, { header: 'Giro', format: 'int' }, { header: 'Tua offerta', format: 'eur' }, { header: 'Sua controproposta', format: 'eur' },
        { header: 'Salita sulla tua offerta', format: 'pct' }, { header: 'Distanza concessa', format: 'pct' }, { header: 'Ore alla sua risposta', format: 'num' },
        { header: 'Ricevuta', format: 'datetime', width: 17 }, { header: 'Tua risposta', format: 'eur' }, { header: 'Tua salita', format: 'pct' }, { header: 'Quota della distanza', format: 'pct' },
        { header: 'Metà strada', width: 12 }, { header: 'Ultima offerta', width: 14 }, { header: 'Stima accettazione', format: 'pct' }, { header: 'Accettata', width: 12 }, { header: 'Inviata', format: 'datetime', width: 17 },
      ],
      rows: report.inMonth.flatMap((r) => r.rounds.map((x) => [
        r.title || 'Senza titolo', x.index, x.buyerPrice, x.sellerPrice, Number.isFinite(x.sellerRaisePct) ? x.sellerRaisePct / 100 : null, x.sellerGapShare, x.latencyH == null ? null : lrnR2(x.latencyH),
        x.receivedAt ? new Date(x.receivedAt) : null, x.replyPrice, Number.isFinite(x.replyRaisePct) ? x.replyRaisePct / 100 : null, x.replyGapShare, yesNo(x.replyIsSplit), yesNo(x.replyIsFinal),
        x.replyPAccept, x.replyAccepted == null ? 'In attesa' : x.replyAccepted ? 'Sì' : x.replyImplicit ? 'No (nessuna risposta)' : 'No', x.replyAt ? new Date(x.replyAt) : null,
      ])),
    },
    {
      name: 'Fasce orarie',
      note: 'Tutto lo storico, i mesi vecchi pesano meno. Osservate − attese > 0: la fascia rende più di quanto il motore stimava.',
      title: 'Fasce orarie',
      columns: [{ header: 'Fascia', width: 44 }, { header: 'Prime offerte', format: 'int' }, { header: 'Accettate', format: 'int' }, { header: 'Attese', format: 'num' }, { header: 'Osservate − attese', format: 'num' },
        { header: 'Tasso reale', format: 'pct' }, { header: 'Tasso stimato', format: 'pct' }, { header: 'Correzione prima', format: 'num' }, { header: 'Correzione ora', format: 'num' }],
      rows: report.byTimeGroup.map((g) => [g.label, g.n, g.successes, g.expected, g.oe, g.observedRate, g.expectedRate, g.before, g.after]),
    },
    {
      name: 'Sconti',
      title: 'Fasce di sconto e sconto di partenza',
      note: `Sconto di partenza: ${report.previousProfile.discountPct}% → ${report.nextProfile.discountPct}%. Risparmio atteso = probabilità × sconto + (1 − probabilità) × (affari chiusi dopo un primo no: ${Math.round(report.discount.closeAfterFail * 100)}%, con il ${Math.round(report.discount.continuationRatio * 100)}% del risparmio iniziale; un affare perso costa il ${Math.round(LEARNING.LOSS_COST_SHARE * 100)}%).`,
      columns: [{ header: 'Voce', width: 28 }, { header: 'Prime offerte', format: 'int' }, { header: 'Accettate', format: 'int' }, { header: 'Attese', format: 'num' }, { header: 'Osservate − attese', format: 'num' },
        { header: 'Correzione prima', format: 'num' }, { header: 'Correzione ora', format: 'num' }],
      rows: [
        ...report.byBand.map((b) => [b.label, b.n, b.successes, b.expected, b.oe, b.before, b.after]),
        [],
        ['Sconto di partenza', 'Accettazione stimata', 'Risparmio atteso'],
        ...report.discount.curve.map((p) => [`${p.discountPct}%`, p.pAccept, p.expectedSavingShare]),
      ],
      rowFormats: { afterRow: report.byBand.length + 1, formats: ['text', 'pct', 'pct'] },
    },
    {
      name: 'Calibrazione',
      title: 'Quanto sono affidabili le stime',
      note: 'Per fascia di probabilità stimata: quante offerte e quante accettate davvero. Più le colonne si somigliano, più il motore è calibrato.',
      columns: [{ header: 'Stima da', format: 'pct' }, { header: 'Stima a', format: 'pct' }, { header: 'Offerte', format: 'int' }, { header: 'Stima media', format: 'pct' }, { header: 'Accettate davvero', format: 'pct' }],
      rows: [
        ...c.reliability.bins.map((b) => [b.from, b.to, b.n, b.predicted, b.observed]),
        [],
        ['Errore di calibrazione medio (ECE)', null, null, c.reliability.ece],
        ['Log loss stime mostrate (più basso è meglio)', null, null, lrnTyped(c.logLossShown == null ? null : lrnR4(c.logLossShown), 'num')],
        ['Log loss motore di base', null, null, lrnTyped(c.logLossEngine == null ? null : lrnR4(c.logLossEngine), 'num')],
        ['Log loss con le nuove correzioni', null, null, lrnTyped(c.logLossNext == null ? null : lrnR4(c.logLossNext), 'num')],
        ['Tutto lo storico: offerte con esito', null, null, lrnTyped(c.allTime.n, 'int')],
        ['Tutto lo storico: log loss base → corretto', null, null, c.allTime.logLossEngine == null ? null : `${lrnR4(c.allTime.logLossEngine)} → ${lrnR4(c.allTime.logLossNext)}`],
      ],
    },
    {
      name: 'Varianti di test',
      title: 'Varianti di test (1 offerta su 5)',
      note: 'Osservate − attese confronta ogni variante con la stima del motore per le stesse offerte: con pochi casi è solo un indizio.',
      columns: [{ header: 'Variante', width: 36 }, { header: 'Prime offerte', format: 'int' }, { header: 'Accettate', format: 'int' }, { header: 'Attese', format: 'num' }, { header: 'Osservate − attese', format: 'num' }, { header: 'Risparmio medio', format: 'pct' }],
      rows: report.exploration.map((a) => [a.label, a.n, a.successes, a.expected, a.oe, a.avgSavingPct]),
    },
    {
      name: 'Modifiche motore',
      title: `Correzioni per ${monthLabel(shiftMonth(report.month, 1))}`,
      note: report.rollback ? 'Rollback prudente: le correzioni del mese scorso sono state dimezzate.' : 'Ogni valore si muove solo con abbastanza esiti e al massimo di un passo al mese.',
      columns: [{ header: 'Parametro', width: 46 }, { header: 'Prima', format: 'num' }, { header: 'Dopo', format: 'num' }, { header: 'Obiettivo dai dati', format: 'num' }, { header: 'Esiti pesati', format: 'num' },
        { header: 'Minimo richiesto', format: 'int' }, { header: 'Stato', width: 16 }, { header: 'Motivo', width: 60 }],
      rows: report.changes.map((x) => [x.label, x.from, x.to, x.target, x.nEff, x.minEffective, { applied: 'Applicata', capped: 'Applicata (limitata)', unchanged: 'Invariata', waiting_data: 'In attesa di dati' }[x.status] || x.status, x.reason]),
    },
    {
      name: 'Andamento',
      title: 'Mese dopo mese',
      columns: [{ header: 'Mese', width: 16 }, { header: 'Offerte', format: 'int' }, { header: 'Accettazione reale', format: 'pct' }, { header: 'Stimata', format: 'pct' }, { header: 'Conclusi', format: 'int' },
        { header: 'Persi', format: 'int' }, { header: 'Tasso di chiusura', format: 'pct' }, { header: 'Risparmio medio', format: 'pct' }, { header: 'Risparmio totale', format: 'eur' }, { header: 'Correzioni applicate', format: 'int' }],
      rows: report.trend.map((t) => [t.label, t.offers, t.firstAcceptRate, t.predicted, t.closed, t.lost, t.closeRate, t.avgSavingPct, t.totalSavedEur, t.changesApplied]),
    },
    {
      name: 'Note',
      columns: [{ header: 'Nota', width: 110 }],
      rows: report.notes.length ? report.notes.map((n) => [n]) : [['Nessuna nota.']],
    },
  ]
  return buildXlsx(sheets.map(lrnApplyRowFormats), { title: `Offerte Vinted ${report.label}`, creator: 'Offerta Vinted Timing', date: lrnDate(report.generatedAt) || new Date(0) })
}

/** Rows after `rowFormats.afterRow` (the discount curve under the band table) get their own per-column formats. */
function lrnApplyRowFormats(sheet) {
  if (sheet.rowFormats) {
    const { afterRow, formats } = sheet.rowFormats
    return { ...sheet, rows: sheet.rows.map((row, i) => (i >= afterRow + 1 ? row.map((v, j) => lrnTyped(v, formats[j])) : row)) }
  }
  return sheet
}

/** A value with an explicit cell format (the writer reads { value, format } objects). */
const lrnTyped = (value, format) => (value == null || format == null || format === 'text' ? value : { value, format })

export const reportFileName = (report) => `Offerte-Vinted-${report.month}.xlsx`
