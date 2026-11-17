import AsyncStorage from '@react-native-async-storage/async-storage'
import { AppState, Platform } from 'react-native'
import * as core from '../../core/index.js'
import { scheduleReminderAt } from './notifications.js'
import { fetchVintedListPage } from './vinted.js'
import { vintedBridge } from './vintedBridge.js'

/**
 * The engine of «caccia» (semi-automatic) and «vetrina» (automatic), outside the interface (1.17).
 *
 * One job at a time: a page (a search, or the user's Vinted home) read again after a wait drawn anew each time
 * between 8 and 12 minutes. What the articles say is kept and ranked (core watch.js). The job, what it found and the
 * diary of its readings live in the phone's storage, so that a reading can happen with no screen of the app alive.
 *
 * Who starts a reading (`innesco` in the diary):
 * - 'avvio'   the user started the job;
 * - 'sveglia' Android's alarm clock rang (modules/vinted-bridge, WatchAlarms.kt) and ran the background task
 *             registered in index.js: this is what works with the app behind, the screen off or the app closed;
 * - 'timer'   the app's own timer, the net under the alarm while the app is in front (and the only way where there
 *             are no alarms: the web build);
 * - 'ritorno' the app came back in front and a reading was overdue, or waiting for the browser.
 *
 * A page is downloaded with the app's own plain request; the in-app browser, a real one, is asked only with the app
 * in front and when the download gives no list. A check asked by Vinted is never worked around: met by the download
 * with the app behind it pauses the job until the app is in front; asked of the browser it stops the job.
 * The engine never sends an offer: a hunt ends with a notification, and the user sends it.
 */
export const AUTO_KEY = 'offerta-vinted.auto.v1'
export const WATCH_TICK_TASK = 'OvtWatchTick'
const ORIGIN = 'https://www.vinted.it'
const LOG_MAX = 80
/** When this JavaScript started: a reading right after it means the app was not alive when the alarm rang. */
const BOOT_AT = Date.now()
/** A reading that has not ended after this long is taken for lost (the task was cut): the next one may start. */
const BUSY_STALE_MS = 150_000

let state = { mode: 'manual', job: null, finds: [], log: [], draft: null }
let loading = null
let busySince = 0
let netTimer = null
let browserReader = null
const listeners = new Set()

const euro = (v) => core.formatEuro(v)
const clockOf = (ms) => new Date(ms).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })

function snapshot() {
  const job = state.job
  return { ...state, nextAt: job && !job.stopped && !job.waiting ? job.nextAt || null : null, reading: busySince > 0 }
}
function emit() {
  const now = snapshot()
  listeners.forEach((fn) => {
    try { fn(now) } catch { /* a listener of the interface must not stop a reading */ }
  })
}
function persist() {
  return AsyncStorage.setItem(AUTO_KEY, JSON.stringify({ mode: state.mode, job: state.job, finds: state.finds, log: state.log.slice(-LOG_MAX) })).catch(() => {})
}
/** The new state, shown and saved; the promise ends when it is on disk (a background task must wait for it). */
function set(next) {
  state = next
  emit()
  return persist()
}

function load() {
  if (!loading) {
    loading = AsyncStorage.getItem(AUTO_KEY).then((raw) => {
      const saved = raw ? JSON.parse(raw) : null
      if (saved && typeof saved === 'object') {
        state = {
          mode: ['manual', 'semi', 'auto'].includes(saved.mode) ? saved.mode : 'manual', job: saved.job || null,
          finds: Array.isArray(saved.finds) ? saved.finds : [], log: Array.isArray(saved.log) ? saved.log : [], draft: state.draft,
        }
      }
      emit()
    }).catch(() => {})
  }
  return loading
}

/** A notification a few seconds from now. Awaited by who calls it: a background task ends when its promise does. */
const notify = (title, body, link = null) => Promise.resolve().then(() => scheduleReminderAt({ itemId: null, link, at: Date.now() + 6500, title, body, kind: 'auto' })).catch(() => null)

function showStatus() {
  const job = state.job
  if (!core.jobActive(job)) return
  const title = `${job.kind === 'hunt' ? 'Caccia' : 'Vetrina'} in corso${job.label ? ` · ${String(job.label).slice(0, 40)}` : ''}`
  const next = job.waiting ? ' · in pausa: apri l\'app' : job.nextAt ? ` · prossima verso le ${clockOf(job.nextAt)}` : ''
  vintedBridge.showWatchStatus(title, `${job.reads || 0} ${job.reads === 1 ? 'lettura' : 'letture'} · ${state.finds.length} trovati${next} · fino alle ${clockOf(core.jobEndsAt(job))}`)
}

/** The app's own timer under the alarm: it reads only if the alarm has not, twenty seconds after its time. */
function armNet(nextAt) {
  if (netTimer) clearTimeout(netTimer)
  const alarms = Platform.OS === 'android' && vintedBridge.available
  netTimer = setTimeout(() => { tick('timer') }, Math.max(500, nextAt - Date.now() + (alarms ? 20_000 : 0)))
}

/** Draws the wait before the next reading and asks Android for the alarm at that moment. */
async function schedule() {
  const job = state.job
  if (!core.jobActive(job)) return
  const now = Date.now()
  const nextAt = now + Math.min(core.nextRefreshDelayMs(), Math.max(1000, core.jobEndsAt(job) - now))
  const sveglia = vintedBridge.scheduleWatchAlarm(nextAt)
  await set({ ...state, job: { ...state.job, nextAt, sveglia } })
  armNet(nextAt)
  showStatus()
}

async function endJob(reason) {
  const base = state
  if (!base.job || base.job.stopped) return
  if (netTimer) clearTimeout(netTimer)
  netTimer = null
  vintedBridge.cancelWatchAlarm()
  vintedBridge.hideWatchStatus()
  const job = { ...base.job, stopped: reason, stoppedAt: Date.now(), nextAt: null, waiting: null }
  await set({ ...base, job })
  if (reason === 'verifica') await notify('Ricerca fermata', 'Vinted chiede una verifica: aprila nella scheda Vinted, poi riavvia la ricerca.')
  if (reason !== 'fine') return
  const ranked = core.rankFinds(base.finds, job.kind === 'hunt' ? job : null)
  if (job.kind === 'hunt') {
    const best = ranked.find((f) => f.eligible)
    if (best) await notify(`Caccia finita: ${best.title || 'il migliore'} a ${euro(best.price)}`, 'Tocca per aprirlo: lo analizzo, poi cuore e offerta con un tocco.', best.url)
    else await notify('Caccia finita', `Niente entro ${euro(job.maxPrice)} in ${job.reads || 0} letture.`)
  } else await notify('Vetrina finita', `${ranked.length} articoli raccolti in ${job.reads || 0} letture: li trovi nella scheda Caccia.`)
}

/**
 * One reading of a list page → { ok, via, cards } or { ok: false, via, reason }.
 * The page is downloaded as it is: lighter than a browser, and a search page's own data say more than its cards.
 * With the app in front, a download that gives no list is followed by the in-app browser.
 */
async function readListPage(url, front) {
  // The web build has no in-app browser: what a test hands over stands in for the page (cards, or a refusal).
  const handed = Platform.OS === 'web' && typeof window !== 'undefined' ? window.__ovtWatchCards : null
  if (Array.isArray(handed)) return { ok: true, via: 'prova', cards: handed }
  if (handed && handed.reason) return { ok: false, via: 'browser', reason: handed.reason }
  let got
  const dl = await fetchVintedListPage(url)
  if (!dl.html) got = { ok: false, via: 'scaricata', reason: dl.reason || 'failed' }
  else {
    const data = core.parseVintedCatalog(dl.html).items
    const marked = data.length ? [] : core.cardsFromHtml(dl.html)
    if (data.length) got = { ok: true, via: 'scaricata', cards: data }
    else if (marked.length) got = { ok: true, via: 'scaricata_html', cards: marked }
    else {
      // A page with no article: Vinted's check, an error, or a search with no result. What it calls itself helps to tell.
      const challenge = dl.mitigated || Boolean(core.detectVintedChallenge(dl.html))
      const title = (dl.html.match(/<title[^>]*>([^<]{0,80})/i) || [])[1] || null
      got = { ok: false, via: 'scaricata', reason: challenge ? 'challenge' : dl.ok ? 'vuota' : 'http', stato: dl.status, caratteri: dl.html.length, titolo: title }
    }
  }
  if (got.ok || !front || !browserReader) return got
  let seen
  try { seen = await browserReader(url) } catch { seen = { ok: false, reason: 'failed' } }
  if (seen.ok) return { ok: true, via: 'browser', cards: seen.cards, diag: seen.diag || null }
  return { ok: false, via: 'browser', reason: seen.reason || 'failed', scaricata: got.reason, stato: got.stato, caratteri: got.caratteri, titolo: got.titolo }
}

/**
 * One reading of the running job, if it is time. `source`: who asks (see the top of the file). Returns a word that
 * says what happened; it never throws.
 */
async function tick(source = 'timer') {
  await load()
  const job = state.job
  if (!job || job.stopped) { vintedBridge.cancelWatchAlarm(); return 'nessun lavoro' }
  if (!core.jobActive(job)) { await endJob('fine'); return 'finito' }
  const t0 = Date.now()
  if (busySince && t0 - busySince < BUSY_STALE_MS) return 'occupato'
  // An alarm or a timer of a reading already done by the other: not before its time.
  const early = job.nextAt && t0 < job.nextAt - 5000
  if (source !== 'avvio' && !(source === 'ritorno' && job.waiting) && (early || job.waiting)) return 'presto'
  busySince = t0
  emit()
  const front = AppState.currentState === 'active'
  let res
  try { res = await readListPage(job.url, front) } catch (e) { res = { ok: false, via: null, reason: 'failed', errore: String((e && e.message) || e).slice(0, 120) } }
  busySince = 0
  try {
    const now = Date.now()
    const base = state
    if (!base.job || base.job.stopped || base.job.startedAt !== job.startedAt) { emit(); return 'cambiato' }
    const cards = res.ok ? res.cards : null
    const entry = {
      quando: new Date(now).toISOString(), innesco: source, ritardo_s: job.nextAt ? Math.round((t0 - job.nextAt) / 1000) : null, freddo: source === 'sveglia' ? t0 - BOOT_AT < 20_000 : undefined,
      sfondo: !front, via: res.via, ms: now - t0, esito: res.ok ? 'ok' : res.reason || 'failed', schede: cards ? cards.length : null,
    }
    for (const key of ['scaricata', 'stato', 'caratteri', 'titolo', 'errore']) if (res[key] !== undefined && res[key] !== null) entry[key] = res[key]
    if (res.diag) entry.pagina = { ...res.diag, sample: cards && cards.length ? undefined : res.diag.sample }
    const log = [...base.log, entry].slice(-LOG_MAX)
    if (!res.ok && res.reason === 'challenge') {
      if (res.via === 'browser') {
        // The browser itself was asked to verify: the job stops, the user does it by hand.
        await set({ ...base, log })
        await endJob('verifica')
        return 'verifica'
      }
      // The download met the check with the app behind: no further attempt until the app is in front, where the
      // browser reads the page (see resume).
      if (!base.job.waiting) await notify('Ricerca in pausa', 'Vinted ha risposto con un controllo: apri l\'app per riprendere le letture.')
      vintedBridge.cancelWatchAlarm()
      await set({ ...base, job: { ...base.job, waiting: 'verifica', nextAt: null }, log })
      showStatus()
      return 'in pausa'
    }
    let { finds } = base
    if (cards) {
      const merged = core.mergeFinds(base.finds, cards, { at: now, source: job.kind, origin: ORIGIN })
      finds = merged.finds
      entry.nuovi = merged.fresh.length
    }
    const next = { ...base.job, reads: (base.job.reads || 0) + 1, lastReadAt: now, told: base.job.told || [], waiting: null }
    if (job.kind === 'hunt' && cards) {
      // An exceptional one is told at once, each article once: on Vinted the best ones do not wait a day.
      for (const f of core.rankFinds(finds, job).filter((x) => x.exceptional && !next.told.includes(x.id)).slice(0, 2)) {
        next.told = [...next.told, f.id]
        await notify(`Affare: ${f.title || 'articolo'} a ${euro(f.price)}`, `Sotto il ${Math.round(core.WATCH.EXCEPTIONAL_SHARE * 100)}% del tuo massimo di ${euro(job.maxPrice)}. Tocca per aprirlo.`, f.url)
      }
    }
    await set({ ...base, job: next, finds, log })
    if (core.jobActive(next)) await schedule()
    else await endJob('fine')
    return res.ok ? 'letto' : 'non letto'
  } catch {
    // Whatever went wrong after the page was read, the chain of alarms must not break.
    try { await schedule() } catch { /* the app coming back in front takes it up again */ }
    return 'errore'
  }
}

/** The app is in front (or has just started): an overdue or waiting reading happens now, a pending one is set again. */
async function resume() {
  await load()
  const job = state.job
  if (job && !job.stopped && !core.jobActive(job)) return endJob('fine')
  if (!core.jobActive(job)) return null
  if (job.waiting || !job.nextAt || job.nextAt <= Date.now()) return tick('ritorno')
  // The alarm may be gone (the phone was restarted, the app updated): asking again for the same moment costs nothing.
  vintedBridge.scheduleWatchAlarm(job.nextAt)
  armNet(job.nextAt)
  showStatus()
  return null
}

AppState.addEventListener('change', (next) => { if (next === 'active') resume() })

export const watchEngine = {
  load,
  snapshot,
  /** `fn(snapshot)` at every change; returns the function that stops it. */
  subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  /** The interface lends its hidden browser: `fn(url)` → { ok, cards, diag } | { ok: false, reason }. */
  setBrowserReader(fn) { browserReader = typeof fn === 'function' ? fn : null },
  async setMode(mode) {
    await load()
    return set({ ...state, mode, draft: mode === 'semi' ? state.draft : null })
  },
  async setDraft(draft) {
    await load()
    return set({ ...state, mode: 'semi', draft })
  },
  async clearFinds() {
    await load()
    return set({ ...state, finds: [] })
  },
  /** A new job, with its own list and its own diary; its first reading happens at once. */
  async startJob(job) {
    await load()
    if (netTimer) clearTimeout(netTimer)
    vintedBridge.cancelWatchAlarm()
    busySince = 0
    await set({ ...state, job: { ...job, startedAt: Date.now(), reads: 0, told: [], nextAt: null, waiting: null }, finds: [], log: [], draft: null })
    return tick('avvio')
  },
  stopJob: () => endJob('utente'),
  tick,
  resume,
  /** What «Condividi il diario» shares: the job, how Android's alarms are doing, and every reading. */
  diary() {
    const { job, log, finds } = state
    const iso = (ms) => (ms ? new Date(ms).toISOString() : null)
    const alarm = vintedBridge.watchAlarmInfo()
    return {
      lavoro: job ? {
        tipo: job.kind, avviato: iso(job.startedAt), ore: job.hours, letture: job.reads || 0, fermato: job.stopped || null, in_attesa: job.waiting || null,
        prezzo_massimo: job.maxPrice ?? null, prossima: iso(job.nextAt), sveglia: job.sveglia ?? null,
      } : null,
      sveglie: alarm ? { esatte: alarm.exact, impostata_per: iso(alarm.scheduledAt), ultima_suonata: iso(alarm.firedAt), ultima_lettura_avviata: iso(alarm.tickAt), errore: alarm.error || null, errore_alle: iso(alarm.errorAt) } : null,
      batteria_senza_restrizioni: vintedBridge.isBatteryUnrestricted(),
      trovati: finds.length,
      letture: log,
    }
  },
}
