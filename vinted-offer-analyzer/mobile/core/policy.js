/**
 * Target / discount policy by price band and listing age (engine 1.4.0, spec §2).
 *
 * The first month of real offers (12 decided, 1 accepted, discounts 18–37%, 0/8 under 50 €) showed that the opening
 * discount was the lever, not the send time: on a cheap item a 20% ask is a few euros for the seller and a nuisance,
 * on a fresh listing the seller has no reason to move yet. The policy answers «quanto chiedere» with a table
 * (price band × listing age) plus small, explainable modifiers; `null` cells mean «non offrire» (buy, heart, bundle).
 * The learned term `profile.discountShift` (monthly, bounded) moves the whole table for this user's sellers.
 *
 * Pure functions, no engine dependency: constants.js only. Private helpers are prefixed `pol` because the artifact
 * bundler puts every module in one scope.
 */
import { LISTING_AGES } from './constants.js'

/** Price bands of the listing price (upper bound exclusive). */
export const POLICY_BANDS = [
  { id: 'under_12', label: 'sotto 12 €', max: 12 },
  { id: 'from_12_to_20', label: '12–20 €', max: 20 },
  { id: 'from_20_to_40', label: '20–40 €', max: 40 },
  { id: 'from_40_to_100', label: '40–100 €', max: 100 },
  { id: 'over_100', label: 'oltre 100 €', max: Infinity },
]

/** Listing age tiers: under a week, one to four weeks (also when the age is unknown), over a month. */
export const POLICY_AGE_TIERS = [
  { id: 'fresh', label: 'meno di una settimana', maxDays: 7 },
  { id: 'mid', label: 'da una a quattro settimane', maxDays: 30 },
  { id: 'old', label: 'più di un mese', maxDays: Infinity },
]

/** Discount points by band × age tier; null = no offer (buy, favourite and wait, or ask for a bundle). */
export const TARGET_TABLE = Object.freeze({
  under_12: { fresh: null, mid: null, old: 10 },
  from_12_to_20: { fresh: null, mid: 10, old: 15 },
  from_20_to_40: { fresh: 8, mid: 12, old: 18 },
  from_40_to_100: { fresh: 10, mid: 15, old: 20 },
  over_100: { fresh: 10, mid: 15, old: 20 },
})

/** Additive modifiers in points: what the listing text, the seller, the category and the market say. */
export const POLICY_MODIFIERS = Object.freeze({
  clearing_out: 5,
  open_to_offers: 3,
  new_seller: 2,
  expert: -3,
  market_high: 5,
  collectible: -3,
  luxury: -3,
  fast_fashion: 3,
  kids: 3,
})

/** Ceilings in points: a business seller or an already reduced price leaves little room. */
export const POLICY_CAPS = Object.freeze({ business: 10, price_dropped: 10, price_dropped_recent: 8 })

export const POLICY_BOUNDS = Object.freeze({
  /** Final discount, points, after modifiers and the learned shift. */
  MIN_PCT: 5,
  MAX_PCT: 25,
  /** The learned shift (profile.discountShift) may move the table by at most this many points either way. */
  SHIFT_PTS: 6,
  /**
   * An offer must save at least this many euros (analyze.js applies the same threshold): below it the precise rounding
   * is pushed down, and when that would ask more than GAP_EXTRA_PTS over the table the policy says «compra».
   */
  MIN_GAP_EUR: 2,
  GAP_EXTRA_PTS: 6,
  /** Vinted refuses offers under 60% of the listing price; the market floor keeps the ask above the cheapest quarter. */
  FLOOR_SHARE: 0.6,
  MARKET_FLOOR_SHARE: 0.95,
  /** A price drop younger than this is a seller «in vendita»: the cap is tighter. */
  RECENT_DROP_HOURS: 48,
  /** Quick chips around the policy default (points), and the legacy chips when there is no policy. */
  QUICK_OFFSETS: [-4, 0, 4, 8],
  QUICK_DEFAULT: [10, 15, 20, 25, 30],
  QUICK_MIN_PCT: 5,
  QUICK_MAX_PCT: 40,
})

const polR2 = (v) => Math.round(v * 100) / 100
const polClamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const polFinite = (v) => typeof v === 'number' && Number.isFinite(v)
const polPrice = (raw) => {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : NaN
  const s = String(raw ?? '').trim().replace(/€/g, '').replace(/\s+/g, '').replace(',', '.')
  const v = Number(s)
  return s && Number.isFinite(v) && v > 0 ? v : NaN
}
const polEuro = (n) => `${(Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '')).replace('.', ',')} €`
const polSigned = (pts) => (pts > 0 ? `+${pts}` : `−${Math.abs(pts)}`)

/** Band of a listing price, or null without a usable price. */
export const policyBandOf = (listPrice) => {
  const L = polPrice(listPrice)
  if (!(L > 0)) return null
  return POLICY_BANDS.find((b) => L < b.max) || POLICY_BANDS[POLICY_BANDS.length - 1]
}

/** Age tier from the days online: under 7 days fresh, 7–30 days (inclusive) middle, over 30 old; an unknown age lands in the middle tier (spec §2.1). */
export const policyAgeTierOf = (ageDays) => {
  if (!polFinite(ageDays) || ageDays < 0) return { ...POLICY_AGE_TIERS[1], known: false }
  const tier = ageDays < POLICY_AGE_TIERS[0].maxDays ? POLICY_AGE_TIERS[0] : ageDays <= POLICY_AGE_TIERS[1].maxDays ? POLICY_AGE_TIERS[1] : POLICY_AGE_TIERS[2]
  return { ...tier, known: true }
}

/** Days online from either a number or a LISTING_AGES id / object; null when unknown. */
const polAgeDays = (ageDays, listingAge) => {
  if (polFinite(ageDays)) return ageDays
  const id = listingAge && typeof listingAge === 'object' ? listingAge.id : listingAge
  if (!id || id === 'unknown') return null
  if (listingAge && typeof listingAge === 'object' && polFinite(listingAge.days)) return listingAge.days
  const found = LISTING_AGES.find((a) => a.id === id)
  return found ? found.days : null
}

const polCategoryId = (category) => (category && typeof category === 'object' ? category.id : category) || null
const polId = (v) => (v && typeof v === 'object' ? v.id : v) || null

/**
 * Psychological precise price (spec §2.1): under 20 € steps of 0,50; from 20 € the nearest integer that is not a
 * multiple of 5 (23, not 25; ties go to the lower, cheaper number). `min` keeps the result at or above a floor,
 * `max` strictly below the listing price.
 */
export function precisePriceFor(value, listPrice, { min = 0, max = Infinity } = {}) {
  const L = polPrice(listPrice)
  const v = polFinite(value) ? value : NaN
  if (!(L > 0) || !Number.isFinite(v)) return null
  if (L < 20) {
    let p = Math.round(v * 2) / 2
    if (p < min) p = Math.ceil(min * 2 - 1e-9) / 2
    while (p >= max && p - 0.5 >= min) p -= 0.5
    return polR2(p)
  }
  let n = Math.round(v)
  if (n % 5 === 0) {
    const lo = n - 1
    const hi = n + 1
    n = Math.abs(v - lo) <= Math.abs(v - hi) ? lo : hi
  }
  while (n < min) n++
  if (n % 5 === 0) n++
  // Stepping under the list price: the skip of a multiple of 5 may not cross the floor (the multiple stays when it is
  // the only integer left in [min, max)), or the policy would ask under the floor it promises never to go below.
  while (n >= max && n - 1 >= min) {
    n--
    if (n % 5 === 0 && n - 1 >= min) n--
  }
  return n > 0 ? n : null
}

/**
 * True when a policy computed earlier (buildFormFromExtraction) still describes the listing: its band and age tier,
 * when stamped, are the ones `listPrice` and `ageDays` (null = unknown) fall in. The form may still carry the policy
 * after the user edited the price or the age; the gate and the arms must not trust it then. A policy without the
 * stamps (hand-built, the legacy default) is kept.
 */
export function policyFitsListing(policy, { listPrice, ageDays = null } = {}) {
  if (!policy || typeof policy !== 'object') return false
  const band = policyBandOf(listPrice)
  if (typeof policy.band === 'string' && band && policy.band !== band.id) return false
  if (typeof policy.ageTier === 'string' && policy.ageTier !== policyAgeTierOf(ageDays).id) return false
  return true
}

/**
 * The policy for a listing. Every argument is optional except the listing price:
 *   listPrice (number or form string) · ageDays (days online) or listingAge (LISTING_AGES id / object) · category (id or
 *   object) · sellerProfile (SELLER_PROFILES id) · listingSignal (LISTING_SIGNALS id or object) · sellerBusiness ·
 *   signals ({ priceDropped, priceDropHoursAgo | priceDrop: { hoursAgo }, sellerBusiness }) · market (value.js
 *   marketFromRows) · profile (learned profile with discountShift).
 * Returns null without a usable price, else
 *   { kind: 'offer' | 'no_offer', noOffer, discountPct, effectiveDiscountPct, targetPrice, floor, band, bandLabel,
 *     ageTier, ageDays, table, modifiers: [{ id, pts, label }], caps: [{ id, pts, label }], shift, reason: [string],
 *     summary, source: 'policy' }.
 * `discountPct` are the policy points before the precise rounding, `effectiveDiscountPct` the rounded price's discount.
 */
export function policyDiscountFor({ listPrice, ageDays = null, listingAge = null, category = null, sellerProfile = null, listingSignal = null, sellerBusiness = null, signals = null, market = null, profile = null } = {}) {
  const L = polPrice(listPrice)
  if (!(L > 0)) return null
  const band = policyBandOf(L)
  const days = polAgeDays(ageDays, listingAge)
  const tier = policyAgeTierOf(days)
  const table = TARGET_TABLE[band.id][tier.id]
  const sig = signals && typeof signals === 'object' ? signals : {}
  const categoryId = polCategoryId(category)
  const signalId = polId(listingSignal)
  const sellerId = polId(sellerProfile)
  const marketOk = market && polFinite(market.n) && market.n >= 2 && polFinite(market.p25Price) && polFinite(market.p75Price)
  const shiftRaw = profile && polFinite(profile.discountShift) ? profile.discountShift : 0
  const shift = polClamp(shiftRaw, -POLICY_BOUNDS.SHIFT_PTS, POLICY_BOUNDS.SHIFT_PTS)
  const ageText = !tier.known ? 'anzianità non nota' : days < 1 ? 'caricato oggi' : `${Math.round(days)} giorn${Math.round(days) === 1 ? 'o' : 'i'}`
  const base = { band: band.id, bandLabel: band.label, ageTier: tier.id, ageDays: tier.known ? days : null, table, shift, source: 'policy' }

  const noOffer = (why, alternative) => ({
    ...base, kind: 'no_offer', noOffer: true, discountPct: null, effectiveDiscountPct: null, targetPrice: null, floor: null,
    modifiers: [], caps: [], reason: [why], alternative, summary: `nessuna offerta: ${why}`,
  })
  if (marketOk && L <= market.p25Price) {
    return noOffer(`costa già meno del quarto più economico degli annunci simili (prezzo tipico ${polEuro(market.medianPrice)}): compra subito`, 'buy_now')
  }
  if (table === null) {
    return noOffer(`fascia ${band.label}, ${ageText}: un'offerta vale pochi euro e di solito non passa. Compra, metti il cuore o chiedi un lotto`, 'buy')
  }

  const modifiers = []
  const push = (id, pts, label) => modifiers.push({ id, pts, label })
  if (signalId === 'clearing_out') push('clearing_out', POLICY_MODIFIERS.clearing_out, "svuota l'armadio")
  else if (signalId === 'open_to_offers') push('open_to_offers', POLICY_MODIFIERS.open_to_offers, 'accetta offerte')
  if (sellerId === 'new_seller') push('new_seller', POLICY_MODIFIERS.new_seller, 'venditore nuovo')
  else if (sellerId === 'expert') push('expert', POLICY_MODIFIERS.expert, 'venditore esperto')
  if (categoryId === 'collectible') push('collectible', POLICY_MODIFIERS.collectible, 'collezionismo')
  else if (categoryId === 'luxury') push('luxury', POLICY_MODIFIERS.luxury, 'lusso')
  else if (categoryId === 'fast_fashion') push('fast_fashion', POLICY_MODIFIERS.fast_fashion, 'fast fashion')
  else if (categoryId === 'kids') push('kids', POLICY_MODIFIERS.kids, 'articolo per bambini')
  if (marketOk && L >= market.p75Price) push('market_high', POLICY_MODIFIERS.market_high, 'sopra tre quarti degli annunci simili')

  const caps = []
  const business = sellerBusiness === true || sig.sellerBusiness === true || sellerId === 'business'
  if (business) caps.push({ id: 'business', pts: POLICY_CAPS.business, label: 'venditore professionale' })
  const dropHours = polFinite(sig.priceDropHoursAgo) ? sig.priceDropHoursAgo : sig.priceDrop && polFinite(sig.priceDrop.hoursAgo) ? sig.priceDrop.hoursAgo : null
  const dropped = sig.priceDropped === true || (sig.priceDrop && typeof sig.priceDrop === 'object' && sig.priceDrop !== null) || dropHours !== null
  if (dropped) {
    const recent = dropHours !== null && dropHours < POLICY_BOUNDS.RECENT_DROP_HOURS
    caps.push(recent
      ? { id: 'price_dropped_recent', pts: POLICY_CAPS.price_dropped_recent, label: 'prezzo appena ribassato' }
      : { id: 'price_dropped', pts: POLICY_CAPS.price_dropped, label: 'prezzo già ribassato' })
  }

  // Points: table + modifiers + learned shift, under the caps (a cap is a ceiling on the final ask), then the bounds.
  let pts = table + modifiers.reduce((s, m) => s + m.pts, 0) + shift
  const cap = caps.length ? Math.min(...caps.map((c) => c.pts)) : Infinity
  const capped = pts > cap
  pts = polClamp(Math.min(pts, cap), POLICY_BOUNDS.MIN_PCT, POLICY_BOUNDS.MAX_PCT)

  const floor = polR2(Math.max(POLICY_BOUNDS.FLOOR_SHARE * L, marketOk ? POLICY_BOUNDS.MARKET_FLOOR_SHARE * market.p25Price : 0))
  const rawTarget = Math.max(L * (1 - pts / 100), floor)
  let targetPrice = precisePriceFor(rawTarget, L, { min: floor, max: L })
  // The precise rounding may land within MIN_GAP_EUR of the listing (22 € → 21 €): a saving that small is not worth an
  // offer, so step down to the last price that keeps the gap; if that asks far more than the table, say «compra».
  let gapCapped = false
  if (targetPrice !== null && L - targetPrice < POLICY_BOUNDS.MIN_GAP_EUR - 1e-9) {
    const step = L < 20 ? 0.5 : 1
    const capped = Math.floor((L - POLICY_BOUNDS.MIN_GAP_EUR) / step + 1e-9) * step
    const gapPts = ((L - capped) / L) * 100
    if (capped < floor - 1e-9 || capped <= 0 || gapPts > pts + POLICY_BOUNDS.GAP_EXTRA_PTS) {
      return noOffer(`sotto ${polEuro(POLICY_BOUNDS.MIN_GAP_EUR)} di risparmio un'offerta non vale lo scambio: compra, o chiedi la spedizione inclusa o un lotto`, 'buy')
    }
    targetPrice = polR2(capped)
    gapCapped = true
  }
  const effective = targetPrice !== null ? Math.round(((L - targetPrice) / L) * 1000) / 10 : null

  const reason = [`Fascia ${band.label}, ${ageText}: la tabella parte da −${table}%.`]
  for (const m of modifiers) reason.push(`${m.label.charAt(0).toUpperCase()}${m.label.slice(1)}: ${polSigned(m.pts)} punti.`)
  if (capped) reason.push(`${caps.find((c) => c.pts === cap).label.charAt(0).toUpperCase()}${caps.find((c) => c.pts === cap).label.slice(1)}: non oltre il ${cap}%.`)
  if (shift !== 0) reason.push(`Dai tuoi esiti: ${polSigned(Math.round(shift * 10) / 10)} punti.`)
  if (targetPrice !== null && rawTarget > L * (1 - pts / 100) + 1e-9) reason.push(`Mai sotto ${polEuro(floor)} (il 60% del prezzo, o il mercato).`)
  if (gapCapped) reason.push(`Almeno ${polEuro(POLICY_BOUNDS.MIN_GAP_EUR)} di risparmio, altrimenti l'offerta non vale lo scambio.`)
  const summaryBits = [`fascia ${band.label}`, ageText, ...modifiers.map((m) => `${m.label} ${polSigned(m.pts)}`), ...(capped ? [`massimo ${cap}%`] : []), ...(shift !== 0 ? [`tuoi esiti ${polSigned(Math.round(shift * 10) / 10)}`] : [])]

  return {
    ...base, kind: 'offer', noOffer: false, discountPct: pts, effectiveDiscountPct: effective, targetPrice, floor,
    modifiers, caps, reason, summary: `−${effective !== null ? Math.round(effective) : pts}%: ${summaryBits.join(', ')}`,
  }
}

/**
 * Quick-chip discounts around the policy default d₀: [d₀−4, d₀, d₀+4, d₀+8] within [5, 40]; the chip equal to
 * `policy.discountPct` is the one to highlight. A «no offer» policy proposes the band's lightest table ask; without a
 * policy the legacy chips come back.
 */
export function quickDiscountsFor(policy) {
  let d0 = policy && polFinite(policy.discountPct) ? policy.discountPct : null
  if (d0 === null && policy && policy.band && TARGET_TABLE[policy.band]) {
    const cells = Object.values(TARGET_TABLE[policy.band]).filter((v) => v !== null)
    d0 = cells.length ? Math.min(...cells) : null
  }
  if (d0 === null) return [...POLICY_BOUNDS.QUICK_DEFAULT]
  const base = Math.round(d0)
  const out = []
  for (const off of POLICY_BOUNDS.QUICK_OFFSETS) {
    const v = polClamp(base + off, POLICY_BOUNDS.QUICK_MIN_PCT, POLICY_BOUNDS.QUICK_MAX_PCT)
    if (!out.includes(v)) out.push(v)
  }
  return out.sort((a, b) => a - b)
}
