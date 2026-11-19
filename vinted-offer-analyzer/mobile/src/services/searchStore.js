import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Legacy from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'

/**
 * «Cerca altrove» data on the phone: the city used for Wallapop's distance-based search, the spend of the searches
 * and the last search (product card and ranked rows, no photos), so the result can be reopened.
 */
const KEY = 'offerta-vinted.search.v1'
const MAX_CHARS = 600_000

export const emptySearchState = () => ({ version: 1, cityLabel: 'Roma', spend: {}, last: null })

export async function loadSearchState() {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    const s = raw ? JSON.parse(raw) : null
    if (!s || typeof s !== 'object' || s.version !== 1) return emptySearchState()
    return { ...emptySearchState(), ...s }
  } catch {
    return emptySearchState()
  }
}

export async function saveSearchState(state) {
  try {
    let json = JSON.stringify(state)
    // The last search is a convenience: drop it rather than fail when it is too large.
    if (json.length > MAX_CHARS) json = JSON.stringify({ ...state, last: null })
    await AsyncStorage.setItem(KEY, json)
    return true
  } catch {
    return false
  }
}

/**
 * Saves what a search page carried when nothing could be read from it, and opens the share sheet, so the parser can be
 * fixed from a real page. Contains only the public page data the user was looking at; no keys, no account data.
 */
export async function shareDiagnostic(channel, text) {
  if (Platform.OS === 'web') return false
  try {
    const dir = `${Legacy.documentDirectory}diagnosi/`
    await Legacy.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {})
    const day = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
    const uri = `${dir}pagina-${channel}-${day}.json`
    await Legacy.writeAsStringAsync(uri, String(text || '').slice(0, 3_000_000))
    if (!(await Sharing.isAvailableAsync())) return false
    await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: `Pagina ${channel} per diagnosi` })
    return true
  } catch {
    return false
  }
}
