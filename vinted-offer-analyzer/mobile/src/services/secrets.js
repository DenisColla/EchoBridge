import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'

/**
 * API keys of the AI providers, typed by the user once and kept in the Android Keystore-backed secure store (never in
 * the APK, never in the Excel report, never in AsyncStorage). On the web preview they live in memory only.
 */
const memory = {}
const listeners = new Set()
const storeKey = (provider) => `llm-key-${provider}`
const said = (e) => String((e && e.message) || e || 'errore').slice(0, 140)

export async function getApiKey(provider) {
  return (await readKey(provider)).key
}

/**
 * The key and how its reading went: { key, state: 'present' | 'absent' | 'unreadable', error? }. 'unreadable' is the
 * secure store refusing (a locked phone, a task started by Android with no screen): not the same as no key at all,
 * and the engine of the watch must be able to tell them apart. A key read once is remembered for this run of the
 * app, in memory only, so that a refusal later on does not stop a reading.
 */
async function readKey(provider) {
  if (Platform.OS === 'web') return { key: memory[provider] || null, state: memory[provider] ? 'present' : 'absent' }
  let error = null
  // Twice: a refusal may be of the moment.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const key = (await SecureStore.getItemAsync(storeKey(provider))) || null
      if (key) memory[provider] = key
      else delete memory[provider]
      return { key, state: key ? 'present' : 'absent' }
    } catch (e) {
      error = said(e)
    }
  }
  if (memory[provider]) return { key: memory[provider], state: 'present' }
  return { key: null, state: 'unreadable', error }
}

/** How the key of a provider is doing, without the key itself: { state, error? } (see readKey). */
export async function keyStatus(provider) {
  const { state, error } = await readKey(provider)
  return error ? { state, error } : { state }
}

/** `fn(provider, present)` each time a key is saved or removed; returns the function that stops it. */
export function onKeyChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function told(provider, present) {
  listeners.forEach((fn) => {
    try { fn(provider, present) } catch { /* who listens must not stop the saving */ }
  })
}

export async function setApiKey(provider, value) {
  const key = String(value || '').trim()
  if (Platform.OS !== 'web') {
    try {
      if (key) await SecureStore.setItemAsync(storeKey(provider), key)
      else await SecureStore.deleteItemAsync(storeKey(provider))
    } catch {
      return false
    }
  }
  if (key) memory[provider] = key
  else delete memory[provider]
  told(provider, Boolean(key))
  return true
}

/** "sk-ant-api03-…" → "sk-ant…9xQz": enough to recognise the key, never enough to use it. */
export const maskKey = (key) => (key ? `${key.slice(0, 6)}…${key.slice(-4)}` : '')
