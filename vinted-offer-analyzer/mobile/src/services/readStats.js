import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * Per-field read counters of the link extraction (engine-spec §3.1 / §8.6): «letto in k delle ultime 20 letture».
 * They say which fields Vinted's page really shows us (the DOM-only ones above all: views, interested buyers, the
 * previous price), so the engine's prior weights on those signals are switched on only once the data exists.
 * The history keeps the last READ_WINDOW reads as flags only: no titles, prices or links are stored here.
 * The pure helpers (readFlagsOf, pushRead, summarizeReads) have no storage dependency.
 */
const KEY = 'offerta-vinted.readstats.v1'
export const READ_WINDOW = 20

const has = (v) => v !== null && v !== undefined
const sig = (ex) => (ex && ex.signals && typeof ex.signals === 'object' ? ex.signals : {})

/** The fields a read can carry, in the order Info lists them; `of(ex)` says whether this extraction read the field. */
export const READ_FIELDS = [
  { id: 'title', label: 'titolo', of: (ex) => has(ex.title) },
  { id: 'listPrice', label: 'prezzo', of: (ex) => has(ex.listPrice) },
  { id: 'brand', label: 'marca', of: (ex) => has(ex.brand) },
  { id: 'condition', label: 'condizioni', of: (ex) => has(ex.condition) },
  { id: 'categoryText', label: 'categoria', of: (ex) => has(ex.categoryText) },
  { id: 'description', label: 'descrizione', of: (ex) => has(ex.description) },
  { id: 'uploadedDays', label: 'data di caricamento', of: (ex) => has(ex.uploadedDays) },
  { id: 'sellerLastSeenDays', label: 'attività del venditore', of: (ex) => has(ex.sellerLastSeenDays) },
  { id: 'sellerRating', label: 'valutazione del venditore', of: (ex) => has(ex.sellerRating) },
  { id: 'sellerFeedbackCount', label: 'numero di recensioni', of: (ex) => has(ex.sellerFeedbackCount) },
  { id: 'sellerBadges', label: 'distintivi del venditore', of: (ex) => Array.isArray(ex.sellerBadges) && ex.sellerBadges.length > 0 },
  { id: 'views', label: 'visualizzazioni', of: (ex) => has(sig(ex).views) },
  { id: 'interested', label: 'interessati', of: (ex) => has(sig(ex).interested) },
  { id: 'oldPrice', label: 'prezzo precedente', of: (ex) => has(sig(ex).oldPrice) },
  { id: 'bundleDiscountPct', label: 'sconto sui lotti', of: (ex) => has(sig(ex).bundleDiscountPct) || sig(ex).bundleOffered === true },
  { id: 'sellerItems', label: 'altri articoli del venditore', of: (ex) => has(sig(ex).sellerItems) },
  { id: 'reserved', label: 'riservato', of: (ex) => has(sig(ex).reserved) },
]

/** { fieldId: 1 | 0 } for one extraction result (parseVintedItemHtml output). */
export const readFlagsOf = (ex) => {
  const src = ex && typeof ex === 'object' ? ex : {}
  return Object.fromEntries(READ_FIELDS.map((f) => [f.id, f.of(src) ? 1 : 0]))
}

/** Appends one read to the history and keeps the last READ_WINDOW. `via` is 'fetch' or 'browser' (the in-app WebView). */
export const pushRead = (history, ex, { at = Date.now(), via = null } = {}) => {
  const list = Array.isArray(history) ? history : []
  return [...list, { at, via, read: readFlagsOf(ex) }].slice(-READ_WINDOW)
}

/** { total, viaBrowser, fields: [{ id, label, read }] }: how many of the last reads carried each field. */
export const summarizeReads = (history) => {
  const list = Array.isArray(history) ? history.filter((h) => h && typeof h === 'object') : []
  const fields = READ_FIELDS.map((f) => ({ id: f.id, label: f.label, read: list.reduce((n, h) => n + (h.read && h.read[f.id] ? 1 : 0), 0) }))
  return { total: list.length, viaBrowser: list.filter((h) => h.via === 'browser').length, fields }
}

export async function loadReadHistory() {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

/** Records one successful extraction; returns the updated summary. Never throws (the read itself must not fail on a counter). */
export async function recordRead(ex, meta = {}) {
  try {
    const next = pushRead(await loadReadHistory(), ex, meta)
    await AsyncStorage.setItem(KEY, JSON.stringify(next))
    return summarizeReads(next)
  } catch {
    return null
  }
}

export async function loadReadStats() {
  return summarizeReads(await loadReadHistory())
}
