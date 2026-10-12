/**
 * The second-hand channels searched on the user's command: Vinted, Subito and Wallapop (Italy).
 *  - search URLs (opened in a visible in-app browser, never fetched in the background);
 *  - readers for the data each search page carries (Vinted flight data, Subito __NEXT_DATA__, Wallapop's own search
 *    JSON observed in the page), all normalised to one candidate shape;
 *  - what the buyer pays on top of the price (official formulas where published, estimates flagged otherwise);
 *  - the offer rules of each channel.
 * Sources and dates are in the comments; anything not published officially is marked as an estimate.
 */

import { decodeEntities } from './extract.js'
import { parseVintedCatalog, vintedSearchUrl } from './catalog.js'

// Half-up to the cent (Vinted rounds its fee half-up; 1e-7 absorbs binary noise such as 14.745 → 14.7449999…).
const round2 = (n) => Math.round(n * 100 + 1e-7) / 100

/**
 * Channel facts (checked 2026-10-12).
 * - Vinted: fee 0.70 € + 5% (help 342, matched on 169 live price/fee pairs, half-up rounding); offers down to 60% of
 *   the price, 25 per day (help 258); shipping paid by the buyer, 2.29–4.09 € seen inside Italy, more cross-border.
 * - Subito (TuttoSubito, Condizioni Art. 10, 22-09-2026): 1.20 € + 5% up to 300 €, 1.20 € + 4.5% above, max 91.20 €,
 *   on the agreed price without shipping; «Proposta di acquisto» has no minimum, the seller has 4 days, 48 h to pay.
 * - Wallapop (Italy): «Protezione Wallapop» depends on the price but is NOT published: estimate max(1.95, 0.69 + 7.5%)
 *   capped at 50 € (secondary sources); offers at most 30% below the price, 10 per day, none to PRO sellers.
 */
export const CHANNELS = {
  vinted: {
    id: 'vinted', label: 'Vinted', origin: 'https://www.vinted.it',
    offerFloor: 0.6, offersPerDay: 25, feeEstimated: false, shippingEstimate: 3.5,
    offerRules: 'offerte fino al 40% sotto il prezzo, al massimo 25 al giorno; commissione acquirente 5% + 0,70 € ricalcolata sul prezzo concordato; la spedizione non si tratta',
  },
  subito: {
    id: 'subito', label: 'Subito', origin: 'https://www.subito.it',
    offerFloor: 0, offersPerDay: null, feeEstimated: false, shippingEstimate: 6,
    offerRules: '«Fai una proposta» senza minimo; il venditore ha 4 giorni per rispondere, poi hai 48 ore per pagare; commissione TuttoSubito 1,20 € + 5% (4,5% sopra 300 €) sul prezzo concordato, spedizione esclusa',
  },
  wallapop: {
    id: 'wallapop', label: 'Wallapop', origin: 'https://it.wallapop.com',
    offerFloor: 0.7, offersPerDay: 10, feeEstimated: true, shippingEstimate: 4,
    offerRules: 'offerte al massimo 30% sotto il prezzo, 10 al giorno, non ai venditori PRO; dopo l\'accettazione hai 24 ore per comprare e l\'articolo non è riservato; la protezione Wallapop dipende dal prezzo (importo non pubblicato)',
  },
}
export const CHANNEL_IDS = Object.keys(CHANNELS)

/**
 * What the buyer pays on top of the price for buying through the platform (secure payment and protection).
 * Returns { amount, estimated }. Hand delivery paid in cash has no fee on any channel.
 */
export function buyerFee(channelId, price) {
  const p = Number(price)
  if (!Number.isFinite(p) || p <= 0) return { amount: null, estimated: true }
  if (channelId === 'vinted') return { amount: round2(0.70 + 0.05 * p), estimated: false }
  if (channelId === 'subito') return { amount: round2(Math.min(91.2, 1.2 + (p <= 300 ? 0.05 : 0.045) * p)), estimated: false }
  if (channelId === 'wallapop') return { amount: round2(Math.min(50, Math.max(1.95, 0.69 + 0.075 * p))), estimated: true }
  return { amount: null, estimated: true }
}

/** Italian cities for Wallapop's distance-based search (the page needs coordinates and a label). */
export const ITALIAN_CITIES = [
  { label: 'Roma', latitude: 41.9028, longitude: 12.4964 },
  { label: 'Milano', latitude: 45.4642, longitude: 9.19 },
  { label: 'Napoli', latitude: 40.8518, longitude: 14.2681 },
  { label: 'Torino', latitude: 45.0703, longitude: 7.6869 },
  { label: 'Palermo', latitude: 38.1157, longitude: 13.3615 },
  { label: 'Genova', latitude: 44.4056, longitude: 8.9463 },
  { label: 'Bologna', latitude: 44.4949, longitude: 11.3426 },
  { label: 'Firenze', latitude: 43.7696, longitude: 11.2558 },
  { label: 'Bari', latitude: 41.1171, longitude: 16.8719 },
  { label: 'Catania', latitude: 37.5079, longitude: 15.083 },
  { label: 'Venezia', latitude: 45.4408, longitude: 12.3155 },
  { label: 'Verona', latitude: 45.4384, longitude: 10.9916 },
  { label: 'Padova', latitude: 45.4064, longitude: 11.8768 },
  { label: 'Brescia', latitude: 45.5416, longitude: 10.2118 },
  { label: 'Cagliari', latitude: 39.2238, longitude: 9.1217 },
  { label: 'Perugia', latitude: 43.1107, longitude: 12.3908 },
  { label: 'Ancona', latitude: 43.6158, longitude: 13.5189 },
  { label: 'Pescara', latitude: 42.4618, longitude: 14.2161 },
  { label: 'Reggio Calabria', latitude: 38.1113, longitude: 15.6473 },
  { label: 'Trento', latitude: 46.0748, longitude: 11.1217 },
]

const enc = (s) => encodeURIComponent(String(s || '').trim())

/**
 * Search URL of a channel. `opts` = { minPrice, maxPrice, city } (city = one of ITALIAN_CITIES, Wallapop only).
 * Only shippable listings are asked for on Subito and Wallapop (the user buys from all of Italy).
 */
export function channelSearchUrl(channelId, query, opts = {}) {
  const min = Number.isFinite(opts.minPrice) && opts.minPrice > 0 ? Math.floor(opts.minPrice) : null
  const max = Number.isFinite(opts.maxPrice) && opts.maxPrice > 0 ? Math.ceil(opts.maxPrice) : null
  if (channelId === 'vinted') {
    return `${vintedSearchUrl(query)}${min != null ? `&price_from=${min}` : ''}${max != null ? `&price_to=${max}` : ''}${min != null || max != null ? '&currency=EUR' : ''}`
  }
  if (channelId === 'subito') {
    // /annunci-italia/vendita/usato/ = all Market categories; shp=true = «Solo annunci con spedizione disponibile».
    return `${CHANNELS.subito.origin}/annunci-italia/vendita/usato/?q=${enc(query).replace(/%20/g, '+')}&shp=true${min != null ? `&ps=${min}` : ''}${max != null ? `&pe=${max}` : ''}`
  }
  if (channelId === 'wallapop') {
    const city = opts.city || ITALIAN_CITIES[0]
    // Coordinates are applied only together with location_label (checked in the web bundle, 2026-10-12).
    return `${CHANNELS.wallapop.origin}/search?keywords=${enc(query)}&latitude=${city.latitude}&longitude=${city.longitude}&location_label=${enc(city.label)}&is_shippable=true${min != null ? `&min_sale_price=${min}` : ''}${max != null ? `&max_sale_price=${max}` : ''}`
  }
  throw new Error(`Canale sconosciuto: ${channelId}`)
}

/** Which channel a URL belongs to (for the in-app browser and for messages coming from it). */
export function channelOfUrl(url) {
  let host = ''
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
  if (host === 'vinted.it' || host.endsWith('.vinted.it')) return 'vinted'
  if (host === 'subito.it' || host.endsWith('.subito.it')) return 'subito'
  if (host === 'wallapop.com' || host.endsWith('.wallapop.com')) return 'wallapop'
  return null
}

/* ───────── normalised candidate ───────── */

const num = (v) => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\s|€/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
const str = (v) => (typeof v === 'string' && v.trim() ? decodeEntities(v).trim() : null)
const httpsUrl = (u, hostRe) => (typeof u === 'string' && /^https:\/\//i.test(u) && (!hostRe || hostRe.test(u)) ? u : null)

/**
 * Completes a candidate with the buyer's costs: fee on the price, shipping (known or estimated) and the total.
 * `shipping` = { available, cost, free, estimated }.
 */
export function withCosts(c) {
  const ch = CHANNELS[c.source]
  const fee = c.buyerFee != null && c.source === 'vinted' ? { amount: c.buyerFee, estimated: false } : buyerFee(c.source, c.price)
  const ship = c.shipping || {}
  const shippingCost = ship.free ? 0 : Number.isFinite(ship.cost) ? ship.cost : ch ? ch.shippingEstimate : null
  const shippingEstimated = !ship.free && !Number.isFinite(ship.cost)
  const total = c.price != null && fee.amount != null && shippingCost != null ? round2(c.price + fee.amount + shippingCost) : null
  return { ...c, buyerFee: fee.amount, feeEstimated: fee.estimated, shippingCost, shippingEstimated, total }
}

/** Vinted search page → candidates (the catalog parser plus costs; shipping is only on the item page). */
export function readVinted(html) {
  const { items } = parseVintedCatalog(html)
  return items.map((c) => withCosts({
    ...c, description: null, location: null, reserved: false, sold: false, createdAt: null,
    shipping: { available: true, cost: null, free: false },
  }))
}

/* ───────── Subito ───────── */

const SUBITO_CONDITIONS = { 10: 'Nuovo', 20: 'Come nuovo', 30: 'Ottimo', 40: 'Buono', 50: 'Danneggiato' }
const feature = (ad, uri) => {
  const f = ad && ad.features
  if (!f) return null
  if (Array.isArray(f)) return f.find((x) => x && x.uri === uri) || null
  return f[uri] || null
}
const featureKey = (ad, uri) => {
  const f = feature(ad, uri)
  const v = f && Array.isArray(f.values) ? f.values[0] : null
  return v ? v.key : null
}
const featureValue = (ad, uri) => {
  const f = feature(ad, uri)
  const v = f && Array.isArray(f.values) ? f.values[0] : null
  return v ? v.value : null
}

/** One Subito ad (search payload, camelCase) → candidate, or null. */
export function subitoCandidate(ad) {
  if (!ad || typeof ad !== 'object') return null
  if (ad.kind && ad.kind !== 'AdItem') return null
  const title = str(ad.subject)
  const url = httpsUrl(ad.urls && ad.urls.default, /^https:\/\/www\.subito\.it\//i)
  if (!title || !url) return null
  const urn = typeof ad.urn === 'string' ? ad.urn : ''
  const listId = (urn.match(/:list:(\d+)$/) || url.match(/-(\d+)\.htm$/) || [])[1] || urn || url
  const price = num(featureKey(ad, '/price'))
  const images = Array.isArray(ad.images) ? ad.images.map((i) => i && (i.cdnBaseUrl || i.cdn_base_url)).filter((u) => httpsUrl(u, /^https:\/\/images\.sbito\.it\//i)) : []
  const shippable = featureKey(ad, '/item_shippable') === '1'
  const shipCost = num(featureKey(ad, '/item_shipping_cost_tuttosubito'))
  const conditionKey = Number(featureKey(ad, '/item_condition'))
  const geo = ad.geo || {}
  const sold = String(featureValue(ad, '/transaction_status') || '').toUpperCase() === 'SOLD'
  const typeKey = ad.type && ad.type.key
  return withCosts({
    source: 'subito',
    id: String(listId),
    title,
    description: str(ad.body),
    url,
    price: price && price > 0 ? price : null,
    listPrice: price && price > 0 ? price : null,
    currency: 'EUR',
    brand: null,
    size: null,
    condition: SUBITO_CONDITIONS[conditionKey] || str(featureValue(ad, '/item_condition')),
    favourites: null,
    promoted: false,
    photo: images[0] ? `${images[0]}?rule=gallery-desktop-1x-auto` : null,
    photos: images.map((u) => `${u}?rule=gallery-desktop-1x-auto`),
    thumb: images[0] ? `${images[0]}?rule=card-desktop-new-small-2x-auto` : null,
    sellerId: ad.advertiser && ad.advertiser.userId != null ? String(ad.advertiser.userId) : null,
    sellerBusiness: ad.advertiser ? Boolean(ad.advertiser.company) : null,
    location: [geo.town && geo.town.value, geo.city && geo.city.shortName].filter(Boolean).join(' ') || null,
    reserved: false,
    sold: sold || (typeKey != null && typeKey !== 's'),
    createdAt: typeof ad.date === 'string' ? ad.date : null,
    shipping: { available: shippable, cost: shippable ? shipCost : null, free: false },
  })
}

/**
 * Subito search page data (__NEXT_DATA__ JSON, object or string) → { items, total }.
 * Results: props.pageProps.initialState.items.{list[].item (kind AdItem), originalList, galleryList}, merged and
 * de-duplicated (galleryList holds promoted ads partly missing from the main list). Never throws.
 */
export function parseSubitoSearch(nextData) {
  let data = nextData
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      return { items: [], total: 0 }
    }
  }
  const items = data && data.props && data.props.pageProps && data.props.pageProps.initialState && data.props.pageProps.initialState.items
  if (!items || typeof items !== 'object') return { items: [], total: 0 }
  const ads = []
  if (Array.isArray(items.list)) for (const w of items.list) if (w && w.item) ads.push(w.item)
  if (Array.isArray(items.originalList)) ads.push(...items.originalList)
  if (Array.isArray(items.galleryList)) ads.push(...items.galleryList)
  const out = []
  const seen = new Set()
  for (const ad of ads) {
    let c = null
    try {
      c = subitoCandidate(ad)
    } catch {
      c = null
    }
    if (!c || seen.has(c.id)) continue
    seen.add(c.id)
    out.push(c)
  }
  return { items: out, total: Number.isFinite(items.total) ? items.total : out.length }
}

/* ───────── Wallapop ───────── */

const WALLAPOP_CONDITIONS = { new: 'Nuovo', as_good_as_new: 'Come nuovo', good: 'Buono', fair: 'Discreto', has_given_it_all: 'Usurato' }
const SELLER_PAYS = '04cf65ea-42f5-11ed-b878-0242ac120002'

/** One Wallapop search item → candidate, or null. */
export function wallapopCandidate(it) {
  if (!it || typeof it !== 'object') return null
  const title = str(it.title)
  const slug = typeof it.web_slug === 'string' && /^[a-z0-9-]+$/i.test(it.web_slug) ? it.web_slug : null
  if (!title || !slug) return null
  const price = it.price && typeof it.price === 'object' ? num(it.price.amount) : num(it.price)
  const imgs = Array.isArray(it.images) ? it.images.map((i) => i && i.urls && (i.urls.medium || i.urls.big || i.urls.small)).filter((u) => httpsUrl(u, /^https:\/\/cdn\.wallapop\.com\//i)) : []
  const ship = it.shipping || {}
  const shippable = Boolean(ship.item_is_shippable && ship.user_allows_shipping)
  const loc = it.location || {}
  const cond = it.type_attributes && it.type_attributes.condition && it.type_attributes.condition.value
  return withCosts({
    source: 'wallapop',
    id: String(it.id || slug),
    title,
    description: str(it.description),
    url: `${CHANNELS.wallapop.origin}/item/${slug}`,
    price: price && price > 0 ? price : null,
    listPrice: price && price > 0 ? price : null,
    currency: (it.price && it.price.currency) || 'EUR',
    brand: null,
    size: null,
    condition: WALLAPOP_CONDITIONS[cond] || null,
    favourites: null,
    promoted: Boolean(it.bump && it.bump.type),
    photo: imgs[0] || null,
    photos: imgs,
    thumb: imgs[0] || null,
    sellerId: it.user_id != null ? String(it.user_id) : null,
    sellerBusiness: null, // not in search results (only on the item page)
    location: [loc.city, loc.country_code && loc.country_code !== 'IT' ? loc.country_code : null].filter(Boolean).join(' ') || null,
    abroad: Boolean(loc.country_code && loc.country_code !== 'IT'),
    reserved: Boolean(it.reserved && it.reserved.flag),
    sold: false,
    createdAt: Number.isFinite(it.created_at) ? new Date(it.created_at).toISOString() : null,
    shipping: { available: shippable, cost: null, free: shippable && ship.cost_configuration_id === SELLER_PAYS },
  })
}

/**
 * Wallapop search JSON (the page's own api/v3/search or api/v3/search/section response, object or string) →
 * { items }. Items live at data.section.items (current) or data.section.payload.items (older). Never throws.
 */
export function parseWallapopSearch(json) {
  let data = json
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      return { items: [] }
    }
  }
  const section = data && data.data && data.data.section
  const raw = section ? (Array.isArray(section.items) ? section.items : section.payload && Array.isArray(section.payload.items) ? section.payload.items : []) : []
  const out = []
  const seen = new Set()
  for (const it of raw) {
    let c = null
    try {
      c = wallapopCandidate(it)
    } catch {
      c = null
    }
    if (!c || seen.has(c.id)) continue
    seen.add(c.id)
    out.push(c)
  }
  return { items: out }
}

/** Highest offer floor and other limits that change what to suggest, per channel. */
export function offerFloorFor(channelId, price, { sellerBusiness = false } = {}) {
  const ch = CHANNELS[channelId]
  if (!ch || !Number.isFinite(price)) return null
  if (channelId === 'wallapop' && sellerBusiness) return price // no offers to PRO sellers
  return round2(price * ch.offerFloor)
}
