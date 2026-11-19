/**
 * Vinted's own notifications, read on the phone (no API): what each one says and which saved offer it is about.
 * Pure functions, no React Native: the Node tests run them as they are. The wording of Vinted's notifications is not
 * documented and changes, so the patterns are broad, every result carries its confidence, and only a certain match
 * updates an offer by itself; everything else is asked with one tap. The raw texts stay in the log (Info) to tune this.
 */
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
// Vinted writes «€12.60» (symbol first, decimal point); other texts use «12,60 €». Both are read, thousands included.
const AMOUNT = '(\\d{1,3}(?:[.\\s]\\d{3})+(?:,\\d{1,2})?|\\d{1,6}(?:[.,]\\d{1,2})?)'
const PRICE_BEFORE = new RegExp(`(?:€|eur)\\s?${AMOUNT}`, 'i')
const PRICE_AFTER = new RegExp(`${AMOUNT}\\s?(?:€|eur\\b)`, 'i')
const toAmount = (raw) => {
  let v = String(raw).replace(/\s/g, '')
  if (/[.,]\d{1,2}$/.test(v)) {
    const i = Math.max(v.lastIndexOf('.'), v.lastIndexOf(','))
    v = `${v.slice(0, i).replace(/[.,]/g, '')}.${v.slice(i + 1)}`
  } else v = v.replace(/[.,]/g, '')
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
/** The first amount in euros of a text, or null. */
export const vintedPriceOf = (text) => {
  const t = String(text || '')
  const m = t.match(PRICE_BEFORE) || t.match(PRICE_AFTER)
  return m ? toAmount(m[1]) : null
}
/**
 * The seller's name when the notification is titled with it («misterbeppe» · «misterbeppe ha accettato…»): one word
 * that also opens the text. Kept on the phone to match the next notifications of the same negotiation.
 */
export const vintedSellerOf = (event) => {
  const title = String((event && event.title) || '').trim()
  if (!/^[\w.-]{3,30}$/.test(title) || /^vinted$/i.test(title)) return null
  const body = String((event && (event.bigText || event.text)) || '').trim().toLowerCase()
  return body.startsWith(title.toLowerCase()) ? title : null
}
const OPEN = ['planned', 'sent', 'countered']
const DAY = 86_400_000

export const VINTED_KIND_LABEL = {
  accepted: 'Offerta accettata', declined: 'Offerta rifiutata', expired: 'Offerta scaduta', counter: 'Controproposta', seller_offer: 'Sconto dal venditore',
  price_drop: 'Prezzo ribassato', sold: 'Venduto', message: 'Messaggio', other: 'Altro',
}
/** The status a certain match sets by itself; a counter-offer or a discount needs the user's answer instead. */
export const VINTED_AUTO_STATUS = { accepted: 'accepted', declined: 'declined', expired: 'no_reply', sold: 'sold_other' }

/** { kind, price, pct, summary }: what a notification is about. `event` = { title, text, bigText, summary }. */
export function classifyVintedNotification(event) {
  const ev = event || {}
  const text = norm([ev.title, ev.text, ev.bigText].filter(Boolean).join(' · '))
  const price = vintedPriceOf(text)
  const pc = text.match(/(\d{1,2})\s?%/)
  const offer = /offert/.test(text)
  let kind = 'other'
  // The refusal first: Vinted writes it «Ci spiace, X non ha accettato la tua offerta» (seen in a real inbox).
  if (offer && /(non\s+(?:ha|hanno|e stata|viene)?\s*accettat|rifiutat|declinat|respint)/.test(text)) kind = 'declined'
  else if (offer && /accettat/.test(text)) kind = 'accepted'
  else if (offer && /scadut/.test(text)) kind = 'expired'
  else if (/(controffert|controproposta|contro-offerta|ha proposto|ti propone)/.test(text) || (offer && /(ti ha fatto|ha fatto|ti ha inviato|ha inviato|nuova|hai ricevuto)/.test(text))) kind = 'counter'
  else if (/(offerta speciale|sconto (solo |esclusivo )?per te|prezzo speciale|ti offre uno sconto|il prezzo per te)/.test(text)) kind = 'seller_offer'
  else if (/(prezzo (e stato |e' stato )?(ridotto|ribassato|abbassato|scontato)|ribass|ora costa meno|calo di prezzo|prezzo ridotto)/.test(text)) kind = 'price_drop'
  else if (/(e stato venduto|non e piu disponibile|venduto a un altro|articolo venduto)/.test(text)) kind = 'sold'
  else if (/(messaggio|ti ha scritto|ha risposto)/.test(text)) kind = 'message'
  return { kind, price: Number.isFinite(price) ? price : null, pct: pc ? Number(pc[1]) : null, summary: ev.summary === true }
}

const lastBuyerPrice = (item) => {
  const neg = Array.isArray(item.negotiation) ? item.negotiation : []
  for (let i = neg.length - 1; i >= 0; i--) if (neg[i] && neg[i].by === 'buyer' && Number.isFinite(neg[i].price)) return neg[i].price
  return Number.isFinite(Number(item.targetPrice)) ? Number(item.targetPrice) : null
}

/** How well one saved offer fits a notification (0 = nothing in common). */
export function vintedMatchScore(event, cls, item, now = new Date()) {
  const text = norm([event.title, event.text, event.bigText].filter(Boolean).join(' · '))
  let score = 0
  const title = norm(item.title)
  if (title.length >= 4 && text.includes(title)) score += 4
  else {
    const tokens = [...new Set(title.split(/[^a-z0-9]+/).filter((w) => w.length >= 4))]
    if (tokens.length) {
      const share = tokens.filter((w) => text.includes(w)).length / tokens.length
      if (share >= 0.6) score += 3
      else if (share >= 0.34) score += 1.5
    }
  }
  const seller = norm(item.sellerName)
  if (seller.length >= 3 && text.includes(seller)) score += 3
  const mine = lastBuyerPrice(item)
  const list = Number(item.listPrice)
  if (cls.price !== null && mine !== null) {
    if (Math.abs(cls.price - mine) < 0.005) score += 2
    else if (cls.kind === 'counter' && cls.price > mine && Number.isFinite(list) && cls.price <= list) score += 1.5
    else if (Number.isFinite(list) && Math.abs(cls.price - list) < 0.005) score += 1
  }
  if (score > 0 && item.status === 'sent') {
    score += 1
    const sent = item.sentAt ? new Date(item.sentAt).getTime() : NaN
    if (Number.isFinite(sent) && now.getTime() - sent <= 3 * DAY) score += 0.5
  }
  return score
}

/**
 * The offer a notification is about: { item, score, certain } or null. Answers to an offer look among the open
 * offers; discounts, price drops and sales also among the ones closed in the last month.
 */
export function matchVintedEvent(event, cls, items, now = new Date()) {
  const list = Array.isArray(items) ? items : []
  const wide = ['seller_offer', 'price_drop', 'sold', 'message'].includes(cls.kind)
  const pool = list.filter((it) => it && (OPEN.includes(it.status) || (wide && it.outcomeAt && now.getTime() - new Date(it.outcomeAt).getTime() <= 30 * DAY)))
  // The exact figure of one open offer and of no other is as good as a name: «€12.60» is not a coincidence.
  const twins = cls.price === null ? [] : pool.filter((it) => { const mine = lastBuyerPrice(it); return mine !== null && Math.abs(mine - cls.price) < 0.005 })
  const scored = pool.map((item) => ({ item, score: vintedMatchScore(event, cls, item, now) + (twins.length === 1 && twins[0] === item ? 1 : 0) })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score)
  if (scored.length) {
    const [best, second] = scored
    return { item: best.item, score: best.score, certain: best.score >= 4 && (!second || best.score - second.score >= 2) }
  }
  // Nothing in the text points to an offer: a single offer waiting for an answer is the likely one, to be confirmed.
  if (['accepted', 'declined', 'expired', 'counter'].includes(cls.kind)) {
    const waiting = list.filter((it) => it && it.status === 'sent' && it.sentAt && now.getTime() - new Date(it.sentAt).getTime() <= 7 * DAY)
    if (waiting.length === 1) return { item: waiting[0], score: 2, certain: false }
  }
  return null
}

/**
 * What to do with one notification: { action: 'ignore' | 'auto' | 'ask' | 'counter' | 'info' | 'unmatched', kind,
 * itemId, status, price, title }. 'auto' sets `status` on the offer (undoable), 'ask' needs a tap, 'counter' opens the
 * counter-offer screen with the figure, 'info' is a discount or a price drop on a known listing.
 */
export function planVintedEvent(event, items, now = new Date()) {
  const cls = classifyVintedNotification(event)
  const base = { kind: cls.kind, price: cls.price, pct: cls.pct, itemId: null, status: null, title: null, seller: vintedSellerOf(event) }
  if (cls.summary || cls.kind === 'other') return { ...base, action: 'ignore' }
  const match = matchVintedEvent(event, cls, items, now)
  if (!match) return { ...base, action: ['accepted', 'declined', 'counter', 'seller_offer'].includes(cls.kind) ? 'unmatched' : 'ignore' }
  const out = { ...base, itemId: match.item.id, title: match.item.title || 'Articolo', certain: match.certain }
  if (cls.kind === 'message') return { ...out, action: match.certain ? 'info' : 'ignore' }
  if (cls.kind === 'counter' || cls.kind === 'seller_offer') return { ...out, action: OPEN.includes(match.item.status) ? 'counter' : 'info' }
  if (cls.kind === 'price_drop') return { ...out, action: 'info' }
  const status = VINTED_AUTO_STATUS[cls.kind] || null
  if (!status) return { ...out, action: 'ignore' }
  // An answer to an offer only makes sense on an open one.
  if (!OPEN.includes(match.item.status)) return { ...out, action: 'ignore' }
  return { ...out, status, action: match.certain ? 'auto' : 'ask' }
}

export const vintedEventKey = (event) => `${event && event.key ? event.key : ''}|${event && event.at ? Math.round(event.at) : ''}|${norm(event && event.text).slice(0, 40)}`
