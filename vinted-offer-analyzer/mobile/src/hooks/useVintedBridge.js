import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { vintedBridge } from '../services/vintedBridge.js'
import { VINTED_KIND_LABEL, planVintedEvent, vintedEventKey } from '../services/vintedEvents.js'

const KEY = 'offerta-vinted.vintedlog.v1'
const MAX_LOG = 120
const MAX_SEEN = 400
const EMPTY = { seen: [], log: [], notices: [] }

/**
 * Vinted ↔ app. Reads the notifications Vinted posted (when the user granted the access), decides what each one
 * means for the saved offers and applies the certain ones by itself: every automatic change is a notice with «Annulla»,
 * every doubtful one a question. Also hands over the links shared from Vinted. `setStatus(id, status)` is the
 * watchlist's; `itemsRef` its live list.
 */
export function useVintedBridge({ ready, itemsRef, setStatus, onSharedLink, onToast }) {
  const [enabled, setEnabled] = useState(false)
  const [state, setState] = useState(EMPTY)
  const stateRef = useRef(EMPTY)
  const loadedRef = useRef(false)
  const busyRef = useRef(false)

  const persist = useCallback(async (next) => {
    stateRef.current = next
    setState(next)
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(next))
    } catch { /* the log is a convenience: a failed write loses nothing the user did */ }
  }, [])

  const refresh = useCallback(async () => {
    if (!vintedBridge.available || busyRef.current || !ready) return
    busyRef.current = true
    try {
      if (!loadedRef.current) {
        try {
          const raw = await AsyncStorage.getItem(KEY)
          const saved = raw ? JSON.parse(raw) : null
          if (saved && typeof saved === 'object') stateRef.current = { seen: Array.isArray(saved.seen) ? saved.seen : [], log: Array.isArray(saved.log) ? saved.log : [], notices: Array.isArray(saved.notices) ? saved.notices : [] }
        } catch { /* start empty */ }
        loadedRef.current = true
      }
      const on = vintedBridge.isEnabled()
      setEnabled(on)
      const events = vintedBridge.readEvents()
      const seen = new Set(stateRef.current.seen)
      const fresh = events.filter((e) => !seen.has(vintedEventKey(e)))
      if (!fresh.length) {
        setState(stateRef.current)
        return
      }
      const log = [...stateRef.current.log]
      const notices = [...stateRef.current.notices]
      let applied = 0
      for (const ev of fresh) {
        const key = vintedEventKey(ev)
        seen.add(key)
        const plan = planVintedEvent(ev, itemsRef.current || [], new Date())
        const entry = { key, at: ev.at, title: ev.title || '', text: ev.bigText || ev.text || '', kind: plan.kind, action: plan.action, itemId: plan.itemId, price: plan.price }
        log.push(entry)
        if (plan.action === 'ignore') continue
        const notice = { id: key, at: ev.at, kind: plan.kind, action: plan.action, itemId: plan.itemId, itemTitle: plan.title, status: plan.status, price: plan.price, text: entry.text.slice(0, 160), previous: null }
        if (plan.action === 'auto') {
          const item = (itemsRef.current || []).find((it) => it.id === plan.itemId)
          notice.previous = item ? item.status : null
          try {
            await setStatus(plan.itemId, plan.status)
            applied += 1
          } catch {
            notice.action = 'ask'
          }
        }
        notices.push(notice)
      }
      const last = events.length ? Math.max(...events.map((e) => Number(e.at) || 0)) : 0
      await persist({ seen: [...seen].slice(-MAX_SEEN), log: log.slice(-MAX_LOG), notices: notices.slice(-20) })
      // The native queue only keeps what the app has not stored yet.
      if (last) vintedBridge.clearEvents(last)
      if (applied && onToast) onToast(applied === 1 ? 'Un\'offerta aggiornata dalle notifiche di Vinted.' : `${applied} offerte aggiornate dalle notifiche di Vinted.`)
    } finally {
      busyRef.current = false
    }
  }, [ready, itemsRef, setStatus, persist, onToast])

  // Shared links: the one that opened the app, then every later «Condividi».
  const sharedRef = useRef(onSharedLink)
  useEffect(() => { sharedRef.current = onSharedLink })
  useEffect(() => {
    if (!vintedBridge.available || !ready) return undefined
    const first = vintedBridge.getSharedText()
    if (first && sharedRef.current) sharedRef.current(first)
    const sub = vintedBridge.onSharedText((text) => { if (text && sharedRef.current) sharedRef.current(text) })
    return () => { if (sub && sub.remove) sub.remove() }
  }, [ready])

  useEffect(() => {
    if (!vintedBridge.available || !ready) return undefined
    refresh()
    const app = AppState.addEventListener('change', (s) => { if (s === 'active') refresh() })
    const sub = vintedBridge.onNotification(() => refresh())
    return () => {
      app.remove()
      if (sub && sub.remove) sub.remove()
    }
  }, [ready, refresh])

  const dropNotice = useCallback((id) => persist({ ...stateRef.current, notices: stateRef.current.notices.filter((n) => n.id !== id) }), [persist])

  /** «Annulla» on an automatic update: the offer goes back to what it was. */
  const undo = useCallback(async (notice) => {
    if (notice && notice.itemId && notice.previous) await setStatus(notice.itemId, notice.previous)
    await dropNotice(notice.id)
  }, [setStatus, dropNotice])

  /** «Sì» on a doubtful match: apply it now. */
  const confirm = useCallback(async (notice) => {
    if (notice && notice.itemId && notice.status) await setStatus(notice.itemId, notice.status)
    await dropNotice(notice.id)
  }, [setStatus, dropNotice])

  const logText = useCallback(() => JSON.stringify(stateRef.current.log.map((e) => ({ quando: new Date(e.at).toISOString(), titolo: e.title, testo: e.text, letto_come: VINTED_KIND_LABEL[e.kind] || e.kind, azione: e.action })), null, 2), [])

  return {
    available: vintedBridge.available, enabled, notices: state.notices, log: state.log,
    refresh, undo, confirm, dismiss: dropNotice, logText,
    openSettings: () => vintedBridge.openListenerSettings(), openAppSettings: () => vintedBridge.openAppSettings(),
  }
}
