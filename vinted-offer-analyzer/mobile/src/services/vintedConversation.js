/**
 * Vinted's conversation page as the in-app browser reads it (no API): the offer the user has just sent, its status,
 * the seller's counter-offer, and which offer of the list they are about. Pure functions, no React Native: the Node
 * tests run them as they are.
 *
 * Seen on real pages (15 Nov 2026), from the buyer's side:
 *  - the listing on top (`hero-message`, its title and price; the price becomes the seller's offer once he makes one);
 *  - the buyer's request (`offer-request-*`): its price, the crossed listing price and a status («In sospeso»,
 *    «Rifiutata»);
 *  - the seller's own offer (`offer-*`, no «request»): its price, the crossed listing price and an «Acquista» button
 *    while it stands. A seller who answers with another figure refuses the request and makes this offer at once, so
 *    «Rifiutata» followed by an offer that still stands is a counter-offer, not a refusal.
 * The statuses not seen yet («Accettata», «Scaduta») are read by their stem; one that is not understood changes
 * nothing. The list of conversations is in the same page: a row is `inbox-list-item-<conversation>` with the other
 * person's name and the last message, which for a seller's offer is the bare figure («€20.00»).
 */
import { linkIdOf } from './segments.js'
import { VINTED_AUTO_STATUS, classifyVintedNotification, vintedPriceOf } from './vintedEvents.js'

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
const OPEN = ['planned', 'sent', 'countered']
/** Closed by a refusal or by silence: a counter-offer that arrives later reopens them. */
const REFUSED = ['declined', 'no_reply']
const same = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.005
/** «6,00 €», «€6.00», or the bare figure of a price label. */
const amountOf = (text) => {
  const v = vintedPriceOf(text)
  if (Number.isFinite(v)) return v
  const m = String(text || '').match(/\d{1,6}(?:[.,]\d{1,2})?/)
  return m ? vintedPriceOf(`${m[0]} €`) : null
}
/** A message that is a figure and nothing else: how the conversation list shows a seller's offer. */
const BARE_PRICE = /^(?:€\s?\d{1,6}(?:[.,]\d{1,2})?|\d{1,6}(?:[.,]\d{1,2})?\s?€)$/

/** What Vinted writes under an offer: 'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled' | 'unknown'. */
export function offerStatusOf(text) {
  const t = norm(text)
  if (!t) return 'unknown'
  if (/(sospes|in attesa|pending)/.test(t)) return 'pending'
  if (/non\s+(?:e stata\s+|viene\s+|ha\s+)?accettat|rifiutat|declinat|respint/.test(t)) return 'declined'
  if (/accettat/.test(t)) return 'accepted'
  if (/scadut/.test(t)) return 'expired'
  if (/(annullat|cancellat|ritirat)/.test(t)) return 'cancelled'
  return 'unknown'
}

/** The status of the list an offer's status on Vinted sets by itself. */
export const OFFER_STATUS_TO_LIST = { accepted: 'accepted', declined: 'declined', expired: 'no_reply', cancelled: 'abandoned' }

/**
 * The browser's raw reading of a conversation page →
 * { convId, itemId, itemLink, title, listPrice, seller, canOffer, offers: [{ by, price, original, status, statusText,
 *   open, buttons }], last, mine, standing }.
 * `by`: 'buyer' for a request, 'seller' for an offer; a request the page lets the user accept is somebody else's (the
 * user is the seller there) and is marked `incoming`. `open`: a seller's offer that can still be bought. `mine`: the
 * user's last request; `standing`: the seller's offer that still stands, unless a newer request of the user is
 * pending or accepted.
 */
export function readConversation(raw, pageUrl = '') {
  const r = raw && typeof raw === 'object' ? raw : {}
  const convId = typeof r.id === 'string' && r.id ? r.id : null
  const m = String(r.link || '').match(/\/items\/(\d+)/)
  const itemId = m ? m[1] : null
  const origin = (String(pageUrl || '').match(/^https:\/\/[^/?#]+/) || ['https://www.vinted.it'])[0]
  const offers = (Array.isArray(r.offers) ? r.offers : []).map((o) => {
    const price = amountOf(o && o.price)
    const original = amountOf(o && o.original)
    const statusText = String((o && o.status) || '').trim().slice(0, 40)
    const buttons = Array.isArray(o && o.buttons) ? o.buttons.map((b) => norm(b)).slice(0, 4) : []
    const by = o && o.kind === 'offer' ? 'seller' : 'buyer'
    const status = offerStatusOf(statusText)
    return {
      by, price, original: Number.isFinite(original) ? original : null, status, statusText, buttons,
      // A seller's offer stands while the page lets the user buy at it and says nothing else about it.
      open: by === 'seller' && Boolean(o && o.buy) && (status === 'unknown' || status === 'pending'),
      incoming: by === 'buyer' && buttons.some((b) => /^(accetta|rifiuta|declina)/.test(b)),
    }
  }).filter((o) => Number.isFinite(o.price) && o.price > 0)
  const last = offers.length ? offers[offers.length - 1] : null
  const mineAt = offers.map((o) => o.by === 'buyer' && !o.incoming).lastIndexOf(true)
  const mine = mineAt >= 0 ? offers[mineAt] : null
  const openAt = offers.map((o) => o.open).lastIndexOf(true)
  const answered = mine && mineAt > openAt && (mine.status === 'pending' || mine.status === 'accepted')
  const standing = openAt >= 0 && !answered ? offers[openAt] : null
  // The crossed price of an offer is the listing's own price; the one on top follows the seller's offer.
  const crossed = [...offers].reverse().find((o) => o.original !== null)
  const hero = amountOf(r.price)
  return {
    convId, itemId, itemLink: itemId ? `${origin}/items/${itemId}` : null,
    title: String(r.title || '').trim().slice(0, 80), listPrice: crossed ? crossed.original : Number.isFinite(hero) ? hero : null,
    seller: /^[\w.-]{2,40}$/.test(String(r.seller || '').trim()) ? String(r.seller).trim() : null,
    canOffer: r.canOffer === true, offers, last, mine, standing,
  }
}

/** Is this listing (of the list, or the one analysed on screen) the one the conversation is about? */
function sameListing(entry, conv) {
  if (!entry) return false
  if (conv.convId && entry.conversationId === conv.convId) return true
  const id = entry.itemId || linkIdOf(entry.link)
  if (conv.itemId) return Boolean(id) && String(id) === conv.itemId
  // The page gave no link: the same start of the title and the same listing price.
  const a = norm(entry.title).slice(0, 24)
  const b = norm(conv.title).slice(0, 24)
  return a.length >= 8 && b.length >= 8 && (a.startsWith(b) || b.startsWith(a)) && same(Number(entry.listPrice), conv.listPrice)
}

const lastOf = (item, by) => {
  const neg = Array.isArray(item.negotiation) ? item.negotiation : []
  for (let i = neg.length - 1; i >= 0; i--) if (neg[i] && neg[i].by === by && Number.isFinite(neg[i].price)) return neg[i].price
  return null
}
const offeredPrice = (item) => lastOf(item, 'buyer') ?? (Number.isFinite(Number(item.targetPrice)) ? Number(item.targetPrice) : null)

/** The seller's counter-offer the list already holds for this item at this figure, waiting for the user's answer. */
const counterKnown = (item, price) => {
  const neg = Array.isArray(item.negotiation) ? item.negotiation : []
  const lastEntry = neg[neg.length - 1]
  return item.status === 'countered' && Boolean(lastEntry) && lastEntry.by === 'seller' && same(lastEntry.price, price)
}

/**
 * What a conversation means for the list. `items`: the list; `analysed`: the analysis on screen ({ itemId, title,
 * listPrice }) or null. Returns { action, itemId, price, … }:
 *  - 'record'         the user's pending request on the listing analysed on screen: save it as sent at `price`
 *  - 'send'           a saved plan of this listing: it is now sent (at `price`, which may differ from the plan)
 *  - 'attach'         already sent at this price: only the conversation and the seller's name are added
 *  - 'reprice'        already sent, but Vinted shows another figure: the list follows Vinted
 *  - 'counter_sent'   the reply planned for a counter-offer is now on Vinted
 *  - 'needs_analysis' a pending request on a listing the app has not analysed: one tap analyses and records it
 *  - 'outcome'        the request of the list now reads accepted / declined / expired on Vinted: `status`
 *  - 'counter'        the seller's offer stands (he refused and proposed `price`): the offer of the list, open or
 *                     closed as refused, becomes a counter-offer to answer; `previousOffer` is the user's figure
 *  - 'incoming'       an offer of the seller on a listing that is not in the list, or a request made to the user
 *  - 'none'           (`recorded`: the list already says what the page says)
 */
export function planOfferCapture(conv, { items = [], analysed = null } = {}) {
  const none = { action: 'none', itemId: null, price: null, statusText: conv && conv.last ? conv.last.statusText : '' }
  if (!conv || !conv.last) return none
  const { mine, standing } = conv
  const order = { countered: 0, sent: 1, planned: 2, declined: 3, no_reply: 4 }
  const pick = (statuses) => items.filter((it) => it && statuses.includes(it.status) && sameListing(it, conv))
    .sort((a, b) => Number(b.conversationId === conv.convId) - Number(a.conversationId === conv.convId) || order[a.status] - order[b.status])[0] || null

  // The seller's offer stands: a counter-offer, whatever the list said until now (open, or closed as refused).
  if (standing) {
    const item = pick([...OPEN, ...REFUSED])
    const base = { ...none, itemId: item ? item.id : null, price: standing.price, title: item ? item.title : conv.title }
    if (!item) return { ...base, action: 'incoming' }
    if (counterKnown(item, standing.price)) return { ...base, action: 'none', recorded: true, counter: true }
    return { ...base, action: 'counter', previousOffer: mine ? mine.price : offeredPrice(item) }
  }
  if (!mine) return conv.last.incoming ? { ...none, action: 'incoming', price: conv.last.price } : none

  const item = pick(OPEN)
  const base = { ...none, itemId: item ? item.id : null, price: mine.price, title: item ? item.title : conv.title, statusText: mine.statusText }
  if (mine.status === 'pending') {
    // The reply to a counter-offer: the figure may differ from the one planned, the list follows Vinted.
    if (item && item.status === 'countered') {
      const plan = item.counterPlan
      return plan && !plan.sentAt && plan.price != null ? { ...base, action: 'counter_sent', reprice: !same(Number(plan.price), mine.price) } : base
    }
    if (item && item.status === 'sent') {
      if (!same(offeredPrice(item), mine.price)) return { ...base, action: 'reprice' }
      const known = item.conversationId === conv.convId && (Boolean(item.sellerName) || !conv.seller)
      return known ? { ...base, action: 'none', recorded: true } : { ...base, action: 'attach', recorded: true }
    }
    if (sameListing(analysed, conv)) return { ...base, action: 'record' }
    if (item) return { ...base, action: 'send', reprice: !same(offeredPrice(item), mine.price) }
    return { ...base, action: 'needs_analysis', link: conv.itemLink }
  }
  const status = OFFER_STATUS_TO_LIST[mine.status] || null
  if (status && item && item.status === 'sent' && (item.conversationId === conv.convId || same(offeredPrice(item), mine.price))) return { ...base, action: 'outcome', status }
  return base
}

/**
 * The rows of the conversation list that concern offers of the list (matched by the conversation recorded with the
 * offer, never by name alone): [{ action: 'outcome' | 'counter', itemId, status, price, title, seller, key }].
 * A row's text is the conversation's last message: a bare figure is the seller's offer (a counter-offer, also on an
 * offer already closed as refused); anything else is read with the same patterns as Vinted's notifications.
 */
export function planInboxRows(rows, items = []) {
  const out = []
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !row.id) continue
    const item = items.find((it) => it && it.conversationId === row.id && [...OPEN, ...REFUSED].includes(it.status))
    if (!item) continue
    const text = String(row.text || '').trim()
    const base = { itemId: item.id, title: item.title, seller: row.seller || null }
    if (BARE_PRICE.test(text)) {
      const price = amountOf(text)
      // His own figure can only be above the user's: a lower one is the user's request shown the same way.
      const offered = offeredPrice(item)
      if (Number.isFinite(price) && item.status !== 'planned' && !counterKnown(item, price) && !(Number.isFinite(offered) && price <= offered + 0.005)) {
        out.push({ ...base, action: 'counter', status: null, price, previousOffer: offered, key: `${row.id}|counter|${price}` })
      }
      continue
    }
    if (item.status !== 'sent') continue
    const cls = classifyVintedNotification({ text })
    const status = cls.kind === 'sold' ? null : VINTED_AUTO_STATUS[cls.kind] || null
    const key = `${row.id}|${cls.kind}|${norm(text).slice(0, 40)}`
    if (status) out.push({ ...base, action: 'outcome', status, price: cls.price, key })
    else if (cls.kind === 'counter') out.push({ ...base, action: 'counter', status: null, price: cls.price, previousOffer: offeredPrice(item), key })
  }
  return out
}
