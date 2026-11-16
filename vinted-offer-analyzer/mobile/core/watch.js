/**
 * The two modes that work beside the manual one (1.14), as pure rules:
 *
 * - «caccia» (semi-automatic): a search page is read again and again for HUNT_HOURS; the articles within the user's
 *   highest price (plus a tolerance for the really good ones) are ranked, an exceptional one is told at once, and at
 *   the end the best is proposed — the user sends heart, message and offer with one tap, never the app by itself;
 * - «vetrina» (automatic): the user's Vinted home is read again for FEED_HOURS and what passed there is ranked.
 *
 * The page is read again after a time drawn anew each time between REFRESH_MIN_S and REFRESH_MAX_S (the user's rule:
 * any minute and second from 8:00 to 12:00). Nothing here imitates a person or works around a check: when Vinted
 * asks for a verification the job stops and says so.
 *
 *   nextRefreshDelayMs(random)          → milliseconds until the next reading
 *   toleranceFor(signals)               → 0 | 10 | 15 (% above the highest price)
 *   findFromCard(card, origin)          → what a card says of an article
 *   mergeFinds(finds, cards, { at })    → { finds, fresh } (one entry per article, price drops kept)
 *   rankFinds(finds, job)               → the list as shown, best first
 *   jobEndsAt(job) · jobActive(job, now)
 */
import { cardFactsOf, cardPriceOf, conditionBandOf } from './productMarket.js'

export const WATCH = Object.freeze({
  REFRESH_MIN_S: 8 * 60,
  REFRESH_MAX_S: 12 * 60,
  FEED_HOURS: 8,
  HUNT_HOURS: 24,
  /** At or below this share of the highest price an article is told at once, without waiting for the end. */
  EXCEPTIONAL_SHARE: 0.7,
  MAX_FINDS: 300,
  /** Really good: two of the four signals let the price rise 10%, three or more 15% (the user's rule). */
  TOLERANCE_TWO: 10,
  TOLERANCE_THREE: 15,
})

const wtR2 = (v) => Math.round(v * 100) / 100
const wtFinite = (v) => typeof v === 'number' && Number.isFinite(v)

/** The wait before the next reading: a whole number of seconds drawn between 8:00 and 12:00, anew each time. */
export function nextRefreshDelayMs(random = Math.random) {
  const span = WATCH.REFRESH_MAX_S - WATCH.REFRESH_MIN_S + 1
  const r = Number(random())
  return (WATCH.REFRESH_MIN_S + Math.min(span - 1, Math.max(0, Math.floor((Number.isFinite(r) ? r : 0) * span)))) * 1000
}

/**
 * How far above the highest price a really good article may go. Signals: `isNew` (new where used was accepted too),
 * `solidSeller` (many reviews, high rating), `underMarket` (still under the market's lower quartile), `fullMatch`
 * (size, colour and version exactly as asked). Unknown counts as no.
 */
export function toleranceFor(signals) {
  const s = signals && typeof signals === 'object' ? signals : {}
  const count = ['isNew', 'solidSeller', 'underMarket', 'fullMatch'].filter((k) => s[k] === true).length
  return count >= 3 ? WATCH.TOLERANCE_THREE : count === 2 ? WATCH.TOLERANCE_TWO : 0
}

/**
 * The hearts a card shows. After the card's description («…, 28.00 €, 30.10 €») its visible text begins with an
 * optional badge and the count («Ricercato 23 DEKKER M · Ottime…», «3 H&M M ·…»): the last such number, else null.
 */
export function favouritesOfCard(text) {
  let last = null
  for (const m of String(text || '').matchAll(/\d+\.\d{2}\s?€\s+(?:[A-Za-zÀ-ÿ]+\s+)?(\d{1,5})\s+[^\d\s]/g)) last = Number(m[1])
  return last
}

/** What a card says of an article: { id, title, brand, condition, band, size, price, favourites, url }, or null. */
export function findFromCard(card, origin = 'https://www.vinted.it') {
  if (!card || card.id === undefined || card.id === null) return null
  const price = cardPriceOf(card.price)
  if (price === null) return null
  const said = cardFactsOf(card.text)
  return {
    id: String(card.id), title: said.title || '', brand: said.brand || null, condition: said.condition || null, band: conditionBandOf(said.condition),
    size: said.size || null, price, favourites: favouritesOfCard(card.text), url: `${String(origin).replace(/\/+$/, '')}/items/${card.id}`,
  }
}

/**
 * Adds the cards of one reading to what was found so far. One entry per article: when it was first and last seen,
 * how many times, and the price it had when first seen if it has dropped since (`was`). `fresh`: the ids new now.
 */
export function mergeFinds(finds, cards, { at = Date.now(), source = 'read', origin = 'https://www.vinted.it' } = {}) {
  const byId = new Map((Array.isArray(finds) ? finds : []).filter((f) => f && f.id).map((f) => [String(f.id), f]))
  const fresh = []
  for (const card of Array.isArray(cards) ? cards : []) {
    const found = findFromCard(card, origin)
    if (!found) continue
    const old = byId.get(found.id)
    if (!old) {
      byId.set(found.id, { ...found, firstSeen: at, lastSeen: at, seen: 1, source })
      fresh.push(found.id)
      continue
    }
    const was = found.price < old.price - 0.004 ? (wtFinite(old.was) ? Math.max(old.was, old.price) : old.price) : old.was
    byId.set(found.id, { ...old, ...found, favourites: found.favourites ?? old.favourites ?? null, was: was ?? null, lastSeen: at, seen: (old.seen || 1) + 1 })
  }
  // The newest stay when the list is full.
  const all = [...byId.values()].sort((a, b) => b.lastSeen - a.lastSeen).slice(0, WATCH.MAX_FINDS)
  return { finds: all, fresh }
}

/** When a job ends (ms), and whether it is still running. */
export const jobEndsAt = (job) => (job && wtFinite(job.startedAt) ? job.startedAt + (wtFinite(job.hours) ? job.hours : job.kind === 'hunt' ? WATCH.HUNT_HOURS : WATCH.FEED_HOURS) * 3_600_000 : null)
export const jobActive = (job, now = Date.now()) => Boolean(job && !job.stopped && jobEndsAt(job) !== null && now < jobEndsAt(job))

/**
 * The finds as shown, best first.
 * Hunt (`job.kind` 'hunt', `job.maxPrice`): only what was seen by this job; an article is `eligible` within the
 * highest price plus its tolerance (from what a card can say: new where used was accepted, the size asked for),
 * `exceptional` at or below EXCEPTIONAL_SHARE of it; the cheapest eligible one first.
 * Feed: the most wanted first (hearts), then the ones whose price dropped, then the newest.
 */
export function rankFinds(finds, job = null) {
  const list = (Array.isArray(finds) ? finds : []).filter((f) => f && wtFinite(f.price))
  if (job && job.kind === 'hunt') {
    const max = wtFinite(job.maxPrice) && job.maxPrice > 0 ? job.maxPrice : null
    const wantSize = job.size ? String(job.size).toLowerCase().replace(/\s+/g, '') : null
    return list.filter((f) => !wtFinite(job.startedAt) || f.lastSeen >= job.startedAt).map((f) => {
      const signals = {
        isNew: f.band === 'new' && job.band !== 'new',
        fullMatch: Boolean(wantSize && f.size && String(f.size).toLowerCase().replace(/\s+/g, '') === wantSize),
        solidSeller: f.solidSeller === true, underMarket: f.underMarket === true,
      }
      const tolerancePct = toleranceFor(signals)
      const limit = max === null ? null : wtR2(max * (1 + tolerancePct / 100))
      return { ...f, tolerancePct, limit, eligible: limit === null || f.price <= limit + 1e-9, exceptional: max !== null && f.price <= max * WATCH.EXCEPTIONAL_SHARE + 1e-9 }
    }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.price - b.price || b.lastSeen - a.lastSeen)
  }
  return list.map((f) => ({ ...f, dropped: wtFinite(f.was) && f.was > f.price ? wtR2(f.was - f.price) : 0 }))
    .sort((a, b) => (b.favourites || 0) - (a.favourites || 0) || b.dropped - a.dropped || b.lastSeen - a.lastSeen)
}
