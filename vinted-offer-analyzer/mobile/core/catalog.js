/**
 * Vinted catalog search: the search URL for a product and the parser of the search page.
 * Pure string work (no DOM, no regex over the whole page): runs in Node, the browser and Hermes on a 3-4 MB page.
 *
 * What www.vinted.it/catalog?search_text=… contains server-side (verified October 2026): no JSON-LD and no
 * __NEXT_DATA__; the 96 results of the page sit in the React flight payload (self.__next_f.push([1,"…"]) scripts)
 * as `"items":{"items":[{ id, productItem: { title, url, price, serviceFee, totalItemPrice, favouriteCount, photos,
 * user: { id, isBusiness }, itemBox: { firstLine, secondLine, accessibilityLabel } } }, …]}`. Listings from other
 * EU countries appear in the same results. The page is read only when the user starts a search (in-app browser).
 */

import { cleanTitle, decodeEntities } from './extract.js'

export const VINTED_ORIGIN = 'https://www.vinted.it'

/** Words that describe the sale, not the product: they only narrow the search. */
const NOISE_WORDS = new Set([
  'vendo', 'vendesi', 'come', 'nuovo', 'nuova', 'nuovi', 'nuove', 'usato', 'usata', 'perfetto', 'perfetta', 'perfette',
  'ottimo', 'ottima', 'ottime', 'condizioni', 'stato', 'originale', 'originali', 'spedizione', 'gratis', 'inclusa',
  'affare', 'occasione', 'bellissimo', 'bellissima', 'strepitoso', 'strepitosa', 'stupendo', 'stupenda', 'splendido',
  'splendida', 'fantastico', 'fantastica', 'tg', 'taglia', 'misura', 'con', 'senza', 'per', 'del', 'della',
  'di', 'da', 'il', 'la', 'lo', 'le', 'i', 'gli', 'un', 'una', 'e', 'a', 'in',
])

/**
 * Search words for the same product: brand first, then the title without sale words, sizes and punctuation,
 * at most `maxWords`. Deterministic; the AI planner can refine it later.
 */
export function vintedSearchQuery({ title = '', brand = '' } = {}, { maxWords = 6 } = {}) {
  const words = []
  const seen = new Set()
  const push = (w) => {
    const key = w.toLowerCase()
    if (!w || seen.has(key)) return
    seen.add(key)
    words.push(w)
  }
  const cleanBrand = brand && !/^\[object/i.test(brand) ? cleanTitle(brand, 40) : ''
  for (const w of cleanBrand.split(/\s+/)) push(w)
  for (const raw of cleanTitle(title, 140).split(/[\s,;:|/()[\]{}"«»!?·•\-–—]+/)) {
    const w = raw.replace(/^[.'’]+|[.'’]+$/g, '')
    if (!w || (w.length < 2 && !/\d/.test(w))) continue
    if (NOISE_WORDS.has(w.toLowerCase())) continue
    if (/^(xxs|xs|s|m|l|xl|xxl|xxxl)$/i.test(w)) continue
    push(w)
    if (words.length >= maxWords) break
  }
  return words.slice(0, maxWords).join(' ')
}

/** URL of the Vinted search page for `query` (relevance order, as the site opens it). */
export function vintedSearchUrl(query) {
  return `${VINTED_ORIGIN}/catalog?search_text=${encodeURIComponent(String(query || '').trim())}`
}

/** The string literal starting at `start` (just after the opening quote), decoded; null when malformed. */
function readJsString(src, start) {
  let i = start
  while (i < src.length) {
    const ch = src.charCodeAt(i)
    if (ch === 92) i += 2 // backslash: skip the escaped character
    else if (ch === 34) break // closing quote
    else i++
  }
  if (i >= src.length) return null
  try {
    return JSON.parse(`"${src.slice(start, i)}"`)
  } catch {
    return null
  }
}

/** All flight payload strings of a page (HTML, or a browser's DOM), concatenated in order. */
export function flightText(html) {
  const src = String(html || '')
  const marker = 'self.__next_f.push([1,"'
  let out = ''
  let at = src.indexOf(marker)
  while (at >= 0) {
    const text = readJsString(src, at + marker.length)
    if (text) out += text
    at = src.indexOf(marker, at + marker.length)
  }
  return out
}

/** End index (inclusive) of the JSON array or object opening at `start`, or -1. Strings are skipped correctly. */
function matchBracket(text, start) {
  const open = text[start]
  const close = open === '[' ? ']' : '}'
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

const undef = (v) => (v === '$undefined' || v === undefined ? null : v)
const money = (m) => {
  const n = m && m.amount != null ? Number(String(m.amount).replace(',', '.')) : NaN
  return Number.isFinite(n) ? n : null
}

/** "Basket Nike Air Max, Brand: Nike, Condizioni: Buone, Taglia: 40, 8.00 €, 9.10 €" → { brand, condition, size }. */
function labelFields(label) {
  const text = decodeEntities(String(label || ''))
  // Sizes may carry a decimal comma ("Taglia: 38,5"): keep it instead of stopping at the comma.
  const field = (name) => {
    const m = text.match(new RegExp(`${name}:\\s*(\\d+,\\d+|[^,]+)`, 'i'))
    return m ? m[1].trim() : null
  }
  return { brand: field('Brand') || field('Marca'), condition: field('Condizioni'), size: field('Taglia') }
}

// Photos are downloaded and sent to the models: only Vinted's own image CDN is accepted.
const photoUrl = (u) => typeof u === 'string' && /^https:\/\/[a-z0-9.-]+\.vinted\.net\//i.test(u)

/** One catalog entry → the candidate shape used by the search and the AI lab. */
export function catalogCandidate(entry) {
  const p = entry && (entry.productItem || entry)
  if (!p || p.id == null || typeof p.title !== 'string' || !p.title.trim()) return null
  const box = p.itemBox || {}
  const fromLabel = labelFields(undef(box.accessibilityLabel))
  // secondLine is "40 · Buone" (size · condition) or just the condition.
  const second = String(undef(box.secondLine) || '').split('·').map((s) => s.trim()).filter(Boolean)
  const photos = Array.isArray(p.photos) ? p.photos.map((ph) => ph && ph.url).filter(photoUrl) : []
  const thumb = photoUrl(undef(p.thumbnailUrl)) ? p.thumbnailUrl : null
  const url = typeof p.url === 'string' ? p.url : null
  return {
    source: 'vinted',
    id: String(p.id),
    title: decodeEntities(p.title).trim(),
    url: url ? (url.startsWith('http') ? url : `${VINTED_ORIGIN}${url}`) : null,
    price: money(undef(p.priceWithDiscount)) ?? money(p.price),
    listPrice: money(p.price),
    buyerFee: money(undef(p.serviceFee)),
    total: money(undef(p.totalItemPrice)),
    currency: (p.price && p.price.currencyCode) || 'EUR',
    brand: fromLabel.brand || undef(box.firstLine) || null,
    size: (second.length > 1 ? second[0] : null) || fromLabel.size,
    condition: fromLabel.condition || (second.length ? second[second.length - 1] : null),
    favourites: Number.isFinite(p.favouriteCount) ? p.favouriteCount : null,
    promoted: Boolean(p.isPromoted),
    photo: photos[0] || thumb,
    photos,
    thumb: thumb || photos[0] || null,
    sellerId: p.user && p.user.id != null ? String(p.user.id) : null,
    sellerBusiness: p.user ? Boolean(p.user.isBusiness) : null,
  }
}

/**
 * Parses a Vinted catalog search page. Returns { items, total } where `items` are candidates in page order
 * (duplicates removed) and `total` the number of entries the payload carried. Never throws.
 */
export function parseVintedCatalog(html) {
  const text = flightText(html) || String(html || '')
  const entries = []
  const marker = '"items":{"items":['
  let at = text.indexOf(marker)
  if (at >= 0) {
    const start = at + marker.length - 1
    const end = matchBracket(text, start)
    if (end > start) {
      try {
        entries.push(...JSON.parse(text.slice(start, end + 1)))
      } catch {
        // fall through to the per-item scan
      }
    }
  }
  if (!entries.length) {
    // Layout variant: read every productItem object on its own.
    const key = '"productItem":'
    at = text.indexOf(key)
    while (at >= 0) {
      const start = at + key.length
      const end = text[start] === '{' ? matchBracket(text, start) : -1
      if (end > start) {
        try {
          entries.push({ productItem: JSON.parse(text.slice(start, end + 1)) })
        } catch {
          // skip a malformed entry
        }
      }
      at = text.indexOf(key, end > start ? end : start)
    }
  }
  const items = []
  const ids = new Set()
  for (const entry of entries) {
    let c = null
    try {
      c = catalogCandidate(entry)
    } catch {
      c = null // one malformed listing must not lose the others
    }
    if (!c || ids.has(c.id)) continue
    ids.add(c.id)
    items.push(c)
  }
  return { items, total: entries.length }
}
