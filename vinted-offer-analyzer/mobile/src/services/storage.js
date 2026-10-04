import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY = 'offerta-vinted.watchlist.v1'

/** Watch-list items are plain JSON: dates are ISO strings. */
export async function loadItems() {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    const items = raw ? JSON.parse(raw) : []
    return Array.isArray(items) ? items : []
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
