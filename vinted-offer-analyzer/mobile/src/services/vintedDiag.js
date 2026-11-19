import AsyncStorage from '@react-native-async-storage/async-storage'
import { pageOf, templateOf } from './vintedNav.js'

const KEY = 'offerta-vinted.browserlog.v1'
const MAX = 150
let cache = null

async function load() {
  if (cache) return cache
  try {
    const raw = await AsyncStorage.getItem(KEY)
    const list = raw ? JSON.parse(raw) : []
    cache = Array.isArray(list) ? list : []
  } catch {
    cache = []
  }
  return cache
}

/** One line per page opened in the Vinted browser: when, what kind of page, the address without ids. Nothing else. */
export async function logVisit(url, extra = null) {
  const list = await load()
  const entry = { at: Date.now(), type: pageOf(url).type, page: templateOf(url), ...(extra ? { note: String(extra).slice(0, 80) } : {}) }
  const last = list[list.length - 1]
  if (last && last.page === entry.page && !extra) return
  list.push(entry)
  cache = list.slice(-MAX)
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(cache))
  } catch { /* a diagnostic log: losing a line loses nothing */ }
}

export async function visitLogText() {
  const list = await load()
  return JSON.stringify(list.map((e) => ({ quando: new Date(e.at).toISOString(), tipo: e.type, pagina: e.page, ...(e.note ? { nota: e.note } : {}) })), null, 2)
}
