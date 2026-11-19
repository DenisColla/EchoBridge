import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_PROFILE, applyCheckpoint, buildDataset, dueMonths, firstOfferCorrected, liveCheckpoint, liveProfile, monthKeyOf, monthStartOf, monthlyReport,
  normalizeProfile, profileIsActive, reportFileName, reportHeadline, reportWorkbook, shiftMonth, withLiveHistory,
} from '../../core/index.js'
import { loadLearningState, saveLearningState } from '../services/storage.js'
import { chooseReportFolder, copyReportToFolder, shareReport, writeReport } from '../services/reports.js'
import { ensureMonthlyReminder as ensureMonthlyNotification } from '../services/notifications.js'

const iso = (d) => new Date(d).toISOString()
const REPORTS_KEPT = 24
const PROFILES_KEPT = 24
/** Morning of the 1st: the month is closed, the seller-side evening has not started. */
const MONTHLY_HOUR = 9
const MONTHLY_MINUTE = 7

/**
 * First run: nothing to compare yet. The month in progress is reported at its end (lastProcessed = previous month),
 * the engine starts from its defaults and test variations are on (the user chose "poche e piccole").
 */
const initialState = (now) => ({
  version: 1,
  installedAt: iso(now),
  lastProcessed: shiftMonth(monthKeyOf(now), -1),
  profile: null,
  history: [],
  undo: null,
  reports: [],
  folder: null,
  exploration: true,
  monthlyReminder: null,
  lastRunAt: null,
  lastError: null,
})

const pickSummary = (s) => ({
  offersSent: s.offersSent, closedDeals: s.closedDeals, lostDeals: s.lostDeals, pending: s.pending, totalSavedEur: s.totalSavedEur, avgSavingPct: s.avgSavingPct,
  firstAcceptRate: s.firstAcceptRate, predictedFirstAccept: s.predictedFirstAccept, sellerCounters: s.sellerCounters, avgSellerRaisePct: s.avgSellerRaisePct,
  ourCounters: s.ourCounters, ourCountersAccepted: s.ourCountersAccepted, medianLatencyH: s.medianLatencyH, explored: s.explored,
})

const nextMonthlyAt = (now) => {
  const start = monthStartOf(shiftMonth(monthKeyOf(now), 1))
  start.setHours(MONTHLY_HOUR, MONTHLY_MINUTE, 0, 0)
  return start
}

/**
 * The learning loop on the phone, in two rhythms.
 *  - Live (engine-spec §1.5): on every change of the list the general correction and the discount slope are re-fitted
 *    from the outcomes (liveProfile) and persisted when they move beyond hysteresis, roll back or rest on more data;
 *    the history keeps one live checkpoint per day, the rollback is judged against the one applied 30 days ago.
 *  - Monthly: at the first app open of a new month (or from the 1st-of-month notification) it builds the closed month's
 *    report from the list and the archive, saves the Excel file (chosen folder + private copy) and applies the monthly
 *    families of the profile automatically, keeping the previous one for «Annulla».
 */
export function useLearning({ items, ready }) {
  const [state, setState] = useState(null)
  const [busy, setBusy] = useState(false)
  const stateRef = useRef(null)
  const runningRef = useRef(false)
  const itemsRef = useRef(items)
  useEffect(() => { itemsRef.current = items }, [items])

  useEffect(() => {
    loadLearningState().then((saved) => {
      // An unreadable state was copied aside by the loader; start fresh but keep that copy.
      const usable = saved && !saved.unreadable && saved.version === 1
      const s = usable ? saved : initialState(new Date())
      stateRef.current = s
      setState(s)
      if (!usable) saveLearningState(s)
    })
  }, [])

  const persist = useCallback(async (next) => {
    stateRef.current = next
    setState(next)
    await saveLearningState(next)
  }, [])

  const profile = useMemo(() => (state && state.profile ? normalizeProfile(state.profile) : null), [state])
  /** Engine options: no profile object at all while it changes nothing (the engine then runs exactly as before). */
  const engineProfile = useMemo(() => (profile && (profileIsActive(profile) || profile.cov) ? profile : null), [profile])
  const records = useMemo(() => buildDataset(items, new Date()), [items])

  /** Live recalibration: the fit runs on every change of the records or of the stored state; stored only when it changes something. */
  const checkpoint = useMemo(() => (state ? liveCheckpoint(state.history, new Date()) : null), [state])
  const live = useMemo(() => (state ? liveProfile(records, new Date(), { previous: state.profile, checkpoint }) : null), [records, state, checkpoint])
  useEffect(() => {
    if (!live || !live.changed || !ready || runningRef.current) return
    const s = stateRef.current
    if (!s) return
    // After this persist the memo recomputes with `previous` = the stored profile and reports no change: no loop.
    persist({ ...s, profile: live.profile, history: withLiveHistory(s.history, live.profile) })
  }, [live, ready, persist])
  const liveStatus = useMemo(() => (live ? {
    intercept: live.profile.intercept,
    dslope: live.profile.dslope,
    status: live.status,
    nEff: live.nEff,
    basedOn: live.basedOn,
    sd: live.sd,
    fitted: live.fitted,
    applied: live.status.intercept === 'applied' || live.status.dslope === 'applied' || (live.frozen && firstOfferCorrected(live.profile)),
    frozen: live.frozen,
    frozenUntil: live.profile.frozenUntil,
    frozenReason: live.profile.frozenReason,
    rollback: live.rollback,
    appliedAt: live.profile.appliedAt,
    checkpointId: live.profile.checkpointId,
    checkedAt: new Date(),
  } : null), [live])

  /** The repeating 1st-of-month notification; re-checked at every run because a force-stop clears alarms. */
  const ensureMonthlyReminder = useCallback(async (s) => {
    const id = await ensureMonthlyNotification()
    if ((s.monthlyReminder && s.monthlyReminder.id) === id) return s
    return { ...s, monthlyReminder: id ? { id } : null }
  }, [])

  /** Runs every closed month not yet reported. Returns the newest report entry, or null when nothing was due. */
  const runDue = useCallback(async (now = new Date()) => {
    const s = stateRef.current
    if (!s || !ready || runningRef.current) return null
    const months = dueMonths(s.lastProcessed, now)
    if (!months.length) {
      const withReminder = await ensureMonthlyReminder(s)
      if (withReminder !== s) await persist(withReminder)
      return null
    }
    runningRef.current = true
    setBusy(true)
    try {
      let current = s.profile ? normalizeProfile(s.profile) : null
      let history = Array.isArray(s.history) ? s.history : []
      const produced = []
      let undo = s.undo
      let lastError = null
      for (let i = 0; i < months.length; i++) {
        // Let the screen draw (and the toast appear) before each month's calculation.
        await new Promise((resolve) => setTimeout(resolve, 0))
        const month = months[i]
        const isLast = i === months.length - 1
        // Catch-up after months away: one profile step only (the newest month); older months are reports, not changes.
        const report = monthlyReport({ items: itemsRef.current, month, now, previous: current, profileHistory: history, explorationEnabled: s.exploration !== false, applied: isLast })
        const fileName = reportFileName(report)
        const file = await writeReport({ bytes: reportWorkbook(report), fileName, folderUri: s.folder ? s.folder.uri : null })
        if (file.error) lastError = file.error
        const applied = isLast ? report.changes.filter((c) => c.status === 'applied' || c.status === 'capped' || c.status === 'rollback') : []
        produced.push({
          month, label: report.label, generatedAt: report.generatedAt, fileName, savedTo: file.savedTo, localUri: file.localUri, folderUri: file.folderUri, error: file.error,
          headline: reportHeadline(report), summary: pickSummary(report.summary), changes: applied, rollback: Boolean(isLast && report.rollback), notes: report.notes, reverted: false,
        })
        if (isLast) {
          undo = { profile: current, month, at: iso(now) }
          current = report.nextProfile
          if (applied.length || report.rollback) history = [...history, { ...report.nextProfile, cov: null }].slice(-PROFILES_KEPT)
        }
      }
      // Merge into the CURRENT state: the user may have changed the folder or the exploration switch meanwhile.
      const cur = stateRef.current || s
      const next = await ensureMonthlyReminder({
        ...cur, profile: current, history, undo, reports: [...produced.reverse(), ...(cur.reports || [])].slice(0, REPORTS_KEPT),
        lastProcessed: months[months.length - 1], lastRunAt: iso(now), lastError,
      })
      await persist({ ...next, folder: (stateRef.current || next).folder, exploration: (stateRef.current || next).exploration })
      return produced[0]
    } catch (error) {
      await persist({ ...(stateRef.current || s), lastError: String(error && error.message ? error.message : error) })
      return null
    } finally {
      runningRef.current = false
      setBusy(false)
    }
  }, [ready, persist, ensureMonthlyReminder])

  /**
   * «Annulla le correzioni»: the monthly families go back to the profile active before the last monthly run, and the
   * live values go back to their checkpoint and stay frozen for 30 days (so the button means something between closes).
   */
  const undoLast = useCallback(async () => {
    const s = stateRef.current
    if (!s) return false
    const now = new Date()
    let next = s
    if (s.undo) {
      const reports = (s.reports || []).map((r) => (r.month === s.undo.month
        ? { ...r, reverted: true, headline: r.headline.replace(/[^·]*$/, ' correzioni annullate').replace(/\s+/g, ' ').trim() }
        : r))
      // The undone profile stays in the history only as «reverted»: later trends count no corrections for that month.
      const history = (s.history || []).map((p) => (p.month === s.undo.month ? { ...p, changes: [], reverted: true } : p))
      next = { ...s, profile: s.undo.profile, undo: null, reports, history }
    }
    const current = next.profile ? normalizeProfile(next.profile) : null
    if (current && current.live && firstOfferCorrected(current) && !(current.frozenUntil && new Date(current.frozenUntil) > now)) {
      const frozen = applyCheckpoint(current, liveCheckpoint(next.history, now), now, { reason: 'undo' })
      next = { ...next, profile: frozen, history: withLiveHistory(next.history, frozen) }
    }
    if (next === s) return false
    await persist(next)
    return true
  }, [persist])

  const setExploration = useCallback(async (on) => {
    const s = stateRef.current
    if (s) await persist({ ...s, exploration: Boolean(on) })
  }, [persist])

  /** Picks the folder once and drops the latest report there straight away. */
  const chooseFolder = useCallback(async () => {
    const picked = await chooseReportFolder()
    if (!picked.ok) return picked
    const s = stateRef.current
    let reports = s.reports || []
    if (reports[0] && reports[0].localUri) {
      const copy = await copyReportToFolder({ localUri: reports[0].localUri, fileName: reports[0].fileName, folderUri: picked.uri })
      if (copy.ok) reports = [{ ...reports[0], savedTo: 'folder', folderUri: copy.uri, error: null }, ...reports.slice(1)]
    }
    await persist({ ...s, folder: { uri: picked.uri, label: picked.label }, reports, lastError: null })
    return picked
  }, [persist])

  /** «Esporta adesso»: the month in progress up to today, without touching the engine. */
  const exportNow = useCallback(async (now = new Date()) => {
    const s = stateRef.current
    if (!s) return null
    setBusy(true)
    try {
      const month = monthKeyOf(now)
      const report = monthlyReport({ items: itemsRef.current, month, now, previous: s.profile, profileHistory: s.history || [], explorationEnabled: s.exploration !== false, applied: false })
      const fileName = reportFileName(report).replace('.xlsx', '-ad-oggi.xlsx')
      const file = await writeReport({ bytes: reportWorkbook(report), fileName, folderUri: s.folder ? s.folder.uri : null })
      return { ...file, fileName, label: report.label, headline: reportHeadline(report) }
    } finally {
      setBusy(false)
    }
  }, [])

  const share = useCallback((entry) => shareReport(entry && entry.localUri, entry ? `Report ${entry.label}` : undefined), [])

  return {
    ready: Boolean(state),
    busy,
    state,
    profile,
    engineProfile,
    records,
    exploration: state ? state.exploration !== false : true,
    folder: state ? state.folder : null,
    reports: state ? state.reports || [] : [],
    canUndo: Boolean(state && state.undo),
    canUndoLive: Boolean(live && !live.frozen && live.profile.live && firstOfferCorrected(live.profile)),
    liveStatus,
    nextReportAt: state ? nextMonthlyAt(new Date()) : null,
    discountPct: (profile || DEFAULT_PROFILE).discountPct,
    runDue,
    undoLast,
    setExploration,
    chooseFolder,
    exportNow,
    share,
  }
}
