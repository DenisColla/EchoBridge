/**
 * Lista logic with no React and no React Native: segments (In corso / Accettate / Rifiutate / Tutte), the three
 * «In corso» groups, ordering, search matching and the short labels of a row. Imports only leaf modules of the engine
 * so the Node tests (test/segments.test.js) run it as-is.
 */
import { CATEGORIES, COUNTER, LEARNING, VINTED } from '../../core/constants.js'
import { MONTHS_IT, calendarDaysBetween, formatLongDate, formatTime } from '../../core/dates.js'
import { formatEuro } from '../../core/messages.js'

const HOUR = 3_600_000

/**
 * The user's own counter history for the «nel tuo storico» line of the counter screen: negotiations where the buyer
 * re-countered after a seller counter, and how many of those closed with a purchase.
 */
export function counterStatsOf(items) {
  let recountered = 0
  let closed = 0
  for (const it of items || []) {
    const neg = Array.isArray(it.negotiation) ? it.negotiation : []
    const re = neg.some((e, i) => e && e.by === 'buyer' && i > 0 && neg[i - 1] && neg[i - 1].by === 'seller')
    if (!re) continue
    recountered += 1
    if (it.status === 'accepted' || it.status === 'bought') closed += 1
  }
  return { recountered, closed }
}
const DAY = 24 * HOUR
/** A row with nothing from us for this long asks for an update (the offer itself lasts 24 h on Vinted). */
export const UPDATE_AFTER_HOURS = 24

const ms = (v) => {
  const t = v ? new Date(v).getTime() : NaN
  return Number.isFinite(t) ? t : null
}

// ---------------------------------------------------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------------------------------------------------

export const SEGMENTS = [
  { id: 'open', label: 'In corso', statuses: ['planned', 'sent', 'countered'] },
  { id: 'won', label: 'Accettate', statuses: ['accepted', 'bought'] },
  { id: 'lost', label: 'Rifiutate', statuses: ['declined', 'no_reply', 'sold_other', 'abandoned'] },
  { id: 'all', label: 'Tutte', statuses: null },
]

/** The segment that lists the item by its CURRENT status (not the first outcome: a deal closed after a counter is won). */
export const segmentOf = (item) => {
  const hit = SEGMENTS.find((s) => s.statuses && s.statuses.includes(item && item.status))
  return hit ? hit.id : 'all'
}

export const segmentLabel = (id) => {
  const hit = SEGMENTS.find((s) => s.id === id)
  return hit ? hit.label : ''
}

export const segmentCounts = (items) => {
  const counts = { open: 0, won: 0, lost: 0, all: items.length }
  for (const item of items) {
    const id = segmentOf(item)
    if (id !== 'all') counts[id] += 1
  }
  return counts
}

/** The rows a segment shows, before the query: `statuses` null means every item. */
export const inSegment = (item, segment) => {
  const s = SEGMENTS.find((x) => x.id === segment)
  return !s || !s.statuses || s.statuses.includes(item.status)
}

// ---------------------------------------------------------------------------------------------------------------------
// Row facts shared by groups, ordering and the row itself
// ---------------------------------------------------------------------------------------------------------------------

const historyOf = (item) => (Array.isArray(item.negotiation) ? item.negotiation : [])

/** Our last move: the last non-planned buyer entry, else the send time, else the planned moment (ms or null). */
export const lastBuyerAt = (item) => {
  const history = historyOf(item)
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i]
    if (e && e.by === 'buyer' && !e.planned && ms(e.at) != null) return ms(e.at)
  }
  return ms(item.sentAt) ?? ms(item.sendAt) ?? ms(item.createdAt)
}

export const hasSellerCounter = (item) => historyOf(item).some((e) => e && e.by === 'seller')

export const pendingCounterOf = (item) => Boolean(item.status === 'countered' && item.counterPlan && item.counterPlan.price != null && !item.counterPlan.sentAt)

export const acceptCounterOf = (item) => Boolean(item.status === 'countered' && item.counterPlan && item.counterPlan.accept)

/** The probability the row shows: the pending counter's, our last counter's while waiting, else the first offer's. */
export const estimateOf = (item) => {
  const history = historyOf(item)
  const last = history[history.length - 1]
  const seller = hasSellerCounter(item)
  const awaiting = item.status === 'sent' && last && last.by === 'buyer'
  if (pendingCounterOf(item)) return item.counterPlan.pAccept ?? null
  if (awaiting && seller) return last.pAccept ?? null
  if (seller) return null
  return item.probability ?? null
}

/** The first offer expires 24 h after it was really sent (not after the planned moment). */
export const offerExpiryOf = (item) => {
  const sent = ms(item.sentAt)
  return sent == null ? null : new Date(sent + VINTED.OFFER_VALIDITY_HOURS * HOUR)
}

/**
 * One of: planned_future · planned_recent (past ≤ 24 h) · planned_stale (past > 24 h, or no moment at all) · counter_pending ·
 * counter_accept · counter_other · sent_waiting (≤ 24 h) · sent_stale (> 24 h) · closed.
 */
export const rowStateOf = (item, now) => {
  const t = now.getTime()
  if (item.status === 'planned') {
    const sendAt = ms(item.sendAt)
    // A plan without a moment (a hand-edited backup): nothing to send at, the user has to settle it.
    if (sendAt == null) return 'planned_stale'
    if (sendAt > t) return 'planned_future'
    return t - sendAt > UPDATE_AFTER_HOURS * HOUR ? 'planned_stale' : 'planned_recent'
  }
  if (item.status === 'sent') {
    const ref = lastBuyerAt(item)
    return ref != null && t - ref > UPDATE_AFTER_HOURS * HOUR ? 'sent_stale' : 'sent_waiting'
  }
  if (item.status === 'countered') {
    if (pendingCounterOf(item)) return 'counter_pending'
    if (acceptCounterOf(item)) return 'counter_accept'
    return 'counter_other'
  }
  return 'closed'
}

// ---------------------------------------------------------------------------------------------------------------------
// «In corso» groups and ordering
// ---------------------------------------------------------------------------------------------------------------------

export const GROUPS = [
  { id: 'update', label: 'Da aggiornare' },
  { id: 'todo', label: 'Da fare' },
  { id: 'waiting', label: 'In attesa di risposta' },
]

/**
 * 'update': sent and silent for more than 24 h, or planned with the moment more than 24 h behind.
 * 'todo': planned (future or just past), or a counter waiting for our move (pending plan, accept, or anything else to
 * settle — a countered item without a plan still needs the user, so it never disappears from the groups).
 * 'waiting': sent within the last 24 h. null for every closed status.
 */
export const groupOf = (item, now) => {
  switch (rowStateOf(item, now)) {
    case 'planned_stale':
    case 'sent_stale':
      return 'update'
    case 'planned_future':
    case 'planned_recent':
    case 'counter_pending':
    case 'counter_accept':
    case 'counter_other':
      return 'todo'
    case 'sent_waiting':
      return 'waiting'
    default:
      return null
  }
}

/** The tab badge: rows that need the user's hand (Da aggiornare + Da fare). */
export const badgeCountOf = (items, now) => (items || []).reduce((n, it) => {
  const g = groupOf(it, now)
  return n + (g === 'update' || g === 'todo' ? 1 : 0)
}, 0)

/** The moment a to-do row is about: the counter plan's send time when there is one, else the item's. */
const actionAt = (item) => (item.status === 'countered' && item.counterPlan && ms(item.counterPlan.sendAt) != null ? ms(item.counterPlan.sendAt) : ms(item.sendAt)) ?? ms(item.createdAt) ?? 0

const referenceAt = (item) => (item.status === 'sent' ? lastBuyerAt(item) : ms(item.sendAt) ?? lastBuyerAt(item)) ?? 0

const byAsc = (key) => (a, b) => key(a) - key(b)
const byDesc = (key) => (a, b) => key(b) - key(a)

/** Closed rows: last change first (outcome time, else creation). */
export const closedOrder = (items) => [...items].sort(byDesc((it) => ms(it.outcomeAt) ?? ms(it.createdAt) ?? 0))

/**
 * Splits a list that no longer fits its storage row (its JSON longer than `maxChars`): the oldest closed negotiations
 * (accepted, bought, declined, no reply, sold to others, abandoned; outcome time ascending, creation time as fallback)
 * leave it, one at a time, until the rest fits. Open rows never move. Returns { keep, moved } with `moved` oldest
 * first; `keep` is `items` itself when it already fits. Sizes are measured per item, so the list is serialised once.
 */
export const overflowSplit = (items, maxChars) => {
  const list = Array.isArray(items) ? items : []
  if (JSON.stringify(list).length <= maxChars) return { keep: list, moved: [] }
  // JSON.stringify(array).length = 2 brackets + the items + (n − 1) commas = 1 + Σ(item + 1) for n ≥ 1.
  const sizeOf = (it) => (it === undefined ? 4 : JSON.stringify(it).length) + 1
  let total = 1 + list.reduce((s, it) => s + sizeOf(it), 0)
  const closed = list.filter((it) => it && !inSegment(it, 'open')).sort(byAsc((it) => ms(it.outcomeAt) ?? ms(it.createdAt) ?? 0))
  const moved = []
  for (const it of closed) {
    if (total <= maxChars) break
    moved.push(it)
    total -= sizeOf(it)
  }
  const gone = new Set(moved)
  return { keep: list.filter((it) => !gone.has(it)), moved }
}

/** The three open groups, each sorted as the spec says; empty groups are omitted. */
export const openGroups = (items, now) => {
  const buckets = { update: [], todo: [], waiting: [] }
  for (const item of items) {
    const g = groupOf(item, now)
    if (g) buckets[g].push(item)
  }
  buckets.update.sort(byAsc(referenceAt)) // oldest first: the longest-neglected row on top
  buckets.todo.sort(byAsc(actionAt)) // overdue first
  buckets.waiting.sort(byDesc(lastBuyerAt)) // most recent first
  return GROUPS.filter((g) => buckets[g.id].length).map((g) => ({ id: g.id, label: g.label, items: buckets[g.id] }))
}

/**
 * The sections a segment renders: [{ id, label, items }]. 'open' shows the three labelled groups; 'won' and 'lost' one
 * unlabelled list by last change; 'all' the open groups first, then «Concluse».
 */
export const sectionsFor = (items, segment, now) => {
  if (segment === 'open') return openGroups(items.filter((it) => inSegment(it, 'open')), now)
  if (segment === 'all') {
    const open = openGroups(items.filter((it) => inSegment(it, 'open')), now)
    const closed = closedOrder(items.filter((it) => !inSegment(it, 'open')))
    return closed.length ? [...open, { id: 'closed', label: 'Concluse', items: closed }] : open
  }
  const rows = closedOrder(items.filter((it) => inSegment(it, segment)))
  return rows.length ? [{ id: segment, label: null, items: rows }] : []
}

// ---------------------------------------------------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------------------------------------------------

/** Lower case, accents stripped (NFD), so «perù» matches «Peru» and «PERÙ». */
export const normalizeText = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** "vinted.it" from any link, with or without scheme and www; '' when there is none. */
export const hostOf = (link) => {
  const m = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:www\.)?([^/?#\s]+)/i.exec(String(link || '').trim())
  return m ? m[1].toLowerCase() : ''
}

/** The numeric id of a Vinted listing in its link ("/items/10404231478-…" → "10404231478"). */
export const linkIdOf = (link) => {
  const m = /\/items\/(\d+)/.exec(String(link || ''))
  return m ? m[1] : ''
}

export const categoryLabelOf = (id) => {
  const hit = CATEGORIES.find((c) => c.id === id)
  return hit ? hit.label : ''
}

const priceTokens = (v) => {
  const n = Number(v)
  if (v == null || v === '' || !Number.isFinite(n)) return []
  return [formatEuro(n), String(n), String(n).replace('.', ',')]
}

/** Everything a query can hit, normalised once per item. */
export const searchTextOf = (item) => normalizeText([
  item.title, ...priceTokens(item.listPrice), ...priceTokens(item.targetPrice), categoryLabelOf(item.category), hostOf(item.link), linkIdOf(item.link),
].filter(Boolean).join(' '))

/** Every word of the query must appear somewhere in the row's text (case- and accent-insensitive). */
export const matchesQuery = (item, q) => {
  const tokens = normalizeText(q).split(/\s+/).filter(Boolean)
  if (!tokens.length) return true
  const hay = searchTextOf(item)
  return tokens.every((tok) => hay.includes(tok))
}

// ---------------------------------------------------------------------------------------------------------------------
// Short labels of a row
// ---------------------------------------------------------------------------------------------------------------------

/** "12 ott" (closed rows show the day of the outcome); '' for a missing or unreadable value, never the epoch. */
export const shortDate = (value) => {
  const t = ms(value)
  if (t == null) return ''
  const d = new Date(t)
  return `${d.getDate()} ${MONTHS_IT[d.getMonth()].slice(0, 3)}`
}

/** "oggi" | "ieri" | "3 giorni fa" | "domani" | "tra 5 giorni": both directions, by calendar day. */
export const relativeDayLabel = (value, now) => {
  const t = ms(value)
  if (t == null) return ''
  const d = new Date(t)
  const days = calendarDaysBetween(now, d)
  if (days === 0) return 'oggi'
  if (days === 1) return 'domani'
  if (days === -1) return 'ieri'
  return days > 0 ? `tra ${days} giorni` : `${-days} giorni fa`
}

/** "da pochi minuti" | "da 5 ore" | "da 3 giorni": how long a sent row has been silent. */
export const sinceLabel = (value, now) => {
  const from = ms(value)
  if (from == null) return ''
  const diff = Math.max(0, now.getTime() - from)
  const hours = Math.floor(diff / HOUR)
  if (hours < 1) return 'da pochi minuti'
  if (hours < 24) return `da ${hours} ${hours === 1 ? 'ora' : 'ore'}`
  const days = Math.floor(diff / DAY)
  return `da ${days} ${days === 1 ? 'giorno' : 'giorni'}`
}

/** "oggi alle 20:45" | "ieri alle 20:45" | "3 giorni fa": when something happened. */
export const whenLabel = (value, now) => {
  const t = ms(value)
  if (t == null) return ''
  const d = new Date(t)
  const days = calendarDaysBetween(d, now)
  if (days <= 0) return `oggi alle ${formatTime(d)}`
  if (days === 1) return `ieri alle ${formatTime(d)}`
  return `${days} giorni fa`
}

/** "oggi alle 21:30" | "domani alle 21:30" | "domenica 2 novembre alle 21:30": a moment to act at. */
export const momentLabel = (value, now) => {
  const t = ms(value)
  if (t == null) return ''
  const d = new Date(t)
  const days = calendarDaysBetween(now, d)
  const day = days === 0 ? 'oggi' : days === 1 ? 'domani' : formatLongDate(d, now)
  return `${day} alle ${formatTime(d)}`
}

/** The right-aligned time of the collapsed row (planned: the moment; sent: the silence; closed: the outcome day). */
export const timeLabelOf = (item, now) => {
  const state = rowStateOf(item, now)
  if (state.startsWith('planned')) return relativeDayLabel(item.sendAt, now)
  if (state.startsWith('sent')) return sinceLabel(lastBuyerAt(item), now)
  if (state.startsWith('counter')) return item.counterPlan && item.counterPlan.sendAt ? relativeDayLabel(item.counterPlan.sendAt, now) : ''
  return item.outcomeAt ? shortDate(item.outcomeAt) : ''
}

/** Whole days a sent row has waited (≥ 1 for stale rows). */
export const daysSilent = (item, now) => {
  const ref = lastBuyerAt(item)
  return ref == null ? 0 : Math.max(0, Math.floor((now.getTime() - ref) / DAY))
}

/**
 * The one next-step sentence of an open row: { lead, rest } (lead is the bold part), null for closed rows.
 * ≤ 14 words each, as the spec lists them.
 */
export const nextStepOf = (item, now) => {
  const state = rowStateOf(item, now)
  const plan = item.counterPlan
  switch (state) {
    case 'planned_future':
      return { lead: `Invia ${momentLabel(item.sendAt, now)}`, rest: item.windowLabel ? ` · ${item.windowLabel.toLowerCase()}` : '' }
    case 'planned_recent':
      return { lead: 'Finestra passata:', rest: " invia ora o segna l'esito" }
    case 'planned_stale':
      return { lead: "L'hai inviata?", rest: " Segna com'è andata o lascia perdere" }
    case 'counter_pending': {
      const at = ms(plan.sendAt)
      if (at != null && at < now.getTime()) return { lead: 'Momento passato:', rest: ' ricalcola la risposta' }
      return { lead: `Rispondi con ${formatEuro(plan.price)}`, rest: at != null ? ` · ${momentLabel(at, now)}` : '' }
    }
    case 'counter_accept':
      return { lead: 'Conviene comprare alla sua cifra:', rest: ' compra, poi segna Accettata' }
    case 'counter_other':
      return { lead: 'Ha fatto una controproposta:', rest: ' ricalcola la risposta' }
    case 'sent_waiting': {
      const history = historyOf(item)
      const last = history[history.length - 1]
      if (hasSellerCounter(item) && last && last.by === 'buyer') return { lead: `Hai proposto ${formatEuro(last.price)}:`, rest: ' aspetta la risposta' }
      const sent = lastBuyerAt(item)
      const expiry = offerExpiryOf(item) || (sent != null ? new Date(sent + VINTED.OFFER_VALIDITY_HOURS * HOUR) : null)
      const expires = expiry ? ` (scade ${calendarDaysBetween(now, expiry) > 0 ? 'domani ' : ''}alle ${formatTime(expiry)})` : ''
      return { lead: sent != null ? `Inviata ${whenLabel(sent, now)}:` : 'Inviata:', rest: ` aspetta la risposta${expires}` }
    }
    case 'sent_stale': {
      const days = Math.max(1, daysSilent(item, now))
      const tail = days >= LEARNING.NO_REPLY_AFTER_DAYS ? ' · senza risposta conta come rifiuto' : ''
      return { lead: `Scaduta da ${days} ${days === 1 ? 'giorno' : 'giorni'}:`, rest: ` com'è andata?${tail}` }
    }
    default:
      return null
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Outcome reminders (C8): when to ask «com'è andata?» after a first offer
// ---------------------------------------------------------------------------------------------------------------------

export const OUTCOME_REMINDER_HOURS = [36, LEARNING.NO_REPLY_AFTER_DAYS * 24]

/** Moves a moment that falls in the quiet hours (23:00–07:00 local) to 07:00, the same morning or the next. */
export const outsideQuietHours = (date) => {
  const d = new Date(date)
  const minutes = d.getHours() * 60 + d.getMinutes()
  if (minutes >= COUNTER.QUIET_FROM_MINUTES) d.setDate(d.getDate() + 1)
  else if (minutes >= COUNTER.QUIET_TO_MINUTES) return d
  d.setHours(Math.floor(COUNTER.QUIET_TO_MINUTES / 60), COUNTER.QUIET_TO_MINUTES % 60, 0, 0)
  return d
}

/** The two «com'è andata?» moments after a send: +36 h and +7 d (when silence starts counting as a refusal). */
export const outcomeReminderTimes = (sentAt) => {
  const sent = ms(sentAt)
  if (sent == null) return []
  return OUTCOME_REMINDER_HOURS.map((h) => {
    const d = new Date(sent)
    // Whole days are a calendar rule (the 7-day silence): keep the local clock time across a DST change.
    if (h % 24 === 0) d.setDate(d.getDate() + h / 24)
    else d.setTime(sent + h * HOUR)
    return outsideQuietHours(d)
  })
}
