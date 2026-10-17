/**
 * Monthly learning loop. Pure functions over the saved offers (the app's "da comprare" list plus archived items):
 *
 *   dataset      every first offer and every counter with its outcome, re-scored by the current engine at the moment
 *                it was really sent (so the fit always measures the engine the user is running);
 *   fit          Bayesian logistic correction of the engine (MAP + Laplace) with priors centred on "no change",
 *                older months down-weighted by a half-life; general shift first, then centred time and discount
 *                offsets, each family admitted only when leave-one-out says it predicts better;
 *   profile      the correction actually applied next month: each value moves toward the fit only with enough data,
 *                beyond half a posterior sd and by a bounded step; a profile that predicts worse than its parent
 *                (prequential log Bayes factor < −2) is rolled back;
 *   discount     the default starting discount, moved only by what the data change in the expected-saving optimum;
 *   counters     seller concession share and reply time (Kaplan–Meier), fed to the counter engine with gates;
 *   exploration  a deterministic, flagged ±1 h / ±2 points variation on about 1 offer in 5, drawn from the safe
 *                variations with logged propensity and a monthly cost budget;
 *   failure risk the probability that an offer fails even at the recommended moment and price, why, and the chance
 *                the negotiation still closes;
 *   report       the month's numbers and the workbook (.xlsx) the app exports.
 *
 * No Math.random, no clock reads: every function takes `now`. Same inputs → same output.
 */
import { COUNTER, ENGINE_VERSION, LEARNING, LEARNING_DISCOUNT_KNOTS, LEARNING_TIME_GROUPS, VINTED } from './constants.js'
import { analyzeOffer, normalizeInput, priceStepFor, withPrices } from './analyze.js'
import { MONTHS_IT, WEEKDAYS_IT, calendarDaysBetween, minutesOfDay, pad2 } from './dates.js'
import { clamp, formatPoints, hashString, squash } from './math.js'
import { formatEuro } from './messages.js'
import { prepArticleFor } from './reasoning.js'
import {
  DEFAULT_PROFILE, discKnotOf, discKnotWeights, discOffset, monotoneDisc, normalizeProfile, profileIsActive, profileParams, timeGroupOf,
} from './profile.js'
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
/** Number or NaN: null and '' are missing values, not zeros (Number(null) === 0). */
const lrnNum = (v) => (v == null || v === '' ? NaN : Number(v))
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
    knot: discKnotOf(input.discountPct),
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
    const pRead = reply && lrnNum(reply.pRead) > 0 ? lrnNum(reply.pRead) : 1
    // Sent more than an hour away from the planned moment: the stored logit (planned window, planned delay) does not
    // describe what was sent, so the round stays out of the counter fit (it still counts in the analytics).
    const plannedAt = reply ? lrnDate(reply.plannedAt) : null
    const offPlan = Boolean(replyAt && plannedAt && Math.abs(replyAt.getTime() - plannedAt.getTime()) > 60 * 60000)
    const replyRawLogit = !reply || offPlan ? null
      : Number.isFinite(lrnNum(reply.rawLogit)) ? lrnNum(reply.rawLogit)
        : Number.isFinite(lrnNum(reply.pAccept)) ? unsquash(lrnNum(reply.pAccept) / pRead) - (lrnNum(reply.learnedWeight) || 0) : null
    const replyWindow = reply ? ((!offPlan && reply.windowId) || (replyAt ? timeWindowAt(replyAt).id : null)) : null
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
      replyPAccept: reply && Number.isFinite(lrnNum(reply.pAccept)) ? lrnNum(reply.pAccept) : null,
      replyOffPlan: offPlan,
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
  const firstSeller = history.find((e) => e.by === 'seller')
  // A plan never sent (abandoned, or bought at list price without an offer) is not an offer at all.
  if (!item.sentAt && !firstSeller && (!history[0] || history[0].planned)) return null
  let knownSentAt = lrnDate(item.sentAt) || (status !== 'planned' && history[0] && !history[0].planned ? lrnDate(history[0].at) : null)
  // An imputed send time that is not before the seller's counter is the moment the outcome was tapped, not a send.
  if (knownSentAt && item.sentAtSource === 'imputed' && firstSeller && lrnDate(firstSeller.at) && knownSentAt.getTime() >= lrnDate(firstSeller.at).getTime()) knownSentAt = null
  const sentAt = knownSentAt || (status !== 'planned' ? lrnDate(firstSeller && firstSeller.at) || lrnDate(item.outcomeAt) || lrnDate(item.createdAt) : null)
  if (!sentAt) return null
  const sentKnown = Boolean(knownSentAt)
  const decision = item.decision || null
  const listPrice = lrnNum(item.listPrice)
  const price = lrnNum(item.targetPrice)
  const discountPct = Number.isFinite(lrnNum(item.discountPct)) ? lrnNum(item.discountPct) : listPrice > 0 ? ((listPrice - price) / listPrice) * 100 : 0
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
      : lrnNum(item.probability) > 0 ? unsquash(lrnNum(item.probability)) : null
  const k = rescored ? rescored.k : decision && lrnNum(decision.k) > 0 ? lrnNum(decision.k) : 1
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
    knot: discKnotOf(discountPct),
    discW: discKnotWeights(discountPct),
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
    pShown: Number.isFinite(lrnNum(item.probability)) ? lrnNum(item.probability) : decision && Number.isFinite(lrnNum(decision.probability)) ? lrnNum(decision.probability) : null,
    first,
    implicit,
    y,
    latencyFirstH: firstOutcomeAt && sentKnown && item.sentAtSource !== 'imputed' ? Math.max(0, (firstOutcomeAt.getTime() - sentAt.getTime()) / 3_600_000) : null,
    firstOutcomeAt,
    outcomeAt: lrnDate(item.outcomeAt),
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
  // Ties broken by id: the same items in any order give the same dataset (and the same fit).
  return records.sort((a, b) => b.sentAt - a.sentAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
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
  if (key === 'slope') return r.rawLogit - LEARNING.SLOPE_CENTER
  const [kind, id] = key.split('.')
  if (kind === 'time') return r.timeGroup === id ? 1 : 0
  if (kind === 'disc') return (r.discW && r.discW[id]) || 0
  return 0
}
const lrnPriorSd = (key) => LEARNING.PRIOR_SD[key.split('.')[0]] || 0.35

/** p, dp/dz of one record at correction vector `theta` over `keys`. */
function lrnPoint(r, keys, theta) {
  const x = keys.map((key) => lrnFeature(key, r))
  const z = r.rawLogit + x.reduce((s, v, j) => s + v * theta[j], 0)
  const s = lrnSigma(z)
  return { x, p: lrnClip(r.k * (0.03 + 0.94 * s)), dp: r.k * 0.94 * s * (1 - s) }
}

/** Gradient and Fisher information of the weighted log posterior (priors N(0, sd²)), skipping record `skip`. */
function lrnScore(records, keys, theta, weights, skip = -1) {
  const m = keys.length
  const precision = keys.map((key) => 1 / lrnPriorSd(key) ** 2)
  const g = theta.map((t, j) => -precision[j] * t)
  const H = keys.map((_, i) => keys.map((__, j) => (i === j ? precision[i] : 0)))
  for (let idx = 0; idx < records.length; idx++) {
    const w = weights[idx]
    if (idx === skip || !(w > 0)) continue
    const r = records[idx]
    const { x, p, dp } = lrnPoint(r, keys, theta)
    const info = (dp * dp) / (p * (1 - p))
    const resid = ((r.y - p) / (p * (1 - p))) * dp
    for (let i = 0; i < m; i++) {
      if (x[i] === 0) continue
      g[i] += w * resid * x[i]
      for (let j = 0; j < m; j++) if (x[j] !== 0) H[i][j] += w * info * x[i] * x[j]
    }
  }
  return { g, H }
}

/**
 * MAP fit of  p = k · squash(rawLogit + Σ θ_j x_j)  with independent normal priors θ_j ~ N(0, sd_j²), by damped Fisher
 * scoring. Returns { theta: {key: value}, vector, cov, keys, iterations } (cov = inverse Fisher information).
 * `start` warm-starts (leave-one-out refits), `maxIter` caps the iterations, `skip` leaves one record out.
 */
export function fitCorrection(records, keys, weights, { start = null, maxIter = 60, skip = -1 } = {}) {
  const m = keys.length
  const theta = start ? [...start] : new Array(m).fill(0)
  let H = null
  let iterations = 0
  for (; iterations < maxIter; iterations++) {
    const step = lrnScore(records, keys, theta, weights, skip)
    H = step.H
    const delta = lrnSolve(H, step.g)
    if (!delta) break
    const biggest = Math.max(...delta.map(Math.abs))
    const scale = biggest > 1 ? 1 / biggest : 1 // damped steps: separable data must not explode
    for (let j = 0; j < m; j++) theta[j] += scale * delta[j]
    if (biggest < 1e-8) break
  }
  if (!H || iterations === maxIter) H = lrnScore(records, keys, theta, weights, skip).H
  return { theta: Object.fromEntries(keys.map((k, j) => [k, theta[j]])), vector: theta, cov: lrnInverse(H), keys, iterations }
}

/**
 * Leave-one-out log predictive density by one Newton step from the full fit, with the information matrix downdated by
 * Sherman–Morrison (θ₋ᵢ = θ̂ − rᵢ·H⁻¹xᵢ / (1 − cᵢ·xᵢᵀH⁻¹xᵢ)): O(n·m²), no pass over the data per left-out offer.
 * Returns the weighted pointwise values (Σ = elpd).
 */
function lrnLoo(records, keys, weights, full) {
  const m = keys.length
  const Hinv = m ? lrnInverse(lrnScore(records, keys, full, weights).H) : null
  return records.map((r, i) => {
    const w = weights[i]
    if (!(w > 0)) return 0
    let theta = full
    if (m && Hinv) {
      const { x, p, dp } = lrnPoint(r, keys, full)
      const c = (w * dp * dp) / (p * (1 - p))
      const resid = ((w * (r.y - p)) / (p * (1 - p))) * dp
      const u = Hinv.map((row) => row.reduce((acc, h, j) => acc + h * x[j], 0))
      const xu = u.reduce((acc, v, j) => acc + v * x[j], 0)
      const denom = 1 - c * xu
      theta = denom > 1e-6 ? full.map((t, j) => t - (resid * u[j]) / denom) : fitCorrection(records, keys, weights, { start: full, maxIter: 3, skip: i }).vector
    }
    const { p } = lrnPoint(r, keys, theta)
    return w * (r.y ? Math.log(p) : Math.log(1 - p))
  })
}

/** Gain of model B over model A in leave-one-out elpd, with its standard error (Vehtari 2017). */
const lrnGain = (a, b) => {
  const d = b.map((v, i) => v - a[i])
  const n = d.length
  const gain = d.reduce((s, x) => s + x, 0)
  const mean = n ? gain / n : 0
  const se = n > 1 ? Math.sqrt(n * (d.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1))) : Infinity
  return { gain, se, admitted: gain >= LEARNING.LADDER_MIN_ELPD_GAIN && gain >= se }
}

/** Predicted probability of record `r` under a profile (or the raw engine with profile = null). */
export function predictWith(profile, r) {
  if (!profile) return lrnClip(r.k * squash(r.rawLogit))
  const P = normalizeProfile(profile)
  const z = r.rawLogit + (P.slope - 1) * (r.rawLogit - LEARNING.SLOPE_CENTER) + P.intercept + (P.time[r.timeGroup] || 0) + discOffset(P, r.discountPct)
  return lrnClip(r.k * squash(z))
}

export const logLoss = (pairs) => (pairs.length ? -pairs.reduce((s, [p, y]) => s + (y ? Math.log(lrnClip(p)) : Math.log(1 - lrnClip(p))), 0) / pairs.length : null)
export const brierScore = (pairs) => (pairs.length ? pairs.reduce((s, [p, y]) => s + (p - y) ** 2, 0) / pairs.length : null)

/** Wilson 90% interval of k successes in n. */
const lrnWilson = (k, n, z = 1.645) => {
  if (!n) return [null, null]
  const p = k / n
  const d = 1 + (z * z) / n
  const c = (p + (z * z) / (2 * n)) / d
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d
  return [Math.max(0, c - h), Math.min(1, c + h)]
}

/**
 * Calibration of [p, y] pairs: log loss and Brier with standard errors, calibration-in-the-large (observed vs
 * expected, with z), Spiegelhalter's Z (no binning), and an equal-mass reliability table with Wilson intervals
 * (fixed-width bins overstate the error at small n). ECE is for display only.
 */
export function calibrationMetrics(pairs) {
  const n = pairs.length
  if (!n) return { n: 0, logLoss: null, logLossSe: null, brier: null, brierSe: null, observed: 0, expected: 0, oeRatio: null, oeZ: null, spiegelhalterZ: null, bins: [], ece: null }
  const ll = pairs.map(([p, y]) => -(y ? Math.log(lrnClip(p)) : Math.log(1 - lrnClip(p))))
  const br = pairs.map(([p, y]) => (p - y) ** 2)
  const se = (xs) => {
    const m = xs.reduce((s, x) => s + x, 0) / xs.length
    return xs.length > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1) / xs.length) : null
  }
  const O = pairs.reduce((s, [, y]) => s + y, 0)
  const E = pairs.reduce((s, [p]) => s + p, 0)
  const V = pairs.reduce((s, [p]) => s + p * (1 - p), 0)
  const sNum = pairs.reduce((s, [p, y]) => s + (y - p) * (1 - 2 * p), 0)
  const sDen = Math.sqrt(pairs.reduce((s, [p]) => s + (1 - 2 * p) ** 2 * p * (1 - p), 0))
  const k = n >= 2 ? clamp(Math.round(Math.cbrt(n)), 2, LEARNING.RELIABILITY_MAX_BINS) : 1
  const sorted = [...pairs].sort((a, b) => a[0] - b[0])
  const bins = []
  for (let b = 0; b < k; b++) {
    const chunk = sorted.slice(Math.round((b * n) / k), Math.round(((b + 1) * n) / k))
    if (!chunk.length) continue
    const hits = chunk.filter(([, y]) => y).length
    const [lo, hi] = lrnWilson(hits, chunk.length)
    bins.push({ from: chunk[0][0], to: chunk[chunk.length - 1][0], n: chunk.length, predicted: lrnMean(chunk.map(([p]) => p)), observed: hits / chunk.length, low: lo, high: hi })
  }
  return {
    n,
    logLoss: lrnMean(ll),
    logLossSe: se(ll),
    brier: lrnMean(br),
    brierSe: se(br),
    observed: O,
    expected: E,
    oeRatio: E > 0 ? O / E : null,
    oeZ: V > 0 ? (O - E) / Math.sqrt(V) : null,
    spiegelhalterZ: sDen > 0 ? sNum / sDen : null,
    bins,
    ece: bins.reduce((s, b) => s + (b.n / n) * Math.abs(b.predicted - b.observed), 0),
  }
}

/** First offers old enough for a verdict: a fixed horizon, so fast answers do not dominate the fit. */
const lrnMature = (r, now) => now.getTime() - r.sentAt.getTime() >= LEARNING.NO_REPLY_AFTER_DAYS * DAY_MS

/**
 * Fits the first-offer correction on every decided, mature first offer (weighted by recency), as a ladder where each
 * step must beat the simpler model by ≥ 1 nat and ≥ 1 se of leave-one-out log score (Vergouwe 2017):
 *   1. intercept: the general shift between the engine and this user's sellers;
 *      + slope, only with ≥ 40 weighted outcomes;
 *   2. time-group and discount-knot offsets on what stage 1 leaves unexplained, admitted as a family only with the
 *      same leave-one-out test, centred (weighted by data) so they express differences BETWEEN groups, and with the
 *      discount curve projected to stay monotone.
 * The covariance is the full joint inverse Fisher information at the final values.
 */
export function fitFirstOffers(records, now) {
  const decided = records.filter((r) => r.y != null && Number.isFinite(r.rawLogit) && lrnMature(r, now))
  const weights = decided.map((r) => recencyWeight(r.sentAt, now))
  const total = weights.reduce((s, w) => s + w, 0)
  const offsetKeys = [...LEARNING_TIME_GROUPS.map((g) => `time.${g.id}`), ...LEARNING_DISCOUNT_KNOTS.map((k) => `disc.${k.id}`)]
  const allKeys = ['intercept', 'slope', ...offsetKeys]
  const nEff = Object.fromEntries(allKeys.map((key) => [key, decided.reduce((s, r, i) => s + weights[i] * (key === 'intercept' || key === 'slope' ? 1 : lrnFeature(key, r)), 0)]))
  const empty = { theta: Object.fromEntries(allKeys.map((k) => [k, 0])), cov: null, keys: ['intercept'], nEff, n: 0, weightTotal: 0, decided, weights, ladder: { intercept: null, slope: null, offsets: null }, df: 0 }
  if (!decided.length) return empty

  // Stage 1: intercept, then the slope, each only if it earns its place against the simpler model.
  const base = fitCorrection(decided, ['intercept'], weights)
  const intercept = lrnGain(lrnLoo(decided, [], weights, []), lrnLoo(decided, ['intercept'], weights, base.vector))
  let stage1 = base
  let slope = null
  if (total >= LEARNING.MIN_EFFECTIVE.slope) {
    const withSlope = fitCorrection(decided, ['intercept', 'slope'], weights)
    slope = lrnGain(lrnLoo(decided, ['intercept'], weights, base.vector), lrnLoo(decided, ['intercept', 'slope'], weights, withSlope.vector))
    if (slope.admitted) stage1 = withSlope
  }
  const shiftOf = (r) => r.rawLogit + (stage1.theta.slope || 0) * (r.rawLogit - LEARNING.SLOPE_CENTER) + stage1.theta.intercept
  const shifted = decided.map((r) => ({ ...r, rawLogit: shiftOf(r) }))

  // Stage 2: offsets as a family, centred, monotone discount curve.
  const s2 = fitCorrection(shifted, offsetKeys, weights)
  const offsets = lrnGain(lrnLoo(shifted, [], weights, []), lrnLoo(shifted, offsetKeys, weights, s2.vector))
  const theta2 = { ...s2.theta }
  for (const prefix of ['time.', 'disc.']) {
    const ks = offsetKeys.filter((k) => k.startsWith(prefix) && nEff[k] > 0)
    const wsum = ks.reduce((acc, k) => acc + nEff[k], 0)
    if (!wsum) continue
    const mean = ks.reduce((acc, k) => acc + nEff[k] * theta2[k], 0) / wsum
    for (const k of ks) theta2[k] -= mean
  }
  const projected = monotoneDisc(Object.fromEntries(LEARNING_DISCOUNT_KNOTS.map((k) => [k.id, theta2[`disc.${k.id}`]])), 1 + (stage1.theta.slope || 0))
  for (const k of LEARNING_DISCOUNT_KNOTS) theta2[`disc.${k.id}`] = projected[k.id]

  const keys = [...stage1.keys, ...offsetKeys]
  const theta = { slope: 0, ...stage1.theta, ...theta2 }
  // Posterior sd for the evidence gate, from the stage that estimated each parameter: the joint matrix is right for
  // predictions (x'Σx) but its marginals are inflated by the intercept/offset collinearity the centring removes.
  const sd = {}
  stage1.keys.forEach((k, j) => { sd[k] = stage1.cov ? Math.sqrt(Math.max(0, stage1.cov[j][j])) : null })
  offsetKeys.forEach((k, j) => { sd[k] = s2.cov ? Math.sqrt(Math.max(0, s2.cov[j][j])) : null })
  const vector = keys.map((k) => theta[k])
  // Joint covariance at the final values (stage 1 and 2 together): honest intervals for the failure risk.
  const H = lrnScore(decided, keys, vector, weights).H
  const cov = lrnInverse(H)
  const df = cov ? keys.reduce((s, k, j) => s + (1 - cov[j][j] / lrnPriorSd(k) ** 2), 0) : 0
  return { theta, cov, sd, keys, nEff, n: decided.length, weightTotal: total, decided, weights, ladder: { intercept, slope, offsets }, df }
}

/**
 * One-parameter fit of the counter correction (time-group offsets taken from the current profile). Rounds of the same
 * negotiation are weighted 1/√m, replies need a fixed 4-day horizon unless their outcome is already known.
 */
export function fitCounters(records, now, timeOffsets = {}) {
  const rows = []
  for (const r of records) {
    const usable = r.rounds.filter((x) => x.replyAccepted != null && Number.isFinite(x.replyRawLogit)
      && (x.replyAccepted === true || !x.replyAt || now.getTime() - new Date(x.replyAt).getTime() >= LEARNING.COUNTER_NO_REPLY_AFTER_DAYS * DAY_MS || r.closed || r.lost))
    const m = usable.length
    for (const round of usable) {
      const at = lrnDate(round.replyAt) || r.sentAt
      rows.push({ y: round.replyAccepted ? 1 : 0, z: round.replyRawLogit + (timeOffsets[round.replyTimeGroup] || 0), k: round.replyPRead, w: recencyWeight(at, now) / Math.sqrt(m) })
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
  const expected = rows.reduce((s, row) => s + lrnClip(row.k * squash(row.z)), 0)
  return { theta: c, sd: Math.sqrt(1 / info), n: rows.length, nEff: rows.reduce((s, r) => s + r.w, 0), observed: rows.filter((r) => r.y).length, expected }
}

/** Kaplan–Meier survival S(t) = P(no answer yet after t hours) from [{ t, event }]. */
export function kaplanMeier(samples, hours = LEARNING.KM_HOURS) {
  const data = samples.filter((s) => Number.isFinite(s.t) && s.t >= 0).sort((a, b) => a.t - b.t)
  const times = [...new Set(data.filter((s) => s.event).map((s) => s.t))]
  let S = 1
  const curve = []
  for (const t of times) {
    const atRisk = data.filter((s) => s.t >= t).length
    const d = data.filter((s) => s.t === t && s.event).length
    if (atRisk > 0) S *= 1 - d / atRisk
    curve.push({ t, S })
  }
  const at = (h) => {
    let v = 1
    for (const c of curve) if (c.t <= h) v = c.S
    return v
  }
  const median = (curve.find((c) => c.S <= 0.5) || {}).t ?? null
  return { events: data.filter((s) => s.event).length, censored: data.filter((s) => !s.event).length, median, table: hours.map((h) => ({ hours: h, survival: at(h), atRisk: data.filter((s) => s.t >= h).length })) }
}

/**
 * What the user's sellers do with counters: the share of the gap they concede (posterior toward eBay's 0,42), how often
 * they hold, how much their counter sits above our offer, how many rounds deals take, and how fast they answer.
 */
export function counterAnalytics(records, now) {
  const rounds = []
  for (const r of records) {
    const m = r.rounds.length
    for (const x of r.rounds) rounds.push({ ...x, w: recencyWeight(lrnDate(x.receivedAt) || r.sentAt, now) / Math.sqrt(Math.max(1, m)), recordId: r.id, closed: r.closed })
  }
  const shares = rounds.filter((x) => Number.isFinite(x.sellerGapShare))
  const W0 = LEARNING.SELLER_SHARE_PRIOR_WEIGHT
  const wsum = shares.reduce((s, x) => s + x.w, 0)
  const posterior = (W0 * LEARNING.SELLER_SHARE_PRIOR + shares.reduce((s, x) => s + x.w * x.sellerGapShare, 0)) / (W0 + wsum)
  const shareSd = Math.sqrt(Math.max(1e-6, posterior * (1 - posterior)) / (W0 + wsum))
  const byRound = [1, 2, 3].map((idx) => {
    const xs = rounds.filter((x) => (idx < 3 ? x.index === idx : x.index >= 3)).map((x) => x.sellerRaisePct).filter(Number.isFinite).sort((a, b) => a - b)
    const q = (f) => (xs.length ? xs[Math.min(xs.length - 1, Math.floor(f * (xs.length - 1) + 0.5))] : null)
    return { round: idx, n: xs.length, mean: lrnMean(xs), median: lrnMedian(xs), q1: q(0.25), q3: q(0.75) }
  })
  const closed = records.filter((r) => r.closed)
  const roundsToClose = [0, 1, 2, 3].map((k) => ({ rounds: k, deals: closed.filter((r) => (k < 3 ? r.rounds.length === k : r.rounds.length >= 3)).length }))
  // Reply times from the seller's counters (the user says when each arrived); silences are censored. Acceptances and
  // refusals are left out: their only timestamp is when the user marked them, often hours later than the answer.
  const samples = []
  for (const r of records) {
    if (!r.sentKnown) continue
    if (r.first === 'no_reply' || r.implicit) samples.push({ t: LEARNING.NO_REPLY_AFTER_DAYS * 24, event: false })
    else if (r.pending && r.first == null) samples.push({ t: (now.getTime() - r.sentAt.getTime()) / 3_600_000, event: false })
  }
  for (const x of rounds) {
    if (x.latencyH != null) samples.push({ t: x.latencyH, event: true })
    if (x.replyAt && x.replyAccepted === false && x.replyImplicit) samples.push({ t: LEARNING.COUNTER_NO_REPLY_AFTER_DAYS * 24, event: false })
  }
  const latency = kaplanMeier(samples)
  return {
    rounds: rounds.length,
    shareN: shares.length,
    shareEff: wsum,
    shareObserved: shares.length ? lrnMean(shares.map((x) => x.sellerGapShare)) : null,
    sharePosterior: posterior,
    shareMultiplier: posterior / LEARNING.SELLER_SHARE_PRIOR,
    shareMultiplierSd: shareSd / LEARNING.SELLER_SHARE_PRIOR,
    holdRate: shares.length ? shares.filter((x) => x.sellerGapShare <= 0.02).length / shares.length : null,
    byRound,
    roundsToClose,
    latency,
  }
}

/**
 * Iso-acceptance starting discount: the deepest discount (grid of 0,5 points within the bounds) whose corrected
 * acceptance, averaged over the user's own items at their own moments, is still at least the plain engine's average
 * acceptance at the default −20%. Tougher sellers → a softer opener; more generous sellers → a deeper one; with no
 * correction exactly −20%. Monotone corrections make the search well defined.
 */
export function isoAcceptanceDiscount(records, profile, now) {
  const P = normalizeProfile(profile)
  const usable = records.filter((r) => r.y != null && r.input && r.listPrice > 0)
  const weights = usable.map((r) => recencyWeight(r.sentAt, now))
  const nEff = weights.reduce((s, w) => s + w, 0)
  if (!nEff) return { target: null, targetAcceptance: null, curve: [], nEff: 0, n: 0 }
  const z0At = (r, d) => scoreAt(withPrices(r.input, r.listPrice, Math.round(r.listPrice * (1 - d / 100) * 100) / 100), r.sentAt, r.daysWaited).logit
  const corrected = (r, d, z0) => r.k * squash(z0 + (P.slope - 1) * (z0 - LEARNING.SLOPE_CENTER) + P.intercept + (P.time[r.timeGroup] || 0) + discOffset(P, d))
  const d0 = LEARNING.DEFAULT_DISCOUNT_PCT
  const targetAcceptance = usable.reduce((s, r, i) => s + weights[i] * r.k * squash(z0At(r, d0)), 0) / nEff
  const [lo, hi] = LEARNING.BOUNDS.discountPct
  const curve = []
  let target = lo
  for (let d = lo; d <= hi + 1e-9; d += 0.5) {
    const a = usable.reduce((s, r, i) => s + weights[i] * corrected(r, d, z0At(r, d)), 0) / nEff
    curve.push({ discountPct: d, pAccept: a })
    if (a >= targetAcceptance - 1e-9) target = d
  }
  return { target, targetAcceptance, curve, nEff, n: usable.length }
}

/**
 * The default starting discount that maximises the expected saving share (of list price), averaged over the user's
 * own items, under the corrected engine:
 *   ES(d) = p(d)·d + (1 − p(d))·[q(d)·ρ·d − (1 − q(d))·LOSS]
 * p(d) = corrected acceptance at discount d (same item, same moment); q = share of failed first offers that still
 * closed; ρ = their saving relative to the first discount; both smoothed with priors (LEARNING). Grid of 0,5 points.
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
  for (let d = lo; d <= hi + 1e-9; d += 0.5) {
    const qd = q * (1 - 0.5 * clamp((d - rampFrom) / (rampTo - rampFrom), 0, 1))
    const share = d / 100
    let es = 0
    let pSum = 0
    usable.forEach((r, i) => {
      const price = Math.round(r.listPrice * (1 - share) * 100) / 100
      const input = withPrices(r.input, r.listPrice, price)
      const z0 = scoreAt(input, r.sentAt, r.daysWaited).logit
      const z = z0 + (P.slope - 1) * (z0 - LEARNING.SLOPE_CENTER) + P.intercept + (P.time[r.timeGroup] || 0) + discOffset(P, d)
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
  counterShare: 'Quanto scendono i tuoi venditori',
  sellerReplyHours: 'Tempo di risposta dei venditori',
  discountPct: 'Sconto di partenza suggerito',
}
export const paramLabel = (key) => {
  if (PARAM_LABELS[key]) return PARAM_LABELS[key]
  const [kind, id] = key.split('.')
  if (kind === 'time') return `Fascia: ${(LEARNING_TIME_GROUPS.find((g) => g.id === id) || { label: id }).label}`
  if (kind === 'disc') return `${(LEARNING_DISCOUNT_KNOTS.find((k) => k.id === id) || { label: id }).label}`
  return key
}
const SCALARS = new Set(['intercept', 'slope', 'counter', 'counterShare', 'sellerReplyHours', 'discountPct'])
const getParam = (P, key) => {
  if (SCALARS.has(key)) return P[key]
  const [kind, id] = key.split('.')
  return P[kind][id]
}
const setParam = (P, key, value) => {
  if (SCALARS.has(key)) P[key] = value
  else {
    const [kind, id] = key.split('.')
    P[kind] = { ...P[kind], [id]: value }
  }
}
/** Parameter family of a key (what a rollback freezes). */
const familyOf = (key) => ({ intercept: 'intercept', slope: 'slope', counter: 'counter', counterShare: 'share', sellerReplyHours: 'latency', discountPct: 'discount' })[key] || key.split('.')[0]

/**
 * Next month's profile.
 *  - Rollback: the prequential log Bayes factor of the active profile against its parent, summed over the months it
 *    was active, below −2 → the parent's values come back and the families that had changed are frozen for a month.
 *  - Each parameter then moves from its current value toward the fit's target only when it has enough weighted
 *    outcomes, its family passed the leave-one-out ladder, the gap exceeds half a posterior sd, by at most MAX_STEP,
 *    inside BOUNDS; tiny moves are skipped.
 * Returns { profile, changes: [{ key, label, from, to, target, nEff, minEffective, status, reason }], rollback, … }.
 */
export function proposeProfile({ previous, firstFit, counterFit = null, counterStats = null, records = [], month, now, lastMonthRecords = [] }) {
  const prev = normalizeProfile(previous)
  const parent = prev.parent ? normalizeProfile(prev.parent) : null
  const pairs = lastMonthRecords.filter((r) => r.y != null && Number.isFinite(r.rawLogit))
  const logBF = pairs.reduce((s, r) => {
    const pa = predictWith(prev, r)
    const pp = predictWith(parent, r)
    return s + (r.y ? Math.log(pa) - Math.log(pp) : Math.log(1 - pa) - Math.log(1 - pp))
  }, 0)
  const score = prev.score + logBF
  const rollback = profileIsActive(prev) && score < LEARNING.ROLLBACK_LOG_BF
  const frozen = Object.fromEntries(Object.entries(prev.frozen || {}).filter(([, until]) => until > month))
  if (rollback) for (const c of prev.changes || []) frozen[familyOf(c.key)] = shiftMonth(month, LEARNING.FREEZE_MONTHS)
  const start = rollback ? normalizeProfile({ ...prev, ...profileParams(parent || DEFAULT_PROFILE) }) : prev
  const next = normalizeProfile({ ...start, time: { ...start.time }, disc: { ...start.disc } })

  const changes = []
  // A rollback is a change of its own: every parameter that goes back to the parent's value is listed (and undoable).
  const rolledBack = new Set()
  if (rollback) {
    const keys = ['intercept', 'slope', ...LEARNING_TIME_GROUPS.map((g) => `time.${g.id}`), ...LEARNING_DISCOUNT_KNOTS.map((k) => `disc.${k.id}`), 'counter', 'counterShare', 'sellerReplyHours', 'discountPct']
    for (const key of keys) {
      // null reply time = the engine default (2 h): show the number, not «null».
      const orDefault = (v) => (key === 'sellerReplyHours' && v == null ? COUNTER.SELLER_REPLY_HOURS : v)
      const from = orDefault(getParam(prev, key))
      const to = orDefault(getParam(start, key))
      if (from === to || (from != null && to != null && Math.abs(from - to) < 1e-9)) continue
      rolledBack.add(key)
      changes.push({ key, label: paramLabel(key), from: from == null ? null : lrnR4(from), to: to == null ? null : lrnR4(to), target: null, nEff: null, minEffective: null, status: 'rollback', reason: 'Le correzioni in uso prevedevano peggio di quelle di prima (log Bayes factor sotto −2): torno al valore precedente.' })
    }
  }
  const sdOf = (key) => {
    if (firstFit.sd && firstFit.sd[key] != null) return firstFit.sd[key]
    const i = firstFit.keys.indexOf(key)
    return i >= 0 && firstFit.cov && firstFit.cov[i] ? Math.sqrt(Math.max(0, firstFit.cov[i][i])) : null
  }
  const consider = (key, target, nEff, kind, { sd = null, eligible = true, notEligible = '' } = {}) => {
    const from = getParam(next, key)
    const minEffective = LEARNING.MIN_EFFECTIVE[kind]
    const maxStep = kind === 'discount' ? LEARNING.MAX_STEP.discountPct : LEARNING.MAX_STEP[kind]
    const bounds = kind === 'discount' ? LEARNING.BOUNDS.discountPct : LEARNING.BOUNDS[kind]
    const minChange = kind === 'discount' ? LEARNING.MIN_CHANGE_DISCOUNT_PCT : LEARNING.MIN_CHANGE
    const base = { key, label: paramLabel(key), from: from == null ? null : lrnR4(from), target: target == null || !Number.isFinite(target) ? null : lrnR4(target), nEff: lrnR2(nEff || 0), minEffective }
    const keep = (status, reason) => changes.push({ ...base, to: base.from, status, reason })
    if (frozen[familyOf(key)]) return rolledBack.has(key) ? null : keep('frozen', `Bloccata fino a ${monthLabel(frozen[familyOf(key)])} dopo il ritorno ai valori precedenti.`)
    if ((nEff || 0) < minEffective) return keep('waiting_data', `Servono almeno ${minEffective} esiti pesati (ne hai ${String(lrnR2(nEff || 0)).replace('.', ',')}).`)
    if (!eligible) return keep('waiting_data', notEligible || 'Con questi dati non migliora le previsioni: resta com\'è.')
    if (target == null || !Number.isFinite(target)) return keep('waiting_data', 'Nessun esito utile.')
    if (kind === 'latency') {
      // Multiplicative: at most ×1,5 or ÷1,5 a month, from the engine default when nothing was learned yet.
      const current = from == null ? COUNTER.SELLER_REPLY_HOURS : from
      const wanted = clamp(target, bounds[0], bounds[1])
      const to = lrnR2(clamp(wanted, current / maxStep, current * maxStep))
      if (Math.abs(Math.log(to / current)) < 0.05) return keep('unchanged', 'Già allineato ai tuoi esiti.')
      setParam(next, key, to)
      const capped = Math.abs(to - wanted) > 0.01
      return changes.push({ ...base, from: lrnR2(current), to, status: capped ? 'capped' : 'applied', reason: capped ? 'Spostato del massimo consentito in un mese.' : 'Allineato ai tuoi esiti.' })
    }
    const wanted = clamp(target, bounds[0], bounds[1])
    if (sd != null && Math.abs(wanted - from) < LEARNING.EVIDENCE_GATE_SD * sd) return keep('unchanged', 'Differenza dentro il margine di incertezza: resta com\'è.')
    const step = clamp(wanted - from, -maxStep, maxStep)
    const to = kind === 'discount' ? Math.round((from + step) * 2) / 2 : lrnR4(from + step)
    if (Math.abs(to - from) < minChange) return keep('unchanged', 'Già allineato ai tuoi esiti.')
    setParam(next, key, to)
    const capped = Math.abs(wanted - from) > maxStep + 1e-9
    return changes.push({ ...base, to, status: capped ? 'capped' : 'applied', reason: capped ? 'Spostato del massimo consentito in un mese; il resto il mese prossimo se i dati lo confermano.' : 'Allineato ai tuoi esiti.' })
  }

  const ladder = firstFit.ladder || {}
  // Without a ladder verdict (hand-built fits) the intercept is judged by the gates alone.
  consider('intercept', firstFit.theta.intercept, firstFit.nEff.intercept, 'intercept', { sd: sdOf('intercept'), eligible: !ladder.intercept || ladder.intercept.admitted })
  consider('slope', firstFit.keys.includes('slope') ? 1 + firstFit.theta.slope : null, firstFit.nEff.slope ?? firstFit.weightTotal, 'slope', {
    sd: sdOf('slope'), eligible: Boolean(ladder.slope && ladder.slope.admitted), notEligible: 'Con questi dati non migliora le previsioni: resta com\'è.',
  })
  const offsetsOk = Boolean(ladder.offsets && ladder.offsets.admitted)
  for (const g of LEARNING_TIME_GROUPS) consider(`time.${g.id}`, firstFit.theta[`time.${g.id}`], firstFit.nEff[`time.${g.id}`], 'time', { sd: sdOf(`time.${g.id}`), eligible: offsetsOk })
  for (const k of LEARNING_DISCOUNT_KNOTS) consider(`disc.${k.id}`, firstFit.theta[`disc.${k.id}`], firstFit.nEff[`disc.${k.id}`], 'disc', { sd: sdOf(`disc.${k.id}`), eligible: offsetsOk })
  // Stepwise moves could bend the discount curve upward: project it back to monotone.
  next.disc = monotoneDisc(next.disc, next.slope)
  consider('counter', counterFit ? counterFit.theta : null, counterFit ? counterFit.nEff : 0, 'counter', { sd: counterFit ? counterFit.sd : null })
  consider('counterShare', counterStats ? counterStats.shareMultiplier : null, counterStats ? counterStats.shareEff : 0, 'share', { sd: counterStats ? counterStats.shareMultiplierSd : null })
  consider('sellerReplyHours', counterStats && counterStats.latency.median != null ? counterStats.latency.median : null, counterStats ? counterStats.latency.events : 0, 'latency')
  // Starting discount, with next month's corrections in place: the deepest discount at which these sellers still accept
  // as often as the plain engine expects at −20% (iso-acceptance). With an uncorrected engine it is exactly −20%.
  const iso = isoAcceptanceDiscount(records, next, now)
  consider('discountPct', iso.target, iso.nEff, 'discount')
  const discountFit = { ...optimalDiscount(records, next, now), iso, learnedTarget: iso.target }

  const moved = changes.filter((c) => c.status === 'applied' || c.status === 'capped' || c.status === 'rollback')
  const renewed = moved.length > 0 || rollback
  next.version = DEFAULT_PROFILE.version
  next.frozen = frozen
  if (renewed) {
    next.id = prev.id === month ? `${month}.2` : month
    next.parentId = prev.id
    next.parent = profileParams(prev)
    next.month = month
    next.createdAt = lrnIso(now)
    next.changes = moved
    next.score = 0
    next.scoreMonths = 0
  } else {
    next.id = prev.id
    next.parentId = prev.parentId
    next.parent = prev.parent
    next.changes = prev.changes
    next.score = score
    next.scoreMonths = prev.scoreMonths + (pairs.length ? 1 : 0)
  }
  next.basedOn = firstFit.n
  next.paramKeys = firstFit.keys
  next.cov = firstFit.cov ? firstFit.cov.map((row) => row.map(lrnR4)) : null
  return { profile: next, changes, rollback, logBF, score, discountFit }
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

const lrnUnit = (key, month, purpose) => (hashString(`${key}|${month}|${purpose}`) % 100000) / 100000

const lrnQuiet = (date) => {
  const m = minutesOfDay(date)
  return m >= 23 * 60 || m < 7 * 60
}

/** Expected saving share of an offer at acceptance p and discount d (%), with the prior continuation values. */
const lrnExpectedSaving = (p, discountPct) => {
  const d = discountPct / 100
  const q = LEARNING.CLOSE_AFTER_FAIL_PRIOR
  return p * d + (1 - p) * (q * LEARNING.CONTINUATION_RATIO_PRIOR * d - (1 - q) * LEARNING.LOSS_COST_SHARE)
}

/** One arm evaluated against every guard; null when it is not safe or not meaningful. */
function lrnTryArm(raw, base, arm, now, options) {
  let result
  let price = base.input.targetPrice
  let at
  if (arm.kind === 'time') {
    at = new Date(base.optimal.date.getTime() + arm.minutes * 60000)
    if (at.getTime() < now.getTime() + 10 * 60000) return null
    if (lrnQuiet(at)) return null
    result = analyzeOffer(raw, now, { ...options, exactSendAt: at, preferredSendAt: null })
    if (!result.ok || result.kind !== base.kind) return null
  } else {
    const L = base.input.listPrice
    const step = priceStepFor(L)
    const wantedPct = base.input.discountPct + arm.points
    if (wantedPct < 5 || wantedPct > VINTED.MAX_DISCOUNT_PCT - 0.01) return null
    price = Math.round(Math.round((L * (1 - wantedPct / 100)) / step) * step * 100) / 100
    // At least one price step in the arm's direction.
    if (arm.points > 0 && price > base.input.targetPrice - step + 1e-9) price = Math.round((base.input.targetPrice - step) * 100) / 100
    if (arm.points < 0 && price < base.input.targetPrice + step - 1e-9) price = Math.round((base.input.targetPrice + step) * 100) / 100
    if (!(price > 0) || price >= L || ((L - price) / L) * 100 > VINTED.MAX_DISCOUNT_PCT) return null
    result = analyzeOffer({ ...raw, targetPrice: String(price).replace('.', ',') }, now, { ...options, preferredSendAt: base.optimal.date })
    if (!result.ok || result.kind !== 'analysis') return null
    // On cheap listings one price step is several points: the user agreed to about ±2, so cap the real change.
    if (Math.abs(result.input.discountPct - base.input.discountPct) > LEARNING.EXPLORE_DISCOUNT_PTS + 1) return null
    at = result.optimal.date
    if (lrnQuiet(at) && !lrnQuiet(base.optimal.date)) return null
  }
  const cost = base.probability - result.probability
  const savingCost = lrnExpectedSaving(base.probability, base.input.discountPct) - lrnExpectedSaving(result.probability, result.input.discountPct)
  if (cost > LEARNING.EXPLORE_MAX_COST + 1e-9 || savingCost > LEARNING.EXPLORE_MAX_SAVING_COST + 1e-9) return null
  return { arm, result, cost, savingCost, price, at }
}

/** The month's exploration spend so far, from the decision snapshots of the saved offers. */
export function explorationBudget(items, month) {
  let baseTotal = 0
  let spent = 0
  for (const it of items || []) {
    const d = it && it.decision
    if (!d || monthKeyOf(d.at) !== month) continue
    const ex = d.exploration
    const pBase = ex && ex.base && Number.isFinite(ex.base.probability) ? ex.base.probability : d.probability
    if (Number.isFinite(pBase)) baseTotal += pBase
    if (ex && ex.base && Number.isFinite(d.probability)) spent += Math.max(0, ex.base.probability - d.probability)
  }
  return { baseTotal, spent }
}

/**
 * The offer's exploration, decided in two deterministic draws from its key and the month:
 *   1. explore with probability EXPLORE_SHARE (about 1 offer in 5);
 *   2. one arm drawn uniformly from the SAFE arms (cost ≤ 6 points of acceptance and ≤ 1% of list price in expected
 *      saving, no sending at night, at least 10 minutes away, within Vinted's cap, within the monthly budget).
 * The propensity ε/|safe| is logged so the report can weigh the arms fairly. Returns { result, exploration } or null.
 */
export function explorationPlan(raw, base, now, { key = null, month = null, enabled = true, options = {}, budget = null, share = LEARNING.EXPLORE_SHARE } = {}) {
  if (!enabled || !base || !base.ok || base.kind !== 'analysis' || !base.optimal) return null
  if (base.input.listPrice < LEARNING.EXPLORE_MIN_LIST_PRICE) return null
  const k = key || explorationKey(raw)
  const m = month || monthKeyOf(now)
  if (lrnUnit(k, m, 'explore') >= share) return null
  let safe = EXPLORATION_ARMS.map((arm) => lrnTryArm(raw, base, arm, now, options)).filter(Boolean)
  if (budget) {
    const allowed = LEARNING.EXPLORE_BUDGET_SHARE * ((budget.baseTotal || 0) + base.probability) - (budget.spent || 0)
    safe = safe.filter((s) => s.cost <= allowed + 1e-9)
  }
  if (!safe.length) return null
  const pick = safe[Math.min(safe.length - 1, Math.floor(lrnUnit(k, m, 'arm') * safe.length))]
  const pts = Math.round(Math.abs(pick.result.input.discountPct - base.input.discountPct) * 10) / 10
  const label = pick.arm.kind === 'discount'
    ? `${String(pts).replace('.', ',')} ${pts === 1 ? 'punto' : 'punti'} di sconto ${pick.arm.points > 0 ? 'in più' : 'in meno'}`
    : pick.arm.label
  const exploration = {
    arm: pick.arm.id,
    kind: pick.arm.kind,
    label,
    propensity: share / safe.length,
    safe: safe.map((s) => s.arm.id),
    base: { price: base.input.targetPrice, at: lrnIso(base.optimal.date), probability: base.probability },
    price: pick.price,
    at: lrnIso(pick.at),
    costPoints: Math.round(pick.cost * 100),
    savingCostPct: Math.round(pick.savingCost * 1000) / 10,
  }
  return { result: { ...pick.result, exploration }, exploration }
}

/* ───────── failure risk ───────── */

const lrnLevel = (pFail) => (pFail >= 0.6 ? 'high' : pFail >= 0.35 ? 'medium' : 'low')
const REASON_LABELS = { countered: 'Controproposta', declined: 'Rifiuto', no_reply: 'Nessuna risposta', sold_other: 'Venduto ad altri' }

/**
 * Probability that this offer fails even at the recommended moment and price, a 90% range, why (engine factors), how
 * failures split by kind (engine shares smoothed with the user's own mix) and the chance the negotiation still closes
 * (each kind of failure has its own chance of a deal later). `records` = buildDataset(...) (optional).
 */
export function failureRiskFor(result, { profile = null, records = null, now = null } = {}) {
  if (!result || !result.ok || !result.optimal || result.kind === 'no_offer_needed') return null
  const { optimal, input } = result
  const p = result.probability
  const A = optimal.pAvailable
  const R = optimal.pRead
  const z = optimal.score.logit
  let lo = result.probabilityRange ? result.probabilityRange[0] : p
  let hi = result.probabilityRange ? result.probabilityRange[1] : p
  const P = profile ? normalizeProfile(profile) : null
  let basis = 'engine'
  // «Calibrated» only when the FIRST-OFFER correction moved (counter-side changes do not touch this estimate).
  const firstOfferCorrected = P && (Math.abs(P.intercept) > 1e-9 || Math.abs(P.slope - 1) > 1e-9
    || Object.values(P.time).some((v) => Math.abs(v) > 1e-9) || Object.values(P.disc).some((v) => Math.abs(v) > 1e-9))
  if (firstOfferCorrected && P.basedOn >= LEARNING.MIN_EFFECTIVE.intercept && P.cov && Array.isArray(P.paramKeys) && P.cov.length === P.paramKeys.length) {
    const r = { rawLogit: optimal.score.rawLogit ?? z, timeGroup: timeGroupOf(optimal.score.timeWindow.id), discW: discKnotWeights(input.discountPct) }
    const x = P.paramKeys.map((key) => lrnFeature(key, r))
    let v = 0
    for (let i = 0; i < x.length; i++) for (let j = 0; j < x.length; j++) v += x[i] * (P.cov[i][j] || 0) * x[j]
    const sd = Math.sqrt(Math.max(0, v))
    lo = Math.min(lo, A * R * squash(z - 1.645 * sd))
    hi = Math.max(hi, A * R * squash(z + 1.645 * sd))
    basis = 'history'
  } else {
    // Without a calibrated profile the engine is unvalidated for this user's sellers: the range is the prior on the
    // general correction (sd 0,5 logit, 90%).
    const half = 1.645 * LEARNING.PRIOR_SD.intercept
    lo = Math.min(lo, A * R * squash(z - half))
    hi = Math.max(hi, A * R * squash(z + half))
  }
  const reasons = []
  const negatives = (result.factors && result.factors.rows ? result.factors.rows : []).filter((f) => f.deltaPoints < 0).sort((a, b) => a.deltaPoints - b.deltaPoints)
  if (input.discountPct >= 15) reasons.push({ id: 'discount', text: `Sconto ${prepArticleFor('di', input.discountPct)}${Math.round(input.discountPct)}%: parte ${prepArticleFor('da', result.factors.basePct)}${result.factors.basePct}% di accettazione` })
  for (const f of negatives.slice(0, 3)) reasons.push({ id: f.id, text: `${f.label}: ${formatPoints(f.deltaPoints)}` })
  if (A < 0.9) reasons.push({ id: 'available', text: `Può essere venduto ad altri prima: resta disponibile ${prepArticleFor('a', A * 100)}${Math.round(A * 100)}%` })
  if (R < 0.99) reasons.push({ id: 'read', text: `Venditore inattivo: legge l'offerta solo ${Math.round(R * 100) === 50 ? 'una volta su due' : `nel ${Math.round(R * 100)}% dei casi`}` })
  if (result.blockRisk && result.blockRisk.level !== 'low') reasons.push({ id: 'block', text: `Rischio di rifiuto secco ${result.blockRisk.label.toLowerCase()}` })

  // How a failure happens: engine shares for this offer, smoothed with the user's own mix of failed first offers.
  const pAccRead = squash(z)
  const raw = { sold_other: 1 - A, no_reply: A * (1 - R) + A * R * (1 - pAccRead) * LEARNING.REASON_PRIOR_SPLIT.no_reply, countered: A * R * (1 - pAccRead) * LEARNING.REASON_PRIOR_SPLIT.countered, declined: A * R * (1 - pAccRead) * LEARNING.REASON_PRIOR_SPLIT.declined }
  const rawSum = Object.values(raw).reduce((s, v) => s + v, 0) || 1
  const ref = now || (records && records.length ? new Date(Math.max(...records.map((r) => r.sentAt.getTime()))) : new Date(0))
  const failed = Array.isArray(records) ? records.filter((r) => r.y === 0 && r.first && REASON_LABELS[r.first]) : []
  const fw = failed.map((r) => recencyWeight(r.sentAt, ref))
  const W0 = LEARNING.REASON_PRIOR_WEIGHT
  const fwSum = fw.reduce((s, w) => s + w, 0)
  const mix = Object.keys(REASON_LABELS).map((id) => {
    const share = (W0 * (raw[id] / rawSum) + failed.reduce((s, r, i) => s + (r.first === id ? fw[i] : 0), 0)) / (W0 + fwSum)
    const done = failed.filter((r) => r.first === id && (r.closed || r.lost))
    const dw = done.map((r) => recencyWeight(r.sentAt, ref))
    const W1 = LEARNING.CLOSE_AFTER_REASON_WEIGHT
    const prior = LEARNING.CLOSE_AFTER_REASON_PRIOR[id]
    const closeAfter = (W1 * prior + done.reduce((s, r, i) => s + (r.closed ? dw[i] : 0), 0)) / (W1 + dw.reduce((s, w) => s + w, 0))
    return { id, label: REASON_LABELS[id], share, closeAfter }
  }).sort((a, b) => b.share - a.share)
  const rescue = mix.reduce((s, m) => s + m.share * m.closeAfter, 0)
  const pClose = p + (1 - p) * rescue

  let similar = null
  if (Array.isArray(records) && records.length) {
    const knot = discKnotOf(input.discountPct)
    const same = records.filter((r) => r.y != null && r.knot === knot)
    if (same.length >= 3) similar = { n: same.length, successes: same.filter((r) => r.y === 1).length, knot }
  }
  const pFail = 1 - p
  const plan = []
  if (pFail >= 0.35 && mix[0].id === 'countered') plan.push('Il fallimento più probabile è una controproposta: non accettarla subito, usa «Ha fatto una controproposta» per la tua mossa.')
  else if (pFail >= 0.35) plan.push('Se arriva una controproposta, non accettarla subito: usa «Ha fatto una controproposta» per la tua mossa.')
  if (pFail >= 0.5 && input.discountPct > 20) plan.push('Se rifiuta, riprova tra qualche giorno con 2–3 punti di sconto in meno.')
  if (R < 0.99) plan.push('Con un venditore inattivo scrivi prima un messaggio: l\'offerta da sola rischia di scadere senza risposta.')
  return {
    pSuccess: p,
    pFail,
    range: [Math.max(0, 1 - hi), Math.min(1, 1 - lo)],
    level: lrnLevel(pFail),
    basis,
    reasons: reasons.slice(0, 5),
    failureMix: mix,
    pClose,
    pCloseRange: [lo + (1 - lo) * rescue, hi + (1 - hi) * rescue],
    similar,
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
export function monthlyReport({ items, month, now, previous = null, profileHistory = [], explorationEnabled = true, applied = true }) {
  const records = buildDataset(items, now)
  const inMonth = records.filter((r) => r.month === month)
  const prev = normalizeProfile(previous)

  const firstFit = fitFirstOffers(records, now)
  const counterFit = fitCounters(records, now, prev.time)
  const counterStats = counterAnalytics(records, now)
  const proposal = proposeProfile({ previous: prev, firstFit, counterFit, counterStats, records, month, now, lastMonthRecords: inMonth })
  const next = proposal.profile
  const discountFit = proposal.discountFit

  // Negotiations sent in earlier months that moved this month (a counter, our reply, the outcome): reported again with
  // their current state, so no deal or counter falls between two monthly files.
  const inThisMonth = (d) => d && monthKeyOf(d) === month
  const touched = records.filter((r) => r.month < month && (inThisMonth(r.outcomeAt) || inThisMonth(r.firstOutcomeAt)
    || r.rounds.some((x) => inThisMonth(x.receivedAt) || inThisMonth(x.replyAt))))
  const roundsThisMonth = records.flatMap((r) => r.rounds.filter((x) => inThisMonth(x.receivedAt) || inThisMonth(x.replyAt) || (r.month === month && !x.receivedAt)).map((x) => ({ ...x, record: r })))
  const decided = inMonth.filter((r) => r.y != null)
  const pairsShown = decided.filter((r) => r.pShown != null).map((r) => [r.pShown, r.y])
  const pairsRaw = decided.filter((r) => Number.isFinite(r.rawLogit)).map((r) => [predictWith(null, r), r.y])
  const pairsNext = decided.filter((r) => Number.isFinite(r.rawLogit)).map((r) => [predictWith(next, r), r.y])
  const rounds = inMonth.flatMap((r) => r.rounds.map((round) => ({ ...round, record: r })))
  const replies = rounds.filter((x) => x.replyPrice != null)
  const closed = inMonth.filter((r) => r.closed)
  const lost = inMonth.filter((r) => r.lost)
  // Outcome counts on the same population as «Prime offerte con esito»: they add up to it.
  const count = (first) => decided.filter((r) => r.first === first).length

  const summary = {
    offersSent: inMonth.length,
    decidedFirst: decided.length,
    accepted: count('accepted') + count('bought'),
    countered: count('countered'),
    declined: count('declined'),
    noReply: count('no_reply'),
    noReplyImplicit: inMonth.filter((r) => r.implicit).length,
    soldOther: count('sold_other'),
    unknownStart: inMonth.filter((r) => !r.sentKnown).length,
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
    // Seller timestamps only (his counters): outcome taps measure the user, not the seller.
    medianLatencyH: lrnMedian(rounds.map((x) => x.latencyH).filter(Number.isFinite)),
    totalSavedEur: lrnR2(closed.reduce((s, r) => s + r.savingEur, 0)),
    avgSavingEur: closed.length ? lrnR2(lrnMean(closed.map((r) => r.savingEur))) : null,
    avgSavingPct: closed.length ? lrnMean(closed.map((r) => r.savingShare)) : null,
    avgFirstDiscountPct: inMonth.length ? lrnMean(inMonth.map((r) => r.discountPct)) / 100 : null,
    onTimeShare: inMonth.filter((r) => r.onTime != null).length ? inMonth.filter((r) => r.onTime).length / inMonth.filter((r) => r.onTime != null).length : null,
    explored: inMonth.filter((r) => r.exploration).length,
    // Reward per offer sent (share of list price): saving if closed, minus the cost of a lost item (research §4).
    rewardPerOffer: (closed.length + lost.length) ? (closed.reduce((s, r) => s + r.savingShare, 0) - lost.filter((r) => r.status !== 'abandoned').length * LEARNING.LOSS_COST_SHARE) / (closed.length + lost.length) : null,
  }

  const calibration = {
    shown: calibrationMetrics(pairsShown),
    engine: calibrationMetrics(pairsRaw),
    next: calibrationMetrics(pairsNext),
    allTime: {
      n: firstFit.n,
      engine: calibrationMetrics(firstFit.decided.map((r) => [predictWith(null, r), r.y])),
      next: calibrationMetrics(firstFit.decided.map((r) => [predictWith(next, r), r.y])),
    },
    df: firstFit.df,
    ladder: firstFit.ladder,
    logBF: proposal.logBF,
    score: proposal.score,
  }

  const byTimeGroup = groupStats(records, (r) => r.timeGroup, LEARNING_TIME_GROUPS, prev, next, 'time')
  const byKnot = groupStats(records, (r) => r.knot, LEARNING_DISCOUNT_KNOTS, prev, next, 'disc')
  const exploration = [{ id: 'none', label: 'Nessuna variante' }, ...EXPLORATION_ARMS].map((arm) => {
    const rs = records.filter((r) => r.y != null && Number.isFinite(r.rawLogit) && (arm.id === 'none' ? !r.exploration : r.exploration && r.exploration.arm === arm.id))
    const expected = rs.reduce((s, r) => s + predictWith(prev, r), 0)
    const successes = rs.filter((r) => r.y === 1).length
    const saving = rs.filter((r) => r.closed)
    return { id: arm.id, label: arm.label, n: rs.length, successes, expected: lrnR2(expected), oe: lrnR2(successes - expected), avgSavingPct: saving.length ? lrnMean(saving.map((r) => r.savingShare)) : null }
  })

  const notes = []
  if (!records.length) notes.push('Nessuna offerta inviata finora: segna «Inviata» e l\'esito di ogni offerta, il motore impara solo dai tuoi esiti.')
  else if (firstFit.n < LEARNING.MIN_EFFECTIVE.intercept) notes.push(`Esiti ancora pochi (${firstFit.n}): la probabilità della prima offerta resta quella di base finché non ne raccolgo almeno ${LEARNING.MIN_EFFECTIVE.intercept}.`)
  if (summary.pending) notes.push(`${summary.pending} ${summary.pending === 1 ? 'trattativa è ancora aperta' : 'trattative sono ancora aperte'}: gli esiti che arriveranno entrano nel calcolo del mese prossimo.`)
  const young = inMonth.filter((r) => r.y != null && !lrnMature(r, now)).length
  if (young) notes.push(`${young} ${young === 1 ? 'offerta inviata negli ultimi 7 giorni entra' : 'offerte inviate negli ultimi 7 giorni entrano'} nella correzione del mese prossimo (orizzonte fisso, per non contare solo le risposte veloci).`)
  if (summary.noReplyImplicit) notes.push(`${summary.noReplyImplicit} ${summary.noReplyImplicit === 1 ? 'offerta senza esito da oltre 7 giorni è contata' : 'offerte senza esito da oltre 7 giorni sono contate'} come «nessuna risposta».`)
  if (proposal.rollback) notes.push('Le correzioni in uso prevedevano peggio di quelle di prima: ho ripristinato i valori precedenti e li blocco per un mese.')
  if (!applied) notes.push('Correzioni solo proposte: questo report non modifica il motore (anteprima o mese recuperato).')
  if (!explorationEnabled) notes.push('Le varianti di test sono spente: il motore impara più lentamente sugli orari e sugli sconti.')

  return {
    month,
    label: monthLabel(month),
    generatedAt: lrnIso(now),
    engine: ENGINE_VERSION,
    summary,
    calibration,
    byTimeGroup,
    byKnot,
    exploration,
    discount: discountFit,
    counterFit,
    counterStats,
    firstFit: { keys: firstFit.keys, theta: firstFit.theta, nEff: firstFit.nEff, n: firstFit.n, ladder: firstFit.ladder, df: firstFit.df },
    changes: applied ? proposal.changes : proposal.changes.map((c) => (c.status === 'applied' || c.status === 'capped' || c.status === 'rollback' ? { ...c, status: 'proposed' } : c)),
    rollback: proposal.rollback,
    applied,
    previousProfile: prev,
    nextProfile: next,
    profileHistory,
    records,
    inMonth,
    touched,
    roundsThisMonth,
    notes,
    trend: monthlyTrend(records, applied && proposal.changes.some((c) => c.status === 'applied' || c.status === 'capped' || c.status === 'rollback') ? [...profileHistory, next] : profileHistory),
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
      changesApplied: applied && !applied.reverted && Array.isArray(applied.changes) ? applied.changes.length : 0,
    }
  })
}

/** Short text lines for the app's report card and the monthly notification. */
export function reportHeadline(report) {
  const s = report.summary
  const moved = report.changes.filter((c) => c.status === 'applied' || c.status === 'capped')
  const parts = [`${s.offersSent} ${s.offersSent === 1 ? 'offerta' : 'offerte'}`]
  if (s.closedDeals) parts.push(`${s.closedDeals} ${s.closedDeals === 1 ? 'affare' : 'affari'} (${formatEuro(s.totalSavedEur)} risparmiati)`)
  if (report.applied === false) {
    const proposed = report.changes.filter((c) => c.status === 'proposed').length
    parts.push(proposed ? `${proposed} ${proposed === 1 ? 'correzione proposta' : 'correzioni proposte'} (motore non modificato)` : 'motore non modificato')
  } else parts.push(report.rollback ? 'tornato alle correzioni precedenti' : moved.length ? `${moved.length} ${moved.length === 1 ? 'correzione applicata' : 'correzioni applicate'}` : 'motore invariato')
  return parts.join(' · ')
}

/* ───────── workbook ───────── */

const pctOrNull = (x) => (x == null || !Number.isFinite(x) ? null : x)
const yesNo = (b) => (b == null ? '' : b ? 'Sì' : 'No')
/** A value with an explicit cell format (the writer reads { value, format } objects). */
const lrnTyped = (value, format) => (value == null || format == null || format === 'text' ? value : { value, format })
const num4 = (x) => (x == null || !Number.isFinite(x) ? null : lrnR4(x))
const pm = (v, se) => (v == null ? null : `${String(lrnR4(v)).replace('.', ',')}${se != null ? ` ± ${String(lrnR4(se)).replace('.', ',')}` : ''}`)
const STATUS_LABELS = { applied: 'Applicata', capped: 'Applicata (limitata)', unchanged: 'Invariata', waiting_data: 'In attesa di dati', frozen: 'Bloccata', rollback: 'Tornata al valore precedente', proposed: 'Proposta, non applicata' }
const SENT_SOURCE_LABELS = { tap: 'toccato «Inviata»', imputed: 'stimato', unknown: 'sconosciuto' }

/** The month's .xlsx: summary, offers, negotiations, counter analysis, time and discount groups, calibration, tests, engine changes, trend, notes. */
export function reportWorkbook(report) {
  const s = report.summary
  const c = report.calibration
  const cs = report.counterStats
  const summaryRows = [
    ['Offerte inviate nel mese', s.offersSent, 'int'],
    ['Prime offerte con esito', s.decidedFirst, 'int'],
    ['Accettate subito', s.accepted, 'int'],
    ['Controproposte ricevute alla prima offerta', s.countered, 'int'],
    ['Rifiutate', s.declined, 'int'],
    ['Nessuna risposta', s.noReply, 'int'],
    ['   di cui presunte (7 giorni senza notizie)', s.noReplyImplicit, 'int'],
    ['Vendute ad altri', s.soldOther, 'int'],
    ['Trattative iniziate dalla controproposta (orario della prima offerta sconosciuto)', s.unknownStart, 'int'],
    ['Trattative ancora aperte', s.pending, 'int'],
    ['Affari conclusi', s.closedDeals, 'int'],
    ['Affari persi', s.lostDeals, 'int'],
    ['Tasso di chiusura (conclusi / decisi)', pctOrNull(s.closeRate), 'pct'],
    ['Accettazione reale della prima offerta', pctOrNull(s.firstAcceptRate), 'pct'],
    ['Accettazione stimata dal motore', pctOrNull(s.predictedFirstAccept), 'pct'],
    ['Quota di prime offerte con controproposta', pctOrNull(s.counterRate), 'pct'],
    ['Controproposte del venditore (tutti i giri)', s.sellerCounters, 'int'],
    ['Salita media della controproposta sulla tua offerta', pctOrNull(s.avgSellerRaisePct == null ? null : s.avgSellerRaisePct / 100), 'pct'],
    ['Quota media della distanza concessa dal venditore', pctOrNull(s.avgSellerGapShare), 'pct'],
    ['Tue controproposte inviate', s.ourCounters, 'int'],
    ['Tue controproposte accettate', s.ourCountersAccepted, 'int'],
    ['Tua salita media nelle controproposte', pctOrNull(s.avgOurRaisePct == null ? null : s.avgOurRaisePct / 100), 'pct'],
    ['Giri medi di controproposta negli affari conclusi', s.avgRoundsClosed == null ? null : lrnR2(s.avgRoundsClosed), 'num'],
    ['Tempo mediano della controproposta del venditore (ore)', s.medianLatencyH == null ? null : lrnR2(s.medianLatencyH), 'num'],
    ['Trattative dei mesi precedenti aggiornate in questo mese', report.touched ? report.touched.length : 0, 'int'],
    ['Sconto medio della prima offerta', pctOrNull(s.avgFirstDiscountPct), 'pct'],
    ['Risparmio medio sugli affari conclusi', pctOrNull(s.avgSavingPct), 'pct'],
    ['Risparmio medio per affare', s.avgSavingEur, 'eur'],
    ['Risparmio totale', s.totalSavedEur, 'eur'],
    ['Resa per offerta (risparmio − costo degli affari persi, % del listino)', pctOrNull(s.rewardPerOffer), 'pct'],
    ['Offerte inviate in orario (±60 min)', pctOrNull(s.onTimeShare), 'pct'],
    ['Offerte con variante di test', s.explored, 'int'],
    ['Errore delle stime (Brier, più basso è meglio)', num4(c.shown.brier), 'num'],
    ['Errore delle stime con le nuove correzioni (Brier)', num4(c.next.brier), 'num'],
  ]
  const offerColumns = [
    { header: 'Articolo', width: 34 }, { header: 'Mese di invio', width: 14 }, { header: 'Categoria', width: 14 }, { header: 'Listino', format: 'eur' }, { header: 'Prima offerta', format: 'eur' },
    { header: 'Sconto', format: 'pct' }, { header: 'Inviata', format: 'datetime', width: 17 }, { header: 'Orario di invio', width: 18 }, { header: 'Consigliata', format: 'datetime', width: 17 },
    { header: 'Scarto (min)', format: 'int' }, { header: 'Giorno', width: 11 }, { header: 'Fascia', width: 30 }, { header: 'Stima mostrata', format: 'pct' },
    { header: 'Stima motore oggi', format: 'pct' }, { header: 'Stima corretta', format: 'pct' }, { header: 'Prima risposta', width: 18 }, { header: 'Ore alla controproposta', format: 'num' },
    { header: 'Controproposte', format: 'int' }, { header: 'Prima controproposta', format: 'eur' }, { header: 'Salita controproposta', format: 'pct' },
    { header: 'Prezzo finale', format: 'eur' }, { header: 'Risparmio', format: 'eur' }, { header: 'Risparmio %', format: 'pct' }, { header: 'Esito', width: 30 },
    { header: 'Variante di test', width: 26 }, { header: 'Propensione', format: 'pct' }, { header: 'Venditore', width: 12 }, { header: 'Link', width: 40 },
  ]
  // Send time, weekday and window only when the send time is known (not the seller's counter time); its source is said.
  const offerRow = (r) => {
    const firstRound = r.rounds[0]
    const group = LEARNING_TIME_GROUPS.find((g) => g.id === r.timeGroup)
    return [
      r.title || 'Senza titolo', monthLabel(r.month), r.category, r.listPrice, r.price, r.discountPct / 100, r.sentKnown ? r.sentAt : null, SENT_SOURCE_LABELS[r.sentAtSource] || r.sentAtSource,
      r.recommendedAt, r.delayMinutes, r.sentKnown ? WEEKDAYS_IT[r.weekday] : null, r.sentKnown ? (group ? group.label : r.timeGroup) : null,
      r.pShown, Number.isFinite(r.rawLogit) ? predictWith(null, r) : null, Number.isFinite(r.rawLogit) ? predictWith(report.nextProfile, r) : null,
      r.first ? `${OUTCOME_LABELS[r.first] || r.first}${r.implicit ? ' (presunta)' : ''}` : 'In attesa', r.first === 'countered' && r.latencyFirstH != null ? lrnR2(r.latencyFirstH) : null,
      r.rounds.length, firstRound ? firstRound.sellerPrice : null, firstRound && Number.isFinite(firstRound.sellerRaisePct) ? firstRound.sellerRaisePct / 100 : null,
      r.finalPrice, r.savingEur, r.savingShare, finalLabel(r), r.exploration ? r.exploration.label : '', r.exploration && Number.isFinite(r.exploration.propensity) ? r.exploration.propensity : null, r.sellerProfile, r.link,
    ]
  }
  const g = lrnDate(report.generatedAt) || new Date(0)
  const kmEmpty = !cs.latency.events && !cs.latency.censored
  const sheets = [
    {
      name: 'Riepilogo',
      title: `Offerte Vinted · ${report.label}`,
      note: `Generato il ${pad2(g.getDate())}/${pad2(g.getMonth() + 1)}/${g.getFullYear()} · motore ${report.engine} · ${reportHeadline(report)}`,
      columns: [{ header: 'Voce', width: 64 }, { header: 'Valore', width: 18 }],
      rows: summaryRows.map((r) => [r[0], lrnTyped(r[1], r[2])]),
      filter: false,
    },
    {
      name: 'Offerte',
      columns: offerColumns,
      rows: report.inMonth.map(offerRow),
    },
    {
      name: 'Aggiornamenti',
      title: 'Trattative dei mesi precedenti aggiornate in questo mese',
      note: 'Offerte inviate prima di questo mese che hanno avuto una controproposta, una tua risposta o un esito in questo mese, con lo stato attuale.',
      columns: offerColumns,
      rows: (report.touched || []).map(offerRow),
    },
    {
      name: 'Trattative',
      columns: [
        { header: 'Articolo', width: 34 }, { header: 'Giro', format: 'int' }, { header: 'Tua offerta', format: 'eur' }, { header: 'Sua controproposta', format: 'eur' },
        { header: 'Salita sulla tua offerta', format: 'pct' }, { header: 'Distanza concessa', format: 'pct' }, { header: 'Ore alla sua risposta', format: 'num' },
        { header: 'Ricevuta', format: 'datetime', width: 17 }, { header: 'Tua risposta', format: 'eur' }, { header: 'Tua salita', format: 'pct' }, { header: 'Quota della distanza', format: 'pct' },
        { header: 'Metà strada', width: 12 }, { header: 'Ultima offerta', width: 14 }, { header: 'Stima accettazione', format: 'pct' }, { header: 'Accettata', width: 22 }, { header: 'Inviata', format: 'datetime', width: 17 },
      ],
      // Rounds that happened this month, whatever the month the offer was sent.
      rows: (report.roundsThisMonth || []).map(({ record: r, ...x }) => [
        r.title || 'Senza titolo', x.index, x.buyerPrice, x.sellerPrice, Number.isFinite(x.sellerRaisePct) ? x.sellerRaisePct / 100 : null, x.sellerGapShare, x.latencyH == null ? null : lrnR2(x.latencyH),
        x.receivedAt ? new Date(x.receivedAt) : null, x.replyPrice, Number.isFinite(x.replyRaisePct) ? x.replyRaisePct / 100 : null, x.replyGapShare, yesNo(x.replyIsSplit), yesNo(x.replyIsFinal),
        x.replyPAccept, x.replyAccepted == null ? (x.replyPrice == null ? '' : 'In attesa') : x.replyAccepted ? 'Sì' : x.replyImplicit ? 'No (nessuna risposta)' : 'No', x.replyAt ? new Date(x.replyAt) : null,
      ]),
    },
    {
      name: 'Controproposte',
      filter: false,
      title: 'Come rispondono i tuoi venditori',
      note: 'Tutto lo storico, i mesi vecchi pesano meno e i giri della stessa trattativa contano meno di trattative diverse.',
      columns: [{ header: 'Voce', width: 56 }, { header: 'Valore', width: 16 }, { header: 'Dettaglio', width: 16 }, { header: 'Dettaglio 2', width: 16 }, { header: 'Dettaglio 3', width: 16 }],
      rows: [
        ['Controproposte del venditore analizzate', lrnTyped(cs.rounds, 'int')],
        ['Quota media della distanza concessa (osservata)', lrnTyped(cs.shareObserved, 'pct')],
        ['Quota stimata per i tuoi venditori (verso lo 0,42 di eBay)', lrnTyped(cs.sharePosterior, 'pct')],
        ['Moltiplicatore usato dal motore: prima → dopo', lrnTyped(report.previousProfile.counterShare, 'num'), lrnTyped(report.nextProfile.counterShare, 'num')],
        ['Venditori fermi sul prezzo (quota ≤ 2%)', lrnTyped(cs.holdRate, 'pct')],
        ['Tue controproposte: accettate / attese dal motore', lrnTyped(report.counterFit.observed, 'int'), lrnTyped(lrnR2(report.counterFit.expected), 'num')],
        [],
        ['Salita della sua controproposta sulla tua offerta', 'Casi', 'Media', 'Mediana', 'Q1 – Q3'],
        ...cs.byRound.map((b) => [b.round < 3 ? `Giro ${b.round}` : 'Giro 3 e oltre', lrnTyped(b.n, 'int'), lrnTyped(b.mean == null ? null : b.mean / 100, 'pct'), lrnTyped(b.median == null ? null : b.median / 100, 'pct'),
          b.q1 == null ? null : `${Math.round(b.q1)}% – ${Math.round(b.q3)}%`]),
        [],
        ['Affari conclusi per numero di giri', 'Affari'],
        ...cs.roundsToClose.map((x) => [x.rounds < 3 ? `${x.rounds} ${x.rounds === 1 ? 'giro' : 'giri'} di controproposta` : '3 giri o più', lrnTyped(x.deals, 'int')]),
        [],
        ['Tempo di risposta con una controproposta (Kaplan–Meier; i silenzi contano come attese)', 'Ancora senza risposta', 'Offerte in attesa'],
        ...cs.latency.table.map((t) => [`Dopo ${t.hours} ${t.hours === 1 ? 'ora' : 'ore'}`, kmEmpty ? 'nessun dato' : lrnTyped(t.survival, 'pct'), lrnTyped(t.atRisk, 'int')]),
        ['Mediana (ore)', kmEmpty ? 'nessun dato' : cs.latency.median == null ? 'oltre il periodo osservato' : lrnTyped(lrnR2(cs.latency.median), 'num')],
        ['Risposte osservate / silenzi', lrnTyped(cs.latency.events, 'int'), lrnTyped(cs.latency.censored, 'int')],
        ['Ore di attesa usate dal motore: prima → dopo', lrnTyped(report.previousProfile.sellerReplyHours ?? COUNTER.SELLER_REPLY_HOURS, 'num'), lrnTyped(report.nextProfile.sellerReplyHours ?? COUNTER.SELLER_REPLY_HOURS, 'num')],
      ],
    },
    {
      name: 'Fasce orarie',
      title: 'Fasce orarie',
      filterRows: report.byTimeGroup.length,
      note: 'Tutto lo storico, i mesi vecchi pesano meno. Osservate − attese > 0: la fascia rende più di quanto il motore stimava.',
      columns: [{ header: 'Fascia', width: 44 }, { header: 'Prime offerte', format: 'int' }, { header: 'Accettate', format: 'int' }, { header: 'Attese', format: 'num' }, { header: 'Osservate − attese', format: 'num' },
        { header: 'Tasso reale', format: 'pct' }, { header: 'Tasso stimato', format: 'pct' }, { header: 'Correzione prima', format: 'num' }, { header: 'Correzione ora', format: 'num' }],
      rows: report.byTimeGroup.map((g) => [g.label, g.n, g.successes, g.expected, g.oe, g.observedRate, g.expectedRate, num4(g.before), num4(g.after)]),
    },
    {
      name: 'Sconti',
      title: 'Sconti e sconto di partenza',
      filterRows: report.byKnot.length,
      note: `Tutto lo storico, i mesi vecchi pesano meno. Sconto di partenza: ${report.previousProfile.discountPct}% → ${report.nextProfile.discountPct}%: lo sconto più profondo al quale i tuoi venditori accettano ancora quanto il motore prevede al −20% (${report.discount.iso && report.discount.iso.targetAcceptance != null ? `${Math.round(report.discount.iso.targetAcceptance * 100)}%` : 'nessun dato'}). Il risparmio atteso è solo indicativo: probabilità × sconto + (1 − probabilità) × (affari chiusi dopo un primo no: ${Math.round(report.discount.closeAfterFail * 100)}%, con il ${Math.round(report.discount.continuationRatio * 100)}% del risparmio iniziale; un affare perso costa il ${Math.round(LEARNING.LOSS_COST_SHARE * 100)}%).`,
      columns: [{ header: 'Voce', width: 28 }, { header: 'Prime offerte', format: 'int' }, { header: 'Accettate', format: 'int' }, { header: 'Attese', format: 'num' }, { header: 'Osservate − attese', format: 'num' },
        { header: 'Correzione prima', format: 'num' }, { header: 'Correzione ora', format: 'num' }],
      rows: [
        ...report.byKnot.map((b) => [b.label, b.n, b.successes, b.expected, b.oe, num4(b.before), num4(b.after)]),
        [],
        ['Sconto di partenza', 'Accettazione stimata', 'Risparmio atteso'],
        ...report.discount.curve.filter((p) => Number.isInteger(p.discountPct)).map((p) => [`${p.discountPct}%`, lrnTyped(p.pAccept, 'pct'), lrnTyped(p.expectedSavingShare, 'pct')]),
      ],
    },
    {
      name: 'Calibrazione',
      title: 'Quanto sono affidabili le stime',
      filterRows: c.shown.bins.length,
      note: 'Offerte del mese ordinate per stima e divise in gruppi di pari numerosità: stima media contro accettate davvero, con l\'intervallo al 90%.',
      columns: [{ header: 'Stima da', format: 'pct' }, { header: 'Stima a', format: 'pct' }, { header: 'Offerte', format: 'int' }, { header: 'Stima media', format: 'pct' },
        { header: 'Accettate davvero', format: 'pct' }, { header: 'Intervallo 90% da', format: 'pct' }, { header: 'Intervallo 90% a', format: 'pct' }],
      rows: [
        ...c.shown.bins.map((b) => [b.from, b.to, b.n, b.predicted, b.observed, b.low, b.high]),
        [],
        ['Indicatore', null, null, 'Valore'],
        ['Accettate / attese (mese)', null, null, c.shown.oeRatio == null ? null : `${c.shown.observed} / ${String(lrnR2(c.shown.expected)).replace('.', ',')}`],
        ['Scarto standardizzato (O − A), |z| > 2 = scarto reale', null, null, lrnTyped(num4(c.shown.oeZ), 'num')],
        ['Z di Spiegelhalter (|Z| > 2 = stime non calibrate)', null, null, lrnTyped(num4(c.shown.spiegelhalterZ), 'num')],
        ['Log loss stime mostrate (più basso è meglio)', null, null, pm(c.shown.logLoss, c.shown.logLossSe)],
        ['Log loss motore di base', null, null, pm(c.engine.logLoss, c.engine.logLossSe)],
        ['Log loss con le nuove correzioni', null, null, pm(c.next.logLoss, c.next.logLossSe)],
        ['Brier stime mostrate', null, null, pm(c.shown.brier, c.shown.brierSe)],
        ['Tutto lo storico: offerte con esito', null, null, lrnTyped(c.allTime.n, 'int')],
        ['Tutto lo storico: log loss base → corretto', null, null, c.allTime.engine.logLoss == null ? null : `${String(lrnR4(c.allTime.engine.logLoss)).replace('.', ',')} → ${String(lrnR4(c.allTime.next.logLoss)).replace('.', ',')}`],
        ['Correzioni effettivamente stimate (gradi di libertà)', null, null, lrnTyped(num4(c.df), 'num')],
        ['Correzione generale: guadagno leave-one-out (nat, serve ≥ 1)', null, null, c.ladder && c.ladder.intercept ? pm(c.ladder.intercept.gain, c.ladder.intercept.se) : null],
        ['Pendenza: guadagno leave-one-out (nat)', null, null, c.ladder && c.ladder.slope ? pm(c.ladder.slope.gain, c.ladder.slope.se) : 'non valutata (meno di 40 esiti)'],
        ['Fasce e sconti: guadagno leave-one-out (nat)', null, null, c.ladder && c.ladder.offsets ? pm(c.ladder.offsets.gain, c.ladder.offsets.se) : null],
        ['Correzioni in uso contro le precedenti (log Bayes factor)', null, null, lrnTyped(num4(c.score), 'num')],
      ],
    },
    {
      name: 'Varianti di test',
      title: 'Varianti di test (1 offerta su 5)',
      note: 'Tutto lo storico. Osservate − attese confronta ogni variante con la stima del motore per le stesse offerte. Con poche offerte è solo un indizio: le varianti servono a coprire fasce e sconti poco provati.',
      columns: [{ header: 'Variante', width: 36 }, { header: 'Prime offerte', format: 'int' }, { header: 'Accettate', format: 'int' }, { header: 'Attese', format: 'num' }, { header: 'Osservate − attese', format: 'num' }, { header: 'Risparmio medio', format: 'pct' }],
      rows: report.exploration.map((a) => [a.label, a.n, a.successes, a.expected, a.oe, a.avgSavingPct]),
    },
    {
      name: 'Modifiche motore',
      title: report.applied === false ? 'Correzioni proposte (non applicate)' : `Correzioni per ${monthLabel(shiftMonth(report.month, 1))}`,
      note: report.applied === false
        ? 'Anteprima o mese recuperato: il motore non è stato modificato. Le correzioni valgono solo nel report dell\'ultimo mese chiuso.'
        : report.rollback ? 'Ritorno ai valori precedenti: le correzioni in uso prevedevano peggio. Le famiglie toccate restano bloccate per un mese.' : 'Ogni valore si muove solo con abbastanza esiti, oltre il margine di incertezza e al massimo di un passo al mese.',
      columns: [{ header: 'Parametro', width: 46 }, { header: 'Prima', format: 'num' }, { header: 'Dopo', format: 'num' }, { header: 'Obiettivo dai dati', format: 'num' }, { header: 'Esiti pesati', format: 'num' },
        { header: 'Minimo richiesto', format: 'int' }, { header: 'Stato', width: 18 }, { header: 'Motivo', width: 64 }],
      rows: report.changes.map((x) => [x.label, x.from, x.to, x.target, x.nEff, x.minEffective, STATUS_LABELS[x.status] || x.status, x.reason]),
    },
    {
      name: 'Andamento',
      title: 'Mese dopo mese',
      columns: [{ header: 'Mese', width: 16 }, { header: 'Offerte', format: 'int' }, { header: 'Accettazione reale', format: 'pct' }, { header: 'Stimata', format: 'pct' }, { header: 'Conclusi', format: 'int' },
        { header: 'Persi', format: 'int' }, { header: 'Tasso di chiusura', format: 'pct' }, { header: 'Risparmio medio', format: 'pct' }, { header: 'Risparmio totale', format: 'eur' }, { header: 'Correzioni decise a fine mese (in vigore dal mese dopo)', format: 'int', width: 24 }],
      rows: report.trend.map((t) => [t.label, t.offers, t.firstAcceptRate, t.predicted, t.closed, t.lost, t.closeRate, t.avgSavingPct, t.totalSavedEur, t.changesApplied]),
    },
    {
      name: 'Note',
      columns: [{ header: 'Nota', width: 120 }],
      rows: report.notes.length ? report.notes.map((n) => [n]) : [['Nessuna nota.']],
    },
  ]
  return buildXlsx(sheets, { title: `Offerte Vinted ${report.label}`, creator: 'Offerta Vinted Timing', date: lrnDate(report.generatedAt) || new Date(0) })
}

export const reportFileName = (report) => `Offerte-Vinted-${report.month}.xlsx`
