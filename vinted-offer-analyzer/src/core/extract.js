/**
 * Extraction from a Vinted item page and mapping onto the analyzer's form.
 * Pure string parsing (no DOM): works in Node, the browser and React Native.
 *
 * What a public item page contains server-side (verified October 2026, also in a browser's DOM after hydration):
 * - JSON-LD Product: name, description, brand, price, currency, condition, category path, color.
 * - data-testid="seller-last-logged-in": "Ultima visita 26 min fa".
 * - data-testid="profile-username" and a rating aria-label "valutazione di 5 su 5 stelle".
 * - itemProp="upload_date": "un minuto fa", "3 giorni fa", "2 settimane fa"…
 */

import { CATEGORIES, SELLER_PROFILES } from './constants.js'

const CONDITION_LABELS = { New: 'nuovo con etichetta', NewWithTags: 'nuovo con etichetta', NewWithoutTags: 'nuovo senza etichetta', Used: 'usato', Refurbished: 'ricondizionato', Damaged: 'danneggiato' }

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export const decodeEntities = (s) => String(s || '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&([a-z]+);/gi, (m, name) => (ENTITIES[name.toLowerCase()] !== undefined ? ENTITIES[name.toLowerCase()] : m))

const stripTags = (s) => decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()

const NUMBER_WORDS = { un: 1, una: 1, "un'": 1, uno: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10 }

/**
 * "26 min fa", "un'ora fa", "ieri", "3 giorni fa", "una settimana fa", "2 mesi fa", "un anno fa"
 * → elapsed days (fractional), or null when unparseable. Prefixes like "Ultima visita" / "Caricato" are ignored.
 */
export function parseRelativeItalian(text) {
  const t = String(text || '').toLowerCase().replace(/[’]/g, "'").trim()
  if (!t) return null
  if (/\b(adesso|ora|poco fa|un attimo fa)\b/.test(t) && !/\bun'?ora\b/.test(t)) return 0
  if (/\bieri\b/.test(t)) return 1
  if (/\boggi\b/.test(t)) return 0
  const m = t.match(/(\d+|un'|un|una|uno|due|tre|quattro|cinque|sei|sette|otto|nove|dieci)\s*(secondi?|sec|minut[oi]|min|or[ae]|giorn[oi]|gg|settiman[ae]|sett|mes[ei]|ann[oi])\b/)
  if (!m) return null
  const raw = m[1].replace(/\s/g, '')
  const n = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw] || 1
  const unit = m[2]
  if (/^sec/.test(unit)) return n / 86_400
  if (/^min/.test(unit)) return n / 1_440
  if (/^or/.test(unit)) return n / 24
  if (/^(giorn|gg)/.test(unit)) return n
  if (/^sett/.test(unit)) return n * 7
  if (/^mes/.test(unit)) return n * 30
  if (/^ann/.test(unit)) return n * 365
  return null
}

const firstMatch = (html, re) => {
  const m = html.match(re)
  return m ? m[1] : null
}

/** Parses the HTML of a Vinted item page. Every field may be null; `found`/`missing` list what was recognised. */
export function parseVintedItemHtml(html) {
  const src = String(html || '').replace(/<!--[\s\S]*?-->/g, '')
  const out = {
    title: null, listPrice: null, currency: null, brand: null, condition: null, categoryText: null, description: null, color: null, url: null,
    uploadedText: null, uploadedDays: null, sellerUsername: null, sellerRating: null, sellerFeedbackCount: null, sellerLastSeenText: null, sellerLastSeenDays: null,
    sellerBusiness: null, sellerBadges: [],
    found: [], missing: [],
  }

  const ldScripts = [...src.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)]
  for (const m of ldScripts) {
    try {
      const json = JSON.parse(m[1])
      const product = Array.isArray(json) ? json.find((j) => j && j['@type'] === 'Product') : (json && json['@type'] === 'Product' ? json : null)
      if (!product) continue
      out.title = product.name ? decodeEntities(product.name).trim() : null
      out.description = product.description ? decodeEntities(product.description).trim() : null
      // brand is a Brand object ({"@type":"Brand","name":""} when the seller left it empty) or, on older pages, a string.
      const brand = product.brand && typeof product.brand === 'object' ? product.brand.name : product.brand
      out.brand = typeof brand === 'string' && brand.trim() ? decodeEntities(brand).trim() : null
      out.categoryText = product.category ? decodeEntities(product.category).trim() : null
      out.color = product.color ? decodeEntities(product.color).trim() : null
      const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers
      if (offer) {
        const price = Number(String(offer.price).replace(',', '.'))
        out.listPrice = Number.isFinite(price) && price > 0 ? price : null
        out.currency = offer.priceCurrency || null
        const rawCondition = offer.itemCondition ? String(offer.itemCondition).replace(/^.*\//, '').replace(/Condition$/, '') : null
        out.condition = rawCondition ? (CONDITION_LABELS[rawCondition] || rawCondition) : null
        out.url = offer.url || null
      }
      break
    } catch {
      // malformed JSON-LD: fall back to meta tags below
    }
  }
  if (!out.title) {
    const og = firstMatch(src, /<meta property="og:title" content="([^"]*)"/i)
    if (og) out.title = decodeEntities(og).replace(/\s*\|\s*Vinted\s*$/i, '').trim()
  }
  if (!out.description) {
    const og = firstMatch(src, /<meta property="og:description" content="([^"]*)"/i)
    if (og) out.description = decodeEntities(og).trim()
  }

  const upload = firstMatch(src, /itemProp="upload_date"[^>]*>\s*<span[^>]*>([^<]+)</i) || firstMatch(src, /\\"value\\":\\"Caricato ([^"\\]+)\\"/)
  if (upload) {
    out.uploadedText = stripTags(upload).replace(/^caricato\s*/i, '')
    out.uploadedDays = parseRelativeItalian(out.uploadedText)
  }
  const lastSeen = firstMatch(src, /<[a-z0-9]+[^>]*data-testid="seller-last-logged-in"[^>]*>\s*([^<]+?)\s*<\//i)
  if (lastSeen) {
    out.sellerLastSeenText = stripTags(lastSeen)
    out.sellerLastSeenDays = parseRelativeItalian(out.sellerLastSeenText)
  }
  const username = firstMatch(src, /<[a-z0-9]+[^>]*data-testid="profile-username"[^>]*>\s*([^<]{1,80}?)\s*<\//i)
  if (username) out.sellerUsername = stripTags(username)
  const rating = firstMatch(src, /valutazione di ([\d.,]+) su 5 stelle/i)
  if (rating) out.sellerRating = Number(rating.replace(',', '.'))
  // The seller block is also embedded as escaped JSON (feedback_count, feedback_reputation 0..1, business flag, badges).
  const feedback = firstMatch(src, /\\"feedback_count\\":(\d+)/)
    || firstMatch(src, /web_ui__Rating__label[^>]*>(?:\s*<span[^>]*>)?\s*(\d+)\s*</i)
    || firstMatch(src, /su 5 stelle"[\s\S]{0,400}?>\s*\(?(\d+)\)?\s*<\/span>/i)
  if (feedback) out.sellerFeedbackCount = Number(feedback)
  else if (/Nessuna recensione|Nessuna valutazione/i.test(src)) out.sellerFeedbackCount = 0
  const reputation = firstMatch(src, /\\"feedback_reputation\\":([\d.]+)/)
  if (out.sellerRating === null && reputation) out.sellerRating = Math.round(Number(reputation) * 5 * 10) / 10
  const business = firstMatch(src, /\\"business\\":(true|false)[^}]{0,200}\\"feedback_count\\"/)
  if (business) out.sellerBusiness = business === 'true'
  const badgeBlock = firstMatch(src, /\\"badges\\":\[([^\]]*)\][^}]{0,80}\\"username\\"/)
  if (badgeBlock) out.sellerBadges = [...badgeBlock.matchAll(/\\"type\\":\\"([A-Z_]+)\\"/g)].map((m) => m[1])

  const labels = [
    ['title', 'titolo'], ['listPrice', 'prezzo'], ['brand', 'marca'], ['categoryText', 'categoria'], ['condition', 'condizioni'],
    ['uploadedText', 'data di caricamento'], ['sellerLastSeenText', 'attività del venditore'], ['sellerRating', 'valutazione del venditore'],
    ['sellerFeedbackCount', 'numero di recensioni'], ['description', 'descrizione'],
  ]
  for (const [key, label] of labels) (out[key] !== null && out[key] !== undefined ? out.found : out.missing).push(label)
  return out
}

/**
 * Anti-bot pages served instead of the listing (October 2026: Cloudflare in front of www.vinted.it, DataDome behind it).
 * Returns 'cloudflare' | 'datadome' | null. A real item page also loads DataDome's script, so a page that carries the
 * listing data (JSON-LD Product or og:title) is never reported as a challenge.
 */
export function detectVintedChallenge(html) {
  const src = String(html || '')
  if (!src) return null
  if (/application\/ld\+json[^>]*>\s*\{[^<]{0,200}"@type"\s*:\s*"Product"/i.test(src) || /<meta[^>]+property="og:title"[^>]+content="[^"]{2,}/i.test(src)) return null
  if (/_cf_chl_opt|\/cdn-cgi\/challenge-platform\/|challenges\.cloudflare\.com|cf-browser-verification|<title>\s*Just a moment/i.test(src)) return 'cloudflare'
  if (/captcha-delivery\.com|geo\.captcha|interstitial\.captcha|datadome[\s\S]{0,200}captcha|verifica di essere umano/i.test(src)) return 'datadome'
  return null
}

/* ───────── mapping onto the analyzer ───────── */

const DECORATION = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}]|\u{FE0F}|\u{200D}/gu

/** Listing titles are quoted in the message to the seller: drop emoji and cut at a word boundary, never mid-word. */
export function cleanTitle(title, max = 90) {
  const t = String(title || '').replace(DECORATION, ' ').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const at = cut.lastIndexOf(' ')
  return (at > max * 0.5 ? cut.slice(0, at) : cut).replace(/[\s,;:.\-–(]+$/, '')
}

const labelOf = (list, id) => ((list.find((x) => x.id === id) || {}).label || id)
const BADGE_LABELS = { ACTIVE_LISTER: 'pubblica spesso', SPEEDY_SHIPPING: 'spedisce in fretta', FAST_REPLIER: 'risponde in fretta' }

const LUXURY_BRANDS = /\b(gucci|prada|louis vuitton|chanel|herm[èe]s|dior|fendi|balenciaga|bottega veneta|burberry|versace|valentino|saint laurent|ysl|c[eé]line|loewe|givenchy|miu miu|rolex|cartier|omega|tiffany|bulgari|dolce\s*&\s*gabbana|armani(?! exchange)|moncler|golden goose|off-white|balmain|chlo[ée]|alexander mcqueen|jimmy choo|tod'?s|ferragamo|max mara)\b/i
const FAST_FASHION_BRANDS = /\b(zara|h\s*&\s*m|hm|shein|primark|bershka|pull\s*&\s*bear|stradivarius|mango|ovs|terranova|tezenis|calzedonia|intimissimi|kiabi|c\s*&\s*a|new yorker|uniqlo|asos|boohoo|prettylittlething|missguided|jennyfer|alcott|piazza italia|benetton|motivi|oviesse|subdued|brandy melville|hollister|abercrombie)\b/i
const SNEAKER_HINTS = /\b(sneakers?|scarpe da ginnastica|scarpe sportive|air force|air max|jordan|dunk|yeezy|new balance|nb\s?\d{3}|adidas samba|gazelle|campus|superstar|stan smith|converse|vans|asics|reebok|puma suede|hoka|salomon)\b/i
const ELECTRONICS_HINTS = /\b(elettronica|smartphone|iphone|samsung galaxy|pixel|tablet|ipad|console|playstation|ps[45]|xbox|nintendo|switch|cuffie|airpods|auricolari|smartwatch|apple watch|laptop|notebook|macbook|monitor|fotocamera|gopro|drone|kindle|dyson|speaker|videogioc)\b/i
const COLLECTIBLE_HINTS = /\b(collezionismo|collezione|carte|pok[ée]mon|yu-?gi-?oh|magic the gathering|funko|lego|vintage|fumett|manga|vinil|francobolli|monete|figure|statua|action figure|hot wheels|raro|rara|rare|limited|edizione limitata|prima edizione|autografat)\b/i
const KIDS_HINTS = /^(bambin[ie]|neonat[io]|ragazz[ie]|kids|bimb[aoie])\b|\b(bambin[ioae]|neonat[io]|ragazz[ioae]|bimb[aoie]|baby)\b/i

export function categoryGuess({ categoryText = '', brand = '', title = '', description = '', listPrice = null }) {
  const cat = String(categoryText || '')
  const text = `${title || ''} ${description || ''}`
  const brandText = String(brand || '')
  if (KIDS_HINTS.test(cat)) return { id: 'kids', reason: `categoria "${cat}"` }
  if (LUXURY_BRANDS.test(brandText) || (LUXURY_BRANDS.test(title) && (listPrice === null || listPrice >= 80))) return { id: 'luxury', reason: `marca ${brandText || 'di lusso'}` }
  if (/\b(scarpe|sneakers|calzature)\b/i.test(cat) && (SNEAKER_HINTS.test(cat) || SNEAKER_HINTS.test(text) || /\b(nike|adidas|puma|new balance|reebok|asics|vans|converse|jordan)\b/i.test(brandText))) return { id: 'sneakers', reason: 'scarpe sportive' }
  if (SNEAKER_HINTS.test(title) && /\b(nike|adidas|puma|new balance|reebok|asics|vans|converse|jordan|hoka|salomon)\b/i.test(`${brandText} ${title}`)) return { id: 'sneakers', reason: 'titolo e marca' }
  if (ELECTRONICS_HINTS.test(cat) || (ELECTRONICS_HINTS.test(title) && /\b(apple|samsung|sony|nintendo|microsoft|xiaomi|huawei|google|dyson|bose|jbl|garmin)\b/i.test(`${brandText} ${title}`))) return { id: 'electronics', reason: 'elettronica' }
  if (COLLECTIBLE_HINTS.test(cat) || /\b(collezionismo|carte|fumetti|vinili|lego|funko|pok[ée]mon)\b/i.test(title)) return { id: 'collectible', reason: 'collezionismo' }
  if (FAST_FASHION_BRANDS.test(brandText)) return { id: 'fast_fashion', reason: `marca ${brandText}` }
  if (/^(donna|uomo|women|men)\b/i.test(cat) || /\b(abbigliamento|vestiti|maglie|felpe|pantaloni|jeans|giacche|abiti|gonne|camicie|t-shirt|scarpe)\b/i.test(cat)) {
    return { id: brandText ? 'other' : 'fast_fashion', reason: brandText ? `abbigliamento ${brandText}` : 'abbigliamento senza marca' }
  }
  return { id: 'other', reason: cat ? `categoria "${cat}"` : 'categoria non riconosciuta' }
}

export function listingAgeGuess(days) {
  if (days === null || days === undefined || !Number.isFinite(days)) return 'unknown'
  if (days < 1) return 'today'
  if (days < 7) return 'days_2_6'
  if (days < 14) return 'weeks_1_2'
  if (days < 30) return 'weeks_2_4'
  return 'over_month'
}

export function sellerProfileGuess({ lastSeenDays = null, feedbackCount = null, rating = null }) {
  if (lastSeenDays !== null && lastSeenDays >= 14) return { id: 'inactive', reason: `ultima visita ${Math.round(lastSeenDays)} giorni fa` }
  if (feedbackCount !== null && feedbackCount < 5) return { id: 'new_seller', reason: `${feedbackCount} recension${feedbackCount === 1 ? 'e' : 'i'}` }
  if (feedbackCount !== null && feedbackCount >= 20 && rating !== null && rating >= 4.8) return { id: 'expert', reason: `${feedbackCount} recensioni, ${rating} stelle` }
  if (feedbackCount === null && rating !== null && rating >= 4.8 && lastSeenDays !== null && lastSeenDays < 2) return { id: 'unknown', reason: 'valutazione alta ma recensioni non lette' }
  return { id: 'unknown', reason: 'dati insufficienti' }
}

const FIXED_PRICE = /\b(prezzo (fisso|non trattabile|non negoziabile|bloccato)|non trattabile|non negoziabile|no offerte|no offers|niente offerte|non accetto offerte|offerte? non accettat[ea]|no sconti|non faccio sconti|no trattative)\b/i
const OPEN_TO_OFFERS = /\b(accetto offerte|trattabile|trattabili|fate offerte|fatemi offerte|aperto a offerte|offerte benvenute|offerte ben accette|prezzo trattabile|si accettano offerte|accetto proposte|ascolto offerte)\b/i
const CLEARING_OUT = /\b(svuoto (l')?armadio|svuoto tutto|faccio spazio|vendo tutto|sgombero|devo liberare|cambio casa|trasloc[oa]|svendo|svendita|tutto deve andare|prezzi stracciati)\b/i

export function signalFromText(text) {
  const t = String(text || '')
  if (FIXED_PRICE.test(t)) return { id: 'fixed_price', reason: 'l\'annuncio dice che il prezzo non è trattabile' }
  if (CLEARING_OUT.test(t)) return { id: 'clearing_out', reason: 'il venditore sta svuotando l\'armadio' }
  if (OPEN_TO_OFFERS.test(t)) return { id: 'open_to_offers', reason: 'l\'annuncio invita a fare offerte' }
  return { id: 'none', reason: 'nessun segnale nel testo' }
}

/** First plausible euro amount in free text ("8,90 €", "€ 25", "25€"). */
export function findPriceInText(text) {
  const t = String(text || '')
  const m = t.match(/(\d{1,5}(?:[.,]\d{1,2})?)\s*€/) || t.match(/€\s*(\d{1,5}(?:[.,]\d{1,2})?)/)
  if (!m) return null
  const v = Number(m[1].replace(',', '.'))
  return Number.isFinite(v) && v > 0 ? v : null
}

const roundTarget = (value, listPrice) => (listPrice >= 20 ? Math.round(value) : Math.round(value * 2) / 2)
const euro = (n) => `${(Number.isInteger(n) ? String(n) : n.toFixed(2)).replace('.', ',')} €`

/**
 * Turns an extraction into form values plus a human summary. Fields the page did not provide
 * keep the previous form value (or the neutral default).
 */
export function buildFormFromExtraction(ex, { link = '', targetDiscountPct = 20, previousForm = {} } = {}) {
  const found = []
  const guessed = []
  const missing = []
  const form = { ...previousForm, link: link || previousForm.link || ex.url || '' }

  const title = cleanTitle(ex.title)
  if (title) { form.itemTitle = title; found.push(`Titolo: ${title.length > 60 ? `${cleanTitle(title, 60)}…` : title}`) } else missing.push('titolo')
  if (ex.listPrice) {
    form.listPrice = String(ex.listPrice).replace('.', ',')
    const target = roundTarget(ex.listPrice * (1 - targetDiscountPct / 100), ex.listPrice)
    form.targetPrice = String(target).replace('.', ',')
    found.push(`Prezzo ${euro(ex.listPrice)} (target proposto ${euro(target)}, −${targetDiscountPct}%)`)
  } else missing.push('prezzo')

  const cat = categoryGuess(ex)
  form.category = cat.id
  guessed.push(`Categoria: ${labelOf(CATEGORIES, cat.id)} (${cat.reason})`)

  if (ex.uploadedDays !== null && ex.uploadedDays !== undefined) {
    form.listingAge = listingAgeGuess(ex.uploadedDays)
    found.push(`Caricato ${ex.uploadedText}`)
  } else { form.listingAge = previousForm.listingAge || 'unknown'; missing.push('data di caricamento') }

  const seller = sellerProfileGuess({ lastSeenDays: ex.sellerLastSeenDays, feedbackCount: ex.sellerFeedbackCount, rating: ex.sellerRating })
  form.sellerProfile = seller.id
  const sellerBits = [
    ex.sellerUsername ? ex.sellerUsername : null,
    ex.sellerLastSeenText ? ex.sellerLastSeenText.toLowerCase() : null,
    ex.sellerRating !== null ? `${ex.sellerRating} stelle` : null,
    ex.sellerFeedbackCount !== null ? `${ex.sellerFeedbackCount} recension${ex.sellerFeedbackCount === 1 ? 'e' : 'i'}` : null,
    ex.sellerBusiness ? 'venditore professionale' : null,
    ...(ex.sellerBadges || []).map((b) => BADGE_LABELS[b]).filter(Boolean),
  ].filter(Boolean)
  if (sellerBits.length) found.push(`Venditore: ${sellerBits.join(', ')}`)
  guessed.push(`Venditore: ${labelOf(SELLER_PROFILES, seller.id).toLowerCase()} (${seller.reason})`)
  if (ex.sellerFeedbackCount === null) missing.push('numero di recensioni')

  const signal = signalFromText(`${ex.title || ''} ${ex.description || ''}`)
  form.listingSignal = signal.id
  if (signal.id !== 'none') found.push(`Nell'annuncio: ${signal.reason}`)

  return { form, summary: { found, guessed, missing, condition: ex.condition, brand: ex.brand } }
}
