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
    // The web build has no notifications: a test hands some over.
    if (!native) return Platform.OS === 'web' && typeof window !== 'undefined' && Array.isArray(window.__ovtVintedEvents) ? window.__ovtVintedEvents : []
    const raw = safe(() => native.readEvents(), '[]')
    const list = safe(() => JSON.parse(raw), [])
    return Array.isArray(list) ? list.filter((e) => e && typeof e === 'object') : []
  },
  clearEvents: (upTo) => (native ? safe(() => native.clearEvents(Number(upTo) || 0), false) : false),
  /**
   * 1.17: Android's alarm clock starts each reading of a hunt (modules/vinted-bridge, WatchAlarms.kt).
   * scheduleWatchAlarm(at) → 'exact' | 'inexact' | 'failed', or null where there are no alarms (web, an old APK).
   */
  scheduleWatchAlarm: (at) => (native && native.scheduleWatchAlarm ? safe(() => String(native.scheduleWatchAlarm(Number(at))), 'failed') : null),
  cancelWatchAlarm: () => (native && native.cancelWatchAlarm ? safe(() => Boolean(native.cancelWatchAlarm()), false) : false),
  /** { exact, scheduledAt, firedAt, tickAt, error, errorAt } (times in ms, 0 when never), or null. */
  watchAlarmInfo: () => (native && native.watchAlarmInfo ? safe(() => native.watchAlarmInfo() || null, null) : null),
  /** The notification that says a job is running, between one reading and the next. */
  showWatchStatus: (title, text) => (native && native.showWatchStatus ? safe(() => Boolean(native.showWatchStatus(String(title || ''), String(text || ''))), false) : false),
  hideWatchStatus: () => (native && native.hideWatchStatus ? safe(() => Boolean(native.hideWatchStatus()), false) : false),
  /**
   * 1.18.3: Vinted's own «Session refresh» page, opened in a browser with no screen until it has renewed the session
   * (SessionRenewal.kt): what a plain download cannot do. → { ok, outcome, sawRefresh, pages, path, title, ms, error }
   * (outcome: 'rinnovata' | 'non_serviva' | 'scaduta' | 'tempo' | 'rete' | 'occupato' | 'errore'), or null where
   * there is no such browser (web, an APK without the module). Never rejects.
   */
  renewSession: (url, timeoutMs = 60_000) => (native && native.renewSession
    ? Promise.resolve().then(() => native.renewSession(String(url), Number(timeoutMs))).catch((e) => ({ ok: false, outcome: 'errore', error: String((e && e.message) || e).slice(0, 120) }))
    : Promise.resolve(null)),
  /** true / false, or null where it cannot be known (web, an APK without the module). */
  isBatteryUnrestricted: () => (native && native.isBatteryUnrestricted ? safe(() => Boolean(native.isBatteryUnrestricted()), null) : null),
  getSharedText: () => (native ? safe(() => native.getSharedText() || null, null) : null),
  onSharedText: (handler) => (native ? safe(() => native.addListener('onSharedText', (e) => handler(e && e.text ? String(e.text) : '')), null) : null),
  onNotification: (handler) => (native ? safe(() => native.addListener('onVintedNotification', () => handler()), null) : null),
}
