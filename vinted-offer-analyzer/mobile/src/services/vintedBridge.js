import { Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo-modules-core'

/**
 * The local Android module (modules/vinted-bridge): notification access for Vinted's notifications and the text shared
 * from Vinted's «Condividi». Absent on the web build and on an APK built without it: every call then answers «no».
 */
const native = Platform.OS === 'android' ? requireOptionalNativeModule('VintedBridge') : null
const safe = (fn, fallback) => {
  try {
    return fn()
  } catch {
    return fallback
  }
}

export const vintedBridge = {
  available: Boolean(native),
  isEnabled: () => (native ? safe(() => Boolean(native.isListenerEnabled()), false) : false),
  openListenerSettings: () => (native ? safe(() => native.openListenerSettings(), false) : false),
  openAppSettings: () => (native ? safe(() => native.openAppSettings(), false) : false),
  /** The queue of Vinted's notifications, oldest first: [{ key, at, title, text, bigText, subText, channel, summary }]. */
  readEvents: () => {
    if (!native) return []
    const raw = safe(() => native.readEvents(), '[]')
    const list = safe(() => JSON.parse(raw), [])
    return Array.isArray(list) ? list.filter((e) => e && typeof e === 'object') : []
  },
  clearEvents: (upTo) => (native ? safe(() => native.clearEvents(Number(upTo) || 0), false) : false),
  /** 1.15: the service that keeps a hunt reading with the app behind (a fixed notification while it runs). */
  startWatchService: (title, text) => (native && native.startWatchService ? safe(() => Boolean(native.startWatchService(String(title || ''), String(text || ''))), false) : false),
  updateWatchService: (title, text) => (native && native.updateWatchService ? safe(() => Boolean(native.updateWatchService(String(title || ''), String(text || ''))), false) : false),
  stopWatchService: () => (native && native.stopWatchService ? safe(() => Boolean(native.stopWatchService()), false) : false),
  /** { running, error } of that service, or null where it does not exist. */
  watchServiceState: () => (native && native.watchServiceState ? safe(() => native.watchServiceState() || null, null) : null),
  /** true / false, or null where it cannot be known (web, an APK without the module). */
  isBatteryUnrestricted: () => (native && native.isBatteryUnrestricted ? safe(() => Boolean(native.isBatteryUnrestricted()), null) : null),
  getSharedText: () => (native ? safe(() => native.getSharedText() || null, null) : null),
  onSharedText: (handler) => (native ? safe(() => native.addListener('onSharedText', (e) => handler(e && e.text ? String(e.text) : '')), null) : null),
  onNotification: (handler) => (native ? safe(() => native.addListener('onVintedNotification', () => handler()), null) : null),
}
