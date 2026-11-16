/**
 * The market of an article that is not a book (1.13): what the other listings of the same product ask on Vinted.
 *
 * What a listing page gives as data decides how the same product is found (real pages, Nov 2026):
 * - electronics carry their model as a link («Modello» → /catalog?brand_collection_ids[]=9979&…) and their storage:
 *   the link is Vinted's own search for that model, as the ISBN link is for a book → mode 'model', rules only;
 * - clothes and shoes carry brand × category (the last breadcrumb: /catalog/1821-joggers/brand/14-adidas), size,
 *   condition and colour, but the model only in the seller's words («Nikeminds») → mode 'brand': the AI reads the
 *   listing, gives the words to search for and then says which cards are the same article (`verdicts`). Without the
 *   AI the cards are only «same brand and kind»: shown as a range, never used as the resale value.
 *
 *   productIdentityOf(pageFacts, { brand }) → { kind: 'model' | 'brand', model, modelHref, capacityGb, size, condition,
 *                                              band, colour, brand, brandHref, category } | null
 *   productSearchFor(identity, { origin, query }) → { mode, url, query } | null
 *   cardFactsOf(text) → { title, brand, condition, size } from a card («titolo, marca: X, condizioni: Y, taglia: Z, 9.00 €…»)
 *   productMarketFrom(cards, { identity, mode, selfId, listPrice, verdicts, strict })
 *     → { ok, market, basis, seen, kept, dropped, confidence } (`market`: the summary the engine takes, as for books)
 *
 * Left out: the listing itself, broken articles, accessories, another storage size, what the AI calls another product.
 * The condition (new / used) and, for clothes, the size narrow the cards when enough of them remain; a market whose
 * middle half is wider than PRODUCT_MARKET.MAX_SPREAD of its median loses a step of confidence.
 * These are asking prices of unsold listings: the engine takes their lower quartile as the resale value.
 */
/**
 * What the market asks of the triage (search.js triagePrompt, `note`). The shared rules call «variant» the same model
 * with one thing different; clothes often have no model in their title, and the AI then took every garment of the
 * brand as a variant (jackets at 45–120 € among the comparables of a coat, on a real run): the kind of garment decides.
 */
export const MARKET_TRIAGE_NOTE = [
  'Regola per questo smistamento: serve il prezzo di mercato dello stesso articolo.',
  '"same" solo se è lo stesso articolo: stessa marca, stesso tipo di capo o di oggetto e, quando il titolo li dice, stesso modello o linea.',
  '"variant" se è lo stesso articolo con taglia, colore o condizioni diverse. Quando nessun titolo dice un modello, "variant" vale solo per lo stesso tipo di capo (cappotto con cappotto, giubbotto con giubbotto, jeans con jeans, maglione con maglione).',
  'Un tipo di capo diverso della stessa marca è "family". Un lotto di più articoli, un capo da donna o da bambino quando si cerca da uomo (e viceversa), un articolo dichiarato difettoso sono "other".',
].join(' ')

export const PRODUCT_MARKET = Object.freeze({
  MIN: 3,
  /** Narrowing to the same size is worth it only when this many cards remain: size moves the price of clothes little,
   *  and three cards of one size were a worse market than thirteen of the same article (a real report). */
  SIZE_MIN: 5,
  TRIM_FROM: 4,
  TRIM_FACTOR: 3,
  /** The same model, storage and condition does not vary threefold: beyond twice or half the median it is something else. */
  TRIM_MODEL: 2,
  TRIM_SIMILAR_LOW: 5,
  /** (p75 − p25) / median above which the cards are too different to be one market. */
  MAX_SPREAD: 0.6,
})

const pmR2 = (v) => Math.round(v * 100) / 100
const pmFinite = (v) => typeof v === 'number' && Number.isFinite(v)
const pmNorm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/(\d),(\d)/g, '$1.$2')
const pmPercentile = (sorted, p) => {
  if (!sorted.length) return null
  const at = (sorted.length - 1) * p
  const lo = Math.floor(at)
  const hi = Math.ceil(at)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo)
}
/** «Taglia M» → «M»: the value of an attribute block without its label. */
const pmValue = (text) => String(text || '').replace(/^(taglia|condizioni|colore|modello|capacit[aà] di archiviazione|marca|brand)\s*:?\s*/i, '').trim() || null
/** A price as a card shows it («9,00», «1.150,00», «15.00») → number, else null. */
export const cardPriceOf = (price) => {
  if (typeof price === 'number') return Number.isFinite(price) && price > 0 ? price : null
  const shown = String(price ?? '').trim()
  const v = Number(shown.includes(',') ? shown.replace(/\./g, '').replace(',', '.') : shown)
  return Number.isFinite(v) && v > 0 ? v : null
}

/** 'new' (nuovo con / senza cartellino) or 'used' (ottime, buone, discrete), else null. */
export const conditionBandOf = (text) => {
  const t = pmNorm(text)
  if (/nuov/.test(t)) return 'new'
  if (/ottim|buon|discret|soddisfacent|usat/.test(t)) return 'used'
  return null
}

/** The storage sizes a text names, in GB («256gb», «1 TB»; a phone's «256 MB» is a slip for GB). */
export function capacitiesOf(text) {
  const out = []
  for (const m of pmNorm(text).matchAll(/(\d+(?:\.\d+)?)\s*(tb|gb|mb)\b/g)) {
    const v = Number(m[1])
    const gb = m[2] === 'tb' ? v * 1024 : m[2] === 'mb' && v < 16 ? v / 1024 : v
    if (!out.includes(gb)) out.push(gb)
  }
  return out
}

/** What a card says of its article: the text is «titolo, marca: X, condizioni: Y, taglia: Z, 9.00 €, 10.15 € …». */
export function cardFactsOf(text) {
  const raw = String(text || '')
  const mark = raw.search(/,\s*(?:marca|brand|condizioni|condition|taglia|size)\s*:/i)
  const priceAt = raw.search(/,?\s*\d+[.,]\d{2}\s?€/)
  const end = mark >= 0 ? mark : priceAt >= 0 ? priceAt : Math.min(raw.length, 80)
  const field = (re) => { const m = raw.match(re); return m ? m[1].trim() : null }
  return {
    title: raw.slice(0, end).replace(/[,\s]+$/, '').slice(0, 100),
    brand: field(/,\s*(?:marca|brand)\s*:\s*([^,]{1,40})/i),
    condition: field(/,\s*(?:condizioni|condition)\s*:\s*([^,]{1,40})/i),
    size: field(/,\s*(?:taglia|size)\s*:\s*([^,]{1,20})/i),
  }
}

/** A Vinted catalog path without its tracking parameter, or null when it is not one. */
const pmCatalogPath = (path) => {
  const p = String(path || '').replace(/([?&])referrer=[^&]*&?/, '$1').replace(/[?&]$/, '')
  return /^\/catalog\b/.test(p) ? p : null
}

/**
 * How the same product can be searched for, from what the page gives as data (extract.js pageFactsOf):
 * `kind` 'model' when the page links its model, 'brand' when it links brand × category; null when it links neither.
 */
export function productIdentityOf(facts, { brand = null, description = '' } = {}) {
  const f = facts && typeof facts === 'object' ? facts : {}
  const a = f.attributes || {}
  const links = f.links || {}
  const crumbs = Array.isArray(f.breadcrumbs) ? f.breadcrumbs.filter((c) => c && typeof c.path === 'string') : []
  const modelHref = pmCatalogPath(links.model_nav)
  const brandCrumb = [...crumbs].reverse().find((c) => /\/brand\//.test(c.path) && pmCatalogPath(c.path)) || null
  const categoryCrumb = [...crumbs].reverse().find((c) => !/\/brand\//.test(c.path)) || null
  const kind = modelHref ? 'model' : brandCrumb ? 'brand' : null
  if (!kind) return null
  const capacity = capacitiesOf(a.internal_memory_capacity || '')
  // «Nuovo senza cartellino» in the attributes and «usato pochissimo» in the description (a real listing): the
  // description is what the seller really says, and a used article compares with the used ones.
  const said = pmNorm(description)
  const declared = conditionBandOf(a.status)
  const band = declared === 'new' && /\busat[oaie]\b/.test(said) && !/\b(?:mai|non)\s+(?:stat[oaie]\s+)?usat/.test(said) ? 'used' : declared
  return {
    kind,
    model: pmValue(a.model_nav), modelHref,
    capacityGb: capacity.length ? capacity[0] : null,
    size: pmValue(a.size), condition: pmValue(a.status), band, bandFromDescription: band !== declared, colour: pmValue(a.color),
    brand: brand || null, brandHref: brandCrumb ? pmCatalogPath(brandCrumb.path) : null,
    category: categoryCrumb ? categoryCrumb.text || null : null,
  }
}

/**
 * Where to look: the model's own link, or brand × category with the words the AI gave (`query`). The brand link is
 * rewritten with Vinted's filter parameters (catalog[], brand_ids[], encoded as its own links are) so that the
 * search text applies to it.
 */
export function productSearchFor(identity, { origin = 'https://www.vinted.it', query = null } = {}) {
  const id = identity && typeof identity === 'object' ? identity : {}
  const base = String(origin || '').replace(/\/+$/, '')
  if (id.kind === 'model' && id.modelHref) return { mode: 'model', query: id.model || null, url: `${base}${id.modelHref}` }
  if (id.kind !== 'brand' || !id.brandHref) return null
  const words = String(query || '').trim().split(/\s+/).filter(Boolean).slice(0, 6).join(' ')
  const ids = id.brandHref.match(/^\/catalog\/(\d+)-[^/?]*\/brand\/(\d+)-/)
  const text = words ? `search_text=${encodeURIComponent(words)}` : ''
  if (ids) return { mode: 'brand', query: words || null, url: `${base}/catalog?catalog%5B%5D=${ids[1]}&brand_ids%5B%5D=${ids[2]}${text ? `&${text}` : ''}` }
  return { mode: 'brand', query: words || null, url: `${base}${id.brandHref}${text ? `${id.brandHref.includes('?') ? '&' : '?'}${text}` : ''}` }
}

const PM_BROKEN = /\b(rott[oaie]|non funziona\w*|non si accende|per ricambi|per pezzi|da riparare|difettos[oaie]|guast[oaie]|danneggiat[oaie]|bloccat[oaie]|icloud|solo scatola|scatola vuota|(?:schermo|display|vetro) (?:rotto|crepato|scheggiato))\b/
const PM_ACCESSORY = /^(cover|custodia|pellicola|vetro|caricatore|caricabatterie|cavo|ricambio|scocca|batteria|cinturino|scatola|adesivo|skin|supporto)$/

/**
 * The market from the cards of a search page ([{ id, price, text }]). `verdicts`: what the AI said of each card
 * (Map or object id → 'same' | 'variant' | 'family' | 'accessory' | 'other'), when it was asked.
 */
export function productMarketFrom(cards, { identity = null, mode = 'model', selfId = null, listPrice = null, verdicts = null, strict = true } = {}) {
  const id = identity && typeof identity === 'object' ? identity : {}
  const verdictOf = (cardId) => (verdicts instanceof Map ? verdicts.get(cardId) : verdicts && typeof verdicts === 'object' ? verdicts[cardId] : null) || null
  const judged = Boolean(verdicts && (verdicts instanceof Map ? verdicts.size : Object.keys(verdicts).length))
  const dropped = {}
  // Why each card was left out: the report shows a few of each kind, to judge the rules and the AI's sorting.
  const fate = new Map()
  const drop = (why, r) => { dropped[why] = (dropped[why] || 0) + 1; fate.set(r.id, why); return false }
  const seenIds = new Set()
  const rows = []
  for (const c of Array.isArray(cards) ? cards : []) {
    if (!c || seenIds.has(String(c.id))) continue
    seenIds.add(String(c.id))
    const price = cardPriceOf(c.price)
    if ((selfId !== null && String(c.id) === String(selfId)) || price === null) continue
    const facts = cardFactsOf(c.text)
    rows.push({ id: String(c.id), price, facts, said: pmNorm(c.text), title: pmNorm(facts.title), band: conditionBandOf(facts.condition), verdict: verdictOf(String(c.id)) })
  }
  let pool = rows.filter((r) => {
    if (PM_BROKEN.test(r.said)) return drop('difettoso', r)
    const head = r.title.match(/[a-z]+/g) || []
    if (head.slice(0, 2).some((w) => PM_ACCESSORY.test(w))) return drop('accessorio', r)
    if (pmFinite(id.capacityGb)) {
      // The card's own storage field when it has one («Capacità di archiviazione: 256 GB»), else what its title names.
      const field = (r.said.match(/capacit[a-z ]*:\s*([^,]+)/) || [])[1]
      const named = field ? capacitiesOf(field) : capacitiesOf(r.title).filter((gb) => gb >= 32)
      if (named.length && !named.includes(id.capacityGb)) return drop('altra capacità', r)
    }
    if (r.verdict === 'accessory') return drop('accessorio', r)
    if (r.verdict === 'other' || r.verdict === 'family') return drop('altro prodotto', r)
    // Asked and not answered for: the AI did not vouch for this card.
    if (judged && !r.verdict) return drop('non giudicato', r)
    return true
  })
  const narrow = (alike, why) => {
    const keep = new Set(alike.map((r) => r.id))
    for (const r of pool) if (!keep.has(r.id)) drop(why, r)
    pool = alike
  }
  // With enough cards the AI calls the same article, those are the market; else the variants stay and the result
  // says the cards are alike, not the same (`similar`).
  let similar = false
  if (judged) {
    const same = pool.filter((r) => r.verdict === 'same')
    // `strict` false: the listing names no model (a «maglione H&M»), so «same» and «variant» are one thing — the
    // AI told them apart one way on one run and another way on the next. Its word then only removes what is of
    // another kind, and what is left is alike, never the same.
    if (!strict) similar = pool.length > 0
    else if (same.length >= PRODUCT_MARKET.MIN) { if (same.length < pool.length) narrow(same, 'variante') } else similar = pool.some((r) => r.verdict !== 'same')
  }
  // The same condition (it moves the price a lot) when three remain; the same size (it moves it little) only when
  // SIZE_MIN remain.
  let conditionMatched = false
  if (id.band) {
    const alike = pool.filter((r) => r.band === id.band)
    if (alike.length >= PRODUCT_MARKET.MIN) { if (alike.length < pool.length) narrow(alike, 'altra condizione'); conditionMatched = true }
  }
  let sizeMatched = false
  if (mode === 'brand' && id.size) {
    const want = pmNorm(id.size).replace(/\s+/g, '')
    const alike = pool.filter((r) => r.facts.size && pmNorm(r.facts.size).replace(/\s+/g, '') === want)
    if (pool.length && alike.length === pool.length) sizeMatched = true
    else if (alike.length >= PRODUCT_MARKET.SIZE_MIN) { narrow(alike, 'altra taglia'); sizeMatched = true }
  }
  if (pool.length >= PRODUCT_MARKET.TRIM_FROM) {
    const mid = pmPercentile(pool.map((r) => r.price).sort((x, y) => x - y), 0.5)
    const factor = mode === 'model' ? PRODUCT_MARKET.TRIM_MODEL : PRODUCT_MARKET.TRIM_FACTOR
    // Among cards that are only alike a low price is as real as a high one (two coats at 10 € and 13 € were cut as
    // «anomalies» beside jackets at 120 €): only the absurd ones go.
    const low = similar ? PRODUCT_MARKET.TRIM_SIMILAR_LOW : factor
    const inside = pool.filter((r) => r.price >= mid / low && r.price <= mid * factor)
    if (inside.length < pool.length) narrow(inside, 'prezzo anomalo')
  }
  const prices = pool.map((r) => r.price).sort((x, y) => x - y)
  const show = (r) => `${r.facts.title.slice(0, 60)} — ${r.price} €${r.facts.condition ? ` (${r.facts.condition}${r.facts.size ? `, ${r.facts.size}` : ''})` : ''}`
  const perReason = {}
  const examples = {
    tenuti: pool.slice(0, 8).map((r) => (r.verdict ? `[${r.verdict}] ` : '') + show(r)),
    scartati: rows.filter((r) => fate.has(r.id) && (perReason[fate.get(r.id)] = (perReason[fate.get(r.id)] || 0) + 1) <= 3).slice(0, 15).map((r) => `${fate.get(r.id)}: ${show(r)}`),
  }
  const n = prices.length
  const basis = mode === 'model' ? 'model' : judged ? 'ai' : 'brand'
  const verdictCount = {}
  for (const r of pool) if (r.verdict) verdictCount[r.verdict] = (verdictCount[r.verdict] || 0) + 1
  const out = { ok: false, market: null, basis, similar, verdicts: judged ? verdictCount : null, seen: rows.length, kept: n, dropped, examples, confidence: null, conditionMatched, sizeMatched }
  if (n < 2) return out
  const medianPrice = pmR2(pmPercentile(prices, 0.5))
  const p25Price = pmR2(pmPercentile(prices, 0.25))
  const p75Price = pmR2(pmPercentile(prices, 0.75))
  const spread = medianPrice > 0 ? (p75Price - p25Price) / medianPrice : null
  const steps = ['bassa', 'media', 'alta']
  // Cards that are only alike (same brand and kind, no model to tell them by) are never a market to rest a resale
  // value on, however many and however close: they are told, and can only lower what is counted on.
  let level = basis === 'brand' || similar || n < PRODUCT_MARKET.MIN ? 0 : n >= 5 && (conditionMatched || !id.band) ? 2 : 1
  if (level > 0 && spread !== null && spread > PRODUCT_MARKET.MAX_SPREAD) level -= 1
  out.confidence = steps[level]
  out.ok = n >= PRODUCT_MARKET.MIN && level > 0
  const L = Number(listPrice)
  out.market = {
    n, medianPrice, p25Price, p75Price, minPrice: prices[0], maxPrice: prices[n - 1],
    gapPct: pmFinite(L) && L > 0 && medianPrice > 0 ? Math.round((L / medianPrice - 1) * 100) : null,
    basis, similar, confidence: out.confidence, conditionMatched, sizeMatched, spread: spread === null ? null : pmR2(spread), source: 'vinted-market',
  }
  return out
}
