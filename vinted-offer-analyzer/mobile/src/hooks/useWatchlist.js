import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as core from '../../core/index.js'
import { LEARNING, buildCounterReminders, decisionSnapshot } from '../../core/index.js'
import { MAX_CHARS, loadArchive, loadItems, newId, normalizeItem, saveArchive, saveItems } from '../services/storage.js'
import { cancelReminder, ensureNotificationPermission, scheduleAfterReplyReminder, scheduleOfferReminder, scheduleReminderAt } from '../services/notifications.js'
import { linkIdOf, outcomeReminderTimes, outsideQuietHours, overflowSplit } from '../services/segments.js'

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
/** Gate rule 7 (engine-spec §3.3): a listing refused or left unanswered blocks a new plan for this long. */
export const REOFFER_BLOCK_DAYS = 14
const REOFFER_OUTCOMES = ['declined', 'no_reply']
/** After the seller answers a message sent before the offer, the offer itself should follow within this many hours (§4.1). */
export const AFTER_REPLY_HOURS = 2
/** Raw extraction fields kept on the item (engine-spec §6): what the page said, before the form bucketed it. */
const EXTRACTION_FIELDS = ['uploadedDays', 'sellerLastSeenDays', 'sellerFeedbackCount', 'sellerRating', 'sellerBusiness', 'sellerBadges', 'condition', 'brand', 'categoryText']

const finiteMs = (v) => {
  const t = v ? new Date(v).getTime() : NaN
  return Number.isFinite(t) ? t : null
}

/** The raw parse fields worth logging, plus the text hits (listing-text signals) the engine read in title and description. */
export const extractionOf = (ex) => {
  if (!ex || typeof ex !== 'object') return null
  const out = {}
  for (const key of EXTRACTION_FIELDS) out[key] = ex[key] === undefined ? null : ex[key]
  let hits = Array.isArray(ex.textHits) ? ex.textHits.filter(Boolean) : null
  if (!hits) {
    hits = []
    const text = `${ex.title || ''} ${ex.description || ''}`
    const signal = typeof core.signalFromText === 'function' ? core.signalFromText(text) : null
    if (signal && signal.id && signal.id !== 'none') hits.push(signal.id)
    if (core.BUNDLE_HINT instanceof RegExp && core.BUNDLE_HINT.test(text)) hits.push('bundle_hint')
  }
  out.textHits = hits
  return out
}

/** Hours since the seller's last price drop, when the page or the search said so (the same fields the gate reads); else null. */
const dropHoursOf = (sig) => {
  if (!sig || typeof sig !== 'object') return null
  if (sig.priceDrop && typeof sig.priceDrop === 'object' && Number.isFinite(sig.priceDrop.hoursAgo)) return sig.priceDrop.hoursAgo
  return Number.isFinite(sig.priceDropHoursAgo) ? sig.priceDropHoursAgo : null
}

/**
 * Gate rule 7 without the core export: the same listing id (…/items/<id>…) refused or left unanswered within 14 days
 * blocks a new plan. Exempt, as in the core: a negotiation with a seller counter, a listing whose price is now lower
 * than the one refused, and a price drop dated after the refusal (either way the seller moved). Returns null or
 * { until, outcome, at }.
 */
export const localReofferBlock = (records, link, now, { listPrice = null, dropHoursAgo = null } = {}) => {
  const id = linkIdOf(link)
  if (!id) return null
  const t = now.getTime()
  let hit = null
  for (const it of records || []) {
    if (!it || linkIdOf(it.link) !== id || !REOFFER_OUTCOMES.includes(it.status)) continue
    const at = finiteMs(it.outcomeAt)
    if (at === null || t - at > REOFFER_BLOCK_DAYS * DAY_MS || at > t) continue
    if ((Array.isArray(it.negotiation) ? it.negotiation : []).some((e) => e && e.by === 'seller')) continue
    const oldPrice = Number(it.listPrice)
    if (Number.isFinite(listPrice) && Number.isFinite(oldPrice) && listPrice < oldPrice - 0.004) continue
    if (Number.isFinite(dropHoursAgo) && t - dropHoursAgo * HOUR_MS > at) continue
    if (!hit || at > hit.at.getTime()) hit = { until: new Date(at + REOFFER_BLOCK_DAYS * DAY_MS), outcome: it.status, at: new Date(at) }
  }
  return hit
}

/**
 * The core's reofferBlock when the engine exports it (part 2), else the local check above. Both get the listing's
 * current price and the age of its last price drop: the exemptions the gate applies, so «Salva» never refuses an
 * offer the hero asked for.
 */
const reofferBlockFor = (records, link, now, { listPrice = null, dropHoursAgo = null } = {}) => {
  if (typeof core.reofferBlock === 'function') {
    try {
      const block = core.reofferBlock(records, link, now, { listPrice, dropHoursAgo })
      if (!block || !block.until) return null
      const until = new Date(block.until)
      return { until, outcome: block.outcome || 'declined', at: block.at ? new Date(block.at) : new Date(until.getTime() - REOFFER_BLOCK_DAYS * DAY_MS) }
    } catch {
      // a core still being wired: the local rule decides
    }
  }
  return localReofferBlock(records, link, now, { listPrice, dropHoursAgo })
}

/** The last moment an item changed: for the restore merge, the newer copy of the same id wins. */
export const touchedAt = (it) => {
  const events = Array.isArray(it.events) ? it.events.map((e) => e && e.at) : []
  const times = [it.updatedAt, it.outcomeAt, it.sentAt, it.firstOutcomeAt, it.calendarOpenedAt, it.createdAt, ...events].map(finiteMs).filter((v) => v !== null)
  return times.length ? Math.max(...times) : 0
}

/** A restored item carries another device's notification ids: they mean nothing here and must not read as «promemoria attivo». */
const withoutReminders = (it) => ({ ...it, notificationId: null, outcomeReminderIds: [], counterPlan: it.counterPlan ? { ...it.counterPlan, reminderIds: {} } : it.counterPlan ?? null })

/** Links typed without a scheme would not open: default to https. */
const normalizeLink = (link) => {
  const trimmed = (link || '').trim()
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

const iso = (d) => (d ? new Date(d).toISOString() : null)

/** Every notification an item may own: the first-offer reminder, the counter plan's reminders and the «com'è andata?» nudges. */
export const reminderIdsOf = (item) => [
  item.notificationId,
  ...Object.values((item.counterPlan && item.counterPlan.reminderIds) || {}),
  ...(Array.isArray(item.outcomeReminderIds) ? item.outcomeReminderIds : []),
].filter(Boolean)

const cancelAll = async (item) => {
  for (const id of reminderIdsOf(item)) await cancelReminder(id)
}

const OUTCOMES = ['accepted', 'countered', 'declined', 'no_reply', 'sold_other', 'abandoned', 'bought']

/** Did the seller answer the offer? true for a reply of any kind, false for silence, null when the status says nothing. */
const answeredFor = (status) => (['accepted', 'bought', 'declined', 'countered'].includes(status) ? true : status === 'no_reply' ? false : null)

/** Fields added for the 1.7 data log; older items simply lack them (schema stays 3, nothing reads them as required). */
const LOG_FIELDS = { messageCopiedAt: null, messageSentAt: null, replyReceivedAt: null, userOverride: null, answered: null, outcomeReminderIds: [] }

/**
 * «Com'è andata?» at +36 h and +7 d after a first offer went out (outside the quiet hours). Returns the notification
 * ids; [] when permission is missing, the moments are past or scheduling fails. Never throws.
 */
async function scheduleOutcomeReminders(item, sentAt) {
  try {
    const allowed = await ensureNotificationPermission()
    if (!allowed) return []
    const name = item.title && item.title.trim() ? item.title.trim() : "l'articolo"
    const [first, second] = outcomeReminderTimes(sentAt)
    const plans = [
      { at: first, title: "Com'è andata?", body: `${name}: tocca per segnare l'esito dell'offerta.` },
      { at: second, title: 'Ancora nessuna risposta?', body: `${name}: dopo ${LEARNING.NO_REPLY_AFTER_DAYS} giorni il silenzio conta come un no. Segna l'esito.` },
    ]
    const ids = []
    for (const p of plans) {
      if (!p.at) continue
      const id = await scheduleReminderAt({ itemId: item.id, link: item.link, at: p.at, title: p.title, body: p.body, kind: 'outcome' })
      if (id) ids.push(id)
    }
    return ids
  } catch {
    return []
  }
}

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

  /**
   * Applies `updater` to the LATEST list (not the one captured at render time) and saves it. A list that no longer fits
   * its storage row (MAX_CHARS: Android could never read it back) first moves its oldest closed negotiations to the
   * archive, where they keep feeding the monthly analysis; the archive is written before the list, so a crash in
   * between duplicates an item rather than losing it (buildDataset reads each id once).
   */
  const persist = useCallback(async (updater) => {
    let next = typeof updater === 'function' ? updater(itemsRef.current) : updater
    const { keep, moved } = overflowSplit(next, MAX_CHARS)
    if (moved.length) {
      next = keep
      const at = new Date().toISOString()
      const gone = new Set(moved.map((it) => it.id))
      // Newest first, like the rest of the archive: the last one moved sits on top, the oldest is dropped first by the cap.
      const archived = [...moved.map((it) => withEvent({ ...it, deletedAt: at, notificationId: null }, 'archived', { reason: 'storage' })).reverse(), ...archiveRef.current.filter((it) => !gone.has(it.id))]
      archiveRef.current = archived
      setArchive(archived)
      await saveArchive(archived)
    }
    itemsRef.current = next
    setItems(next)
    await saveItems(next)
  }, [])

  /**
   * Saves an analysis as a planned offer and schedules its reminder. Returns { item, reminder, replaced }, or
   * { item: null, blocked: { until, outcome, at } } when the listing was refused within 14 days (gate rule 7): the
   * caller shows «Già in Lista…» and nothing is saved.
   * Stores the decision snapshot (what the engine recommended, with which profile, and the test variation if any) and,
   * for the data log (engine-spec §6): the market and the demand signals the analysis used, the raw extraction fields,
   * the discount policy that proposed the ask, the gate and the message policy. Every one of them may be absent.
   * `userOverride`: the price the user typed in place of the suggested one (null when the suggestion was kept).
   */
  const addFromAnalysis = useCallback(async ({ result, link, form, profile = null, userOverride = null, market = null, extraction = null, policy = null, gate = null, messagePolicy = null }) => {
    const { input, optimal, probability, messages, recommendedTone } = result
    const message = (messages.find((m) => m.tone === recommendedTone) || messages[0]).text
    const now = new Date()
    const cleanLink = normalizeLink(link)
    const signals = (form && form.signals && typeof form.signals === 'object' ? form.signals : null) || input.signals || null
    // The gate ran rule 7 on these very records and this link: a verdict past it (rules 8–10) is trusted as it stands.
    // An earlier rule (1–6) or no gate at all (an older engine) leaves the check to the shared rule, with the same
    // exemptions the gate applies (the seller moved: a lower price, or a drop after our refusal).
    const verdict = gate || result.gate || null
    const pastRule7 = Boolean(verdict && Number.isFinite(Number(verdict.rule)) && Number(verdict.rule) > 7)
    const blocked = pastRule7 ? null : reofferBlockFor([...itemsRef.current, ...archiveRef.current], cleanLink, now, { listPrice: input.listPrice, dropHoursAgo: dropHoursOf(signals) })
    if (blocked) return { item: null, reminder: 'skipped', replaced: 0, blocked }
    const marketUsed = market || result.market || null
    const extractionLog = extractionOf(extraction)
    const gateLog = gate && typeof gate === 'object' ? { kind: gate.kind || null, rule: gate.rule ?? null, reason: gate.reason || null, waitHours: gate.waitHours ?? null, alternative: gate.alternative || null } : null
    const messagePolicyLog = messagePolicy && typeof messagePolicy === 'object'
      ? { mode: messagePolicy.mode || null, rule: messagePolicy.rule ?? null, tone: messagePolicy.tone || null, randomised: Boolean(messagePolicy.randomised), propensity: messagePolicy.propensity ?? null, assigned: messagePolicy.assigned || null }
      : null
    let item = {
      id: newId(),
      schema: 3,
      createdAt: now.toISOString(),
      title: input.itemTitle || '',
      link: cleanLink,
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
      // Vinted's cap may have changed the price): the monthly analysis re-scores exactly this offer. The demand signals
      // ride on it too, so lrnRescore sees the same input as the analysis.
      form: {
        ...(form || {}),
        itemTitle: input.itemTitle || '', category: input.category.id, listPrice: String(input.listPrice).replace('.', ','),
        targetPrice: String(input.targetPrice).replace('.', ','), listingAge: input.listingAge.id, sellerProfile: input.sellerProfile || 'unknown',
        listingSignal: input.listingSignal.id, link: cleanLink,
        ...(signals ? { signals } : {}),
      },
      negotiation: [{ by: 'buyer', kind: 'offer', price: input.targetPrice, at: optimal.date.toISOString(), planned: true, probability }],
      sentAt: null,
      counterPlan: null,
      firstOutcome: null,
      firstOutcomeAt: null,
      finalPrice: null,
      // The data log (engine-spec §6). `extraction` holds the raw page fields, `signals` the DOM/search readings.
      market: marketUsed,
      signals,
      policy: policy && typeof policy === 'object' ? policy : null,
      extraction: extractionLog,
      gate: gateLog,
      messagePolicy: messagePolicyLog,
      tier: result.tier && typeof result.tier === 'object' ? result.tier : null,
      decision: decisionSnapshot(result, {
        now, profile, exploration: result.exploration || null, policy: policy || null, gate: gateLog, messagePolicy: messagePolicyLog,
        extraction: extractionLog, signals, market: marketUsed,
      }),
      events: [{ at: now.toISOString(), type: 'saved', price: input.targetPrice, recommendedAt: optimal.date.toISOString(), probability, exploration: result.exploration ? result.exploration.arm : null, gate: gateLog ? gateLog.kind : null }],
      ...LOG_FIELDS,
      userOverride: userOverride ?? null,
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
      patch.outcomeReminderIds = []
      if (target.counterPlan) patch.counterPlan = { ...target.counterPlan, reminderIds: {} }
    }
    const history = Array.isArray(target.negotiation) ? target.negotiation : []
    const hasSeller = history.some((e) => e.by === 'seller')
    // Never sent: judged from the history, not the status (a plan marked «Lasciato perdere» was never sent either).
    const neverSent = !target.sentAt && !hasSeller && history.length > 0 && Boolean(history[history.length - 1].planned)
    const REFUSALS = ['declined', 'no_reply', 'sold_other', 'abandoned']

    // Back to «Da inviare» with no counter: a correction. Undo the send and the outcome, re-plan the first offer.
    if (status === 'planned' && !hasSeller) {
      const plannedAt = (target.decision && target.decision.recommendedAt) || target.sendAt || (history[0] && history[0].at) || null
      // The «com'è andata?» nudges belong to the send that is being undone.
      for (const rid of Array.isArray(target.outcomeReminderIds) ? target.outcomeReminderIds : []) await cancelReminder(rid)
      patch.outcomeReminderIds = []
      patch.answered = null
      patch.sentAt = null
      patch.sentAtSource = null
      patch.firstOutcome = null
      patch.firstOutcomeAt = null
      patch.finalPrice = null
      patch.negotiation = history.length ? [{ ...history[0], at: plannedAt, planned: true }, ...history.slice(1)] : history
      if (plannedAt && new Date(plannedAt).getTime() > Date.now() + 15 * 60000 && !target.notificationId) {
        try {
          if (await ensureNotificationPermission()) patch.notificationId = (await scheduleOfferReminder({ ...target, sendAt: plannedAt })) || null
        } catch {
          // the item is corrected anyway
        }
      }
      await update(id, patch, { type: 'status', data: { from: target.status, to: status, correction: true } })
      return
    }

    // «Inviata» refers to the first offer only before any counter; later it is a later round.
    if (status === 'sent' && !target.sentAt && !hasSeller) {
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
    // First outcome: set once. Replaced by a late answer after «Nessuna risposta», or when the user corrects a reply to
    // the same offer (accepted ↔ declined ↔ no reply) with no counter in between. accepted → sold/abandoned/bought are
    // later events, not corrections.
    const replies = ['accepted', 'declined', 'no_reply']
    const lateAnswer = target.firstOutcome === 'no_reply' && !hasSeller && ['accepted', 'declined', 'sold_other'].includes(status)
    const correction = !hasSeller && target.firstOutcome && target.status === target.firstOutcome && replies.includes(target.firstOutcome) && replies.includes(status) && status !== target.firstOutcome
    if (OUTCOMES.includes(status) && !boughtWithoutOffer && (!target.firstOutcome || lateAnswer || correction)) {
      // «Comprato» after a refusal, silence or giving up is a purchase at list price, never an accepted offer.
      if (!(status === 'bought' && REFUSALS.includes(target.status))) {
        patch.firstOutcome = status
        patch.firstOutcomeAt = now
      }
    }
    // Final price of «Accettata»/«Comprato»: the last number on the table (his counter if he made one and we took it),
    // the list price when bought after a refusal, after giving up or without any offer.
    const last = (patch.negotiation || history)[(patch.negotiation || history).length - 1]
    const atList = status === 'bought' && (boughtWithoutOffer || REFUSALS.includes(target.status))
    patch.finalPrice = status === 'accepted' || status === 'bought' ? (atList ? target.listPrice : last ? last.price : null) : null
    // Did he answer? A reply or a deal says yes, silence says no; «venduto ad altri» and «lasciato perdere» keep what is known.
    if (OUTCOMES.includes(status)) patch.answered = answeredFor(status) ?? target.answered ?? null
    await update(id, patch, { type: 'status', data: { from: target.status, to: status, finalPrice: patch.finalPrice } })
    // A first offer really sent now: ask how it went at +36 h and +7 d. Saved after the status, never blocking it.
    if (status === 'sent' && patch.sentAtSource === 'tap') {
      const ids = await scheduleOutcomeReminders(target, now)
      if (ids.length) await persist((prev) => prev.map((it) => (it.id === id && it.status === 'sent' ? { ...it, outcomeReminderIds: ids } : it)))
    }
  }, [update, persist])

  /** «Copia messaggio» on a saved offer: when the text was copied (the log tells a sent message from a bare offer). */
  const markMessageCopied = useCallback(async (id) => {
    const now = new Date().toISOString()
    await update(id, { messageCopiedAt: now }, { type: 'message_copied' })
  }, [update])

  /** The user confirmed the offer went out after copying the message: the message went with it. */
  const markMessageSent = useCallback(async (id) => {
    const now = new Date().toISOString()
    await update(id, { messageSentAt: now }, { type: 'message_sent' })
  }, [update])

  /**
   * «Ha risposto al messaggio» (message-first offers): records the reply and schedules «invia l'offerta nella stessa
   * chat» two hours later, outside the quiet hours. The reminder id joins outcomeReminderIds, so any outcome cancels it.
   * Returns { at, reminder: 'scheduled' | 'skipped' } or null for an unknown item.
   */
  const markReplied = useCallback(async (id) => {
    const target = itemsRef.current.find((it) => it.id === id)
    if (!target) return null
    const now = new Date()
    const at = outsideQuietHours(new Date(now.getTime() + AFTER_REPLY_HOURS * HOUR_MS))
    await update(id, { replyReceivedAt: now.toISOString() }, { type: 'reply_received' })
    const rid = await scheduleAfterReplyReminder({ itemId: id, link: target.link, title: target.title, at })
    if (rid) await persist((prev) => prev.map((it) => (it.id === id ? { ...it, outcomeReminderIds: [...(Array.isArray(it.outcomeReminderIds) ? it.outcomeReminderIds : []), rid] } : it)))
    return { at, reminder: rid ? 'scheduled' : 'skipped' }
  }, [update, persist])

  /**
   * «Ripristina da JSON» (Info): merges a backup into the list. Accepts the array Info exports or { items, archive }.
   * Items are matched by id and the newer copy wins (touchedAt); every item goes through normalizeItem, so an older
   * schema is upgraded. An item deleted here (in the archive) is only refreshed in the archive; one deleted on the other
   * device (it carries deletedAt) leaves the list for the archive. Notification ids from the other device are dropped,
   * and this device's own are cancelled when its copy is replaced. A plan without a send moment is invalid.
   * Returns { added, updated, skipped, invalid, total }.
   */
  const restoreItems = useCallback(async (payload) => {
    const raw = Array.isArray(payload) ? payload
      : payload && typeof payload === 'object' ? [...(Array.isArray(payload.items) ? payload.items : []), ...(Array.isArray(payload.archive) ? payload.archive : [])] : []
    let invalid = 0
    const incoming = []
    for (const entry of raw) {
      const it = normalizeItem(entry)
      const wellFormed = it && typeof it.id === 'string' && it.id && typeof it.status === 'string' && (it.status !== 'planned' || finiteMs(it.sendAt) !== null)
      if (wellFormed) incoming.push(withoutReminders(it))
      else invalid += 1
    }
    const next = [...itemsRef.current]
    const archive = [...archiveRef.current]
    let added = 0
    let updated = 0
    let skipped = 0
    let archiveChanged = false
    for (const it of incoming) {
      const i = next.findIndex((x) => x.id === it.id)
      if (i >= 0) {
        if (touchedAt(it) > touchedAt(next[i])) {
          // The reminders belong to the copy being replaced: cancelled here, as remove() does, never orphaned.
          await cancelAll(next[i])
          if (it.deletedAt) {
            next.splice(i, 1)
            const dup = archive.findIndex((x) => x.id === it.id)
            if (dup >= 0) archive.splice(dup, 1)
            archive.unshift(it)
            archiveChanged = true
          } else next[i] = it
          updated += 1
        } else skipped += 1
        continue
      }
      const a = archive.findIndex((x) => x.id === it.id)
      if (a >= 0) {
        if (touchedAt(it) > touchedAt(archive[a])) { archive[a] = { ...it, deletedAt: archive[a].deletedAt || it.deletedAt || null }; archiveChanged = true; updated += 1 } else skipped += 1
        continue
      }
      if (it.deletedAt) { archive.unshift(it); archiveChanged = true } else next.unshift(it)
      added += 1
    }
    if (added || updated) await persist(next)
    if (archiveChanged) {
      archiveRef.current = archive
      setArchive(archive)
      await saveArchive(archive)
    }
    return { added, updated, skipped, invalid, total: next.length }
  }, [persist])

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
        ...existing, negotiation, status: 'countered', outcomeAt: new Date().toISOString(), notificationId: null, outcomeReminderIds: [], answered: true, calendarOpenedAt: null, finalPrice: null, counterPlan: plan,
        firstOutcomeAt: existing.firstOutcome === 'no_reply' && !(existing.negotiation || []).some((e) => e.by === 'seller') ? sellerEntry.at
          : existing.firstOutcomeAt || (existing.firstOutcome ? existing.outcomeAt : sellerEntry.at),
        ...(firstChanged ? {
          targetPrice: n.previousOffer, discountPct: ((existing.listPrice - n.previousOffer) / existing.listPrice) * 100,
          form: existing.form ? { ...existing.form, targetPrice: String(n.previousOffer).replace('.', ',') } : existing.form,
        } : {}),
        // A counter after «Nessuna risposta» means he did answer: the first outcome becomes the counter.
        firstOutcome: !existing.firstOutcome || (existing.firstOutcome === 'no_reply' && !(existing.negotiation || []).some((e) => e.by === 'seller')) ? 'countered' : existing.firstOutcome,
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
        ...LOG_FIELDS, answered: true,
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
      ...target, negotiation: [...(target.negotiation || []), entry], status: 'sent', outcomeAt: now.toISOString(), notificationId: null, outcomeReminderIds: [],
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
      decided: decidedItems.length,
      acceptanceRate: decidedItems.length ? decidedItems.filter((it) => ['accepted', 'bought'].includes(first(it))).length / decidedItems.length : null,
      predictedAverage: decidedItems.length ? decidedItems.reduce((s, it) => s + (it.probability || 0), 0) / decidedItems.length : null,
      averageSaving: closed.length ? closed.reduce((s, it) => s + (it.listPrice - it.finalPrice), 0) / closed.length : null,
      closedDeals: closed.length,
      countersWon: withCounter.length ? won.length / withCounter.length : null,
      countersClosed: withCounter.length,
    }
  }, [items, archive])

  return { items, archive, allItems, ready, addFromAnalysis, addCounter, markCounterSent, markMessageCopied, markMessageSent, markReplied, restoreItems, update, setStatus, remove, stats }
}
