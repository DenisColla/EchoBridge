import AsyncStorage from '@react-native-async-storage/async-storage'
import * as core from '../../core/index.js'
import { MARKET_CHAIN, callChain } from '../hooks/useSearch.js'
import { fetchVintedListPage } from './vinted.js'

/**
 * What the interest score (core interest.js) needs from outside, for the watch engine: the AI's cards in batches,
 * the reference read from Vinted's own market with a day of memory, and the user's interests.
 * Nothing here needs a screen of the app: it runs in the background task too.
 * To the AI go titles, brands, sizes, conditions and prices of the listings, never a seller's name.
 */
const REFS_KEY = 'offerta-vinted.refs.v1'
const PROFILE_KEY = 'offerta-vinted.profile.v1'
const ORIGIN = 'https://www.vinted.it'
const REF_TTL_MS = 24 * 3600 * 1000
const REFS_MAX = 300
/** Ten listings a call: about twenty seconds each with the fast model; four calls side by side. */
const BATCH = 10
const PARALLEL = 4

/**
 * The cards of `items` (finds) → { cards: { id: card }, costUsd, error }. `error`: 'auth' when no AI key is set,
 * else what the last failed call said; cards that did arrive are returned all the same.
 */
export async function askCards(items, { target = '' } = {}) {
  const batches = []
  for (let i = 0; i < items.length; i += BATCH) batches.push(items.slice(i, i + BATCH))
  const out = { cards: {}, costUsd: 0, error: null, calls: 0 }
  const run = async (batch) => {
    const res = await callChain(MARKET_CHAIN, core.interestPrompt(batch, { target }), [], { effort: 'low', maxTokens: 400 + 260 * batch.length, timeoutMs: 60_000, maxAttempts: 1, think: false, temperature: 0 })
    out.calls += 1
    out.costUsd += res.costUsd || 0
    // An answer that is JSON but strays from the schema in one card is still read: the cleaner judges card by card.
    const usable = res.value && (res.ok || res.kind === 'schema') ? core.cleanInterestCards(res.value, batch) : {}
    Object.assign(out.cards, usable)
    if (!Object.keys(usable).length) out.error = res.kind || 'failed'
  }
  for (let i = 0; i < batches.length; i += PARALLEL) {
    await Promise.all(batches.slice(i, i + PARALLEL).map((b) => run(b).catch(() => { out.error = 'failed' })))
    // No key at all: the other batches would say the same.
    if (out.error === 'auth' && !Object.keys(out.cards).length) break
  }
  return out
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
const keyOf = (card, find) => `${(card.words || []).join('+') || card.query}|${card.variant || ''}|${find.band || ''}`.toLowerCase()

/**
 * The reference of one article from Vinted's own market: the same search a person would do, its results read from
 * the page, the same product among them, its lower quartile. A day of memory for each product.
 * → { ok: true, ref | null, cached } or { ok: false, reason } ('challenge', 'timeout', 'network', 'vuota').
 */
export async function lookupReference(find, card, now = Date.now()) {
  if (!card || !card.query || !(card.words || []).length) return { ok: true, ref: null, cached: false }
  const all = await loadRefs()
  const key = keyOf(card, find)
  const known = all[key]
  if (known && now - known.at < REF_TTL_MS) return { ok: true, ref: known.ref, cached: true }
  // The web build has no way to Vinted: what a test hands over stands in for the search page.
  const handed = typeof window !== 'undefined' && window.__ovtMarketPages ? window.__ovtMarketPages[card.query] : null
  let items
  if (handed) items = handed
  else {
    const dl = await fetchVintedListPage(`${ORIGIN}/catalog?search_text=${encodeURIComponent(card.query)}`)
    if (!dl.html) return { ok: false, reason: dl.reason || 'failed' }
    items = core.parseVintedCatalog(dl.html).items
    if (!items.length && (dl.mitigated || core.detectVintedChallenge(dl.html))) return { ok: false, reason: 'challenge' }
  }
  const ref = core.marketReferenceOf(core.comparablesOf(items, card, find))
  all[key] = { ref, at: now, seen: items.length }
  await saveRefs()
  return { ok: true, ref, cached: false }
}

const EMPTY_PROFILE = { categories: [], words: [], sizes: [], likes: {} }
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
        }
      : { ...EMPTY_PROFILE }
  } catch {
    profile = { ...EMPTY_PROFILE }
  }
  return profile
}
export async function saveProfile(next) {
  profile = { ...EMPTY_PROFILE, ...(await loadProfile()), ...next }
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile)).catch(() => {})
  return profile
}
