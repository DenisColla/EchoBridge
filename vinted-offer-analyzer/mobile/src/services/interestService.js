import AsyncStorage from '@react-native-async-storage/async-storage'
import * as core from '../../core/index.js'
import { MARKET_CHAIN, callChain } from '../hooks/useSearch.js'
import { keyStatus } from './secrets.js'
import { fetchVintedListPage } from './vinted.js'

/**
 * What the interest score (core interest.js) needs from outside, for the watch engine: the AI's cards in batches,
 * the reference read from Vinted's own market with a day of memory, and the user's interests.
 * Nothing here needs a screen of the app: it runs in the background task too.
 * To the AI go titles, brands, sizes, conditions and prices of the listings, never a seller's name.
 */
const REFS_KEY = 'offerta-vinted.refs.v2'
const PROFILE_KEY = 'offerta-vinted.profile.v1'
const ORIGIN = 'https://www.vinted.it'
const REF_TTL_MS = 24 * 3600 * 1000
const REFS_MAX = 300
/** Ten listings a call: about twenty seconds each with the fast model; four calls side by side. */
const BATCH = 10
const PARALLEL = 4

/** How a call ended when the AI gave nothing for a cause that is not in the listings: asking again costs nothing. */
const FREE_FAILURES = ['auth', 'balance', 'rate', 'server', 'network', 'cancelled', 'request']

/**
 * The cards of `items` (finds) → { cards: { id: card }, answered: [id], costUsd, error, detail, calls }.
 * `answered`: the listings of the batches the AI did answer, with a card or without: only those count as asked.
 * `error`: 'nokey' when no AI key is set, 'keyerror' when the phone did not let the key be read, else how the last
 * call without cards ended ('auth' = the provider refused the key, 'network', 'schema'…), with what it said in
 * `detail`; cards that did arrive are returned all the same.
 */
export async function askCards(items, { target = '' } = {}) {
  const out = { cards: {}, answered: [], costUsd: 0, error: null, detail: null, calls: 0 }
  // The key first: without one no call is made and no listing counts as asked.
  const keys = await Promise.all([...new Set(MARKET_CHAIN.map((m) => m.split(':')[0]))].map((p) => keyStatus(p)))
  if (!keys.some((k) => k.state === 'present')) {
    const refused = keys.find((k) => k.state === 'unreadable')
    out.error = refused ? 'keyerror' : 'nokey'
    out.detail = refused ? refused.error || null : null
    return out
  }
  const batches = []
  for (let i = 0; i < items.length; i += BATCH) batches.push(items.slice(i, i + BATCH))
  const run = async (batch) => {
    const res = await callChain(MARKET_CHAIN, core.interestPrompt(batch, { target }), [], { effort: 'low', maxTokens: 400 + 260 * batch.length, timeoutMs: 60_000, maxAttempts: 1, think: false, temperature: 0 })
    out.calls += 1
    out.costUsd += res.costUsd || 0
    // An answer that is JSON but strays from the schema in one card is still read: the cleaner judges card by card.
    let usable = {}
    let broke = null
    if (res.value && (res.ok || res.kind === 'schema')) {
      try { usable = core.cleanInterestCards(res.value, batch) } catch (e) { broke = String((e && e.message) || e).slice(0, 140) }
    }
    Object.assign(out.cards, usable)
    if (res.ok || !FREE_FAILURES.includes(res.kind)) out.answered.push(...batch.map((f) => f.id))
    // A good answer with no card for these listings is no fault of the AI's service: they simply stay without.
    if (broke || (!res.ok && !Object.keys(usable).length)) {
      out.error = broke ? 'failed' : res.kind || 'failed'
      out.detail = broke || (res.error ? String(res.error).slice(0, 140) : null)
    }
  }
  for (let i = 0; i < batches.length; i += PARALLEL) {
    await Promise.all(batches.slice(i, i + PARALLEL).map((b) => run(b).catch((e) => { out.error = 'failed'; out.detail = String((e && e.message) || e).slice(0, 140) })))
    // The key refused, or no network: the other batches would say the same.
    if (FREE_FAILURES.includes(out.error) && !Object.keys(out.cards).length) break
  }
  return out
}

/** For the diary: how the key of each provider the cards may use is doing, never the key ({ deepseek: 'present', … }). */
export async function aiKeyReport() {
  const providers = [...new Set(MARKET_CHAIN.map((m) => m.split(':')[0]))]
  const states = await Promise.all(providers.map((p) => keyStatus(p)))
  return Object.fromEntries(providers.map((p, i) => [p, states[i].error ? `${states[i].state}: ${states[i].error}` : states[i].state]))
}

let refs = null
async function loadRefs() {
  if (refs) return refs
  try {
    const raw = await AsyncStorage.getItem(REFS_KEY)
    const saved = raw ? JSON.parse(raw) : null
    refs = saved && typeof saved === 'object' ? saved : {}
  } catch {
    refs = {}
  }
  return refs
}
function saveRefs() {
  const entries = Object.entries(refs).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, REFS_MAX)
  refs = Object.fromEntries(entries)
  return AsyncStorage.setItem(REFS_KEY, JSON.stringify(refs)).catch(() => {})
}
/** The results of a search, kept in memory for half an hour: several articles of one product ask for the same page. */
const PAGE_TTL_MS = 30 * 60 * 1000
const pages = new Map()
const keyOf = (card, find, pieces) => `${(card.words || []).join('+') || card.query}|${card.variant || ''}|${find.band || ''}|${pieces}`.toLowerCase()

/**
 * The reference of one article from Vinted's own market: the same search a person would do, its results read from
 * the page, the same product among them, its lower quartile (for a lot of volumes: of one volume, times the lot).
 * A day of memory for each product. A lot that cannot be compared (core lotOf) is not searched.
 * → { ok: true, ref | null, cached, seen, same } (seen: results read, same: those that are the same product) or
 * { ok: false, reason } ('challenge', 'timeout', 'network', 'vuota').
 */
export async function lookupReference(find, card, { now = Date.now(), anonymous = false } = {}) {
  if (!card || !card.query || !(card.words || []).length) return { ok: true, ref: null, cached: false }
  const lot = core.lotOf(find, card)
  if (!lot.comparable) return { ok: true, ref: null, cached: true }
  const all = await loadRefs()
  const key = keyOf(card, find, lot.pieces)
  const known = all[key]
  if (known && now - known.at < REF_TTL_MS) return { ok: true, ref: known.ref, cached: true, seen: known.seen ?? null, same: known.same ?? null }
  // The web build has no way to Vinted: what a test hands over stands in for the search page.
  const handed = typeof window !== 'undefined' && window.__ovtMarketPages ? window.__ovtMarketPages[card.query] : null
  let items
  const kept = pages.get(card.query)
  // `shared`: no request was made for this answer (the page was read for another article a moment ago).
  const shared = Boolean(kept && now - kept.at < PAGE_TTL_MS)
  if (shared) items = kept.items
  else if (handed) items = handed
  else {
    const dl = await fetchVintedListPage(`${ORIGIN}/catalog?search_text=${encodeURIComponent(card.query)}`, { anonymous })
    if (!dl.html) return { ok: false, reason: dl.reason || 'failed' }
    const page = core.parseVintedCatalog(dl.html)
    items = page.items
    if (!items.length) {
      if (dl.mitigated || core.detectVintedChallenge(dl.html)) return { ok: false, reason: 'challenge' }
      // Vinted asks to renew the session: the next reading does it (watchEngine); nothing was learnt here.
      if (core.detectVintedSessionRefresh(dl.html)) return { ok: false, reason: 'sessione' }
      // Not a list of results at all: no value, and nothing to remember for a day.
      if (!page.catalog) return { ok: true, ref: null, cached: false, seen: 0, same: 0 }
    }
  }
  if (!shared && items.length) {
    pages.set(card.query, { at: now, items })
    if (pages.size > 40) pages.delete(pages.keys().next().value)
  }
  const prices = core.comparablesOf(items, card, find)
  const ref = core.marketReferenceOf(prices, { pieces: lot.pieces })
  all[key] = { ref, at: now, seen: items.length, same: prices.length }
  await saveRefs()
  return { ok: true, ref, cached: shared, seen: items.length, same: prices.length }
}

/**
 * What the app knows of the user, apart from any list of finds: the interests he wrote, what his thumbs taught
 * (`likes`) and the scores he gave (`ratings`: [{ id, at, category, brand, system, user, price }], the last 300).
 * Emptying the list or starting a new search does not touch it.
 */
/**
 * The page of one listing, read for what the card of a list does not say (1.20): the description, how long it has
 * been there, its seller's last visit and reviews (core listingFactsOf). → { ok: true, facts } · { ok: true, gone:
 * true } when the listing is no longer there · { ok: false, reason } ('challenge', 'sessione', 'timeout', 'network',
 * 'vuota', 'non_disponibile'). `anonymous`: without the user's session.
 */
export async function readListing(find, { anonymous = false } = {}) {
  // The web build has no way to Vinted: a test hands the facts over ({ id: facts | null }), or there is no reading.
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const handed = window.__ovtItemPages
    if (!handed || handed[find.id] === undefined) return { ok: false, reason: 'non_disponibile' }
    return handed[find.id] === null ? { ok: true, gone: true } : handed[find.id].reason ? { ok: false, reason: handed[find.id].reason } : { ok: true, facts: handed[find.id] }
  }
  if (!find || !find.url) return { ok: false, reason: 'vuota' }
  const dl = await fetchVintedListPage(find.url, { anonymous })
  if (!dl.html) return { ok: false, reason: dl.reason || 'failed' }
  if (dl.status === 404 || dl.status === 410) return { ok: true, gone: true }
  if (dl.mitigated || core.detectVintedChallenge(dl.html)) return { ok: false, reason: 'challenge' }
  if (core.detectVintedSessionRefresh(dl.html)) return { ok: false, reason: 'sessione' }
  const facts = core.listingFactsOf(core.parseVintedItemHtml(dl.html))
  return facts ? { ok: true, facts } : { ok: false, reason: 'vuota' }
}

const EMPTY_PROFILE = { categories: [], words: [], sizes: [], likes: {}, ratings: [] }
const RATINGS_MAX = 300
const cleanRatings = (list) => (Array.isArray(list) ? list : [])
  .filter((r) => r && typeof r === 'object' && Number.isFinite(r.user) && Number.isFinite(r.system))
  .map((r) => ({ id: String(r.id || ''), at: Number(r.at) || 0, category: core.INTEREST_CATEGORIES.includes(r.category) ? r.category : 'altro', brand: String(r.brand || '').slice(0, 40), system: r.system, user: r.user, price: Number.isFinite(r.price) ? r.price : null }))
  .slice(-RATINGS_MAX)
let profile = null
export async function loadProfile() {
  if (profile) return profile
  try {
    const raw = await AsyncStorage.getItem(PROFILE_KEY)
    const saved = raw ? JSON.parse(raw) : null
    profile = saved && typeof saved === 'object'
      ? {
          categories: (Array.isArray(saved.categories) ? saved.categories : []).filter((c) => core.INTEREST_CATEGORIES.includes(c)),
          words: (Array.isArray(saved.words) ? saved.words : []).map((w) => String(w).trim()).filter(Boolean).slice(0, 40),
          sizes: (Array.isArray(saved.sizes) ? saved.sizes : []).map((w) => String(w).trim()).filter(Boolean).slice(0, 12),
          likes: saved.likes && typeof saved.likes === 'object' ? saved.likes : {},
          ratings: cleanRatings(saved.ratings),
        }
      : { ...EMPTY_PROFILE }
  } catch {
    profile = { ...EMPTY_PROFILE }
  }
  return profile
}
export async function saveProfile(next) {
  profile = { ...EMPTY_PROFILE, ...(await loadProfile()), ...next }
  profile.ratings = cleanRatings(profile.ratings)
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile)).catch(() => {})
  return profile
}
