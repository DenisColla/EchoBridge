import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'

/**
 * API keys of the AI providers, typed by the user once and kept in the Android Keystore-backed secure store (never in
 * the APK, never in the Excel report, never in AsyncStorage). On the web preview they live in memory only.
 */
const memory = {}
const storeKey = (provider) => `llm-key-${provider}`

export async function getApiKey(provider) {
  if (Platform.OS === 'web') return memory[provider] || null
  try {
    return (await SecureStore.getItemAsync(storeKey(provider))) || null
  } catch {
    return null
  }
}

export async function setApiKey(provider, value) {
  const key = String(value || '').trim()
  if (Platform.OS === 'web') {
    if (key) memory[provider] = key
    else delete memory[provider]
    return true
  }
  try {
    if (key) await SecureStore.setItemAsync(storeKey(provider), key)
    else await SecureStore.deleteItemAsync(storeKey(provider))
    return true
  } catch {
    return false
  }
}

/** "sk-ant-api03-…" → "sk-ant…9xQz": enough to recognise the key, never enough to use it. */
export const maskKey = (key) => (key ? `${key.slice(0, 6)}…${key.slice(-4)}` : '')
