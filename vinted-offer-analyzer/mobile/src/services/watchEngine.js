import AsyncStorage from '@react-native-async-storage/async-storage'
import { AppState, Platform } from 'react-native'
import * as core from '../../core/index.js'
import { scheduleReminderAt } from './notifications.js'
import { askCards, loadProfile, lookupReference, saveProfile } from './interestService.js'
import { onKeyChange } from './secrets.js'
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
 *
 * 1.18: after each reading comes the judgement (judge): the AI's cards for the new articles, a reference for the
 * promising ones (a hunt's own results are its market; the feed asks Vinted for the same product, three searches a
 * reading at most), and the interest score of all (core interest.js). The next alarm is set before it, so that a
 * judgement cut short never breaks the chain. Nothing in a reading waits on a timer of the app: with the app behind
 * they may not fire (http.js).
 *
 * 1.18.3 (the night of 17 November: 43 readings out of 48 got Vinted's «Session refresh» page): when Vinted asks to
 * renew the session its own page does it, in a browser with no screen (SessionRenewal.kt), and the reading goes on.
 * A reading that read nothing is counted (`empty`, and `stale` in a row); after a few in a row the user is told.
 *
 * 1.18.1: an article counts as asked only when the AI answered (no key, a key the phone did not let be read, no
 * network: asked again at the next occasion), and the judgement also runs with no reading (judgeNow): when a key is
 * saved, when the app comes back in front with articles still without their card, when the user asks.
 */
export const AUTO_KEY = 'offerta-vinted.auto.v1'
export const WATCH_TICK_TASK = 'OvtWatchTick'
const ORIGIN = 'https://www.vinted.it'
const LOG_MAX = 80
/** When this JavaScript started: a reading right after it means the app was not alive when the alarm rang. */
const BOOT_AT = Date.now()
/** A reading that has not ended after this long is taken for lost (the task was cut): the next one may start. */
const BUSY_STALE_MS = 150_000
/** New articles given to the AI in one reading (the rest wait for the next), and searches of the market in one. */
const CARDS_PER_TICK = 40
const LOOKUPS_PER_TICK = 3
/** What the AI may cost in one job, in dollars: past it the scores go on with the cards there are. */
const AI_BUDGET_USD = 0.6
/** The judgement stops asking past this many milliseconds from the start of the reading (the task has two minutes). */
const JUDGE_BUDGET_MS = 85_000
/** How long Vinted's own page may take to renew the session (it waits a minute by itself when another renewal was cut). */
const RENEW_TIMEOUT_MS = 75_000
/** Readings in a row that read nothing before the user is told: two when Vinted asks to renew the session, else three. */
const STALE_TOLD = { sessione: 2, other: 3 }
/** The AI is asked only within this long from the start of the reading: a call may last a minute. */
const ASK_BUDGET_MS = 50_000
/** An article the AI answered about without giving a card is asked this many times in all. */
const CARD_TRIES = 2
/** The last judgement had no AI at all: no key, a key the phone did not let be read, a key the provider refused. */
const NO_AI = ['nokey', 'keyerror', 'auth']
/**
 * The shape of what is saved: 2 since 1.18.1 (a try of a card counts only when the AI answered), 3 since 1.18.2 (a
 * lot is compared piece by piece: the references read from the market before are read again).
 */
const SAVED_V = 3

let state = { mode: 'manual', job: null, finds: [], log: [], draft: null }
let loading = null
let busySince = 0
let judgingSince = 0
let judgeChain = Promise.resolve()
let judgingNow = 0
let netTimer = null
let browserReader = null
let profile = null
const listeners = new Set()

const euro = (v) => core.formatEuro(v)
const clockOf = (ms) => new Date(ms).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
/** The articles the AI still owes a card to. */
const waitingOf = (finds) => finds.filter((f) => !f.card && (f.cardTried || 0) < CARD_TRIES)

function snapshot() {
  const job = state.job
  return {
    ...state, nextAt: job && !job.stopped && !job.waiting ? job.nextAt || null : null, reading: busySince > 0, profile,
    judging: judgingSince > 0, waitingCards: waitingOf(state.finds).length, noCard: state.finds.filter((f) => !f.card).length,
  }
}
function emit() {
  const now = snapshot()
  listeners.forEach((fn) => {
    try { fn(now) } catch { /* a listener of the interface must not stop a reading */ }
  })
}
function persist() {
  return AsyncStorage.setItem(AUTO_KEY, JSON.stringify({ v: SAVED_V, mode: state.mode, job: state.job, finds: state.finds, log: state.log.slice(-LOG_MAX) })).catch(() => {})
}
/** The new state, shown and saved; the promise ends when it is on disk (a background task must wait for it). */
function set(next) {
  state = next
  emit()
  return persist()
}

function load() {
  if (!loading) {
    loading = AsyncStorage.getItem(AUTO_KEY).then(async (raw) => {
      const saved = raw ? JSON.parse(raw) : null
      if (saved && typeof saved === 'object') {
        state = {
          mode: ['manual', 'semi', 'auto'].includes(saved.mode) ? saved.mode : 'manual', job: saved.job || null,
          finds: Array.isArray(saved.finds) ? saved.finds : [], log: Array.isArray(saved.log) ? saved.log : [], draft: state.draft,
        }
        // 1.18.0 counted a try of a card even when no key was there to ask with: those articles are asked again.
        const v = Number(saved.v) || 1
        if (v < 2) {
          state.finds = state.finds.map((f) => (!f.card && f.cardTried ? { ...f, cardTried: 0 } : f))
          if (state.job && state.job.ai === 'auth') state.job = { ...state.job, ai: null }
        }
        if (v < 3) {
          state.finds = state.finds.map((f) => {
            if (!f.refTried && !(f.ref && f.ref.source === 'market')) return f
            const next = { ...f }
            delete next.refTried
            if (next.ref && next.ref.source === 'market') delete next.ref
            return next
          })
        }
      }
      profile = await loadProfile()
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
  const empty = job.empty ? ` (${job.empty} a vuoto)` : ''
  vintedBridge.showWatchStatus(title, `${job.reads || 0} ${job.reads === 1 ? 'lettura' : 'letture'}${empty} · ${state.finds.length} trovati${next} · fino alle ${clockOf(core.jobEndsAt(job))}`)
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
  const ranked = core.rankFinds(state.finds, job.kind === 'hunt' ? job : null)
  const voted = (f) => (f.score ? ` · voto ${f.score.total}${f.score.provisional ? ' provvisorio' : ''}` : '')
  if (job.kind === 'hunt') {
    // The best is the highest score within the price, not the cheapest; what is not the product searched is left out.
    const best = ranked.find((f) => f.eligible && !(f.card && f.card.match === 'no'))
    if (best) await notify(`Caccia finita: ${best.title || 'il migliore'} a ${euro(best.price)}${voted(best)}`, 'Tocca per aprirlo: lo analizzo, poi cuore e offerta con un tocco.', best.url)
    else await notify('Caccia finita', `Niente entro ${euro(job.maxPrice)} in ${job.reads || 0} letture${job.empty ? ` (${job.empty} a vuoto)` : ''}.`)
  } else {
    const top = ranked.filter((f) => f.score && f.score.total >= 70)
    const first = top[0] || ranked[0]
    await notify('Vetrina finita', `${ranked.length} articoli in ${job.reads || 0} letture${job.empty ? ` (${job.empty} a vuoto)` : ''}, ${top.length} da comprare.${first ? ` Il primo: ${first.title || 'articolo'} a ${euro(first.price)}${voted(first)}.` : ''}`, first ? first.url : null)
  }
}

/** The score of every find with what is known now (no request): after a thumb or a change of the interests. */
function rescored(finds, job) {
  return finds.map((f) => (f.card || f.ref ? { ...f, score: core.interestScore(f, { card: f.card || null, ref: f.ref || null, profile, match: job && job.kind === 'hunt' && f.card ? f.card.match : null }) } : f))
}

/**
 * The judgement: cards, references, scores, and the notification of an «affare». `t0`: when the reading started.
 * After a reading (no `source`) what it did goes into the last line of the diary; asked with no reading (`source`:
 * who asked, see judgeNow) it gets a line of its own, and no search of the market (`lookups: false`).
 */
async function judge(t0, { lookups = true, source = null } = {}) {
  const job = state.job
  if (!job) return
  const startedAt = job.startedAt
  const began = Date.now()
  const note = {}
  let list = state.finds
  let spent = job.aiCost || 0
  // What the job says about the AI: as it was, unless the AI is asked now.
  let ai = job.ai || null
  let aiDetail = job.aiDetail || null
  // 1. The AI's cards for the articles that have none, the newest first.
  const waiting = waitingOf(list).sort((a, b) => b.lastSeen - a.lastSeen).slice(0, CARDS_PER_TICK)
  if (!waiting.length) ai = aiDetail = null
  else if (spent >= AI_BUDGET_USD) { ai = 'budget'; aiDetail = null }
  else if (Date.now() - t0 < ASK_BUDGET_MS) {
    const got = await askCards(waiting, { target: job.kind === 'hunt' ? job.label || '' : '' })
    spent += got.costUsd
    note.schede = Object.keys(got.cards).length
    note.chieste = waiting.length
    ai = got.error || null
    aiDetail = got.error ? got.detail || null : null
    // A try is one the AI answered: with no key, no network or a refusal the article is asked again, as many times
    // as it takes.
    const answered = new Set(got.answered)
    list = list.map((f) => (got.cards[f.id] ? { ...f, card: got.cards[f.id] } : answered.has(f.id) ? { ...f, cardTried: (f.cardTried || 0) + 1 } : f))
  }
  if (ai) note.ai = ai
  if (aiDetail) note.ai_dettaglio = aiDetail
  // 2. The reference.
  if (job.kind === 'hunt') {
    // The results of the hunt's own search are the market of what it looks for: no other request.
    const same = list.filter((f) => f.card && f.card.match === 'si')
    list = list.map((f) => {
      if (!f.card) return f
      const others = same.filter((o) => o.id !== f.id)
      const alike = others.filter((o) => !f.band || !o.band || o.band === f.band)
      // Only for what is the product searched: a variant or another thing is worth what the AI estimates for it.
      // A lot of volumes among them counts by its price a volume; a lot of anything else keeps the AI's estimate.
      const market = f.card.match === 'si' ? core.referenceAmong(f, f.card, alike.length >= 5 ? alike : others) : null
      return { ...f, ref: market || core.aiReferenceOf(f.card) }
    })
  } else {
    list = list.map((f) => (f.ref || !f.card ? f : { ...f, ref: core.aiReferenceOf(f.card) }))
    // A search of Vinted for the same product, three a reading, a day of memory each: first what is close to a buy,
    // then what the AI's estimate explains worst, what many want and what costs most (core lookupWorthOf).
    const promising = list
      .filter((f) => f.card && !f.refTried && (!f.ref || f.ref.source !== 'market') && f.card.words.length && f.card.confidence >= 0.5 && !f.card.risks.includes('difettoso') && core.lotOf(f, f.card).comparable)
      .map((f) => ({ f, worth: core.lookupWorthOf(f, core.interestScore(f, { card: f.card, ref: f.ref || null, profile })) }))
      .sort((a, b) => b.worth - a.worth)
    let searched = 0
    const looked = []
    for (const { f } of lookups ? promising : []) {
      if (searched >= LOOKUPS_PER_TICK || Date.now() - t0 > JUDGE_BUDGET_MS) break
      const res = await lookupReference(f, f.card)
      if (!res.ok) {
        note.mercato = res.reason
        // Vinted's check, or no network: no other search in this reading.
        break
      }
      if (!res.cached) searched += 1
      // For the diary: what was searched and how many of the results were the same product.
      looked.push({ per: String(f.title || '').slice(0, 36), cerca: f.card.query, parole: f.card.words, visti: res.seen ?? null, uguali: res.same ?? null, valore: res.ref ? res.ref.value : null, ...(res.ref && res.ref.pieces ? { pezzi: res.ref.pieces } : {}), ...(res.cached ? { memoria: true } : {}) })
      list = list.map((x) => (x.id === f.id ? { ...x, ref: res.ref || x.ref, refTried: true } : x))
    }
    if (lookups && promising.length) note.mercati = searched
    if (looked.length) note.ricerche = looked
  }
  // 3. The scores, on the state as it is now (the user may have voted or emptied the list meanwhile).
  const now = state
  if (!now.job || now.job.startedAt !== startedAt) return
  const judged = new Map(list.map((f) => [f.id, f]))
  let finds = now.finds.map((f) => {
    const j = judged.get(f.id)
    return j ? { ...f, card: j.card, cardTried: j.cardTried, ref: j.ref, refTried: j.refTried } : f
  })
  finds = rescored(finds, now.job)
  note.con_voto = finds.filter((f) => f.score).length
  note.senza_scheda = finds.filter((f) => !f.card).length
  note.ms = Date.now() - began
  const told = now.job.told || []
  // An «affare» whose value was read from the market is told at once, each article once.
  const deals = finds.filter((f) => f.score && f.score.total >= 85 && !f.score.provisional && !told.includes(f.id) && !(job.kind === 'hunt' && Number.isFinite(job.maxPrice) && f.price > job.maxPrice * 1.15))
    .sort((a, b) => b.score.total - a.score.total).slice(0, 2)
  const next = { ...now.job, aiCost: Math.round(spent * 10000) / 10000, ai, aiDetail, told: [...told, ...deals.map((f) => f.id)] }
  const last = now.log[now.log.length - 1]
  const line = { quando: new Date().toISOString(), innesco: source, solo_giudizio: true, giudizio: note }
  // The same judgement with nothing new (no key yet, each time the app comes in front) keeps one line, counted.
  const again = source && last && last.solo_giudizio && last.innesco === source && !note.schede && last.giudizio && !last.giudizio.schede && (last.giudizio.ai || null) === (note.ai || null)
  const log = again ? [...now.log.slice(0, -1), { ...line, volte: (last.volte || 1) + 1 }]
    : source ? [...now.log, line].slice(-LOG_MAX)
      : last ? [...now.log.slice(0, -1), { ...last, giudizio: note }] : now.log
  // Saved before anything else is waited for: nothing the user does meanwhile is written over.
  await set({ ...now, job: next, finds, log })
  for (const f of deals) await notify(`Affare (voto ${f.score.total}): ${f.title || 'articolo'} a ${euro(f.price)}`, `${f.score.reasons[0] || ''}. Tocca per aprirlo.`, f.url)
}

/** One judgement at a time: the one of a reading and one asked with no reading wait for each other. Never throws. */
function runJudge(t0, opts) {
  // A judgement that never came back (the task was cut) does not hold the next ones.
  if (judgingSince && Date.now() - judgingSince > BUSY_STALE_MS) judgeChain = Promise.resolve()
  judgeChain = judgeChain.then(async () => {
    judgingSince = Date.now()
    emit()
    try {
      await judge(t0, opts)
    } catch (e) {
      // The scores wait for the next reading; what broke is written where the user and the diary show it.
      const said = String((e && e.message) || e).slice(0, 160)
      try {
        if (state.job) await set({ ...state, job: { ...state.job, ai: 'errore', aiDetail: said }, log: [...state.log, { quando: new Date().toISOString(), innesco: (opts && opts.source) || 'lettura', solo_giudizio: true, giudizio: { errore: said } }].slice(-LOG_MAX) })
      } catch { /* nothing more to do */ }
    }
    judgingSince = 0
    emit()
  })
  return judgeChain
}

/**
 * The judgement with no reading of Vinted. `source`, as written in the diary: 'chiave' a key of the AI was just
 * saved, 'ritorno' the app came back in front with articles still without their card, 'utente' the user asked
 * («Valuta adesso»). Up to three rounds of cards, as long as each brings some; the searches of the market stay with
 * the readings. Returns a word that says what happened; it never throws.
 */
async function judgeNow(source = 'utente') {
  try {
    await load()
    if (!state.job || !state.finds.length) return 'niente'
    // Coming back in front is no reason for a second judgement; a new key and the user's own request wait their turn.
    if (source === 'ritorno' && (judgingNow || (judgingSince && Date.now() - judgingSince < BUSY_STALE_MS))) return 'occupato'
    judgingNow += 1
    try {
      // Asked by the user or with a new key: what the AI left without a card is asked once more.
      if (source !== 'ritorno' && state.finds.some((f) => !f.card && f.cardTried)) await set({ ...state, finds: state.finds.map((f) => (!f.card && f.cardTried ? { ...f, cardTried: 0 } : f)) })
      if (!waitingOf(state.finds).length) return 'niente'
      for (let round = 0; round < 3; round++) {
        const before = state.finds.filter((f) => f.card).length
        await runJudge(Date.now(), { lookups: false, source })
        // Another round only for articles not asked yet (more than one round holds), and only if this one brought cards.
        if (!waitingOf(state.finds).some((f) => !f.cardTried) || state.finds.filter((f) => f.card).length === before) break
      }
      return 'valutato'
    } finally {
      judgingNow -= 1
    }
  } catch {
    return 'errore'
  }
}

/** The page downloaded as it is and read → { ok, via, cards } or { ok: false, via, reason, … } (see readListPage). */
async function downloadList(url) {
  // The web build has no way to Vinted: what a test hands over stands in for the page (cards, or a refusal).
  const handed = Platform.OS === 'web' && typeof window !== 'undefined' ? window.__ovtWatchCards : null
  if (Array.isArray(handed)) return { ok: true, via: 'prova', cards: handed }
  if (handed && handed.reason) return { ok: false, via: 'browser', reason: handed.reason }
  const dl = await fetchVintedListPage(url)
  if (!dl.html) return { ok: false, via: 'scaricata', reason: dl.reason || 'failed' }
  const data = core.parseVintedCatalog(dl.html).items
  if (data.length) return { ok: true, via: 'scaricata', cards: data }
  const marked = core.cardsFromHtml(dl.html)
  if (marked.length) return { ok: true, via: 'scaricata_html', cards: marked }
  // A page with no article: Vinted's check, its request to renew the session, an error, or a search with no result.
  const challenge = dl.mitigated || Boolean(core.detectVintedChallenge(dl.html))
  const title = (dl.html.match(/<title[^>]*>([^<]{0,80})/i) || [])[1] || null
  const reason = challenge ? 'challenge' : core.detectVintedSessionRefresh(dl.html) ? 'sessione' : dl.ok ? 'vuota' : 'http'
  return { ok: false, via: 'scaricata', reason, stato: dl.status, caratteri: dl.html.length, titolo: title }
}

/**
 * Vinted's own renewal of the session (see SessionRenewal.kt): its «Session refresh» page opened in a browser with
 * no screen until it has moved on. → what the diary keeps of it: { esito, ms, pagine, percorso, titolo, errore }.
 */
async function renewSession(url) {
  const test = Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.__ovtRenew === 'function' ? window.__ovtRenew : null
  let res
  try { res = test ? await test(url) : await vintedBridge.renewSession(url, RENEW_TIMEOUT_MS) } catch (e) { res = { ok: false, outcome: 'errore', error: String((e && e.message) || e).slice(0, 120) } }
  if (!res) return { ok: false, esito: 'non_disponibile' }
  const kept = { ok: Boolean(res.ok), esito: res.outcome || (res.ok ? 'rinnovata' : 'errore') }
  for (const [from, to] of [['ms', 'ms'], ['pages', 'pagine'], ['path', 'percorso'], ['title', 'titolo'], ['error', 'errore']]) if (res[from] !== undefined && res[from] !== null) kept[to] = res[from]
  return kept
}

/**
 * One reading of a list page → { ok, via, cards } or { ok: false, via, reason }.
 * The page is downloaded as it is: lighter than a browser, and a search page's own data say more than its cards.
 * When Vinted answers that the session is to be renewed (about every two hours), its own page does it in a browser
 * with no screen, and the page is downloaded again. With the app in front, a download that gives no list is
 * followed by the in-app browser, which renews the session by itself.
 */
async function readListPage(url, front) {
  const test = Platform.OS === 'web' && typeof window !== 'undefined' && window.__ovtWatchCards !== undefined && window.__ovtWatchCards !== null
  let got = await downloadList(url)
  if (!got.ok && got.reason === 'sessione' && (test || !front || !browserReader)) {
    const { ok, ...rinnovo } = await renewSession(url)
    const first = got
    if (ok) got = await downloadList(url)
    got = { ...got, rinnovo }
    // Renewed, and the page is still the request to renew: said as it is.
    if (!got.ok && !got.titolo) got.titolo = first.titolo
  }
  if (got.ok || !front || !browserReader || test) return got
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
  // Back in front after readings that read nothing: now, with the browser at hand (not more than once a minute).
  const retry = source === 'ritorno' && (job.waiting || (job.stale && t0 - (job.lastReadAt || 0) > 60_000))
  if (source !== 'avvio' && !retry && (early || job.waiting)) return 'presto'
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
    for (const key of ['scaricata', 'stato', 'caratteri', 'titolo', 'errore', 'rinnovo']) if (res[key] !== undefined && res[key] !== null) entry[key] = res[key]
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
    // Readings that read nothing: how many in all, how many in a row, and why the last one did.
    next.empty = (base.job.empty || 0) + (cards ? 0 : 1)
    next.stale = cards ? 0 : (base.job.stale || 0) + 1
    next.staleWhy = cards ? null : res.reason || 'failed'
    // Vinted's own page gave the session up (its renewal failed): told once, the readings go on without the account.
    if (res.rinnovo && res.rinnovo.esito === 'scaduta' && !next.sessionTold) {
      next.sessionTold = true
      await notify('Vinted ha chiuso la sessione', job.kind === 'hunt' ? 'La caccia prosegue lo stesso. Per le offerte rientra dalla scheda Vinted.' : 'La vetrina ora legge la home di tutti, non la tua. Rientra dalla scheda Vinted per riavere la tua.')
    }
    if (cards) next.staleTold = false
    else if (!next.staleTold && next.stale >= (res.reason === 'sessione' ? STALE_TOLD.sessione : STALE_TOLD.other)) {
      // Once, until a reading reads again: the app in front reads with its own browser.
      next.staleTold = true
      await notify(`${job.kind === 'hunt' ? 'Caccia' : 'Vetrina'}: le letture non riescono`, res.reason === 'sessione'
        ? 'Vinted chiede di rinnovare la sessione e da solo non ci sono riuscito. Apri l\'app: riprendo subito.'
        : `Le ultime ${next.stale} letture non hanno letto nulla. Apri l'app: provo con il browser.`)
    }
    if (job.kind === 'hunt' && cards && NO_AI.includes(base.job.ai)) {
      // Without an AI key there are no scores: an article far under the highest price is told at once, each once.
      for (const f of core.rankFinds(finds, job).filter((x) => x.exceptional && !next.told.includes(x.id)).slice(0, 2)) {
        next.told = [...next.told, f.id]
        await notify(`Affare: ${f.title || 'articolo'} a ${euro(f.price)}`, `Sotto il ${Math.round(core.WATCH.EXCEPTIONAL_SHARE * 100)}% del tuo massimo di ${euro(job.maxPrice)}. Tocca per aprirlo.`, f.url)
      }
    }
    await set({ ...base, job: next, finds, log })
    // The next alarm first: whatever happens to the judgement, the chain of readings goes on.
    const active = core.jobActive(next)
    if (active) await schedule()
    // With no page read the searches of the market would meet the same refusal: only the cards and the scores.
    await runJudge(t0, { lookups: Boolean(cards) })
    if (!active) await endJob('fine')
    else showStatus()
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
  if (job && !job.stopped && !core.jobActive(job)) await endJob('fine')
  else if (core.jobActive(job)) {
    // A reading that is due judges too.
    if (job.waiting || job.stale || !job.nextAt || job.nextAt <= Date.now()) {
      const done = await tick('ritorno')
      if (done !== 'presto') return done
    }
    // The alarm may be gone (the phone was restarted, the app updated): asking again for the same moment costs nothing.
    vintedBridge.scheduleWatchAlarm(job.nextAt)
    armNet(job.nextAt)
    showStatus()
  }
  // Articles still without their card (no key then, a key the phone did not let be read, no network): now, in front.
  if (job && waitingOf(state.finds).length) judgeNow('ritorno')
  return null
}

AppState.addEventListener('change', (next) => { if (next === 'active') resume() })
// A key of the AI saved in the lab: what was waiting for it is judged at once, with no reading.
onKeyChange((provider, present) => { if (present) judgeNow('chiave') })

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
  /** The user's interests changed: saved, and every score follows. */
  async setProfile(next) {
    await load()
    profile = await saveProfile(next)
    return set({ ...state, finds: rescored(state.finds, state.job) })
  },
  /** A thumb on a find (1, −1, or 0 to take it back): the article follows at once, its brand and category learn. */
  async vote(id, vote) {
    await load()
    const target = state.finds.find((f) => f.id === id)
    if (!target) return null
    const before = target.vote || 0
    if (vote !== before) {
      let likes = profile ? profile.likes : {}
      if (before) likes = core.learnFromVote(likes, target, target.card || null, -before)
      if (vote) likes = core.learnFromVote(likes, target, target.card || null, vote)
      profile = await saveProfile({ likes })
    }
    const finds = state.finds.map((f) => (f.id === id ? { ...f, vote: vote || undefined } : f))
    return set({ ...state, finds: rescored(finds, state.job) })
  },
  tick,
  resume,
  judgeNow,
  /** What «Condividi il diario» shares: the job, how Android's alarms are doing, and every reading. */
  diary() {
    const { job, log, finds } = state
    const iso = (ms) => (ms ? new Date(ms).toISOString() : null)
    const alarm = vintedBridge.watchAlarmInfo()
    return {
      lavoro: job ? {
        tipo: job.kind, avviato: iso(job.startedAt), ore: job.hours, letture: job.reads || 0, a_vuoto: job.empty || 0, a_vuoto_di_fila: job.stale || 0, fermato: job.stopped || null, in_attesa: job.waiting || null,
        prezzo_massimo: job.maxPrice ?? null, prossima: iso(job.nextAt), sveglia: job.sveglia ?? null,
        ai: job.ai || null, ai_dettaglio: job.aiDetail || null, ai_costo_usd: job.aiCost || 0,
      } : null,
      sveglie: alarm ? { esatte: alarm.exact, impostata_per: iso(alarm.scheduledAt), ultima_suonata: iso(alarm.firedAt), ultima_lettura_avviata: iso(alarm.tickAt), errore: alarm.error || null, errore_alle: iso(alarm.errorAt) } : null,
      batteria_senza_restrizioni: vintedBridge.isBatteryUnrestricted(),
      trovati: finds.length,
      senza_scheda: finds.filter((f) => !f.card).length,
      in_attesa_della_scheda: waitingOf(finds).length,
      voti: {
        con_voto: finds.filter((f) => f.score).length, provvisori: finds.filter((f) => f.score && f.score.provisional).length,
        affare: finds.filter((f) => f.score && f.score.total >= 85).length, da_comprare: finds.filter((f) => f.score && f.score.total >= 70 && f.score.total < 85).length,
        da_trattare: finds.filter((f) => f.score && f.score.total >= 55 && f.score.total < 70).length,
      },
      primi: core.rankFinds(finds, job && job.kind === 'hunt' ? job : null).slice(0, 8).map((f) => ({
        titolo: f.title, prezzo: f.price, voto: f.score ? f.score.total : null, etichetta: f.score ? f.score.label : null, provvisorio: f.score ? f.score.provisional : null,
        categoria: f.card ? f.card.category : null, pezzi: f.card ? core.lotOf(f, f.card).pieces : null, stima_ai: f.card ? [f.card.usedLow, f.card.usedHigh] : null, fiducia: f.card ? f.card.confidence : null,
        riferimento: f.ref ? { valore: f.ref.value, da: f.ref.source, annunci: f.ref.n } : null, motivi: f.score ? f.score.reasons : null,
      })),
      letture: log,
    }
  },
}
