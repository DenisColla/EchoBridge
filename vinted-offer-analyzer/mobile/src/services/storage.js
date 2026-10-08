import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY = 'offerta-vinted.watchlist.v1'
const ARCHIVE_KEY = 'offerta-vinted.archive.v1'
const LEARNING_KEY = 'offerta-vinted.learning.v1'
const ARCHIVE_MAX = 1000

/**
 * Schema 3 (monthly learning loop) adds an append-only event log, the decision snapshot (what the engine recommended
 * when the offer was saved) and the time of the first outcome. Schema 2 added the negotiation history, a raw form
 * snapshot for re-scoring, the counter plan and the final price. Older items are upgraded in place.
 */
const REPLIES = ['accepted', 'countered', 'declined', 'no_reply', 'sold_other']
const AFTER_REFUSAL = ['declined', 'no_reply', 'sold_other', 'abandoned']
const ms = (v) => (v ? new Date(v).getTime() : NaN)

export function normalizeItem(item) {
  if (!item || typeof item !== 'object') return null
  if (item.schema === 3) return item
  const legacyV1 = item.schema !== 2
  const v2 = legacyV1 ? upgradeToV2(item) : item
  const negotiation = Array.isArray(v2.negotiation) ? v2.negotiation.map((e) => ({ ...e })) : []
  const seller = negotiation.find((e) => e.by === 'seller')
  const first = negotiation[0]
  let sentAt = v2.sentAt || null
  let sentAtSource = v2.sentAtSource || null
  let finalPrice = v2.finalPrice ?? null
  if (sentAt && !sentAtSource) {
    if (seller && ms(sentAt) >= ms(seller.at) && (!first || first.at !== sentAt)) {
      // 1.2.0 stored the seller's counter time as the send time when «Inviata» was never tapped: unknown, not real.
      sentAt = null
    } else if (legacyV1 || (first && first.at !== sentAt && REPLIES.includes(v2.status))) {
      // 1.0/1.1 used the outcome tap as the send time: the planned moment when it came first, flagged as an estimate.
      const planned = ms(v2.sendAt)
      sentAt = Number.isFinite(planned) && planned <= ms(sentAt) ? new Date(planned).toISOString() : sentAt
      sentAtSource = 'imputed'
    } else {
      sentAtSource = 'tap' // 1.2.0 «Inviata»: the entry and sentAt were written together
    }
  }
  if (!sentAt && !seller && first && first.planned && REPLIES.includes(v2.firstOutcome)) {
    // 1.2.0 outcomes tapped straight from «Da inviare»: the offer was sent, at the planned moment if before the tap.
    const planned = ms(first.at)
    const tapped = ms(v2.outcomeAt)
    const at = Number.isFinite(planned) && (!Number.isFinite(tapped) || planned <= tapped) ? planned : tapped
    if (Number.isFinite(at)) {
      sentAt = new Date(at).toISOString()
      sentAtSource = 'imputed'
      negotiation[0] = { ...first, at: sentAt, planned: false }
    }
  }
  // 1.2.0 «Comprato» after a refusal kept the offer price: it was a purchase at list price.
  if (v2.status === 'bought' && AFTER_REFUSAL.includes(v2.firstOutcome) && !seller && v2.listPrice != null) finalPrice = v2.listPrice
  return {
    ...v2,
    schema: 3,
    negotiation,
    sentAt,
    sentAtSource,
    finalPrice,
    events: Array.isArray(v2.events) ? v2.events : [],
    decision: v2.decision || null,
    firstOutcomeAt: v2.firstOutcomeAt || (v2.firstOutcome ? ((seller || {}).at || v2.outcomeAt || null) : null),
  }
}

function upgradeToV2(item) {
  const sentAt = item.status && item.status !== 'planned' ? (item.outcomeAt || item.sendAt) : null
  return {
    ...item,
    schema: 2,
    form: item.form || {
      itemTitle: item.title || '', category: item.category || '', listPrice: item.listPrice != null ? String(item.listPrice).replace('.', ',') : '',
      targetPrice: item.targetPrice != null ? String(item.targetPrice).replace('.', ',') : '', listingAge: 'unknown', sellerProfile: 'unknown', listingSignal: 'none', link: item.link || '',
    },
    negotiation: Array.isArray(item.negotiation) ? item.negotiation : [{ by: 'buyer', kind: 'offer', price: item.targetPrice, at: item.sendAt, planned: !sentAt }],
    sentAt: item.sentAt || sentAt,
    counterPlan: item.counterPlan || null,
    firstOutcome: item.firstOutcome || (item.status && !['planned', 'sent'].includes(item.status) ? item.status : null),
    finalPrice: item.finalPrice ?? (item.status === 'accepted' || item.status === 'bought' ? item.targetPrice : null),
  }
}

/** Watch-list items are plain JSON: dates are ISO strings. */
export async function loadItems() {
  let raw = null
  try {
    raw = await AsyncStorage.getItem(KEY)
    const items = raw ? JSON.parse(raw) : []
    return Array.isArray(items) ? items.map(normalizeItem).filter(Boolean) : []
  } catch {
    // An unreadable list must not be silently replaced by the next save: keep the raw text aside first.
    if (raw) await AsyncStorage.setItem(`${KEY}.corrupt.${Date.now()}`, raw).catch(() => {})
    return []
  }
}

export async function saveItems(items) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(items))
    return true
  } catch {
    return false
  }
}

/** Deleted items that had been sent: they leave the list but keep feeding the monthly analysis. */
export async function loadArchive() {
  let raw = null
  try {
    raw = await AsyncStorage.getItem(ARCHIVE_KEY)
    const items = raw ? JSON.parse(raw) : []
    return Array.isArray(items) ? items.map(normalizeItem).filter(Boolean) : []
  } catch {
    if (raw) await AsyncStorage.setItem(`${ARCHIVE_KEY}.corrupt.${Date.now()}`, raw).catch(() => {})
    return []
  }
}

export async function saveArchive(items) {
  try {
    await AsyncStorage.setItem(ARCHIVE_KEY, JSON.stringify(items.slice(0, ARCHIVE_MAX)))
    return true
  } catch {
    return false
  }
}

/** Learning state: active profile, profile history, reports, export folder, exploration switch, last month processed. */
/** Returns the state, null when there is none yet, or { unreadable: true } (raw text kept aside) when it is broken. */
export async function loadLearningState() {
  let raw = null
  try {
    raw = await AsyncStorage.getItem(LEARNING_KEY)
    const state = raw ? JSON.parse(raw) : null
    return state && typeof state === 'object' ? state : null
  } catch {
    if (raw) await AsyncStorage.setItem(`${LEARNING_KEY}.corrupt.${Date.now()}`, raw).catch(() => {})
    return raw ? { unreadable: true } : null
  }
}

export async function saveLearningState(state) {
  try {
    await AsyncStorage.setItem(LEARNING_KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export const STATUSES = [
  { id: 'planned', label: 'Da inviare', tone: 'accent' },
  { id: 'sent', label: 'Inviata', tone: 'neutral' },
  { id: 'accepted', label: 'Accettata', tone: 'good' },
  { id: 'countered', label: 'Controproposta', tone: 'warn' },
  { id: 'declined', label: 'Rifiutata', tone: 'bad' },
  { id: 'no_reply', label: 'Nessuna risposta', tone: 'neutral' },
  { id: 'sold_other', label: 'Venduto ad altri', tone: 'bad' },
  { id: 'abandoned', label: 'Lasciato perdere', tone: 'neutral' },
  { id: 'bought', label: 'Comprato', tone: 'good' },
]

export const statusMeta = (id) => STATUSES.find((s) => s.id === id) || STATUSES[0]
