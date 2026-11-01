import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, StatusBar as RNStatusBar, StyleSheet, Text, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import * as core from './core/index.js'
import {
  MONTHS_IT, analyzeOffer, buildFormFromExtraction, explorationKey, explorationPlan, failureRiskFor, formatEuro, leversFor, monthKeyOf,
  nextGoalFor, optimizeOffer, parsePrice, parseVintedItemHtml, policyDiscountFor, quickDiscountsFor,
} from './core/index.js'
import { EMPTY_FORM } from './src/components/formDefaults.js'
import { LinkEntry } from './src/components/LinkEntry.js'
import { DataForm, dataSummaryOf } from './src/components/DataForm.js'
import { ResultView } from './src/components/ResultView.js'
import { WatchlistView } from './src/components/WatchlistView.js'
import { InfoView } from './src/components/InfoView.js'
import { CounterView } from './src/components/CounterView.js'
import { VintedPageLoader } from './src/components/VintedPageLoader.js'
import { LabView } from './src/components/lab/LabView.js'
import { SearchView } from './src/components/search/SearchView.js'
import { useWatchlist } from './src/hooks/useWatchlist.js'
import { useLearning } from './src/hooks/useLearning.js'
import { useLab } from './src/hooks/useLab.js'
import { useSearch } from './src/hooks/useSearch.js'
import { useExpectedCurve } from './src/hooks/useExpectedCurve.js'
import { VIA_LABEL, eventNotesFor, openCalendarWithEvent } from './src/services/calendar.js'
import { ensureNotificationPermission, listenToReminderTaps, scheduleReminderAt } from './src/services/notifications.js'
import { recordRead } from './src/services/readStats.js'
import { badgeCountOf, counterStatsOf } from './src/services/segments.js'
import { fetchVintedItemPage, normalizeVintedLink, readVintedLinkFromClipboard } from './src/services/vinted.js'
import { space, useTheme } from './src/theme.js'
import { Collapsible } from './src/components/ui.js'

const TABS = [
  { id: 'calcola', label: 'Calcola' },
  { id: 'lista', label: 'Lista' },
  { id: 'info', label: 'Info' },
]

const EXTRACT_ERRORS = {
  not_a_vinted_link: 'Serve un link a un articolo Vinted, del tipo vinted.it/items/… .',
  timeout: 'Vinted non ha risposto in tempo. Controlla la connessione e riprova.',
  network: 'Nessuna connessione: non riesco a scaricare l\'annuncio. Puoi compilare i dati a mano.',
  challenge: 'Vinted ha chiesto una verifica anti-robot che non si è completata. Riprova tra poco o compila i dati a mano: il link resta salvato per il promemoria.',
  cancelled: 'Verifica annullata. Puoi riprovare con «Leggi e calcola» o compilare i dati a mano.',
  crashed: 'Il browser interno si è chiuso all\'improvviso. Riprova con «Leggi e calcola» o compila i dati a mano.',
  cferror: 'Vinted ha risposto con una pagina di errore di Cloudflare (blocco o sito non raggiungibile). Riprova tra poco, magari passando da Wi-Fi a dati mobili, oppure compila i dati a mano.',
  empty: 'Ho aperto la pagina ma non contiene i dati dell\'annuncio: forse è stato rimosso o nascosto. Compila i dati a mano.',
}

/** Message for a failed download: the quick one or the in-app browser. */
const extractErrorFor = (page) => {
  if (page.reason === 'http') {
    return page.status === 404 || page.status === 410
      ? 'L\'annuncio non esiste più o è stato rimosso.'
      : `Vinted ha risposto con un errore (${page.status}). Riprova tra poco o compila i dati a mano.`
  }
  return EXTRACT_ERRORS[page.reason] || EXTRACT_ERRORS.network
}

/**
 * Core exports that the second part of engine 1.4.0 adds (thompsonArm, reofferBlock) or retires (explorationBudget,
 * defaultDiscountFor): looked up at call time, so the app runs on either version of the shared engine.
 */
const coreFn = (name) => (typeof core[name] === 'function' ? core[name] : null)
const legacyDefaultDiscount = (profile) => {
  const fn = coreFn('defaultDiscountFor')
  return fn ? fn(profile) : (core.LEARNING && core.LEARNING.DEFAULT_DISCOUNT_PCT) || 20
}

/** «12 ottobre»: the day a listing was refused and the day a new offer may go out (gate rule 7 toast). */
const dayOf = (value) => {
  const d = new Date(value)
  return Number.isFinite(d.getTime()) ? `${d.getDate()} ${MONTHS_IT[d.getMonth()]}` : '…'
}

/** The form fields the price-band policy depends on (band, age tier, modifiers): an edit of one of them re-derives it. */
const POLICY_FIELDS = ['listPrice', 'listingAge', 'category', 'sellerProfile', 'listingSignal']

/** Non-null demand signals of the page (already on the form) and of the search for this listing, the page's reading winning. */
const mergeSignals = (fromForm, fromSearch) => {
  const out = {}
  for (const source of [fromSearch, fromForm]) {
    if (!source || typeof source !== 'object') continue
    for (const [k, v] of Object.entries(source)) if (v !== null && v !== undefined) out[k] = v
  }
  return Object.keys(out).length ? out : null
}

/** The form as the engine scores it: with the demand signals of the page and of «Cerca altrove» (when it searched this listing). */
const withSignals = (f, mk) => {
  const signals = mergeSignals(f && f.signals, mk && mk.signals)
  return signals ? { ...f, signals } : f
}

/** The form of a saved item, for «Ricalcola» from the list: the one it was analysed with, else rebuilt from its fields. */
const formOfItem = (item) => item.form || {
  ...EMPTY_FORM,
  itemTitle: item.title || '',
  category: item.category || '',
  listPrice: String(item.listPrice ?? '').replace('.', ','),
  targetPrice: String(item.targetPrice ?? '').replace('.', ','),
  link: item.link || '',
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  )
}

function Main() {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const [tab, setTab] = useState('calcola')
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [result, setResult] = useState(null)
  const [saveState, setSaveState] = useState(null)
  const [goal, setGoal] = useState(0.7)
  const [plan, setPlan] = useState(null)
  const [optimizing, setOptimizing] = useState(false)
  const [pinnedSendAt, setPinnedSendAt] = useState(null)
  const [highlightId, setHighlightId] = useState(null)
  const [toast, setToast] = useState(null)
  const [extracting, setExtracting] = useState(false)
  /** null | 'browser' (in-app browser passing Vinted's check) | 'verify' (the check is shown to the user) */
  const [extractPhase, setExtractPhase] = useState(null)
  const pageLoaderRef = useRef(null)
  /** Set synchronously: a second tap (link button, clipboard card, «Incolla») never starts a parallel extraction. */
  const extractingRef = useRef(false)
  const [extraction, setExtraction] = useState(null)
  const [clipboardLink, setClipboardLink] = useState(null)
  /** The «Dati dell'offerta» fold: closed by default, opened by «Modifica», by validation errors or by the manual path. */
  const [dataOpen, setDataOpen] = useState(false)
  const [counterContext, setCounterContext] = useState(null)
  /** «Laboratorio AI» open in place of the tab content. */
  const [labOpen, setLabOpen] = useState(false)
  const collectingRef = useRef(false)
  const onCollectingChange = useCallback((v) => { collectingRef.current = v }, [])
  /** The last listing read from a link: reference and starting search of the lab's pair collection. */
  const [lastListing, setLastListing] = useState(null)
  /** «Cerca altrove» open in place of the tab content; the search itself lives in useSearch and survives closing it. */
  const [searchOpen, setSearchOpen] = useState(false)
  const scrollRef = useRef(null)
  const formYRef = useRef(0)
  const formViewRef = useRef(null)
  const formRef = useRef(form)
  const offeredLinkRef = useRef(null)
  const watchlist = useWatchlist()
  const learning = useLearning({ items: watchlist.allItems, ready: watchlist.ready })
  const lab = useLab({ folderUri: learning.folder ? learning.folder.uri : null })
  const search = useSearch()
  const skipExploreRef = useRef(new Set())
  const now = useMemo(() => new Date(), [tab, result]) // eslint-disable-line react-hooks/exhaustive-deps

  const toastTimer = useRef(null)
  const showToast = useCallback((message, ms = 2500) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(message)
    toastTimer.current = setTimeout(() => setToast(null), ms)
  }, [])

  /** The latest extractFromLink, for the reminder-tap listener (registered once). */
  const extractRef = useRef(null)
  useEffect(() => listenToReminderTaps((data) => {
    // An open pair collection may hold unsaved labels: the lab stays, the tab underneath is ready when it closes.
    if (!collectingRef.current) {
      setLabOpen(false)
      setSearchOpen(false)
    }
    if (data && data.kind === 'lever') {
      // A lever reminder («preferito e aspetta», «aspetta 7 giorni»): back to the listing, ready to send the offer.
      setCounterContext(null)
      setTab('calcola')
      if (data.link && extractRef.current) extractRef.current(data.link)
      return
    }
    if (data && data.kind === 'monthly') {
      setCounterContext(null)
      setTab('info')
      return
    }
    if (data && data.itemId) {
      setCounterContext(null)
      setTab('lista')
      setHighlightId(data.itemId)
    }
  }), [])

  /** Monthly close: at the first open of a new month (and when the app comes back to the foreground). */
  const runMonthly = useCallback(async () => {
    const entry = await learning.runDue(new Date())
    if (!entry) return
    const where = entry.savedTo === 'folder' ? `salvato in ${learning.folder ? learning.folder.label : 'cartella'}` : entry.savedTo === 'app' ? 'pronto nella scheda Info'
      : entry.savedTo === 'download' ? 'scaricato' : 'non salvato (dettagli nella scheda Info)'
    showToast(`Report di ${entry.label} ${where}: ${entry.headline.split(' · ').pop()}.`, 5000)
  }, [learning, showToast])
  const runMonthlyRef = useRef(runMonthly)
  useEffect(() => { runMonthlyRef.current = runMonthly }, [runMonthly])
  useEffect(() => {
    if (watchlist.ready && learning.ready) runMonthlyRef.current()
  }, [watchlist.ready, learning.ready])
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') runMonthlyRef.current() })
    return () => sub.remove()
  }, [])

  /** Engine options with the learned profile (none until the monthly report has something to correct). */
  const engineOptions = (extra = {}) => ({ ...extra, ...(learning.engineProfile ? { profile: learning.engineProfile } : {}) })
  /** The market picture of the listing on screen (from «Cerca altrove», when it searched this very listing). */
  const marketInfoFor = (f) => search.marketFor(normalizeVintedLink(f && f.link) || (f && f.link))
  const marketInfo = useMemo(() => marketInfoFor(form), [form.link, search.run, search.store]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * A field edit. The policy the link read put on the form describes the listing AS READ: when the price, the age or a
   * modifier changes, it is rebuilt from the edited form (the exact days online survive while the age is not the edited
   * field, as does the business cap), so the quick chips, the Thompson base and gate rule 3 judge the listing on screen
   * and not a stale table verdict. The typed target is left as typed; without a usable price there is no policy.
   */
  const setField = (name, value) => setForm((prev) => {
    const next = { ...prev, [name]: value }
    if (!POLICY_FIELDS.includes(name) || !prev.policy || prev.policy.source !== 'policy') return next
    const L = parsePrice(next.listPrice)
    if (!(Number.isFinite(L) && L > 0)) return { ...next, policy: null }
    const mk = marketInfoFor(next)
    const prevCaps = Array.isArray(prev.policy.caps) ? prev.policy.caps : []
    return {
      ...next,
      policy: policyDiscountFor({
        listPrice: L, listingAge: next.listingAge, ageDays: name !== 'listingAge' && Number.isFinite(prev.policy.ageDays) ? prev.policy.ageDays : null,
        category: next.category, sellerProfile: next.sellerProfile, listingSignal: next.listingSignal, sellerBusiness: prevCaps.some((c) => c && c.id === 'business') || null,
        signals: next.signals || null, market: mk ? mk.market : null, profile: learning.engineProfile,
      }),
    }
  })

  /** Measures the form at tap time (its offset moves when sections above fold or unfold), with the last layout as fallback. */
  const scrollToForm = () => {
    const scroller = scrollRef.current
    if (!scroller) return
    const go = (y) => scroller.scrollTo({ y: Math.max(0, y - 8), animated: true })
    const node = formViewRef.current
    const inner = scroller.getInnerViewRef ? scroller.getInnerViewRef() : (scroller.getInnerViewNode ? scroller.getInnerViewNode() : null)
    if (node && inner && typeof node.measureLayout === 'function') {
      try {
        node.measureLayout(inner, (x, y) => go(y), () => go(formYRef.current))
        return
      } catch {
        // fall through to the last known layout
      }
    }
    go(formYRef.current)
  }

  /** Opens the «Dati dell'offerta» fold and brings it on screen (the fold needs a render before it can be measured). */
  const openDataForm = () => {
    setDataOpen(true)
    setTimeout(scrollToForm, 80)
  }

  /**
   * `explore` only for fresh analyses (Calcola, link): a pinned moment or an applied option is the user's own choice.
   * The engine's test (Thompson arms on the discount, or the older flagged variation) is the same one every time the
   * offer is re-analysed this month: key and month seed it.
   */
  const runAnalysis = (nextForm, preferredSendAt, { explore = false } = {}) => {
    const at = new Date()
    const mk = marketInfoFor(nextForm)
    const key = explorationKey(nextForm)
    const month = monthKeyOf(at)
    // The saved offers feed gate rule 7 (no re-offer on a listing refused within 14 days); key and month seed the
    // message-first draw and the exploration arm, so the same listing gets the same assignment all month.
    const options = engineOptions({ ...(preferredSendAt ? { preferredSendAt } : {}), ...(mk ? { market: mk.market } : {}), records: watchlist.allItems, key, month })
    // Demand signals of the page and of the search results ride on the form, like the profile: the exploration arms
    // are scored on the same input, so their cost is measured against the same base.
    const scored = withSignals(nextForm, mk)
    let outcome = analyzeOffer(scored, at, options)
    if (outcome.ok && explore && learning.exploration && !skipExploreRef.current.has(key)) {
      const thompson = coreFn('thompsonArm')
      const budgetOf = coreFn('explorationBudget')
      const varied = thompson
        ? thompson(scored, outcome, at, { key, month, options, enabled: true, profile: learning.engineProfile, records: learning.records })
        : explorationPlan(scored, outcome, at, { key, month, options, ...(budgetOf ? { budget: budgetOf(watchlist.allItems, month) } : {}) })
      if (varied && varied.result) outcome = varied.result
    }
    if (!outcome.ok) {
      setErrors(outcome.errors)
      setResult(null)
      // The fields to fix are inside the fold: open it and go there.
      openDataForm()
      return null
    }
    setErrors({})
    setResult(outcome)
    setSaveState(null)
    if (outcome.kind !== 'no_offer_needed') setGoal(nextGoalFor(outcome.probability, outcome.maxProbability))
    setTimeout(() => scrollRef.current && scrollRef.current.scrollTo({ y: 0, animated: true }), 50)
    return outcome
  }

  const analyze = () => {
    setPlan(null)
    setPinnedSendAt(null)
    runAnalysis(form, null, { explore: true })
  }

  /** «Usa il piano migliore»: this offer skips its test variation (until the app restarts). */
  const skipExploration = () => {
    skipExploreRef.current.add(explorationKey(form))
    setPlan(null)
    setPinnedSendAt(null)
    runAnalysis(form, null)
  }

  /** Re-runs the analysis keeping the moment chosen through the optimizer or «Scegli» (used after edits). */
  const recalcKeepingPin = () => runAnalysis(form, pinnedSendAt)

  /** «Scegli» on another moment: the analysis re-runs pinned to it (the hero then says «Orario scelto da te»). */
  const pickMoment = (date) => {
    setPlan(null)
    setPinnedSendAt(date)
    runAnalysis(form, date)
  }

  const optimize = () => {
    setOptimizing(true)
    setTimeout(() => {
      // The optimizer starts from the offer on screen: with a test variation, its price and its moment.
      const ex = result && result.exploration
      const mk = marketInfoFor(form)
      const src = withSignals(ex ? { ...form, targetPrice: String(result.input.targetPrice).replace('.', ',') } : form, mk)
      setPlan(optimizeOffer(src, new Date(), engineOptions({ targetProbability: goal, exactSendAt: ex && ex.kind === 'time' ? ex.at : null, ...(mk ? { market: mk.market } : {}) })))
      setOptimizing(false)
    }, 20)
  }

  const applyOption = (option) => {
    const nextForm = { ...form, targetPrice: String(option.apply.targetPrice).replace('.', ',') }
    setForm(nextForm)
    setPinnedSendAt(option.apply.preferredSendAt)
    setPlan(null)
    const outcome = runAnalysis(nextForm, option.apply.preferredSendAt)
    if (outcome) showToast(`Applicato: ${option.label.toLowerCase()} → ${Math.round(outcome.probability * 100)}%`)
  }

  /** «Usa N €» from the hero: same as typing the price and recalculating. */
  const applyPrice = (price) => {
    const nextForm = { ...form, targetPrice: String(price).replace('.', ',') }
    setForm(nextForm)
    setPlan(null)
    setPinnedSendAt(null)
    const outcome = runAnalysis(nextForm, null)
    if (outcome) showToast(`Offerta impostata a ${formatEuro(price)}.`)
  }

  /** A lever with a reminder («metti nei preferiti e aspetta», «aspetta 7 giorni»): one notification, no item in the list. */
  const scheduleLever = async (lever) => {
    const allowed = await ensureNotificationPermission().catch(() => false)
    if (!allowed) {
      showToast('Notifiche disattivate: attivale nella scheda Info per ricevere il promemoria.', 4000)
      return
    }
    const hours = lever.action.hours
    const name = form.itemTitle || 'L\'articolo'
    // Three reminders share this path: the two levers and the hero's «Ricordamelo tra N h» when the gate says to wait.
    const copy = lever.id === 'patience'
      ? { title: 'È passata una settimana', body: `${name}: controlla se il prezzo è sceso; se è ancora in vendita, invia l'offerta nel momento consigliato.` }
      : lever.id === 'gate_wait'
        ? { title: 'Tempo di riprovare', body: `${name}: controlla se è ancora in vendita e a che prezzo. Se sì, calcola di nuovo e invia l'offerta nel momento consigliato.` }
        : { title: 'Nessuno sconto dal venditore?', body: `${name}: se non è arrivata la sua offerta, invia ora la tua nel momento consigliato.` }
    const when = hours % 24 === 0 ? `tra ${hours / 24} giorni` : hours === 60 ? 'tra due giorni e mezzo' : hours >= 48 ? `tra circa ${Math.round(hours / 24)} giorni` : `tra ${hours} ore`
    try {
      const id = await scheduleReminderAt({ itemId: null, link: form.link || null, at: new Date(Date.now() + hours * 3600 * 1000), kind: 'lever', ...copy })
      showToast(id ? `Ti avviso ${when}.` : 'Non riesco a programmare la notifica.', 4000)
    } catch {
      showToast('Non riesco a programmare la notifica.', 4000)
    }
  }

  /** «Nuova analisi» / «Svuota»: back to the empty screen with the fold closed. */
  const reset = () => {
    setForm(EMPTY_FORM)
    setErrors({})
    setResult(null)
    setSaveState(null)
    setPlan(null)
    setPinnedSendAt(null)
    setExtraction(null)
    setDataOpen(false)
  }

  useEffect(() => { formRef.current = form }, [form])

  /**
   * The one-tap path: download the public listing page, read title, price, upload age and seller activity,
   * map them onto the form (target from the price-band policy, or list price −20%) and run the analysis. Every failure
   * ends in a message, never in a silent no-op, and the link stays in the form so the manual path still works.
   */
  const extractFromLink = async (rawLink) => {
    if (extractingRef.current) return
    const link = normalizeVintedLink(rawLink)
    offeredLinkRef.current = link || rawLink
    setClipboardLink(null)
    if (!link) {
      setExtraction({ ok: false, message: EXTRACT_ERRORS.not_a_vinted_link })
      return
    }
    extractingRef.current = true
    setExtracting(true)
    setExtraction(null)
    setField('link', link)
    try {
      // Quick download first; when Vinted's anti-bot check refuses it (Cloudflare since October 2026), or the page
      // comes back without the listing, the in-app browser opens the same page the way Chrome would.
      let page = await fetchVintedItemPage(link)
      let ex = page.ok ? parseVintedItemHtml(page.html) : null
      const refused = page.ok ? !ex.title && !ex.listPrice : page.reason === 'challenge' || (page.reason === 'http' && page.status !== 404 && page.status !== 410)
      if (refused && pageLoaderRef.current) {
        setExtractPhase('browser')
        const viaBrowser = await pageLoaderRef.current.load(link, { onVisible: () => setExtractPhase('verify') })
        if (viaBrowser.ok) {
          page = viaBrowser
          // The probe's read-only scrape of the hydrated page (views, interested, previous price…) completes the HTML.
          ex = parseVintedItemHtml(viaBrowser.html, viaBrowser.details || null)
        } else if (viaBrowser.reason !== 'unsupported' && !(page.reason === 'http' && (viaBrowser.reason === 'empty' || viaBrowser.reason === 'timeout'))) {
          // An HTTP error of the quick download stays the explanation when the browser found nothing better.
          page = viaBrowser
        }
        setExtractPhase(null)
      }
      if (!page.ok) {
        setExtraction({ ok: false, message: extractErrorFor(page) })
        return
      }
      if (!ex.title && !ex.listPrice) {
        setExtraction({ ok: false, message: EXTRACT_ERRORS.empty })
        return
      }
      // The ask comes from the price-band policy (band × age, modifiers, learned shift) with this listing's market and
      // demand signals when «Cerca altrove» has them; the learned default discount stays as the policy's fallback.
      const mk = marketInfoFor({ link })
      const built = buildFormFromExtraction(ex, {
        link, policy: true, profile: learning.engineProfile, market: mk ? mk.market : null, signals: mk ? mk.signals : null,
        targetDiscountPct: legacyDefaultDiscount(learning.profile), previousForm: { ...EMPTY_FORM, link },
      })
      setForm(built.form)
      setPlan(null)
      setPinnedSendAt(null)
      const outcome = runAnalysis(built.form, null, { explore: true })
      // `raw` is the parser's output as read (kept with the saved item, engine-spec §6); `via` tells the two paths apart.
      const via = page.via === 'browser' ? 'browser' : 'fetch'
      setExtraction({ ok: true, summary: built.summary, link, at: Date.now(), raw: ex, via })
      recordRead(ex, { via }) // per-field read counters for Info; never blocks the analysis
      const idMatch = String(link).match(/\/items\/(\d+)/)
      setLastListing({
        source: 'vinted', id: idMatch ? idMatch[1] : link, url: link, title: ex.title, brand: ex.brand, size: null, condition: ex.condition, price: ex.listPrice,
        photo: ex.photo || null, thumb: ex.photo || null, description: ex.description || null, categoryText: ex.categoryText || null,
      })
      if (!outcome) showToast(ex.listPrice ? 'Letto l\'annuncio: controlla i campi evidenziati.' : 'Letto l\'annuncio ma non il prezzo: inseriscilo a mano.')
    } catch (error) {
      setExtraction({ ok: false, message: `Errore inatteso durante la lettura: ${String(error && error.message ? error.message : error)}` })
    } finally {
      extractingRef.current = false
      setExtracting(false)
      setExtractPhase(null)
    }
  }

  useEffect(() => { extractRef.current = extractFromLink })

  const pasteLink = async () => {
    const link = await readVintedLinkFromClipboard()
    if (!link) {
      showToast('Negli appunti non c\'è un link a un articolo Vinted.')
      return
    }
    await extractFromLink(link)
  }

  /** When the app comes back to the foreground with a Vinted link copied, offer the one-tap path. */
  const checkClipboard = useCallback(async () => {
    const link = await readVintedLinkFromClipboard()
    if (!link) return
    if (link === offeredLinkRef.current || link === normalizeVintedLink(formRef.current.link)) return
    setClipboardLink(link)
  }, [])

  useEffect(() => {
    checkClipboard()
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') checkClipboard() })
    return () => sub.remove()
  }, [checkClipboard])

  /** Typing in the link field dismisses the clipboard proposal: the field then holds the user's own text. */
  const changeLink = (value) => {
    if (clipboardLink) {
      offeredLinkRef.current = clipboardLink
      setClipboardLink(null)
    }
    setField('link', value)
  }

  /** «Ignora» on the clipboard proposal. The field is emptied only without a result: a saved analysis keeps its link. */
  const ignoreClipboard = () => {
    offeredLinkRef.current = clipboardLink
    setClipboardLink(null)
    if (!result) setField('link', '')
  }

  /**
   * What the list stores with the analysis on screen (engine-spec §6): the form as scored (with the demand signals),
   * the market of this listing, the raw extraction when it belongs to this very link, the discount policy, the gate and
   * the message policy. Fields the running engine does not produce are simply absent.
   */
  const savePayload = () => {
    const mk = marketInfoFor(form)
    const raw = extraction && extraction.ok && extraction.raw && extraction.link === normalizeVintedLink(form.link) ? extraction.raw : null
    // userOverride (engine-spec §4): the ask the user typed when it is not the policy's suggestion (its target, or the
    // list price when it said not to offer). The typed price, not the analysed one: an arm the engine varied is its
    // own test, not the user's choice.
    const typed = parsePrice(form.targetPrice)
    const asked = Number.isFinite(typed) ? typed : result.input.targetPrice
    const suggested = form.policy ? (form.policy.kind === 'no_offer' ? result.input.listPrice : form.policy.targetPrice) : null
    const userOverride = Number.isFinite(suggested) && Math.abs(asked - suggested) > 0.004 ? asked : null
    return {
      result, link: form.link, form: withSignals(form, mk), profile: learning.engineProfile, userOverride,
      market: mk ? mk.market : null, extraction: raw, policy: form.policy || null, gate: result.gate || null, messagePolicy: result.messagePolicy || null,
    }
  }

  /** Gate rule 7: the listing was refused within 14 days, nothing is saved. */
  const toastBlocked = (blocked) => {
    const label = blocked.outcome === 'no_reply' ? 'senza risposta' : 'rifiutata'
    showToast(`Già in Lista: ${label} il ${dayOf(blocked.at)}. Rilancia dopo il ${dayOf(blocked.until)}.`, 5000)
  }

  const saveCurrent = async () => {
    if (!result || result.kind === 'no_offer_needed') return
    const saved = await watchlist.addFromAnalysis(savePayload())
    if (saved.blocked) {
      toastBlocked(saved.blocked)
      return
    }
    const { item, reminder, replaced } = saved
    const messages = {
      scheduled: { tone: 'good', message: `Salvato. Ti avviso 10 minuti prima: ${result.verdict.headline.replace("Invia l'offerta ", '')}.` },
      too_soon: { tone: 'warn', message: 'Salvato. Il momento consigliato è troppo vicino per una notifica: invia l\'offerta adesso.' },
      denied: { tone: 'warn', message: 'Salvato senza promemoria: le notifiche sono disattivate. Puoi attivarle nella scheda Info.' },
      skipped: { tone: 'neutral', message: 'Salvato nella lista.' },
    }
    const outcome = messages[reminder]
    setSaveState({ saved: true, itemId: item.id, ...outcome, message: replaced ? outcome.message.replace(/^Salvato/, 'Aggiornato (sostituisce il piano precedente per questo annuncio)') : outcome.message })
  }

  /** «L'ho inviata adesso»: saved and marked sent in one tap (sentAtSource 'tap'); the outcome is then set from the list. */
  const saveAndMarkSent = async () => {
    if (!result || result.kind === 'no_offer_needed') return
    const saved = await watchlist.addFromAnalysis(savePayload())
    if (saved.blocked) {
      toastBlocked(saved.blocked)
      return
    }
    const { item } = saved
    await watchlist.setStatus(item.id, 'sent')
    const message = 'Segnata come inviata: segna l\'esito dalla Lista.'
    setSaveState({ saved: true, itemId: item.id, tone: 'good', message })
    showToast(message, 4000)
  }

  /** «Copia messaggio» in the hero after a save: the log tells a sent message from a bare offer (engine-spec §6). */
  const noteMessageCopied = () => {
    if (saveState && saveState.saved && saveState.itemId) watchlist.markMessageCopied(saveState.itemId)
  }

  /** «Ricalcola» from the list: the saved form (or the link) back into Calcola, analysed again. */
  const reanalyzeItem = (item) => {
    setCounterContext(null)
    setLabOpen(false)
    setSearchOpen(false)
    setTab('calcola')
    setPlan(null)
    setPinnedSendAt(null)
    setExtraction(null)
    setSaveState(null)
    if (!item.form && item.link) {
      setForm({ ...EMPTY_FORM, link: item.link })
      extractFromLink(item.link)
      return
    }
    const nextForm = formOfItem(item)
    setForm(nextForm)
    runAnalysis(nextForm, null)
  }

  const calendarPayload = (source) => {
    // A saved item waiting for our counter: the event carries the new price, not the first offer.
    const plan = source.counterPlan && source.counterPlan.price != null && !source.counterPlan.sentAt ? source.counterPlan : null
    return {
      title: source.title || source.input?.itemTitle || '',
      link: source.link || form.link,
      // A saved item has no `optimal`; a restored plan may have no sendAt either: null, and addCalendar says so.
      sendAt: source.sendAt || (source.optimal && source.optimal.date) || null,
      subject: plan ? 'Invia la nuova offerta' : undefined,
      notes: eventNotesFor({
        link: source.link || form.link,
        targetPrice: plan ? plan.price : source.targetPrice || source.input?.targetPrice,
        probability: plan ? plan.pAccept : source.probability,
        message: source.message || (source.messages ? (source.messages.find((m) => m.tone === source.recommendedTone) || source.messages[0]).text : ''),
      }),
    }
  }

  const [calendarBusy, setCalendarBusy] = useState(false)

  /**
   * «Calendario»: opens the phone's calendar app on a pre-filled "new event" screen (no permission);
   * the user taps Save there. Falls back to Google Calendar and to a .ics file on its own; every outcome is a toast.
   */
  const addCalendar = async (source, itemId, explicitPayload = null) => {
    if (calendarBusy) return
    const payload = explicitPayload || calendarPayload(source)
    if (!payload.sendAt) {
      showToast('Nessun momento di invio per questa offerta.')
      return
    }
    setCalendarBusy(true)
    showToast('Apro il calendario con l\'evento già compilato: controlla e tocca Salva.', 4000)
    try {
      const outcome = await openCalendarWithEvent(payload)
      if (outcome.ok) {
        if (itemId) await watchlist.update(itemId, { calendarOpenedAt: new Date().toISOString() })
        if (outcome.via === 'google') {
          // Linking.openURL resolves before the app switch: show the return message once the app is active again.
          const sub = AppState.addEventListener('change', (state) => {
            if (state !== 'active') return
            sub.remove()
            showToast(VIA_LABEL.google, 4000)
          })
        } else {
          showToast(VIA_LABEL[outcome.via] || VIA_LABEL.intent, 4000)
        }
      } else {
        showToast('Nessuna app calendario ha risposto. Dettagli nella scheda Info.', 4000)
      }
    } finally {
      setCalendarBusy(false)
    }
  }

  /* ───────── counter-offers ───────── */

  const scrollTop = () => setTimeout(() => scrollRef.current && scrollRef.current.scrollTo({ y: 0, animated: true }), 50)
  const openLab = () => { setLabOpen(true); scrollTop() }
  const closeLab = () => { setLabOpen(false); scrollTop() }
  /** Opens «Cerca altrove»; from Calcola it starts a search on the listing just read, unless one on it is already there. */
  const openSearch = (startFromListing = false) => {
    const r = search.run
    const busy = Boolean(r && r.job && r.job.running)
    if (startFromListing && lastListing && !busy && !(r && !r.reopened && r.reference && r.reference.url === lastListing.url)) search.start(lastListing)
    setCounterContext(null)
    setLabOpen(false)
    setSearchOpen(true)
    scrollTop()
  }
  const closeSearch = () => { setSearchOpen(false); scrollTop() }

  // The lab is a screen of its own: Android back closes it instead of leaving the app.
  useEffect(() => {
    if (!labOpen) return undefined
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setLabOpen(false)
      setTimeout(() => scrollRef.current && scrollRef.current.scrollTo({ y: 0, animated: true }), 50)
      return true
    })
    return () => sub.remove()
  }, [labOpen])
  useEffect(() => {
    if (!searchOpen || labOpen) return undefined
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setSearchOpen(false)
      setTimeout(() => scrollRef.current && scrollRef.current.scrollTo({ y: 0, animated: true }), 50)
      return true
    })
    return () => sub.remove()
  }, [searchOpen, labOpen])

  const openCounterFromItem = (item) => {
    const fallbackForm = {
      itemTitle: item.title || '', category: item.category || '', listPrice: String(item.listPrice ?? '').replace('.', ','),
      targetPrice: String(item.targetPrice ?? '').replace('.', ','), listingAge: 'unknown', sellerProfile: 'unknown', listingSignal: 'none', link: item.link || '',
    }
    setCounterContext({ key: `${item.id}-${Date.now()}`, source: 'item', itemId: item.id, form: item.form || fallbackForm, history: item.negotiation || [], offerSentAt: item.sentAt || null, link: item.link || '' })
    scrollTop()
  }

  const openCounterFromAnalysis = () => {
    const saved = saveState && saveState.itemId ? watchlist.items.find((it) => it.id === saveState.itemId) : null
    if (saved) {
      openCounterFromItem(saved)
      return
    }
    // The offer that was analysed (and sent), not whatever the form says now.
    const sentForm = result && result.input ? { ...form, targetPrice: String(result.input.targetPrice).replace('.', ',') } : form
    setCounterContext({ key: `analysis-${Date.now()}`, source: 'analysis', itemId: null, form: sentForm, history: [], offerSentAt: null, link: form.link })
    scrollTop()
  }

  const saveCounter = async (counterResult, rawCounter = null) => {
    const ctx = counterContext
    const { item, reminder } = await watchlist.addCounter({ itemId: ctx.itemId, result: counterResult, link: ctx.link, form: ctx.form, raw: rawCounter })
    setCounterContext((prev) => (prev ? { ...prev, itemId: item.id, history: item.negotiation } : prev))
    // Link the first-offer result to the new item, so reopening or «Salva» does not create a duplicate.
    if (ctx.source === 'analysis' && !ctx.itemId) setSaveState({ saved: true, itemId: item.id, tone: 'neutral', message: 'Salvato nella lista con la controproposta.' })
    const rec = counterResult.recommended
    if (rec && rec.id === 'accept') return { saved: true, tone: 'good', message: 'Salvato nella lista. Quando hai comprato, segna l\'esito «Accettata».' }
    const when = counterResult.verdict.action
    return {
      saved: true,
      ...({
        scheduled: { tone: 'good', message: `Salvato. Ti avviso 10 minuti prima: ${when}, con ${formatEuro(rec.price)} e il messaggio pronto.` },
        too_soon: { tone: 'warn', message: 'Salvato. Il momento è troppo vicino per una notifica: rispondi adesso.' },
        partial: { tone: 'warn', message: 'Salvato. Il momento è troppo vicino per avvisarti prima: rispondi adesso. Ti ricordo solo la possibile scadenza della sua proposta.' },
        denied: { tone: 'warn', message: 'Salvato senza promemoria: le notifiche sono disattivate. Puoi attivarle nella scheda Info.' },
        skipped: { tone: 'neutral', message: 'Salvato nella lista.' },
      })[reminder],
    }
  }

  const counterCalendar = (counterResult) => {
    const rec = counterResult.recommended
    const message = (counterResult.messages.find((m) => m.tone === counterResult.recommendedTone) || counterResult.messages[0] || {}).text || ''
    const ctx = counterContext
    addCalendar(null, ctx && ctx.itemId, {
      title: counterResult.input.itemTitle,
      link: ctx ? ctx.link : form.link,
      sendAt: counterResult.optimal.date,
      subject: 'Invia la nuova offerta',
      notes: eventNotesFor({ link: ctx ? ctx.link : form.link, targetPrice: rec.price, probability: rec.pAccept, message }),
    })
  }

  const counterSent = async (itemId) => {
    const outcome = await watchlist.markCounterSent(itemId)
    if (!outcome) return
    const price = formatEuro(outcome.item.counterPlan.price)
    showToast(outcome.reminder === 'scheduled'
      ? `Registrato: hai proposto ${price}. Se non risponde entro un giorno ti ricordo di scrivergli.`
      : `Registrato: hai proposto ${price}.`, 4000)
  }

  /** Failure risk of the offer on screen, calibrated on the user's outcomes when there are any. */
  const risk = useMemo(() => (result && result.ok && result.kind !== 'no_offer_needed' ? failureRiskFor(result, { profile: learning.engineProfile, records: learning.records, now: result.now }) : null), [result, learning.engineProfile, learning.records])
  /** The moves beyond the offer (value.js), from the analysed input and the market of this listing. */
  const levers = useMemo(() => (result && result.ok ? leversFor({ result, form, market: marketInfo ? marketInfo.market : null, signals: marketInfo && marketInfo.signals ? marketInfo.signals : {}, now: result.now }) : []), [result, form, marketInfo])
  /** The expected-price curve, once per analysis, shared by the hero tile and the price table. */
  const curve = useExpectedCurve({ result, profile: learning.engineProfile, market: marketInfo ? marketInfo.market : null })
  const badgeCount = badgeCountOf(watchlist.items, now)
  const searchJob = search.run && search.run.job ? search.run.job : null

  const topInset = insets.top || (Platform.OS === 'android' ? (RNStatusBar.currentHeight || 24) : 44)
  const bottomInset = Math.max(insets.bottom, 8)

  /** The «Dati dell'offerta» fold, the same node on the empty screen and under the result (A4 / B8). */
  const dataFold = (
    <View ref={formViewRef} onLayout={(e) => { formYRef.current = e.nativeEvent.layout.y }}>
      <Collapsible title="Dati dell'offerta" summary={dataSummaryOf(form, Boolean(result))} open={dataOpen} onToggle={setDataOpen}>
        <DataForm form={form} errors={errors} onChange={setField} onSubmit={result ? recalcKeepingPin : analyze} onReset={reset} hasResult={Boolean(result)} quickDiscounts={quickDiscountsFor(form.policy)} />
      </Collapsible>
    </View>
  )

  return (
    <View style={[styles.root, { backgroundColor: t.bg, paddingTop: topInset }]}>
      <StatusBar style="auto" />
      <View style={[styles.header, { borderBottomColor: t.line }]}>
        <View style={[styles.logo, { backgroundColor: t.accent }]}><Text style={[styles.logoText, { color: t.onAccent }]}>€</Text></View>
        <Text style={[styles.appName, { color: t.ink, flex: 1 }]} numberOfLines={1}>Offerta Vinted Timing</Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {counterContext && (
            <CounterView
              key={counterContext.key}
              context={counterContext}
              onClose={() => setCounterContext(null)}
              onSave={saveCounter}
              onCalendar={counterCalendar}
              calendarBusy={calendarBusy}
              profile={learning.engineProfile}
              market={marketInfoFor(counterContext.form) ? marketInfoFor(counterContext.form).market : null}
              counterStats={counterStatsOf(watchlist.allItems)}
              onScrollTo={(y) => setTimeout(() => scrollRef.current && scrollRef.current.scrollTo({ y: Math.max(0, y - 8), animated: true }), 30)}
            />
          )}
          {!counterContext && !labOpen && searchOpen && <SearchView search={search} reference={lastListing} onClose={closeSearch} onOpenLab={openLab} />}
          {!counterContext && !labOpen && !searchOpen && tab === 'calcola' && (
            <View style={{ gap: space.lg }}>
              {result && clipboardLink && !extracting ? (
                // A link copied while a result is on screen: the one-tap path stays one tap away (clipboard variant).
                <LinkEntry
                  link={form.link}
                  onChangeLink={changeLink}
                  onExtract={extractFromLink}
                  onPasteLink={pasteLink}
                  extracting={extracting}
                  extractPhase={extractPhase}
                  extraction={null}
                  clipboardLink={clipboardLink}
                  onIgnoreClipboard={ignoreClipboard}
                  onManual={openDataForm}
                />
              ) : null}
              {result ? (
                <ResultView
                  result={result}
                  risk={risk}
                  levers={levers}
                  curve={curve}
                  extraction={extraction}
                  marketInfo={marketInfo}
                  policy={form.policy || null}
                  saveState={saveState}
                  calendarBusy={calendarBusy}
                  now={now}
                  goal={goal}
                  onGoal={setGoal}
                  plan={plan}
                  optimizing={optimizing}
                  onOptimize={optimize}
                  onApply={applyOption}
                  onSave={saveCurrent}
                  onSaveAndMarkSent={saveAndMarkSent}
                  onCalendar={() => addCalendar(result, saveState && saveState.itemId)}
                  onCounter={openCounterFromAnalysis}
                  onSkipExploration={result.exploration ? skipExploration : null}
                  onApplyPrice={applyPrice}
                  onLever={scheduleLever}
                  onCopyMessage={noteMessageCopied}
                  link={form.link}
                  onPickMoment={pickMoment}
                  onOpenSearch={(lastListing && form.link === lastListing.url) || (searchJob && searchJob.running) ? () => openSearch(true) : null}
                  searchJob={searchJob}
                  onRecalc={recalcKeepingPin}
                  onEditData={openDataForm}
                  onReset={reset}
                  dataFold={dataFold}
                />
              ) : (
                <>
                  <LinkEntry
                    link={form.link}
                    onChangeLink={changeLink}
                    onExtract={extractFromLink}
                    onPasteLink={pasteLink}
                    extracting={extracting}
                    extractPhase={extractPhase}
                    extraction={extraction}
                    clipboardLink={clipboardLink}
                    onIgnoreClipboard={ignoreClipboard}
                    onManual={openDataForm}
                  />
                  {dataFold}
                  {badgeCount > 0 ? (
                    <Pressable onPress={() => setTab('lista')} accessibilityRole="button" style={styles.hint}>
                      <Text style={{ color: t.ink3, fontSize: 13 }}>{badgeCount} {badgeCount === 1 ? 'offerta' : 'offerte'} da fare → Lista</Text>
                    </Pressable>
                  ) : null}
                </>
              )}
            </View>
          )}
          {!counterContext && !labOpen && !searchOpen && tab === 'lista' && (
            <WatchlistView
              items={watchlist.items}
              ready={watchlist.ready}
              highlightId={highlightId}
              now={now}
              stats={watchlist.stats}
              actions={watchlist}
              onStatus={watchlist.setStatus}
              onRemove={watchlist.remove}
              onCalendar={(item) => addCalendar(item, item.id)}
              onCounter={openCounterFromItem}
              onCounterSent={counterSent}
              onGoCalcola={() => setTab('calcola')}
              onGoInfo={() => setTab('info')}
              onReanalyze={reanalyzeItem}
              onToast={showToast}
              scrollRef={scrollRef}
            />
          )}
          {!counterContext && !labOpen && !searchOpen && tab === 'info' && <InfoView stats={watchlist.stats} items={watchlist.allItems} learning={learning} onToast={(m) => showToast(m, 4000)} onOpenLab={openLab} onOpenSearch={() => openSearch(false)} onRestore={watchlist.restoreItems} />}
          {!counterContext && labOpen && <LabView labState={lab} onClose={closeLab} onCollectingChange={onCollectingChange} reference={lastListing} onToast={(m) => showToast(m, 4000)} />}
        </ScrollView>
      </KeyboardAvoidingView>

      {toast && (
        <View style={[styles.toast, { backgroundColor: t.ink, bottom: 72 + bottomInset }]}><Text style={{ color: t.bg, fontSize: 14 }}>{toast}</Text></View>
      )}

      <View style={[styles.tabBar, { backgroundColor: t.card, borderTopColor: t.line, paddingBottom: bottomInset }]}>
        {TABS.map((item) => {
          const active = tab === item.id
          const count = item.id === 'lista' ? badgeCount : 0
          return (
            <Pressable key={item.id} onPress={() => { setCounterContext(null); setLabOpen(false); setSearchOpen(false); setTab(item.id); if (item.id !== 'lista') setHighlightId(null) }} style={styles.tab} accessibilityRole="tab" accessibilityState={{ selected: active && !counterContext }}>
              <Text style={[styles.tabLabel, { color: active ? t.accent : t.ink3, fontWeight: active ? '700' : '500' }]}>
                {item.label}{count ? ` (${count})` : ''}
              </Text>
            </Pressable>
          )
        })}
      </View>

      <VintedPageLoader ref={pageLoaderRef} />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm, borderBottomWidth: 1 },
  logo: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  logoText: { fontSize: 18, fontWeight: '800' },
  appName: { fontSize: 17, fontWeight: '700' },
  content: { padding: space.lg, paddingBottom: 96, gap: space.lg },
  toast: { position: 'absolute', left: space.lg, right: space.lg, borderRadius: 12, padding: space.md },
  hint: { paddingVertical: 6, paddingHorizontal: space.xs, alignSelf: 'flex-start' },
  tabBar: { flexDirection: 'row', borderTopWidth: 1 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabLabel: { fontSize: 14 },
})
