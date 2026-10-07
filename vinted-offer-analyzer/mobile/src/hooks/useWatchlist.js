import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildCounterReminders, decisionSnapshot } from '../../core/index.js'
import { loadArchive, loadItems, newId, saveArchive, saveItems } from '../services/storage.js'
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

const OUTCOMES = ['accepted', 'countered', 'declined', 'no_reply', 'sold_other', 'abandoned', 'bought']

/** Append-only log of what happened to an item: the monthly report reads it, nothing ever rewrites it. */
const withEvent = (item, type, data = {}) => ({ ...item, events: [...(Array.isArray(item.events) ? item.events : []), { at: new Date().toISOString(), type, ...data }] })

/** The learning fields of a counter option (engine logit before the learned correction, read probability, window). */
const learningOf = (option) => (option && option.learning ? { rawLogit: option.learning.rawLogit, learnedWeight: option.learning.learnedWeight, pRead: option.learning.pRead, windowId: option.learning.windowId } : {})

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
    // 'scheduled' only when the main reminder exists: a lone last-call reminder must not read as "ti avviso prima".
    const main = ids.send || ids.followup
    return { ids, status: main ? 'scheduled' : Object.keys(ids).length ? 'partial' : 'too_soon' }
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
    ...learningOf(rec && rec.id !== 'accept' ? rec : null),
  }
}

/**
 * The saved offers ("da comprare" list). Persists to AsyncStorage, owns the
 * reminder scheduling, keeps the negotiation history and exposes outcome statistics.
 */
export function useWatchlist() {
  const [items, setItems] = useState([])
  const [archive, setArchive] = useState([])
  const [ready, setReady] = useState(false)
  const itemsRef = useRef([])
  const archiveRef = useRef([])
  const markCounterSentRef = useRef(null)

  useEffect(() => {
    Promise.all([loadItems(), loadArchive()]).then(([loaded, archived]) => {
      itemsRef.current = loaded
      archiveRef.current = archived
      setItems(loaded)
      setArchive(archived)
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

  /**
   * Saves an analysis as a planned offer and schedules its reminder. Returns { item, reminder }.
   * Stores the decision snapshot (what the engine recommended, with which profile, and the test variation if any).
   */
  const addFromAnalysis = useCallback(async ({ result, link, form, profile = null }) => {
    const { input, optimal, probability, messages, recommendedTone } = result
    const message = (messages.find((m) => m.tone === recommendedTone) || messages[0]).text
    const now = new Date()
    let item = {
      id: newId(),
      schema: 3,
      createdAt: now.toISOString(),
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
      // The form is rebuilt from what was ANALYSED (the typed form may have been edited since, a test variation or
      // Vinted's cap may have changed the price): the monthly analysis re-scores exactly this offer.
      form: {
        ...(form || {}),
        itemTitle: input.itemTitle || '', category: input.category.id, listPrice: String(input.listPrice).replace('.', ','),
        targetPrice: String(input.targetPrice).replace('.', ','), listingAge: input.listingAge.id, sellerProfile: input.sellerProfile || 'unknown',
        listingSignal: input.listingSignal.id, link: normalizeLink(link),
      },
      negotiation: [{ by: 'buyer', kind: 'offer', price: input.targetPrice, at: optimal.date.toISOString(), planned: true, probability }],
      sentAt: null,
      counterPlan: null,
      firstOutcome: null,
      firstOutcomeAt: null,
      finalPrice: null,
      decision: decisionSnapshot(result, { now, profile, exploration: result.exploration || null }),
      events: [{ at: now.toISOString(), type: 'saved', price: input.targetPrice, recommendedAt: optimal.date.toISOString(), probability, exploration: result.exploration ? result.exploration.arm : null }],
    }
    // The same listing saved again before sending replaces the old plan: one negotiation, one item in the data.
    const sameLink = item.link ? itemsRef.current.filter((it) => it.link === item.link && it.status === 'planned' && !it.sentAt) : []
    for (const old of sameLink) await cancelAll(old)
    const replaced = new Set(sameLink.map((it) => it.id))
    // Save first: the item must never depend on the notification permission prompt (the app may be killed meanwhile).
    await persist((prev) => [item, ...prev.filter((it) => !replaced.has(it.id))])
    let reminder = 'skipped'
    try {
      const allowed = await ensureNotificationPermission()
      if (allowed) {
        const id = await scheduleOfferReminder(item)
        if (id) {
          item = { ...item, notificationId: id }
          const saved = item
          await persist((prev) => prev.map((it) => (it.id === saved.id && it.status === 'planned' ? { ...it, notificationId: id } : it)))
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
    return { item, reminder, replaced: replaced.size }
  }, [persist])

  const update = useCallback(async (id, patch, event = null) => {
    await persist((prev) => prev.map((it) => (it.id === id ? (event ? withEvent({ ...it, ...patch }, event.type, event.data) : { ...it, ...patch }) : it)))
  }, [persist])

  const setStatus = useCallback(async (id, status) => {
    const target = itemsRef.current.find((it) => it.id === id)
    if (!target) return
    // «Inviata» on an item waiting for our counter means the counter was sent: record it like «Ho inviato».
    if (status === 'sent' && target.status === 'countered' && target.counterPlan && target.counterPlan.price != null && !target.counterPlan.sentAt && markCounterSentRef.current) {
      await markCounterSentRef.current(id)
      return
    }
    const now = new Date().toISOString()
    const patch = { status, outcomeAt: status === 'planned' ? null : now }
    if (status !== 'planned') {
      await cancelAll(target)
      patch.notificationId = null
      if (target.counterPlan) patch.counterPlan = { ...target.counterPlan, reminderIds: {} }
    }
    const history = Array.isArray(target.negotiation) ? target.negotiation : []
    const hasSeller = history.some((e) => e.by === 'seller')
    const neverSent = !target.sentAt && target.status === 'planned'
    if (status === 'sent' && !target.sentAt) {
      patch.sentAt = now
      patch.sentAtSource = 'tap'
      patch.negotiation = history.map((e, i) => (i === history.length - 1 && e.planned ? { ...e, at: now, planned: false } : e))
    }
    // An outcome without «Inviata» first: the offer went out at the recommended moment if that is past, else just now.
    const boughtWithoutOffer = status === 'bought' && neverSent
    // Never once a counter exists: then the tap time is the end of the negotiation, not the first send.
    if (OUTCOMES.includes(status) && status !== 'abandoned' && !boughtWithoutOffer && !target.sentAt && !hasSeller) {
      const planned = history.length && history[history.length - 1].planned && history[history.length - 1].at ? new Date(history[history.length - 1].at) : null
      const imputed = planned && planned.getTime() <= Date.now() ? planned.toISOString() : now
      patch.sentAt = imputed
      patch.sentAtSource = 'imputed'
      patch.negotiation = history.map((e, i) => (i === history.length - 1 && e.planned ? { ...e, at: imputed, planned: false } : e))
    }
    // First outcome: set once; a late answer after «Nessuna risposta» (no counter recorded) replaces it.
    const lateAnswer = target.firstOutcome === 'no_reply' && !hasSeller && ['accepted', 'declined', 'sold_other'].includes(status)
    if (OUTCOMES.includes(status) && !boughtWithoutOffer && (!target.firstOutcome || lateAnswer)) {
      // «Comprato» after a refusal or silence is a purchase at list price, never an accepted offer.
      if (!(status === 'bought' && ['declined', 'no_reply', 'sold_other'].includes(target.status))) {
        patch.firstOutcome = status
        patch.firstOutcomeAt = now
      }
    }
    // Final price of «Accettata»/«Comprato»: the last number on the table (his counter if he made one and we took it),
    // the list price when bought after a refusal or without any offer.
    const last = (patch.negotiation || history)[(patch.negotiation || history).length - 1]
    const atList = status === 'bought' && (boughtWithoutOffer || ['declined', 'no_reply', 'sold_other'].includes(target.status))
    patch.finalPrice = status === 'accepted' || status === 'bought' ? (atList ? target.listPrice : last ? last.price : null) : null
    await update(id, patch, { type: 'status', data: { from: target.status, to: status, finalPrice: patch.finalPrice } })
  }, [update])

  /**
   * Saves a counter analysis: on an existing item (appending the seller's counter) or as a new item.
   * Schedules «invia la nuova offerta» and the last-call reminder. Returns { item, reminder }.
   */
  const addCounter = useCallback(async ({ itemId = null, result, link = '', form = null, raw = null }) => {
    const n = result.negotiation
    const sellerEntry = {
      by: 'seller', kind: 'counter', price: n.sellerCounter, rawPrice: n.sellerCounterRaw ?? n.sellerCounter, at: iso(n.receivedAt), enteredAs: n.sellerCounterEntered || null,
      channel: n.channel, receivedUncertaintyMinutes: n.receivedUncertaintyMinutes,
    }
    const plan = counterPlanFrom(result)
    // What the counter calculation was given (budget, competition, chat…): the report can tell rounds apart by it.
    if (raw) plan.inputs = { maxPrice: raw.maxPrice || null, competition: Boolean(raw.competition), publicPrice: Boolean(raw.publicPrice), channel: raw.channel || 'offer', receivedAgo: raw.receivedAgo || null }
    const existing = itemId ? itemsRef.current.find((it) => it.id === itemId) : null
    let item
    if (existing) {
      await cancelAll(existing)
      // A planned first offer was sent at an unknown time (not at the planned one): keep the real send time if known.
      // Never the counter's own time as the send time (that would fake a 5-minute reply): the recommended moment if it
      // came before his counter, else unknown.
      const plannedAt = existing.decision && existing.decision.recommendedAt ? new Date(existing.decision.recommendedAt) : existing.sendAt ? new Date(existing.sendAt) : null
      const imputedSentAt = !existing.sentAt && plannedAt && n.receivedAt && plannedAt.getTime() < new Date(n.receivedAt).getTime() ? plannedAt.toISOString() : null
      const history = Array.isArray(existing.negotiation) ? existing.negotiation.map((e) => (e.planned ? { ...e, planned: false, at: existing.sentAt || imputedSentAt } : e)) : []
      const last = history[history.length - 1]
      const base = last && last.by === 'seller' ? history.slice(0, -1) : history
      // The user may have corrected «La tua offerta inviata»: store the price the plan was computed on.
      const iB = base.map((e) => e.by).lastIndexOf('buyer')
      if (iB >= 0 && Math.abs(base[iB].price - n.previousOffer) > 0.004) base[iB] = { ...base[iB], price: n.previousOffer }
      const negotiation = [...base, sellerEntry]
      const firstChanged = iB === 0 && Math.abs(existing.targetPrice - n.previousOffer) > 0.004
      item = {
        ...existing, negotiation, status: 'countered', outcomeAt: new Date().toISOString(), notificationId: null, calendarOpenedAt: null, finalPrice: null, counterPlan: plan,
        firstOutcomeAt: existing.firstOutcomeAt || (existing.firstOutcome ? existing.outcomeAt : sellerEntry.at),
        ...(firstChanged ? {
          targetPrice: n.previousOffer, discountPct: ((existing.listPrice - n.previousOffer) / existing.listPrice) * 100,
          form: existing.form ? { ...existing.form, targetPrice: String(n.previousOffer).replace('.', ',') } : existing.form,
        } : {}),
        firstOutcome: existing.firstOutcome || 'countered',
        ...(existing.sentAt ? {} : { sentAt: imputedSentAt, sentAtSource: imputedSentAt ? 'imputed' : null }),
        message: plan.message || existing.message, sendAt: plan.sendAt || existing.sendAt, windowLabel: plan.windowLabel || existing.windowLabel,
      }
    } else {
      const input = result.input
      item = {
        id: newId(), schema: 3, createdAt: new Date().toISOString(), title: input.itemTitle || '', link: normalizeLink(link), platform: 'vinted',
        category: input.category.id, listPrice: input.listPrice, targetPrice: n.firstOffer, discountPct: ((input.listPrice - n.firstOffer) / input.listPrice) * 100,
        sendAt: plan.sendAt, expiresAt: null, windowLabel: plan.windowLabel, probability: null, riskBand: input.riskBand.id, message: plan.message,
        status: 'countered', notificationId: null, calendarOpenedAt: null, outcomeAt: new Date().toISOString(),
        form: form ? { ...form, targetPrice: String(n.firstOffer).replace('.', ','), link: normalizeLink(link) } : null,
        negotiation: [{ by: 'buyer', kind: 'offer', price: n.previousOffer, at: null, planned: false }, sellerEntry],
        sentAt: null, counterPlan: plan, firstOutcome: 'countered', firstOutcomeAt: sellerEntry.at, finalPrice: null, decision: null, events: [],
      }
    }
    item = withEvent(item, 'counter_received', { price: n.sellerCounter, previousOffer: n.previousOffer, plan: plan.price, accept: plan.accept })
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
    const entry = {
      by: 'buyer', kind: 'counter', price: plan.price, at: now.toISOString(), planned: false, option: plan.option, pAccept: plan.pAccept, gapShare: plan.gapShare, isSplit: plan.isSplit, isFinal: plan.isFinal, tone: plan.messageTone,
      rawLogit: plan.rawLogit ?? null, learnedWeight: plan.learnedWeight ?? 0, pRead: plan.pRead ?? 1, windowId: plan.windowId ?? null, plannedAt: plan.sendAt,
    }
    const next = withEvent({
      ...target, negotiation: [...(target.negotiation || []), entry], status: 'sent', outcomeAt: now.toISOString(), notificationId: null,
      counterPlan: { ...plan, sentAt: now.toISOString(), reminderIds: {} },
    }, 'counter_sent', { price: plan.price, plannedAt: plan.sendAt })
    await persist((prev) => prev.map((it) => (it.id === itemId ? next : it)))
    const after = buildCounterReminders({ ok: true, optimal: { date: now }, input: { itemTitle: target.title }, negotiation: {} }, { sentAt: now, title: target.title || null })
    const scheduled = await scheduleAll(after, target.id, target.link)
    if (Object.keys(scheduled.ids).length) {
      await persist((prev) => prev.map((it) => (it.id === itemId && it.status === 'sent' ? { ...it, counterPlan: { ...it.counterPlan, reminderIds: scheduled.ids } } : it)))
    }
    return { item: next, reminder: scheduled.status }
  }, [persist])
  useEffect(() => { markCounterSentRef.current = markCounterSent }, [markCounterSent])

  /** Deleting an offer that was sent keeps it in the archive: its outcome still counts in the monthly analysis. */
  const remove = useCallback(async (id) => {
    const target = itemsRef.current.find((it) => it.id === id)
    if (target) await cancelAll(target)
    if (target && (target.sentAt || target.status !== 'planned')) {
      const archived = [withEvent({ ...target, deletedAt: new Date().toISOString(), notificationId: null }, 'deleted'), ...archiveRef.current.filter((it) => it.id !== id)]
      archiveRef.current = archived
      setArchive(archived)
      await saveArchive(archived)
    }
    await persist((prev) => prev.filter((it) => it.id !== id))
  }, [persist])

  /** Everything the monthly analysis reads: the list and the archive. */
  const allItems = useMemo(() => [...items, ...archive], [items, archive])

  const stats = useMemo(() => {
    // Calibration of the FIRST offer: a counter followed by a deal still counts as "countered".
    const first = (it) => it.firstOutcome || it.status
    const count = (status) => items.filter((it) => first(it) === status).length
    const sent = items.filter((it) => it.status !== 'planned').length
    const accepted = count('accepted') + count('bought')
    const countered = count('countered')
    const declined = count('declined')
    const noReply = count('no_reply')
    const soldOther = count('sold_other')
    const decidedItems = items.filter((it) => OUTCOMES.includes(first(it)) && first(it) !== 'abandoned' && it.probability != null)
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
      soldOther,
      archived: archive.length,
      // Same population as the prediction: only items that carried a first-offer estimate.
      acceptanceRate: decidedItems.length ? decidedItems.filter((it) => ['accepted', 'bought'].includes(first(it))).length / decidedItems.length : null,
      predictedAverage: decidedItems.length ? decidedItems.reduce((s, it) => s + (it.probability || 0), 0) / decidedItems.length : null,
      averageSaving: closed.length ? closed.reduce((s, it) => s + (it.listPrice - it.finalPrice), 0) / closed.length : null,
      closedDeals: closed.length,
      countersWon: withCounter.length ? won.length / withCounter.length : null,
      countersClosed: withCounter.length,
    }
  }, [items, archive])

  return { items, archive, allItems, ready, addFromAnalysis, addCounter, markCounterSent, update, setStatus, remove, stats }
}
