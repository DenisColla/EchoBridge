import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildCounterReminders } from '../../core/index.js'
import { loadItems, newId, saveItems } from '../services/storage.js'
import { cancelReminder, ensureNotificationPermission, scheduleOfferReminder, scheduleReminderAt } from '../services/notifications.js'

/** Links typed without a scheme would not open: default to https. */
const normalizeLink = (link) => {
  const trimmed = (link || '').trim()
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

const iso = (d) => (d ? new Date(d).toISOString() : null)

/** Every notification an item may own: the first-offer reminder and the counter plan's reminders. */
export const reminderIdsOf = (item) => [item.notificationId, ...Object.values((item.counterPlan && item.counterPlan.reminderIds) || {})].filter(Boolean)

const cancelAll = async (item) => {
  for (const id of reminderIdsOf(item)) await cancelReminder(id)
}

const OUTCOMES = ['accepted', 'countered', 'declined', 'no_reply', 'bought']

/** Schedules the given core reminders; returns { ids: { send, deadline, followup, giveup }, status }. Never throws. */
async function scheduleAll(reminders, itemId, link) {
  if (!reminders.length) return { ids: {}, status: 'skipped' }
  try {
    const allowed = await ensureNotificationPermission()
    if (!allowed) return { ids: {}, status: 'denied' }
    const ids = {}
    for (const r of reminders) {
      const id = await scheduleReminderAt({ itemId, link, at: r.at, title: r.title, body: r.body })
      if (id) ids[r.kind.replace('counter_', '')] = id
    }
    return { ids, status: Object.keys(ids).length ? 'scheduled' : 'too_soon' }
  } catch {
    return { ids: {}, status: 'skipped' }
  }
}

/** What the app keeps of a counter analysis between rounds. */
function counterPlanFrom(result) {
  const rec = result.recommended
  const message = result.messages && result.messages.length ? (result.messages.find((m) => m.tone === result.recommendedTone) || result.messages[0]).text : ''
  const n = result.negotiation
  return {
    price: rec && rec.id !== 'accept' ? rec.price : null,
    accept: Boolean(rec && rec.id === 'accept'),
    option: rec ? rec.id : null,
    isSplit: Boolean(rec && rec.isSplit),
    isFinal: Boolean(rec && rec.isFinal),
    gapShare: rec ? rec.gapShare : null,
    pAccept: rec ? rec.pAccept : null,
    expectedPrice: rec ? rec.expectedPrice : null,
    sendAt: result.optimal ? iso(result.optimal.date) : null,
    tier: result.optimal ? result.optimal.tier : null,
    windowLabel: result.optimal ? result.optimal.score.timeWindow.label : null,
    assumedExpiry: iso(n.assumedExpiry),
    deadline: iso(n.deadline),
    safeAlternativeAt: result.safeAlternative ? iso(result.safeAlternative.date) : null,
    messageTone: result.recommendedTone,
    message,
    sentAt: null,
    reminderIds: {},
  }
}

/**
 * The saved offers ("da comprare" list). Persists to AsyncStorage, owns the
 * reminder scheduling, keeps the negotiation history and exposes outcome statistics.
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
  const addFromAnalysis = useCallback(async ({ result, link, form }) => {
    const { input, optimal, probability, messages, recommendedTone } = result
    const message = (messages.find((m) => m.tone === recommendedTone) || messages[0]).text
    const item = {
      id: newId(),
      schema: 2,
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
      form: form ? { ...form, link: normalizeLink(link) } : null,
      negotiation: [{ by: 'buyer', kind: 'offer', price: input.targetPrice, at: optimal.date.toISOString(), planned: true, probability }],
      sentAt: null,
      counterPlan: null,
      firstOutcome: null,
      finalPrice: null,
    }
    let reminder = 'skipped'
    try {
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
    } catch {
      reminder = 'skipped' // the item is saved anyway
    }
    await persist((prev) => [item, ...prev])
    return { item, reminder }
  }, [persist])

  const update = useCallback(async (id, patch) => {
    await persist((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)))
  }, [persist])

  const setStatus = useCallback(async (id, status) => {
    const target = itemsRef.current.find((it) => it.id === id)
    if (!target) return
    const now = new Date().toISOString()
    const patch = { status, outcomeAt: status === 'planned' ? null : now }
    if (status !== 'planned') {
      await cancelAll(target)
      patch.notificationId = null
      if (target.counterPlan) patch.counterPlan = { ...target.counterPlan, reminderIds: {} }
    }
    const history = Array.isArray(target.negotiation) ? target.negotiation : []
    if (status === 'sent' && !target.sentAt) {
      patch.sentAt = now
      patch.negotiation = history.map((e, i) => (i === history.length - 1 && e.planned ? { ...e, at: now, planned: false } : e))
    }
    if (!target.firstOutcome && OUTCOMES.includes(status)) patch.firstOutcome = status
    if ((status === 'accepted' || status === 'bought') && history.length) patch.finalPrice = history[history.length - 1].price
    await update(id, patch)
  }, [update])

  /**
   * Saves a counter analysis: on an existing item (appending the seller's counter) or as a new item.
   * Schedules «invia la nuova offerta» and the last-call reminder. Returns { item, reminder }.
   */
  const addCounter = useCallback(async ({ itemId = null, result, link = '', form = null }) => {
    const n = result.negotiation
    const sellerEntry = {
      by: 'seller', kind: 'counter', price: n.sellerCounter, at: iso(n.receivedAt), enteredAs: n.sellerCounterEntered || null,
      channel: n.channel, receivedUncertaintyMinutes: n.receivedUncertaintyMinutes,
    }
    const plan = counterPlanFrom(result)
    const existing = itemId ? itemsRef.current.find((it) => it.id === itemId) : null
    let item
    if (existing) {
      await cancelAll(existing)
      const history = Array.isArray(existing.negotiation) ? existing.negotiation.map((e) => (e.planned ? { ...e, planned: false } : e)) : []
      const last = history[history.length - 1]
      const negotiation = last && last.by === 'seller' ? [...history.slice(0, -1), sellerEntry] : [...history, sellerEntry]
      item = {
        ...existing, negotiation, status: 'countered', outcomeAt: new Date().toISOString(), notificationId: null, counterPlan: plan,
        firstOutcome: existing.firstOutcome || 'countered', sentAt: existing.sentAt || iso(n.receivedAt),
        message: plan.message || existing.message, sendAt: plan.sendAt || existing.sendAt, windowLabel: plan.windowLabel || existing.windowLabel,
      }
    } else {
      const input = result.input
      item = {
        id: newId(), schema: 2, createdAt: new Date().toISOString(), title: input.itemTitle || '', link: normalizeLink(link), platform: 'vinted',
        category: input.category.id, listPrice: input.listPrice, targetPrice: n.firstOffer, discountPct: ((input.listPrice - n.firstOffer) / input.listPrice) * 100,
        sendAt: plan.sendAt, expiresAt: null, windowLabel: plan.windowLabel, probability: null, riskBand: input.riskBand.id, message: plan.message,
        status: 'countered', notificationId: null, calendarOpenedAt: null, outcomeAt: new Date().toISOString(),
        form: form ? { ...form, targetPrice: String(n.firstOffer).replace('.', ','), link: normalizeLink(link) } : null,
        negotiation: [{ by: 'buyer', kind: 'offer', price: n.previousOffer, at: null, planned: false }, sellerEntry],
        sentAt: null, counterPlan: plan, firstOutcome: 'countered', finalPrice: null,
      }
    }
    // Save first: the item must never depend on the notification permission prompt.
    await persist((prev) => (existing ? prev.map((it) => (it.id === item.id ? item : it)) : [item, ...prev]))
    const scheduled = await scheduleAll(result.reminders || [], item.id, item.link)
    if (Object.keys(scheduled.ids).length) {
      item = { ...item, counterPlan: { ...item.counterPlan, reminderIds: scheduled.ids } }
      const saved = item
      await persist((prev) => prev.map((it) => (it.id === saved.id && it.counterPlan && !it.counterPlan.sentAt ? { ...it, counterPlan: { ...it.counterPlan, reminderIds: scheduled.ids } } : it)))
      return { item: saved, reminder: scheduled.status }
    }
    return { item, reminder: scheduled.status }
  }, [persist])

  /** «Ho inviato la nuova offerta»: records our counter, swaps the send reminders for a nudge and a give-up note. */
  const markCounterSent = useCallback(async (itemId) => {
    const target = itemsRef.current.find((it) => it.id === itemId)
    if (!target || !target.counterPlan || target.counterPlan.price == null) return null
    await cancelAll(target)
    const now = new Date()
    const plan = target.counterPlan
    const entry = { by: 'buyer', kind: 'counter', price: plan.price, at: now.toISOString(), planned: false, option: plan.option, pAccept: plan.pAccept, gapShare: plan.gapShare, isSplit: plan.isSplit, isFinal: plan.isFinal, tone: plan.messageTone }
    const next = {
      ...target, negotiation: [...(target.negotiation || []), entry], status: 'sent', outcomeAt: now.toISOString(), notificationId: null,
      counterPlan: { ...plan, sentAt: now.toISOString(), reminderIds: {} },
    }
    await persist((prev) => prev.map((it) => (it.id === itemId ? next : it)))
    const after = buildCounterReminders({ ok: true, optimal: { date: now }, input: { itemTitle: target.title }, negotiation: {} }, { sentAt: now, title: target.title || null })
    const scheduled = await scheduleAll(after, target.id, target.link)
    if (Object.keys(scheduled.ids).length) {
      await persist((prev) => prev.map((it) => (it.id === itemId && it.status === 'sent' ? { ...it, counterPlan: { ...it.counterPlan, reminderIds: scheduled.ids } } : it)))
    }
    return next
  }, [persist])

  const remove = useCallback(async (id) => {
    const target = itemsRef.current.find((it) => it.id === id)
    if (target) await cancelAll(target)
    await persist((prev) => prev.filter((it) => it.id !== id))
  }, [persist])

  const stats = useMemo(() => {
    // Calibration of the FIRST offer: a counter followed by a deal still counts as "countered".
    const first = (it) => it.firstOutcome || it.status
    const count = (status) => items.filter((it) => first(it) === status).length
    const sent = items.filter((it) => it.status !== 'planned').length
    const accepted = count('accepted') + count('bought')
    const countered = count('countered')
    const declined = count('declined')
    const noReply = count('no_reply')
    const decided = accepted + countered + declined + noReply
    const decidedItems = items.filter((it) => OUTCOMES.includes(first(it)) && it.probability != null)
    const closed = items.filter((it) => it.finalPrice != null && it.listPrice > 0)
    const withCounter = closed.filter((it) => (it.negotiation || []).some((e) => e.by === 'seller'))
    const won = withCounter.filter((it) => {
      const firstCounter = it.negotiation.find((e) => e.by === 'seller')
      return it.finalPrice < firstCounter.price - 0.009
    })
    return {
      total: items.length,
      planned: items.filter((it) => it.status === 'planned' || (it.status === 'countered' && it.counterPlan && !it.counterPlan.sentAt && it.counterPlan.price != null)).length,
      sent,
      accepted,
      countered,
      declined,
      noReply,
      acceptanceRate: decided ? accepted / decided : null,
      predictedAverage: decidedItems.length ? decidedItems.reduce((s, it) => s + (it.probability || 0), 0) / decidedItems.length : null,
      averageSaving: closed.length ? closed.reduce((s, it) => s + (it.listPrice - it.finalPrice), 0) / closed.length : null,
      closedDeals: closed.length,
      countersWon: withCounter.length ? won.length / withCounter.length : null,
      countersClosed: withCounter.length,
    }
  }, [items])

  return { items, ready, addFromAnalysis, addCounter, markCounterSent, update, setStatus, remove, stats }
}
