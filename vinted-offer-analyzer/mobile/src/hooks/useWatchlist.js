import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadItems, newId, saveItems } from '../services/storage.js'
import { cancelReminder, ensureNotificationPermission, scheduleOfferReminder } from '../services/notifications.js'
import { removeFromDeviceCalendar } from '../services/calendar.js'

/**
 * The saved offers ("da comprare" list). Persists to AsyncStorage, owns the
 * reminder scheduling and exposes outcome statistics for calibration.
 */
export function useWatchlist() {
  const [items, setItems] = useState([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    loadItems().then((loaded) => {
      setItems(loaded)
      setReady(true)
    })
  }, [])

  const persist = useCallback(async (next) => {
    setItems(next)
    await saveItems(next)
  }, [])

  /** Saves an analysis as a planned offer and schedules its reminder. Returns { item, reminder }. */
  const addFromAnalysis = useCallback(async ({ result, link }) => {
    const { input, optimal, probability, messages, recommendedTone } = result
    const message = (messages.find((m) => m.tone === recommendedTone) || messages[0]).text
    const item = {
      id: newId(),
      createdAt: new Date().toISOString(),
      title: input.itemTitle || '',
      link: (link || '').trim(),
      platform: 'vinted',
      category: input.category.id,
      listPrice: input.listPrice,
      targetPrice: input.targetPrice,
      discountPct: input.discountPct,
      sendAt: optimal.date.toISOString(),
      expiresAt: optimal.expiresAt.toISOString(),
      windowLabel: optimal.score.timeWindow.label,
      probability,
      riskBand: input.riskBand.id,
      message,
      status: 'planned',
      notificationId: null,
      calendarEventId: null,
      outcomeAt: null,
    }
    let reminder = 'skipped'
    const allowed = await ensureNotificationPermission()
    if (allowed) {
      const id = await scheduleOfferReminder(item)
      if (id) {
        item.notificationId = id
        reminder = 'scheduled'
      } else {
        reminder = 'too_soon'
      }
    } else {
      reminder = 'denied'
    }
    await persist([item, ...items])
    return { item, reminder }
  }, [items, persist])

  const update = useCallback(async (id, patch) => {
    await persist(items.map((it) => (it.id === id ? { ...it, ...patch } : it)))
  }, [items, persist])

  const setStatus = useCallback(async (id, status) => {
    const patch = { status, outcomeAt: status === 'planned' ? null : new Date().toISOString() }
    const target = items.find((it) => it.id === id)
    if (target && status !== 'planned' && target.notificationId) {
      await cancelReminder(target.notificationId)
      patch.notificationId = null
    }
    await update(id, patch)
  }, [items, update])

  const remove = useCallback(async (id) => {
    const target = items.find((it) => it.id === id)
    if (target) {
      await cancelReminder(target.notificationId)
      await removeFromDeviceCalendar(target.calendarEventId)
    }
    await persist(items.filter((it) => it.id !== id))
  }, [items, persist])

  const stats = useMemo(() => {
    const count = (status) => items.filter((it) => it.status === status).length
    const sent = items.filter((it) => it.status !== 'planned').length
    const accepted = count('accepted') + count('bought')
    const countered = count('countered')
    const declined = count('declined')
    const noReply = count('no_reply')
    const decided = accepted + countered + declined + noReply
    return {
      total: items.length,
      planned: count('planned'),
      sent,
      accepted,
      countered,
      declined,
      noReply,
      acceptanceRate: decided ? accepted / decided : null,
      predictedAverage: decided ? items.filter((it) => it.status !== 'planned' && it.status !== 'sent').reduce((s, it) => s + (it.probability || 0), 0) / decided : null,
    }
  }, [items])

  return { items, ready, addFromAnalysis, update, setStatus, remove, stats }
}
