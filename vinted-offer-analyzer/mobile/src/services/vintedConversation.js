/**
 * Vinted's conversation page as the in-app browser reads it (no API): the offer the user has just sent, its status,
 * and which offer of the list it is about. Pure functions, no React Native: the Node tests run them as they are.
 *
 * Seen on a real page (15 Nov 2026): the listing on top (`hero-message`, its title and price), then each offer with
 * its price, the crossed listing price and a status («In sospeso»). The other statuses have not been seen yet and are
 * read by their stem; a status that is not understood changes nothing. The list of conversations is in the same page:
 * a row is `inbox-list-item-<conversation>` with the other person's name and the last message.
 */
import { linkIdOf } from './segments.js'
import { VINTED_AUTO_STATUS, classifyVintedNotification, vintedPriceOf } from './vintedEvents.js'

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
const OPEN = ['planned', 'sent', 'countered']
const same = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.005
/** «6,00 €», «€6.00», or the bare figure of a price label. */
const amountOf = (text) => {
  const v = vintedPriceOf(text)
  if (Number.isFinite(v)) return v
  const m = String(text || '').match(/\d{1,6}(?:[.,]\d{1,2})?/)
  return m ? vintedPriceOf(`${m[0]} €`) : null
}

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
 * { convId, itemId, itemLink, title, listPrice, seller, canOffer, offers: [{ price, original, status, statusText,
 *   buttons, incoming }], last }. `incoming` marks an offer the page lets the user accept: the seller's, not the
 * user's own.
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
    const buttons = Array.isArray(o && o.buttons) ? o.buttons.map((b) => norm(b)) : []
    return { price, original: Number.isFinite(original) ? original : null, status: offerStatusOf(statusText), statusText, buttons: buttons.slice(0, 4), incoming: buttons.some((b) => /^(accetta|rifiuta|declina)/.test(b)) }
  }).filter((o) => Number.isFinite(o.price) && o.price > 0)
  const listPrice = amountOf(r.price)
  const last = offers.length ? offers[offers.length - 1] : null
  return {
    convId, itemId, itemLink: itemId ? `${origin}/items/${itemId}` : null,
    title: String(r.title || '').trim().slice(0, 80), listPrice: Number.isFinite(listPrice) ? listPrice : last && last.original !== null ? last.original : null,
    seller: /^[\w.-]{2,40}$/.test(String(r.seller || '').trim()) ? String(r.seller).trim() : null,
    canOffer: r.canOffer === true, offers, last,
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

const offeredPrice = (item) => {
  const neg = Array.isArray(item.negotiation) ? item.negotiation : []
  for (let i = neg.length - 1; i >= 0; i--) if (neg[i] && neg[i].by === 'buyer' && Number.isFinite(neg[i].price)) return neg[i].price
  return Number.isFinite(Number(item.targetPrice)) ? Number(item.targetPrice) : null
}

/**
 * What an offer read in a conversation means for the list. `items`: the list; `analysed`: the analysis on screen
 * ({ itemId, title, listPrice }) or null. Returns { action, … }:
 *  - 'record'         the user's pending offer on the listing analysed on screen: save it as sent at `price`
 *  - 'send'           a saved plan of this listing: it is now sent (at `price`, which may differ from the plan)
 *  - 'attach'         already sent at this price: only the conversation and the seller's name are added
 *  - 'reprice'        already sent, but Vinted shows another figure: the list follows Vinted
 *  - 'counter_sent'   the reply planned for a counter-offer is now on Vinted
 *  - 'needs_analysis' a pending offer on a listing the app has not analysed: one tap analyses and records it
 *  - 'outcome'        the offer of the list now reads accepted / declined / expired on Vinted: `status`
 *  - 'incoming'       the last offer is the seller's (a counter-offer): nothing changes by itself
 *  - 'unclear'        a pending figure above the previous offer: the user's raise or the seller's counter-offer
 *  - 'none'
 */
export function planOfferCapture(conv, { items = [], analysed = null } = {}) {
  const none = { action: 'none', itemId: null, price: null, statusText: conv && conv.last ? conv.last.statusText : '' }
  if (!conv || !conv.last) return none
  const { last } = conv
  const order = { sent: 0, countered: 1, planned: 2 }
  const open = items.filter((it) => it && OPEN.includes(it.status) && sameListing(it, conv))
    .sort((a, b) => Number(b.conversationId === conv.convId) - Number(a.conversationId === conv.convId) || order[a.status] - order[b.status])
  const item = open[0] || null
  const base = { ...none, itemId: item ? item.id : null, price: last.price, title: item ? item.title : conv.title }
  if (last.incoming) return { ...base, action: 'incoming' }
  if (last.status === 'pending') {
    // What the list already expects is the user's own: the reply planned for a counter-offer, the figure recorded.
    if (item && item.status === 'countered') {
      const plan = item.counterPlan
      return plan && !plan.sentAt && same(Number(plan.price), last.price) ? { ...base, action: 'counter_sent' } : base
    }
    if (item && item.status === 'sent' && same(offeredPrice(item), last.price)) {
      const known = item.conversationId === conv.convId && (Boolean(item.sellerName) || !conv.seller)
      return known ? { ...base, action: 'none', recorded: true } : { ...base, action: 'attach', recorded: true }
    }
    // A pending figure higher than the offer before it may be the seller's counter-offer (its page has not been
    // seen yet, so it may come without the buttons that mark it): never recorded as the user's own.
    const prev = conv.offers.length > 1 ? conv.offers[conv.offers.length - 2] : null
    if (prev && last.price > prev.price + 0.005) return { ...base, action: 'unclear' }
    if (item && item.status === 'sent') return { ...base, action: 'reprice' }
    if (sameListing(analysed, conv)) return { ...base, action: 'record' }
    if (item) return { ...base, action: 'send', reprice: !same(offeredPrice(item), last.price) }
    return { ...base, action: 'needs_analysis', link: conv.itemLink }
  }
  const status = OFFER_STATUS_TO_LIST[last.status] || null
  if (status && item && item.status === 'sent' && (item.conversationId === conv.convId || same(offeredPrice(item), last.price))) return { ...base, action: 'outcome', status }
  return base
}

/**
 * The rows of the conversation list that concern offers of the list (matched by the conversation recorded with the
 * offer, never by name alone): [{ action: 'outcome' | 'counter', itemId, status, price, title, seller, key }].
 * A row's text is the conversation's last message; it is read with the same patterns as Vinted's notifications.
 */
export function planInboxRows(rows, items = []) {
  const out = []
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !row.id) continue
    const item = items.find((it) => it && it.conversationId === row.id && OPEN.includes(it.status))
    if (!item) continue
    const cls = classifyVintedNotification({ text: row.text })
    const status = cls.kind === 'sold' ? null : VINTED_AUTO_STATUS[cls.kind] || null
    const key = `${row.id}|${cls.kind}|${norm(row.text).slice(0, 40)}`
    if (status && item.status === 'sent') out.push({ action: 'outcome', itemId: item.id, status, price: cls.price, title: item.title, seller: row.seller || null, key })
    else if (cls.kind === 'counter' && item.status === 'sent') out.push({ action: 'counter', itemId: item.id, status: null, price: cls.price, title: item.title, seller: row.seller || null, key })
  }
  return out
}
