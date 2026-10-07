import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY = 'offerta-vinted.watchlist.v1'

/**
 * Schema 2 adds the negotiation history (our offers and the seller's counters), a raw form snapshot for re-scoring,
 * the counter plan and the final price. Older items are upgraded in place: their first offer becomes the history.
 */
export function normalizeItem(item) {
  if (!item || typeof item !== 'object') return null
  if (item.schema === 2) return item
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
  try {
    const raw = await AsyncStorage.getItem(KEY)
    const items = raw ? JSON.parse(raw) : []
    return Array.isArray(items) ? items.map(normalizeItem).filter(Boolean) : []
  } catch {
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

export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export const STATUSES = [
  { id: 'planned', label: 'Da inviare', tone: 'accent' },
  { id: 'sent', label: 'Inviata', tone: 'neutral' },
  { id: 'accepted', label: 'Accettata', tone: 'good' },
  { id: 'countered', label: 'Controproposta', tone: 'warn' },
  { id: 'declined', label: 'Rifiutata', tone: 'bad' },
  { id: 'no_reply', label: 'Nessuna risposta', tone: 'neutral' },
  { id: 'bought', label: 'Comprato', tone: 'good' },
]

export const statusMeta = (id) => STATUSES.find((s) => s.id === id) || STATUSES[0]
