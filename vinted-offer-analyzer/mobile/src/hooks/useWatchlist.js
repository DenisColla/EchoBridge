import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadItems, newId, saveItems } from '../services/storage.js'
import { cancelReminder, ensureNotificationPermission, scheduleOfferReminder } from '../services/notifications.js'

/** Links typed without a scheme would not open: default to https. */
const normalizeLink = (link) => {
  const trimmed = (link || '').trim()
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

/**
 * The saved offers ("da comprare" list). Persists to AsyncStorage, owns the
 * reminder scheduling and exposes outcome statistics for calibration.
 */
export function useWatchlist() {
  const [items, setItems] = useState([])
  const [ready, setReady] = useState(false)
  const itemsRef = useRef([])

  useEffect(() => {
    loadItems().then((loaded) => {
      itemsRef.current = loaded
      setItems(loaded)
      setReady(true)
    })
  }, [])

  /** Applies `updater` to the LATEST list (not the one captured at render time) and saves it. */
  const persist = useCallback(async (updater) => {
    const next = typeof updater === 'function' ? updater(itemsRef.current) : updater
    itemsRef.current = next
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
      link: normalizeLink(link),
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
      calendarOpenedAt: null,
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
    await persist((prev) => [item, ...prev])
    return { item, reminder }
  }, [persist])

  const update = useCallback(async (id, patch) => {
    await persist((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)))
  }, [persist])

  const setStatus = useCallback(async (id, status) => {
    const patch = { status, outcomeAt: status === 'planned' ? null : new Date().toISOString() }
    const target = itemsRef.current.find((it) => it.id === id)
    if (target && status !== 'planned' && target.notificationId) {
      await cancelReminder(target.notificationId)
      patch.notificationId = null
    }
    await update(id, patch)
  }, [update])

  const remove = useCallback(async (id) => {
    const target = itemsRef.current.find((it) => it.id === id)
    if (target) {
      await cancelReminder(target.notificationId)
    }
    await persist((prev) => prev.filter((it) => it.id !== id))
  }, [persist])

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
