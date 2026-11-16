/**
 * The market of a book on Vinted (1.12): what the other listings ask for the same book, so that the resale value and
 * the proposals rest on the market and not on this one listing's price.
 *
 * A book's listing page carries its ISBN (a link to the listings with the same ISBN), its title and its author
 * (structure of a real page, Nov 2026: data-testid="item-attributes-isbn_nav-link" → «9788834909195»,
 * "item-attributes-book_title" → «Titolo» + «NEUN 6.5», "item-attributes-author" → «Autore» + «Tsutomu Takahashi»).
 *
 *   bookIdentityOf(html)                       → { isbn, isbnHref, title, author } | null (not a book, or nothing said)
 *   bookSearchFor(identity, { origin, mode, listingTitle }) → { mode: 'isbn' | 'title', url, query } | null
 *   bookMarketFrom(cards, { identity, mode, selfId, listingTitle, listPrice })
 *     → { ok, market, basis, query, seen, kept, confidence } — `market` is the summary the engine already knows
 *       ({ n, medianPrice, p25Price, p75Price, gapPct }) plus what it rests on; `ok` only with BOOK_MARKET.MIN cards.
 *
 * The ISBN is the same edition by definition: every card of that search counts, but for lots and box sets (or only
 * them, when the listing itself is one). Without an ISBN the search is by title and author, and a card counts only
 * when its text carries the title's words and the same volume number.
 *
 * These are asking prices of listings not sold yet: the median is what sellers hope for, the lower quartile is nearer
 * to what sells. Both are returned; the engine takes the median as the resale value, as the user asked.
 */
import { decodeEntities } from './extract.js'

export const BOOK_MARKET = Object.freeze({
  /** Comparable listings needed before the median is used as a market. */
  MIN: 3,
  /** With at least this many, a price further than this factor from the median is left out (a typo, a placeholder). */
  TRIM_FROM: 4,
  TRIM_FACTOR: 3,
  /** Share of the title's words a card must carry when the search is by title… */
  TITLE_COVERAGE: 0.75,
  /** …and when the title is the listing's own (it often carries the author or the publisher too). */
  LISTING_COVERAGE: 0.6,
})

const bkR2 = (v) => Math.round(v * 100) / 100
const bkFinite = (v) => typeof v === 'number' && Number.isFinite(v)
/** Linear-interpolated percentile of a sorted list (the same rule as value.js, which the web bundle does not carry). */
const bkPercentile = (sorted, p) => {
  if (!sorted.length) return null
  const at = (sorted.length - 1) * p
  const lo = Math.floor(at)
  const hi = Math.ceil(at)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo)
}

/** Lower case, no accents, words and numbers only («6,5» and «6.5» are the same number). */
const bkNorm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/(\d),(\d)/g, '$1.$2')
const bkTokens = (s) => bkNorm(s).match(/[a-z]+|\d+(?:\.\d+)?/g) || []
const BK_STOP = new Set(['il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'una', 'uno', 'di', 'da', 'del', 'della', 'dei', 'delle', 'dello', 'e', 'ed', 'the', 'of', 'and', 'a', 'in', 'con', 'per', 'su', 'vol', 'volume', 'volumi', 'libro', 'libri', 'edizione', 'ed', 'nuovo', 'usato'])
/** Several books sold together: never the price of one. */
const BK_LOT_WORDS = /\b(lotto|lotti|stock|bundle|set|cofanetto|box|serie completa|opera completa|collezione completa|tutti i volumi|(?:volumi|vol|numeri|nn?)\W{0,3}\d+\s*(?:-|–|al?|e)\s*\d+)\b/
/** «5 libri», «3 volumi»: a count of books — not the «5» of «6.5 manga». */
const BK_LOT_COUNT = /(?:^|[^\d.])\d+\s*(?:volumi|libri|numeri|fumetti|manga|pezzi)\b/
const bkIsLot = (normalised) => BK_LOT_WORDS.test(normalised) || BK_LOT_COUNT.test(normalised)
/** «vol. 3», «n° 12», «tomo 2»: a numbered volume. */
const BK_VOLUME = /\b(?:vol|volume|n|nr|num|numero|tomo|parte|libro)\W{0,3}(\d{1,3})\b/g

/** An ISBN as written (spaces, hyphens) → its 13 or 10 characters when the check digit holds, else null. */
export function normalizeIsbn(raw) {
  const s = String(raw || '').replace(/[\s-]/g, '').toUpperCase()
  if (/^97[89]\d{10}$/.test(s)) {
    let sum = 0
    for (let i = 0; i < 12; i++) sum += Number(s[i]) * (i % 2 ? 3 : 1)
    return (10 - (sum % 10)) % 10 === Number(s[12]) ? s : null
  }
  if (/^\d{9}[\dX]$/.test(s)) {
    let sum = 0
    for (let i = 0; i < 10; i++) sum += (s[i] === 'X' ? 10 : Number(s[i])) * (10 - i)
    return sum % 11 === 0 ? s : null
  }
  return null
}

/** The text pieces of a fragment of HTML, one per element. */
const bkPieces = (chunk) => String(chunk || '').replace(/<[^>]+>/g, '\n').split('\n').map((p) => decodeEntities(p).replace(/\s+/g, ' ').trim()).filter(Boolean)

/** The value of one «item-attributes-<name>» block: the piece after its label, or what follows the label in the same piece. */
const bkAttribute = (src, name, label) => {
  const at = src.search(new RegExp(`data-testid="item-attributes-${name}"`, 'i'))
  if (at < 0) return null
  const tail = src.slice(at, at + 900)
  const inner = tail.slice(tail.indexOf('>') + 1)
  const next = inner.search(new RegExp(`data-testid="(?!item-attributes-${name})`, 'i'))
  const pieces = bkPieces(next >= 0 ? inner.slice(0, inner.lastIndexOf('<', next)) : inner)
  for (let i = 0; i < pieces.length; i++) {
    if (!label.test(pieces[i])) continue
    const rest = pieces[i].replace(label, '').trim()
    return rest || pieces[i + 1] || null
  }
  return pieces[0] || null
}

/**
 * What the listing page says of the book: { isbn, isbnHref, title, author }, each null when the page does not say it;
 * null when it says none (not a book, or a book listed without its details).
 */
export function bookIdentityOf(html) {
  const src = String(html || '')
  const link = src.match(/<a\b[^>]*data-testid="item-attributes-isbn_nav-link"[^>]*>([\s\S]{0,200}?)<\/a>/i)
  const written = link ? bkPieces(link[1]).join('') : null
  const inData = (src.match(/\\?"isbn\\?":\s*\\?"([\dXx -]{10,17})\\?"/) || [])[1] || null
  const inText = (src.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').match(/\bisbn\b[^0-9]{0,12}(97[89][\d -]{10,14}\d|\d[\d -]{8,11}[\dXx])/i) || [])[1] || null
  const isbn = normalizeIsbn(written) || normalizeIsbn(bkAttribute(src, 'isbn_nav', /^isbn\s*:?\s*/i)) || normalizeIsbn(inData) || normalizeIsbn(inText)
  const href = link ? (link[0].match(/href="([^"]+)"/i) || [])[1] || null : null
  const title = bkAttribute(src, 'book_title', /^titolo\s*:?\s*/i)
  const author = bkAttribute(src, 'author', /^autor[ei]\s*:?\s*/i)
  if (!isbn && !title && !author) return null
  return { isbn, isbnHref: isbn && href ? decodeEntities(href) : null, title: title || null, author: author || null }
}

/** The words of a listing title worth searching for: no punctuation, the first eight. */
const bkQueryTitle = (title) => (String(title || '').match(/[\p{L}\p{N}]+(?:[.,]\d+)?/gu) || []).slice(0, 8).join(' ')

/**
 * Where to look for the same book: by ISBN (the page's own link when it is a Vinted search, else the ISBN as search
 * text) or, with `mode` 'title' or no ISBN, by title and author. Null when there is nothing to search for.
 */
export function bookSearchFor(identity, { origin = 'https://www.vinted.it', mode = null, listingTitle = '' } = {}) {
  const id = identity && typeof identity === 'object' ? identity : {}
  const base = String(origin || '').replace(/\/+$/, '')
  if (id.isbn && mode !== 'title') {
    const href = typeof id.isbnHref === 'string' ? id.isbnHref : ''
    const own = /^\/catalog\b/.test(href) ? `${base}${href}` : href.startsWith(`${base}/catalog`) ? href : null
    return { mode: 'isbn', query: id.isbn, url: own || `${base}/catalog?search_text=${id.isbn}` }
  }
  if (mode === 'isbn') return null
  const query = [id.title || bkQueryTitle(listingTitle), id.author].map((p) => String(p || '').trim()).filter(Boolean).join(' ').slice(0, 120)
  if (bkTokens(query).filter((t) => t.length >= 3).length < 1) return null
  return { mode: 'title', query, url: `${base}/catalog?search_text=${encodeURIComponent(query)}` }
}

/** Does a card's text speak of the same title (its words, the same numbers, no other volume)? */
const bkSameTitle = (cardText, refTitle, coverage = BOOK_MARKET.TITLE_COVERAGE) => {
  const ref = bkTokens(refTitle)
  const card = new Set(bkTokens(cardText))
  const numbers = ref.filter((t) => /^\d/.test(t))
  const words = ref.filter((t) => /^[a-z]/.test(t) && t.length >= 3 && !BK_STOP.has(t))
  if (!words.length && !numbers.length) return false
  if (numbers.some((n) => !card.has(n))) return false
  const found = words.filter((w) => card.has(w)).length
  if (words.length && found / words.length < (words.length <= 2 ? 1 : coverage)) return false
  // A numbered volume the title does not name is another book of the series.
  if (!numbers.length) {
    for (const hit of bkNorm(cardText).matchAll(BK_VOLUME)) if (Number(hit[1]) >= 2) return false
  }
  return true
}

/**
 * The market from the cards of a search page ([{ id, price, text }], as the in-app browser read them).
 * `mode` 'isbn': every card is the same edition. 'title': only the cards that carry the title.
 * Lots and box sets are left out, or are the only ones kept when the listing itself is one.
 */
export function bookMarketFrom(cards, { identity = null, mode = 'isbn', selfId = null, listingTitle = '', listPrice = null } = {}) {
  const id = identity && typeof identity === 'object' ? identity : {}
  const refTitle = id.title || listingTitle || ''
  const refIsLot = bkIsLot(bkNorm(`${listingTitle} ${id.title || ''}`))
  const seenIds = new Set()
  const rows = []
  for (const c of Array.isArray(cards) ? cards : []) {
    if (!c || seenIds.has(String(c.id))) continue
    seenIds.add(String(c.id))
    const shown = String(c.price ?? '')
    const price = typeof c.price === 'number' ? c.price : Number(shown.includes(',') ? shown.replace(/\./g, '').replace(',', '.') : shown)
    if (selfId !== null && String(c.id) === String(selfId)) continue
    if (!bkFinite(price) || price <= 0) continue
    rows.push({ id: String(c.id), price, text: String(c.text || '') })
  }
  // Why a card was left out, and the first few of them: the report shows whether the rules cut the right ones.
  const dropped = {}
  const examples = []
  const drop = (why, r) => {
    dropped[why] = (dropped[why] || 0) + 1
    if (examples.length < 4) examples.push(`${why}: ${r.text.split(/,\s*(?:marca|condizioni|taglia)\s*:/i)[0].slice(0, 50)}`)
    return false
  }
  const kept = rows.filter((r) => {
    const said = bkNorm(r.text)
    // A card that says nothing can only be trusted when the search itself was by ISBN.
    if (!said.replace(/[^a-z]/g, '')) return mode === 'isbn' && !refIsLot ? true : drop('senza testo', r)
    if (bkIsLot(said) !== refIsLot) return drop(refIsLot ? 'non è un lotto' : 'lotto', r)
    if (mode !== 'isbn' && !bkSameTitle(r.text, refTitle, id.title ? BOOK_MARKET.TITLE_COVERAGE : BOOK_MARKET.LISTING_COVERAGE)) return drop('altro titolo', r)
    return true
  })
  let prices = kept.map((r) => r.price).sort((a, b) => a - b)
  if (prices.length >= BOOK_MARKET.TRIM_FROM) {
    const mid = bkPercentile(prices, 0.5)
    const before = prices.length
    prices = prices.filter((p) => p >= mid / BOOK_MARKET.TRIM_FACTOR && p <= mid * BOOK_MARKET.TRIM_FACTOR)
    if (before - prices.length) dropped['prezzo anomalo'] = before - prices.length
  }
  const n = prices.length
  const query = mode === 'isbn' ? id.isbn || null : [id.title || listingTitle, id.author].filter(Boolean).join(' ') || null
  const base = { ok: n >= BOOK_MARKET.MIN, market: null, basis: mode === 'isbn' ? 'isbn' : 'title', query, seen: rows.length, kept: n, dropped, examples, confidence: null }
  if (n < 2) return base
  const medianPrice = bkR2(bkPercentile(prices, 0.5))
  const L = Number(listPrice)
  base.confidence = mode === 'isbn' ? (n >= 5 ? 'alta' : n >= BOOK_MARKET.MIN ? 'media' : 'bassa') : (n >= 6 ? 'media' : 'bassa')
  base.market = {
    n, medianPrice, p25Price: bkR2(bkPercentile(prices, 0.25)), p75Price: bkR2(bkPercentile(prices, 0.75)), minPrice: prices[0], maxPrice: prices[n - 1],
    gapPct: bkFinite(L) && L > 0 && medianPrice > 0 ? Math.round((L / medianPrice - 1) * 100) : null,
    basis: base.basis, confidence: base.confidence, source: 'vinted-books',
  }
  return base
}
