/**
 * What a purchase on Vinted really costs, and what is left when the article is sold again (1.11).
 *
 * The buyer pays the price, Vinted's buyer protection and the shipping; the seller receives the price. So buying to
 * sell again (or simply not to lose) is judged on the total, never on the price alone:
 *
 *   total = price + (0,70 € + 5% of the price) + shipping
 *
 * The protection is Vinted's published formula (the same as channels.js, checked on real listings to the cent:
 * 6 → 7,00 · 9 → 10,15 · 12,60 → 13,93 · 20 → 21,70 · 31 → 33,25 · 200 → 210,70). It is charged on the price agreed,
 * so every euro taken off an offer saves 1,05 €; the fixed 0,70 € and the shipping are what weighs on a cheap article.
 * The shipping is the «Spedizione da…» of the listing when the page says it, else an estimate by size and value.
 *
 * - vintedBuyerFee(price), purchaseCost(price, shipping)
 * - shippingEstimateFor({ category, listPrice })
 * - ceilingPriceFor(resale, shipping, marginPct): the highest price that still leaves the margin when sold at `resale`
 * - resaleMarginOf(price, shipping, resale)
 */

// Half-up to the cent, as Vinted rounds its protection (1e-7 absorbs binary noise such as 14.745 → 14.7449999…).
const cstR2 = (v) => Math.round(v * 100 + 1e-7) / 100
const cstFinite = (v) => typeof v === 'number' && Number.isFinite(v)

export const COSTS = Object.freeze({
  FEE_FIXED: 0.7,
  FEE_PCT: 5,
  /**
   * Shipping when the listing does not say (the user's own rule of thumb, Nov 2026): about 3 € for a small article,
   * up to 10 € for a large or valuable one; a book 3 €, a high-end phone 10 €.
   */
  SHIPPING_SMALL: 3,
  SHIPPING_MEDIUM: 4.5,
  SHIPPING_LARGE: 7,
  SHIPPING_VALUABLE: 10,
})

/** Vinted's buyer protection on a price: 0,70 € + 5%. Null when the price is not one. */
export const vintedBuyerFee = (price) => (cstFinite(price) && price > 0 ? cstR2(COSTS.FEE_FIXED + (price * COSTS.FEE_PCT) / 100) : null)

/** The shipping the buyer pays when the listing does not say it: { amount, source: 'estimate', why }. */
export function shippingEstimateFor({ category = null, listPrice = null } = {}) {
  const id = category && typeof category === 'object' ? category.id : category
  const L = Number(listPrice)
  const price = cstFinite(L) ? L : 0
  if (price >= 400 || (id === 'electronics' && price >= 250)) return { amount: COSTS.SHIPPING_VALUABLE, source: 'estimate', why: 'articolo di valore' }
  if (price >= 150 || (id === 'electronics' && price >= 80)) return { amount: COSTS.SHIPPING_LARGE, source: 'estimate', why: 'articolo grande o costoso' }
  if (['electronics', 'sneakers', 'luxury'].includes(id) || price >= 60) return { amount: COSTS.SHIPPING_MEDIUM, source: 'estimate', why: 'articolo medio' }
  return { amount: COSTS.SHIPPING_SMALL, source: 'estimate', why: 'articolo piccolo' }
}

/** What buying at `price` costs in all: { price, fee, shipping, total }. Null when the price is not one. */
export function purchaseCost(price, shipping = 0) {
  const fee = vintedBuyerFee(price)
  if (fee === null) return null
  const ship = cstFinite(shipping) && shipping > 0 ? cstR2(shipping) : 0
  return { price: cstR2(price), fee, shipping: ship, total: cstR2(price + fee + ship) }
}

/**
 * The highest price at which the article, sold again at `resale`, still leaves `marginPct` of the resale (0 = not
 * losing a cent). Rounded down to the cent; 0 when no price can do it (the fixed costs alone eat the resale).
 */
export function ceilingPriceFor(resale, shipping = 0, marginPct = 0) {
  if (!cstFinite(resale) || resale <= 0) return 0
  const keep = cstFinite(marginPct) ? Math.min(Math.max(marginPct, 0), 90) : 0
  const ship = cstFinite(shipping) && shipping > 0 ? shipping : 0
  const target = resale * (1 - keep / 100)
  const raw = (target - ship - COSTS.FEE_FIXED) / (1 + COSTS.FEE_PCT / 100)
  if (!(raw > 0)) return 0
  // The protection is rounded to the cent, so the last cent is settled on the real total rather than on the formula.
  let price = Math.floor(raw * 100 + 1e-7) / 100
  for (let i = 0; i < 3; i++) {
    const next = cstR2(price + 0.01)
    const cost = purchaseCost(next, ship)
    if (!cost || cost.total > target + 1e-9) break
    price = next
  }
  return price
}

/** Bought at `price`, sold again at `resale`: { total, margin, marginPct (of the resale) }. Null without a price. */
export function resaleMarginOf(price, shipping, resale) {
  const cost = purchaseCost(price, shipping)
  if (!cost || !cstFinite(resale) || resale <= 0) return null
  const margin = cstR2(resale - cost.total)
  return { total: cost.total, margin, marginPct: Math.round((margin / resale) * 1000) / 10 }
}
