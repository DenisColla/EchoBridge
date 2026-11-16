import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, StatusBar as RNStatusBar, StyleSheet, Text, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import * as core from './core/index.js'
import {
  MONTHS_IT, buildFormFromExtraction, explorationKey, failureRiskFor, formatEuro, leversFor, monthKeyOf,
  nextGoalFor, optimizeOffer, parsePrice, parseVintedItemHtml, policyDiscountFor, quickDiscountsFor, strategyFor, strategySnapshot, wardrobeFromProbe,
  analyzeCounter,
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
import { MARKET_CHAIN, callChain, useSearch } from './src/hooks/useSearch.js'
import { useExpectedCurve } from './src/hooks/useExpectedCurve.js'
import { useVintedBridge } from './src/hooks/useVintedBridge.js'
import { VintedNotices } from './src/components/VintedNotices.js'
import { VintedTab } from './src/components/vinted/VintedTab.js'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { copyText } from './src/services/clipboard.js'
import { budgetOfItem, counterRawFor, policyTargetFor } from './src/services/counterInput.js'
import { VIA_LABEL, eventNotesFor, openCalendarWithEvent } from './src/services/calendar.js'
import { ensureNotificationPermission, listenToReminderTaps, scheduleReminderAt } from './src/services/notifications.js'
import { recordRead } from './src/services/readStats.js'
import { badgeCountOf, counterStatsOf, linkIdOf } from './src/services/segments.js'
import { planInboxRows, planOfferCapture, readConversation } from './src/services/vintedConversation.js'
import { logVisit } from './src/services/vintedDiag.js'
import { fetchVintedItemPage, normalizeVintedLink, readVintedLinkFromClipboard } from './src/services/vinted.js'
import { space, useTheme } from './src/theme.js'
import { Collapsible } from './src/components/ui.js'

const AIM_KEY = 'offerta-vinted.aim.v1'
/** 1.13.1: the share of the resale value to keep as margin (0 = not losing), chosen in the cost panel. */
const MARGIN_KEY = 'offerta-vinted.margin.v1'
const MARGIN_CHOICES = [0, 10, 20, 30]

const TABS = [
  { id: 'vinted', label: 'Vinted' },
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
  // 1.9: the Vinted browser is the home of the app (the web build has no browser, it starts from Calcola).
  const [tab, setTab] = useState(Platform.OS === 'web' ? 'calcola' : 'vinted')
  const vintedRef = useRef(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [result, setResult] = useState(null)
  // 1.8: the seller profile, the three proposals and the moves; `result` is the analysis of the chosen proposal.
  const [strategy, setStrategy] = useState(null)
  // What the link read knows beyond the form (raw extraction, the seller's wardrobe), and how the price was picked.
  const contextRef = useRef(null)
  const choiceRef = useRef({ kind: 'auto' })
  /** The last strategy computed and the form it was computed for: what a save right after runAnalysis stores. */
  const lastRunRef = useRef(null)
  /**
   * 1.11 — what the purchase is for: 'resell' (the proposals never cost more than the resale gives back) or 'keep'
   * (the costs are only shown). Remembered between launches.
   */
  const aimRef = useRef('resell')
  const marginRef = useRef(0)
  useEffect(() => {
    AsyncStorage.getItem(AIM_KEY).then((saved) => {
      if (saved === 'keep' || saved === 'resell') aimRef.current = saved
    }).catch(() => {})
    AsyncStorage.getItem(MARGIN_KEY).then((saved) => {
      if (MARGIN_CHOICES.includes(Number(saved))) marginRef.current = Number(saved)
    }).catch(() => {})
  }, [])
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
  // 1.12: for a book the analysis itself reads the market (the other listings with the same ISBN, else with its title
  // and author); kept by link for the session, behind the one «Cerca altrove» found for the same listing.
  const bookMarketRef = useRef(new Map())
  const [bookMarkets, setBookMarkets] = useState({})
  const bookInfoOf = (book) => (book && book.market ? { market: book.market, at: book.at, signals: null } : null)
  const linkKeyOf = (f) => normalizeVintedLink(f && f.link) || (f && f.link)
  /** In a handler: the freshest reading (the ref is written before the analysis that follows it runs). */
  const marketInfoFor = (f) => {
    const url = linkKeyOf(f)
    return search.marketFor(url) || bookInfoOf(url ? bookMarketRef.current.get(url) : null)
  }
  /** While rendering: the same picture, from state. */
  const marketShownFor = (f) => {
    const url = linkKeyOf(f)
    return search.marketFor(url) || bookInfoOf(url ? bookMarkets[url] : null)
  }
  const marketInfo = useMemo(() => marketShownFor(form), [form.link, search.run, search.store, bookMarkets]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * The market of a book: one search page read in the in-app browser (by ISBN; by title and author when the page has
   * no ISBN, or when the ISBN finds fewer than three comparable listings). Read-only, at most two pages.
   * → { market (null when too few), info (what was found), tried (one line per search, for the report) }.
   */
  const readBookMarket = async (identity, { origin, selfId, listingTitle, listPrice }) => {
    const tried = []
    let best = null
    for (const mode of identity.isbn ? ['isbn', 'title'] : ['title']) {
      const q = core.bookSearchFor(identity, { origin, mode, listingTitle })
      if (!q || !pageLoaderRef.current) continue
      // The web build has no in-app browser: the cards a test hands over stand in for the search page.
      const handed = Platform.OS === 'web' && typeof window !== 'undefined' && window.__ovtBookCards && Array.isArray(window.__ovtBookCards[mode]) ? window.__ovtBookCards[mode] : null
      const res = handed ? { ok: true, details: { kind: 'catalog', cards: handed, diag: null } } : await pageLoaderRef.current.load(q.url, { onVisible: () => setExtractPhase('verify') })
      const cards = res.ok && res.details && res.details.kind === 'catalog' && Array.isArray(res.details.cards) ? res.details.cards : null
      const found = cards ? core.bookMarketFrom(cards, { identity, mode, selfId, listingTitle, listPrice }) : null
      tried.push({ via: mode, esito: res.ok ? (cards ? 'ok' : 'not_a_search') : res.reason || 'failed', visti: found ? found.seen : null, confrontabili: found ? found.kept : null, pagina: res.ok && res.details ? res.details.diag || null : null })
      setExtractPhase('market')
      if (found && (!best || found.kept > best.kept)) best = found
      if (found && found.ok) break
    }
    return { market: best && best.ok ? best.market : null, info: best, tried, identity }
  }

  /**
   * 1.13 — the market of an article that is not a book. Electronics: the page links its model, that search is read
   * and judged by rules. Clothes and shoes: the page links brand × category and the model is only in the seller's
   * words, so the AI (DeepSeek first) reads the listing, gives the words to search for and says which cards are the
   * same article; without a key the cards are only «same brand and kind», a range that is told and not used.
   * Read-only, one page; to the AI go titles, prices and conditions only (scrubbed), never a seller's name.
   */
  /**
   * The AI's product card for a listing. It needs only the listing, so it is asked as soon as that is read and is
   * ready when the seller's page has been (1.13.1: asked in line, the first real analysis took 47 seconds).
   */
  const askProductCard = async (identity, ex) => {
    const reference = {
      title: ex.title || '', brand: ex.brand || '', size: identity.size || '', categoryText: identity.category || ex.categoryText || '',
      description: ex.description || '', price: ex.listPrice, condition: identity.condition || ex.condition || '',
    }
    const ai = { scheda: null, smistamento: null, modello: null, parole: null, costo_usd: 0, ms_scheda: null, ms_smistamento: null }
    const t0 = Date.now()
    try {
      const res = await callChain(MARKET_CHAIN, core.productPrompt(reference), [], { effort: 'low', maxTokens: 900, timeoutMs: 20_000, maxAttempts: 1, think: false })
      ai.costo_usd += res.costUsd || 0
      if (res.costUsd) search.addSpend(res.modelKey, res.costUsd, null)
      ai.scheda = res.ok ? 'ok' : res.kind || 'failed'
      ai.ms_scheda = Date.now() - t0
      if (res.ok && res.value) {
        const product = core.cleanProduct(res.value, reference)
        ai.modello = res.modelKey
        ai.parole = product.query
        return { reference, product, ai }
      }
    } catch { ai.scheda = 'failed' }
    return { reference, product: null, ai }
  }
  const readProductMarket = async (identity, { origin, selfId, ex, card = null }) => {
    const started = Date.now()
    const asked = card ? await card : null
    const reference = asked ? asked.reference : { title: ex.title || '', brand: ex.brand || '', size: identity.size || '', categoryText: identity.category || '', description: '', price: ex.listPrice, condition: identity.condition || '' }
    const ai = asked ? asked.ai : { scheda: null, smistamento: null, modello: null, parole: null, costo_usd: 0, ms_scheda: null, ms_smistamento: null }
    const product = asked ? asked.product : null
    const q = core.productSearchFor(identity, { origin, query: product ? product.query : null })
    if (!q || !pageLoaderRef.current) return { market: null, info: null, tried: [], identity, ai, ms: Date.now() - started }
    setExtractPhase('product')
    const handed = Platform.OS === 'web' && typeof window !== 'undefined' && window.__ovtBookCards && Array.isArray(window.__ovtBookCards[q.mode]) ? window.__ovtBookCards[q.mode] : null
    const res = handed ? { ok: true, details: { kind: 'catalog', cards: handed, diag: null } } : await pageLoaderRef.current.load(q.url, { onVisible: () => setExtractPhase('verify') })
    const cards = res.ok && res.details && res.details.kind === 'catalog' && Array.isArray(res.details.cards) ? res.details.cards : null
    let verdicts = null
    if (product && cards && cards.length) {
      setExtractPhase('product')
      const candidates = cards.map((c) => {
        const said = core.cardFactsOf(c.text)
        return { source: 'vinted', id: String(c.id), title: said.title, price: core.cardPriceOf(c.price), condition: said.condition || '' }
      }).filter((c) => c.price !== null && c.title && c.id !== String(selfId)).slice(0, 80)
      const tTriage = Date.now()
      const answers = await Promise.all(core.triageBatches(candidates, 40).map((batch) => callChain(MARKET_CHAIN, core.triagePrompt(reference, product, batch), [], { effort: 'low', maxTokens: 4000, timeoutMs: 30_000, maxAttempts: 1, think: false })))
      ai.ms_smistamento = Date.now() - tTriage
      const said = new Map()
      let answered = 0
      for (const r of answers) {
        ai.costo_usd += r.costUsd || 0
        if (r.costUsd) search.addSpend(r.modelKey, r.costUsd, null)
        if (!(r.ok && r.value && Array.isArray(r.value.items))) continue
        answered++
        for (const it of r.value.items) {
          const id = String((it && it.id) || '').trim().replace(/^#/, '').replace(/^vinted:/, '')
          if (id && core.TRIAGE_VERDICTS.includes(it.verdict)) said.set(id, it.verdict)
        }
      }
      ai.smistamento = answers.length ? `${answered}/${answers.length}` : null
      if (answered) verdicts = said
    }
    ai.costo_usd = Math.round(ai.costo_usd * 100000) / 100000
    const found = cards ? core.productMarketFrom(cards, { identity, mode: q.mode, selfId, listPrice: ex.listPrice, verdicts }) : null
    const tried = [{ via: q.mode, parole: q.query, esito: res.ok ? (cards ? 'ok' : 'not_a_search') : res.reason || 'failed', visti: found ? found.seen : null, confrontabili: found ? found.kept : null, pagina: res.ok && res.details ? res.details.diag || null : null }]
    return { market: found && found.ok ? found.market : null, info: found, tried, identity, ai, ms: Date.now() - started }
  }

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
  /** The price the form asks for, as a choice: one of the proposals on screen, the user's own figure, or the engine's. */
  const choiceFromForm = (f) => {
    const typed = parsePrice(f.targetPrice)
    if (!Number.isFinite(typed) || typed <= 0) return { kind: 'auto' }
    const same = strategy && strategy.options ? strategy.options.find((o) => Math.abs(o.price - typed) < 0.005 && o.id !== 'tua') : null
    return same ? { kind: 'option', id: same.id } : { kind: 'custom', price: typed }
  }

  /**
   * The best-price strategy for the form: seller profile, three proposals, moment and moves (core strategyFor); the
   * analysis shown is the one of the chosen proposal. `choice` says how the price is picked (default: as last time).
   */
  const runAnalysis = (nextForm, preferredSendAt, { choice = null } = {}) => {
    const at = new Date()
    const mk = marketInfoFor(nextForm)
    const key = explorationKey(nextForm)
    const month = monthKeyOf(at)
    const linkOf = (f) => normalizeVintedLink(f && f.link) || (f && f.link) || ''
    const ctx = contextRef.current && contextRef.current.link && contextRef.current.link === linkOf(nextForm) ? contextRef.current : null
    const pick = choice || choiceRef.current || { kind: 'auto' }
    const scored = withSignals(nextForm, mk)
    const strat = strategyFor(scored, at, engineOptions({
      ...(preferredSendAt ? { preferredSendAt } : {}), ...(mk ? { market: mk.market } : {}), records: watchlist.allItems, key, month,
      extraction: ctx ? ctx.extraction : null, wardrobe: ctx ? ctx.wardrobe : null,
      // The seller's last visit ages with the time passed since the page was read; a form that carries a link but no
      // reading of this session (a saved offer opened again) says nothing about «online adesso».
      ...(ctx ? { readAt: ctx.at } : linkOf(nextForm) ? { readAt: 0 } : {}),
      // 1.11: the purchase as a whole. The resale value is the one typed, else the engine's default.
      goal: aimRef.current, marginPct: marginRef.current, ...(Number.isFinite(parsePrice(nextForm.resalePrice)) && parsePrice(nextForm.resalePrice) > 0 ? { resale: parsePrice(nextForm.resalePrice) } : {}),
      ...(pick.kind === 'option' ? { chosen: pick.id } : pick.kind === 'custom' ? { customPrice: pick.price } : {}),
    }))
    if (!strat.ok) {
      setErrors(strat.errors || {})
      setResult(null)
      setStrategy(null)
      // The fields to fix are inside the fold: open it and go there.
      openDataForm()
      return null
    }
    const outcome = strat.result
    choiceRef.current = pick
    lastRunRef.current = { strat, form: nextForm }
    setErrors({})
    setStrategy(strat)
    setResult(outcome)
    setSaveState(null)
    // The form follows the proposal on screen, so «Dati dell'offerta» and the saved item carry the analysed price.
    const chosen = strat.options.find((o) => o.id === strat.chosenId)
    if (chosen && parsePrice(nextForm.targetPrice) !== chosen.price) setForm((f) => (linkOf(f) === linkOf(nextForm) ? { ...f, targetPrice: String(chosen.price).replace('.', ',') } : f))
    if (outcome.kind !== 'no_offer_needed') setGoal(nextGoalFor(outcome.probability, outcome.maxProbability))
    setTimeout(() => scrollRef.current && scrollRef.current.scrollTo({ y: 0, animated: true }), 50)
    return outcome
  }

  const analyze = () => {
    setPlan(null)
    setPinnedSendAt(null)
    runAnalysis(form, null, { choice: choiceFromForm(form) })
  }

  /** Kept for older result views: re-runs the plain strategy. */
  const skipExploration = () => {
    setPlan(null)
    setPinnedSendAt(null)
    runAnalysis(form, null)
  }

  /** Re-runs the analysis keeping the moment chosen through the optimizer or «Scegli» (used after edits). */
  const recalcKeepingPin = () => runAnalysis(form, pinnedSendAt, { choice: choiceFromForm(form) })

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
    const outcome = runAnalysis(nextForm, null, { choice: choiceFromForm(nextForm) })
    if (outcome) showToast(`Offerta impostata a ${formatEuro(price)}.`)
  }

  /** A tap on one of the three proposals (or on «La tua cifra»): the analysis follows it, the moment stays. */
  const pickProposal = (option) => {
    if (!option) return
    const nextForm = { ...form, targetPrice: String(option.price).replace('.', ',') }
    setForm(nextForm)
    setPlan(null)
    runAnalysis(nextForm, pinnedSendAt, { choice: option.id === 'tua' ? { kind: 'custom', price: option.price } : { kind: 'option', id: option.id } })
  }

  /** «Per rivendere» / «Per me»: the proposals are computed again for the new aim, and the best one is picked again. */
  const changeAim = (next) => {
    if (next !== 'keep' && next !== 'resell') return
    aimRef.current = next
    AsyncStorage.setItem(AIM_KEY, next).catch(() => {})
    if (strategy) {
      setPlan(null)
      runAnalysis(form, pinnedSendAt, { choice: { kind: 'auto' } })
    }
  }

  /** «Margine minimo»: the ceiling leaves that share of the resale value, and the proposals follow it. */
  const changeMargin = (pct) => {
    if (!MARGIN_CHOICES.includes(pct)) return
    marginRef.current = pct
    AsyncStorage.setItem(MARGIN_KEY, String(pct)).catch(() => {})
    if (strategy) {
      setPlan(null)
      runAnalysis(form, pinnedSendAt, { choice: { kind: 'auto' } })
    }
  }

  /** «Lo rivendo a»: the price the article would be sold again at (blank = the engine's default). */
  const changeResale = (text) => {
    const value = parsePrice(text)
    const nextForm = { ...form, resalePrice: Number.isFinite(value) && value > 0 ? String(value).replace('.', ',') : '' }
    setForm(nextForm)
    setPlan(null)
    runAnalysis(nextForm, pinnedSendAt, { choice: { kind: 'auto' } })
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
    setStrategy(null)
    contextRef.current = null
    choiceRef.current = { kind: 'auto' }
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
      // 1.8: the seller's wardrobe, for the profile (facile / medio / difficile). Its link is only in the live page, so
      // a listing that came from the quick download is opened once in the in-app browser to find it. Read-only; when
      // anything fails the profile is built from the listing alone.
      let wardrobe = null
      let memberRaw = null
      let bookRead = null
      let itemHtml = page.html || ''
      // What each step of the seller's reading gave: shown in «Condividi cosa ha letto l'analisi», to tell a seller
      // with nothing to read from a page that was not read.
      const profileRead = { livePage: 'skipped', sellerLink: null, memberPage: 'skipped' }
      if (pageLoaderRef.current) {
        let details = page.via === 'browser' ? page.details || null : null
        if (page.via === 'browser') profileRead.livePage = details ? 'ok' : 'no_details'
        if (!(details && details.sellerUrl) && page.via !== 'browser') {
          setExtractPhase('browser')
          const live = await pageLoaderRef.current.load(link, { onVisible: () => setExtractPhase('verify') })
          profileRead.livePage = live.ok ? (live.details ? 'ok' : 'no_details') : live.reason || 'failed'
          if (live.ok && live.html) itemHtml = live.html
          if (live.ok && live.details) {
            details = live.details
            const fuller = parseVintedItemHtml(live.html || page.html, live.details)
            if (fuller && (fuller.title || fuller.listPrice)) ex = fuller
          }
        }
        // The seller's link by his name in the page that was read (parseVintedItemHtml): a logged-in page also links
        // the visitor's own profile, so the name decides, then the link of the seller's box in the live page.
        const origin = (String(link).match(/^https:\/\/[^/?#]+/) || ['https://www.vinted.it'])[0]
        const byName = ex.sellerPath ? `${origin}${ex.sellerPath}` : null
        const byPage = details && typeof details.sellerUrl === 'string' && /\/member\/\d+/.test(details.sellerUrl) ? details.sellerUrl : null
        const sellerUrl = byName || byPage
        profileRead.sellerLink = byName ? 'name' : byPage ? 'page' : null
        profileRead.sellerNameRead = Boolean(ex.sellerUsername)
        // What the market search will rest on is known as soon as the listing is read: for clothes the AI's product
        // card is asked now, while the seller's page is being read.
        const bookIdentity = core.bookIdentityOf(itemHtml) || (core.categoryGuess(ex).id === 'books' && ex.title ? { isbn: null, isbnHref: null, title: null, author: null } : null)
        const productIdentity = bookIdentity ? null : core.productIdentityOf(core.pageFactsOf(itemHtml), { brand: ex.brand || null, description: ex.description || '' })
        const cardAsked = productIdentity && productIdentity.kind === 'brand' ? askProductCard(productIdentity, ex) : null
        if (sellerUrl) {
          setExtractPhase('seller')
          const member = await pageLoaderRef.current.load(sellerUrl, { onVisible: () => setExtractPhase('verify') })
          if (member.ok && member.details && member.details.kind === 'member') {
            memberRaw = member.details
            wardrobe = wardrobeFromProbe(member.details)
            profileRead.memberPage = wardrobe ? 'ok' : 'nothing_read'
            profileRead.memberSeen = member.details.diag || null
          } else profileRead.memberPage = member.ok ? 'not_a_profile' : member.reason || 'failed'
        }
        // 1.12: the market of a book — the same ISBN, else its title and author. 1.13: any other article — by the
        // model the page links (electronics) or by brand × category and the AI.
        const selfId = (String(link).match(/\/items\/(\d+)/) || [])[1] || null
        if (bookIdentity) {
          setExtractPhase('market')
          bookRead = await readBookMarket(bookIdentity, { origin, selfId, listingTitle: ex.title || '', listPrice: ex.listPrice })
        } else if (productIdentity) {
          setExtractPhase('product')
          bookRead = await readProductMarket(productIdentity, { origin, selfId, ex, card: cardAsked })
        }
        setExtractPhase(null)
      }
      const marketKey = normalizeVintedLink(link) || link
      const bookEntry = bookRead && bookRead.market ? { market: bookRead.market, at: new Date().toISOString() } : null
      if (bookEntry) {
        bookMarketRef.current.set(marketKey, bookEntry)
        if (bookMarketRef.current.size > 30) bookMarketRef.current.delete(bookMarketRef.current.keys().next().value)
      } else bookMarketRef.current.delete(marketKey)
      setBookMarkets(Object.fromEntries(bookMarketRef.current))
      if (bookRead && bookRead.info) {
        const info = bookRead.info
        const what = { isbn: 'dello stesso libro', title: 'con lo stesso titolo', model: 'dello stesso modello', ai: 'dello stesso articolo', brand: 'della stessa marca e categoria' }[info.basis] || 'simili'
        const count = `${info.kept} ${info.kept === 1 ? 'annuncio' : 'annunci'} ${what}`
        if (bookRead.market) showToast(`Mercato: ${count}. Si vende a ${formatEuro(bookRead.market.p25Price)} (quartile basso), mediana ${formatEuro(bookRead.market.medianPrice)}.`, 6000)
        else if (info.basis === 'brand' && info.market) showToast(`${count}, tra ${formatEuro(info.market.minPrice)} e ${formatEuro(info.market.maxPrice)}: troppo diversi per farne un valore.${bookRead.ai && bookRead.ai.scheda === 'auth' ? ' Con la chiave DeepSeek (Info → Laboratorio AI) riconosco lo stesso articolo.' : ''}`, 7000)
        else showToast(`Mercato: ${count}, ${info.kept < 3 ? 'troppo pochi' : 'troppo diversi'} per farne un valore.`, 5000)
      }
      contextRef.current = { link, extraction: ex, wardrobe, memberRaw, at: Date.now() }
      choiceRef.current = { kind: 'auto' }
      // The form starts from the listing; the price is then the strategy's recommended proposal (runAnalysis sets it).
      const mk = marketInfoFor({ link })
      const built = buildFormFromExtraction(ex, {
        link, policy: false, profile: learning.engineProfile, market: mk ? mk.market : null, signals: mk ? mk.signals : null,
        targetDiscountPct: legacyDefaultDiscount(learning.profile), previousForm: { ...EMPTY_FORM, link },
      })
      setForm(built.form)
      setPlan(null)
      setPinnedSendAt(null)
      const outcome = runAnalysis(built.form, null, { choice: { kind: 'auto' } })
      // `raw` is the parser's output as read (kept with the saved item, engine-spec §6); `via` tells the two paths apart.
      const via = page.via === 'browser' ? 'browser' : 'fetch'
      setExtraction({ ok: true, summary: built.summary, link, at: Date.now(), raw: ex, via, wardrobe, memberRaw, profileRead, bookRead, pageFacts: core.pageFactsOf(itemHtml) })
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

  // Vinted ↔ app (1.8): Vinted's notifications update the saved offers, and a listing shared from Vinted is read at once.
  const listRef = useRef([])
  useEffect(() => { listRef.current = watchlist.items }, [watchlist.items])
  const vinted = useVintedBridge({
    ready: watchlist.ready,
    itemsRef: listRef,
    setStatus: watchlist.setStatus,
    setSellerName: (id, name) => watchlist.update(id, { sellerName: name }),
    onToast: (m) => showToast(m, 4000),
    onSharedLink: (text) => {
      const url = (String(text || '').match(/https?:\/\/\S+/) || [])[0]
      const link = url ? normalizeVintedLink(url) : null
      if (!link) {
        showToast('Il contenuto condiviso non è un annuncio Vinted.', 4000)
        return
      }
      setCounterContext(null)
      setLabOpen(false)
      setSearchOpen(false)
      setTab('calcola')
      if (extractRef.current) extractRef.current(link)
    },
  })

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
  const savePayload = (run = null) => {
    // `run`: an analysis just computed (runAnalysis's state is not on screen yet), else the one on screen.
    const f = run ? run.form : form
    const r = run ? run.result : result
    const st = run ? run.strategy : strategy
    const mk = marketInfoFor(f)
    const raw = extraction && extraction.ok && extraction.raw && extraction.link === normalizeVintedLink(f.link) ? extraction.raw : null
    // userOverride: the figure the user typed in place of the three proposals («La tua cifra»).
    const userOverride = st && st.chosenId === 'tua' ? r.input.targetPrice : null
    return {
      result: r, link: f.link, form: withSignals(f, mk), profile: learning.engineProfile, userOverride,
      market: mk ? mk.market : null, extraction: raw, policy: f.policy || null, gate: r.gate || null, messagePolicy: r.messagePolicy || null,
      strategy: strategySnapshot(st), sellerName: raw && raw.sellerUsername ? raw.sellerUsername : null,
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

  // In the Vinted tab the back gesture belongs to the browser (its panel first, then its history).
  const vintedActive = tab === 'vinted' && !counterContext && !labOpen && !searchOpen
  useEffect(() => {
    if (!vintedActive) return undefined
    const sub = BackHandler.addEventListener('hardwareBackPress', () => Boolean(vintedRef.current && vintedRef.current.handleBack()))
    return () => sub.remove()
  }, [vintedActive])

  const browserToast = useCallback((m) => showToast(m, 4000), [showToast])

  /** A proposal chosen in the browser panel: the analysis follows it and the figure is ready to paste in Vinted's offer. */
  const pickInBrowser = async (option) => {
    pickProposal(option)
    if (option && (await copyText(String(option.price).replace('.', ',')))) showToast(`${formatEuro(option.price)} copiato: incollalo nell'offerta su Vinted.`, 3500)
  }

  /* ───────── Offers made on Vinted, seen by the browser (services/vintedConversation.js) ───────── */

  /** What the strip shows on the conversation open in the browser: { convId, state, price, link }. */
  const [capture, setCapture] = useState(null)
  const convQueueRef = useRef(null)
  const convLastRef = useRef(null)
  const convBusyRef = useRef(false)
  const convDoneRef = useRef(new Set())
  const convApplyRef = useRef(null)
  const inboxApplyRef = useRef(null)
  /** The listing the user asked to analyse so that the offer seen on Vinted can be recorded: { convId, itemId }. */
  const wantRecordRef = useRef(null)

  /** The listing analysed on screen, to recognise its conversation. */
  const analysedListing = () => {
    if (!(extraction && extraction.ok && strategy && result && result.ok && result.kind !== 'no_offer_needed')) return null
    if (normalizeVintedLink(form.link) !== extraction.link) return null
    return { itemId: linkIdOf(extraction.link), link: extraction.link, title: form.itemTitle || '', listPrice: parsePrice(form.listPrice) }
  }

  const OUTCOME_WORD = { accepted: 'accettata', declined: 'rifiutata', no_reply: 'scaduta senza risposta', abandoned: 'annullata', sold_other: 'chiusa, articolo venduto ad altri' }
  const shortTitle = (title) => (String(title || '').trim().slice(0, 40) || 'Offerta')

  /**
   * An outcome read on Vinted closes the offer, whichever page showed it first. Judged on the list as it is now (an
   * offer reopened by a counter-offer and answered again can be refused a second time), with a guard only for the two
   * pages reporting at the same instant.
   */
  const closeFromVinted = async (itemId, status, title) => {
    const busy = `outcome|${itemId}`
    const live = watchlist.peek().find((it) => it.id === itemId)
    if (!live || live.status !== 'sent' || convDoneRef.current.has(busy)) return
    convDoneRef.current.add(busy)
    try {
      await watchlist.setStatus(itemId, status)
      showToast(`«${shortTitle(title)}»: offerta ${OUTCOME_WORD[status] || 'chiusa'}. Lista aggiornata.`, 5000)
    } finally {
      convDoneRef.current.delete(busy)
    }
  }

  /**
   * «Acquisto andato a buon fine» in the conversation: the offer of the list is a deal ('accepted', at the figure on
   * the table: the accepted request or the seller's own offer) or a purchase at the listing price ('bought').
   */
  const purchaseFromVinted = async (itemId, status, title, atList = false) => {
    const busy = `purchase|${itemId}`
    const live = watchlist.peek().find((it) => it.id === itemId)
    if (!live || ['accepted', 'bought', 'sold_other'].includes(live.status) || convDoneRef.current.has(busy)) return
    convDoneRef.current.add(busy)
    try {
      await watchlist.setStatus(itemId, status)
      // Bought without waiting for the answer: the price paid is the listing's, not the figure offered.
      if (atList && Number.isFinite(Number(live.listPrice))) await watchlist.update(itemId, { finalPrice: Number(live.listPrice) })
      const after = watchlist.peek().find((it) => it.id === itemId)
      const paid = after && Number.isFinite(after.finalPrice) ? ` a ${formatEuro(after.finalPrice)}` : ''
      showToast(`«${shortTitle(title)}»: acquistato${paid}. Lista aggiornata.`, 5000)
    } finally {
      convDoneRef.current.delete(busy)
    }
  }

  /**
   * The seller's counter-offer, read on Vinted: the offer becomes «controproposta» with the reply plan the planner
   * computes by default (no budget, received now). An offer already closed as refused reopens: on Vinted a seller who
   * proposes another figure refuses the request and makes his offer at once. Returns the plan, or null when nothing
   * was saved.
   */
  const registerCounter = async (itemId, price, { previousOffer = null, conversationId = null, seller = null } = {}) => {
    // Whether it is already in the list is the planner's judgement (on the list as it is now): here only the guard
    // for two pages reporting the same counter-offer at the same instant. Returns 'saved' | 'busy' | 'failed'.
    const busy = `counter|${itemId}`
    if (convDoneRef.current.has(busy)) return 'busy'
    convDoneRef.current.add(busy)
    try {
      const item = watchlist.peek().find((it) => it.id === itemId)
      if (!item) return 'failed'
      const history = Array.isArray(item.negotiation) ? item.negotiation : []
      const lastEntry = history[history.length - 1]
      if (item.status === 'countered' && lastEntry && lastEntry.by === 'seller' && Math.abs(lastEntry.price - price) < 0.005) return 'busy'
      const raw = counterRawFor(item, price, { previousOffer })
      const mk = marketInfoFor(formOfItem(item))
      const market = mk ? mk.market : null
      const policyTarget = policyTargetFor(formOfItem(item), { market, profile: learning.engineProfile })
      const outcome = analyzeCounter(raw, new Date(), {
        ...(learning.engineProfile ? { profile: learning.engineProfile } : {}), ...(market ? { market } : {}),
        ...(policyTarget != null ? { policyTarget } : {}), counterStats: counterStatsOf(watchlist.allItems),
      })
      if (!outcome.ok) return 'failed'
      // The refusal recorded for this offer was the counter-offer itself: its first answer is the counter.
      if (!history.some((e) => e.by === 'seller') && ['declined', 'no_reply'].includes(item.status)) await watchlist.update(item.id, { firstOutcome: null, firstOutcomeAt: null }, { type: 'reopened', data: { from: item.status, reason: 'vinted_counter' } })
      await watchlist.addCounter({ itemId: item.id, result: outcome, link: item.link, form: formOfItem(item), raw })
      const saved = watchlist.peek().find((it) => it.id === itemId)
      const patch = {}
      if (conversationId && saved && !saved.conversationId) patch.conversationId = conversationId
      if (seller && saved && !saved.sellerName) patch.sellerName = seller
      if (Object.keys(patch).length) await watchlist.update(itemId, patch)
      const rec = outcome.recommended
      const budget = budgetOfItem(item)
      // No reply fits under the ceiling of an offer made to sell again: the plan is to leave it, and it says why.
      const move = rec && rec.id === 'accept' ? `conviene accettare a ${formatEuro(price)}`
        : rec && Number.isFinite(rec.price) ? `rilancia a ${formatEuro(rec.price)}`
          : outcome.kind === 'walk_away' && budget !== null ? `è sopra il tetto di ${formatEuro(budget)}, non conviene: lascia o aspetta che scenda` : 'apri la Lista'
      showToast(`«${shortTitle(item.title)}»: controproposta di ${formatEuro(price)} registrata. Piano: ${move}.`, 7000)
      return 'saved'
    } catch {
      return 'failed'
    } finally {
      convDoneRef.current.delete(busy)
    }
  }

  /**
   * A conversation page of Vinted, as the browser read it. The user's own pending offer on the listing analysed on
   * screen is saved as sent at the figure Vinted shows, with no tap; a saved plan becomes sent; an offer that Vinted
   * now shows accepted or refused closes in the list. Nothing is ever done on Vinted: this only reads.
   */
  const applyConversation = async ({ url, conv: raw }) => {
    const conv = readConversation(raw, url)
    if (!conv.convId) return
    const plan = planOfferCapture(conv, { items: watchlist.peek(), analysed: analysedListing() })
    const key = `${conv.convId}|${plan.action}|${plan.price}|${plan.status || ''}`
    const fresh = !convDoneRef.current.has(key)
    const show = (state, extra = {}) => setCapture({ convId: conv.convId, state, price: plan.price, link: conv.itemLink, itemId: plan.itemId, ...extra })
    // One line per change in the navigation log: Vinted's own words for the status, never a name or a message.
    if (fresh) logVisit(url, `offerta «${(conv.mine && conv.mine.statusText) || '-'}»${conv.standing ? ' + proposta del venditore' : ''}${conv.purchased ? ' + acquisto' : ''}${conv.unavailable ? ' + non disponibile' : ''} → ${plan.action}`)
    if (plan.action === 'none' || plan.action === 'needs_analysis' || plan.action === 'incoming') {
      convDoneRef.current.add(key)
      show(plan.action !== 'none' ? plan.action : plan.counter ? 'counter' : plan.recorded ? 'recorded' : 'idle')
      return
    }
    if (plan.action === 'purchase') {
      convDoneRef.current.add(key)
      await purchaseFromVinted(plan.itemId, plan.status, plan.title, plan.atList === true)
      show('closed', { status: plan.status })
      return
    }
    if (plan.action === 'counter') {
      // Not behind `fresh`: the same figure may come back later in the same negotiation (his offer stands again
      // after the user's reply was refused), and the planner already skips what the list holds.
      convDoneRef.current.add(key)
      const saved = await registerCounter(plan.itemId, plan.price, { previousOffer: plan.previousOffer, conversationId: conv.convId, seller: conv.seller })
      if (saved === 'failed' && fresh) showToast(`Controproposta di ${formatEuro(plan.price)} dal venditore: apri la Lista e tocca «Controproposta».`, 6000)
      show('counter')
      return
    }
    if (!fresh) return
    convDoneRef.current.add(key)
    const seen = { price: plan.price, conversationId: conv.convId, sellerName: conv.seller }
    try {
      if (plan.action === 'record') {
        if (!(plan.price > 0 && plan.price < parsePrice(form.listPrice))) throw new Error('price')
        // The analysis follows the figure actually offered, so the list stores its probability and not the proposal's.
        const nextForm = { ...form, targetPrice: String(plan.price).replace('.', ',') }
        setForm(nextForm)
        setPlan(null)
        const outcome = runAnalysis(nextForm, pinnedSendAt, { choice: choiceFromForm(nextForm) })
        const run = lastRunRef.current
        if (!outcome || outcome.kind === 'no_offer_needed' || !run || run.form !== nextForm) throw new Error('analysis')
        const saved = await watchlist.addFromAnalysis({ ...savePayload({ form: nextForm, result: outcome, strategy: run.strat }), allowReoffer: true })
        if (!saved.item) throw new Error('save')
        await watchlist.markSentFromVinted(saved.item.id, seen)
        const message = `Offerta di ${formatEuro(plan.price)} registrata in Lista: in attesa di risposta.`
        setSaveState({ saved: true, itemId: saved.item.id, tone: 'good', message })
        // The next move is the message, and the field to write it in is right under the offer: it is copied now, with
        // the figure really offered (a message copied before the offer says the proposal's figure, and takes the
        // clipboard the figure needed for Vinted's offer window).
        const step = (run.strat.plan || []).find((s) => s.text)
        const copied = step ? await copyText(step.text) : false
        if (copied) watchlist.markMessageCopied(saved.item.id)
        showToast(copied ? `${message} Messaggio${step.optional ? ' (facoltativo)' : ''} copiato: incollalo qui sotto.` : message, copied ? 6500 : 4500)
        show('recorded')
      } else if (plan.action === 'send' || plan.action === 'attach' || plan.action === 'reprice') {
        await watchlist.markSentFromVinted(plan.itemId, seen)
        if (plan.action === 'send') showToast(`Offerta di ${formatEuro(plan.price)} registrata in Lista: in attesa di risposta.`, 4500)
        else if (plan.action === 'reprice') showToast(`Lista aggiornata: su Vinted la tua offerta è di ${formatEuro(plan.price)}.`, 4500)
        show('recorded')
      } else if (plan.action === 'counter_sent') {
        await watchlist.markCounterSent(plan.itemId)
        // The figure really sent, when it is not the planned one.
        await watchlist.markSentFromVinted(plan.itemId, seen)
        showToast(`Risposta di ${formatEuro(plan.price)} inviata: segnata in Lista.`, 4500)
        show('recorded')
      } else if (plan.action === 'outcome') {
        // «Rifiutata» may be followed by the seller's own offer a moment later (the page fills in steps): wait for it.
        if (plan.status === 'declined') {
          await new Promise((resolve) => setTimeout(resolve, 2500))
          if (convQueueRef.current) {
            convDoneRef.current.delete(key)
            return
          }
        }
        await closeFromVinted(plan.itemId, plan.status, plan.title)
        show('closed', { status: plan.status })
      }
    } catch {
      convDoneRef.current.delete(key)
      show('failed')
      showToast('Ho visto l\'offerta su Vinted ma non sono riuscito a registrarla: segnala a mano dal pannello.', 6000)
    }
  }

  /** The conversation list: an answer to an offer whose conversation is known closes it; a counter-offer is announced. */
  const applyInbox = async (rows) => {
    const items = watchlist.peek()
    for (const row of rows) {
      const named = items.find((it) => it.conversationId === row.id && !it.sellerName)
      if (named && /^[\w.-]{2,40}$/.test(String(row.seller || ''))) await watchlist.update(named.id, { sellerName: row.seller })
    }
    for (const p of planInboxRows(rows, items)) {
      if (convDoneRef.current.has(p.key)) continue
      convDoneRef.current.add(p.key)
      // In the visit log too: an outcome applied from the inbox is why the conversation then has nothing left to do.
      logVisit('https://www.vinted.it/inbox', `messaggi: ${p.action}${p.status ? ' ' + p.status : ''}${Number.isFinite(p.price) ? ' ' + p.price + ' €' : ''}`)
      if (p.action === 'outcome') await closeFromVinted(p.itemId, p.status, p.title)
      // A counter-offer with its figure is registered (also on an offer closed as refused); without one it is announced.
      else if (Number.isFinite(p.price) && p.price > 0) await registerCounter(p.itemId, p.price, { previousOffer: p.previousOffer, conversationId: null, seller: p.seller })
      else showToast(`«${shortTitle(p.title)}»: controproposta dal venditore. Apri la Lista e tocca «Controproposta».`, 6000)
    }
  }
  useEffect(() => {
    convApplyRef.current = applyConversation
    inboxApplyRef.current = applyInbox
  })

  /** One reading at a time, always the latest: the page reports again while it renders. */
  const onConversation = useCallback((msg) => {
    convLastRef.current = msg
    convQueueRef.current = msg
    if (convBusyRef.current) return
    convBusyRef.current = true
    ;(async () => {
      try {
        for (let guard = 0; convQueueRef.current && guard < 6; guard++) {
          const next = convQueueRef.current
          convQueueRef.current = null
          if (convApplyRef.current) await convApplyRef.current(next)
        }
      } catch { /* a reading that fails changes nothing */ } finally {
        convBusyRef.current = false
      }
    })()
  }, [])
  const onInbox = useCallback((rows) => {
    if (inboxApplyRef.current) inboxApplyRef.current(rows).catch(() => {})
  }, [])

  /** From the list: the conversation of an offer, opened in the Vinted tab, where it is read again. */
  const openConversation = (item) => {
    if (!item || !item.conversationId) return
    const origin = (String(item.link || '').match(/^https:\/\/[^/?#]+/) || ['https://www.vinted.it'])[0]
    setCounterContext(null)
    setLabOpen(false)
    setSearchOpen(false)
    setTab('vinted')
    if (vintedRef.current) vintedRef.current.open(`${origin}/inbox/${item.conversationId}`)
  }
  /** «Piano di risposta» in the browser strip: the reply planner of the counter-offer just read. */
  const openCapturedCounter = () => {
    const item = capture && capture.itemId ? watchlist.peek().find((it) => it.id === capture.itemId) : null
    if (item) openCounterFromItem(item)
  }

  /** «Analizza e registra»: the offer seen on Vinted is on a listing never analysed; analyse it, then record the offer. */
  const analyseAndRecord = () => {
    const link = capture && capture.state === 'needs_analysis' && capture.link ? normalizeVintedLink(capture.link) : null
    if (!link) return
    wantRecordRef.current = { convId: capture.convId, itemId: linkIdOf(link) }
    if (extractRef.current) extractRef.current(link)
  }
  useEffect(() => {
    const want = wantRecordRef.current
    if (!want || extracting || !extraction) return
    if (!extraction.ok) {
      wantRecordRef.current = null
      return
    }
    if (!strategy || !result || linkIdOf(extraction.link) !== want.itemId) return
    wantRecordRef.current = null
    const last = convLastRef.current
    if (last && last.conv && last.conv.id === want.convId) onConversation(last)
  }, [extraction, strategy, result, extracting, onConversation])

  // The web build has no Vinted browser: its checks reach the same handlers through this hook (never set in the app).
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return
    window.__ovtBrowser = { conversation: onConversation, inbox: onInbox, record: analyseAndRecord }
  })

  /** What the analysis on screen read and concluded, as text to share: numbers and the page's own words, no names. */
  const analysisReport = () => {
    if (!(extraction && extraction.ok && strategy && strategy.seller)) return null
    const ex = extraction.raw || {}
    const num = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null)
    return JSON.stringify({
      letto: new Date(extraction.at).toISOString(), via: extraction.via,
      annuncio: { prezzo: ex.listPrice ?? null, caricato: ex.uploadedText ?? null, giorni_online: num(ex.uploadedDays), condizione: ex.condition ?? null, categoria: form.category || null },
        prime_ore: strategy && Number.isFinite(strategy.firstHours) ? strategy.firstHours : null,
      venditore: {
        ultima_visita: ex.sellerLastSeenText ?? null, ultima_visita_minuti: Number.isFinite(ex.sellerLastSeenDays) ? Math.round(ex.sellerLastSeenDays * 1440) : null,
        recensioni: ex.sellerFeedbackCount ?? null, valutazione: ex.sellerRating ?? null, professionale: ex.sellerBusiness ?? null,
      },
      segnali: ex.signals || null,
      distintivi: ex.sellerBadges || [],
      armadio: extraction.wardrobe || null,
      // Which step of the seller's reading worked: the live page, the link to his profile (by name or from the page), his profile.
      lettura_profilo: extraction.profileRead || null,
      // What the page exposes as data (attribute blocks, breadcrumb) and what only as the seller's words: the ground
      // a «same product» search can rest on, category by category.
      pagina: extraction.pageFacts || null,
      // 1.12: the market of a book — what it was searched by, how many listings were seen and how many compare.
      mercato: extraction.bookRead ? (() => {
        const read = extraction.bookRead
        const info = read.info
        const id = read.identity || {}
        return {
          ...(id.kind ? { tipo: id.kind === 'model' ? 'modello' : 'marca', modello: id.model || null, capacita_gb: id.capacityGb ?? null, taglia: id.size || null, condizioni: id.condition || null, categoria: id.category || null }
            : { tipo: 'libro', isbn: id.isbn || null, titolo: id.title || null, autore: id.author || null }),
          via: info ? info.basis : null, annunci_visti: info ? info.seen : null, confrontabili: info ? info.kept : null, usato: Boolean(read.market),
          scartati: info ? info.dropped || null : null, ...(info && info.examples ? { esempi_scartati: info.examples } : {}),
          ...(info && info.market ? {
            mediana: info.market.medianPrice, quartile_basso: info.market.p25Price, quartile_alto: info.market.p75Price, minimo: info.market.minPrice, massimo: info.market.maxPrice,
            affidabilita: info.market.confidence, ...(id.kind ? { stessa_condizione: info.conditionMatched, stessa_taglia: info.sizeMatched, dispersione: info.market.spread } : {}),
          } : {}),
          ...(read.ai ? { ai: read.ai, millisecondi: read.ms } : {}),
          ricerche: read.tried,
        }
      })() : null,
      profilo: {
        tipo: strategy.seller.type, punteggio: strategy.seller.score, archetipo: strategy.seller.archetype ? strategy.seller.archetype.label : null, fiducia: strategy.seller.confidence,
        tratti: (strategy.seller.traits || []).map((x) => `${x.pts > 0 ? '+' : ''}${x.pts} ${x.label}`),
      },
      momento: strategy.moment,
      // 1.11: the purchase as a whole. The shipping is the listing's («page»), an estimate, or typed; the resale the
      // listing price, the market's median, or typed.
      costi: strategy.costs ? {
        scopo: strategy.goal, spedizione: strategy.costs.shipping.amount, spedizione_da: strategy.costs.shipping.source,
        rivendita: strategy.costs.resale.amount, rivendita_da: strategy.costs.resale.source, tetto: strategy.costs.ceiling, minimo_vinted: strategy.costs.floor,
        tetto_raggiungibile: strategy.costs.reachable, senza_margine: strategy.costs.noMargin, totale_al_minimo: strategy.costs.floorTotal ?? null,
        set: strategy.costs.set ? { articoli: strategy.costs.set.items, tetto_a_pezzo: strategy.costs.set.ceilingEach, raggiungibile: strategy.costs.set.reachable, risparmio_a_pezzo: strategy.costs.set.savingEach, sconto_set_pct: strategy.costs.set.discountPct } : null,
      } : null,
      proposte: (strategy.options || []).map((o) => ({
        tipo: o.id, prezzo: o.price, sconto_pct: o.discountPct, probabilita_pct: Number.isFinite(o.probability) ? Math.round(o.probability * 100) : null, consigliata: Boolean(o.recommended),
        totale: o.total ?? null, margine: o.margin ?? null, controproposta_attesa: o.landing ?? null, margine_medio: o.expectedMargin ?? null,
      })),
    }, null, 1)
  }

  const openCounterFromItem = (item, prefillCounter = null) => {
    const fallbackForm = {
      itemTitle: item.title || '', category: item.category || '', listPrice: String(item.listPrice ?? '').replace('.', ','),
      targetPrice: String(item.targetPrice ?? '').replace('.', ','), listingAge: 'unknown', sellerProfile: 'unknown', listingSignal: 'none', link: item.link || '',
    }
    setCounterContext({ key: `${item.id}-${Date.now()}`, source: 'item', itemId: item.id, form: item.form || fallbackForm, history: item.negotiation || [], offerSentAt: item.sentAt || null, link: item.link || '', prefillCounter: Number.isFinite(prefillCounter) ? prefillCounter : null, prefillMax: budgetOfItem(item) })
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
      {vintedActive ? null : (
        <View style={[styles.header, { borderBottomColor: t.line }]}>
          <View style={[styles.logo, { backgroundColor: t.accent }]}><Text style={[styles.logoText, { color: t.onAccent }]}>€</Text></View>
          <Text style={[styles.appName, { color: t.ink, flex: 1 }]} numberOfLines={1}>Offerta Vinted Timing</Text>
        </View>
      )}

      {/* The browser stays mounted while the other tabs are shown, so the page and the session are where they were. */}
      <View style={{ flex: 1, display: vintedActive ? 'flex' : 'none' }}>
        <VintedTab
          ref={vintedRef}
          normalizeLink={normalizeVintedLink}
          analysedLink={extraction && extraction.ok ? extraction.link : null}
          strategy={strategy}
          result={result && result.ok && result.kind !== 'no_offer_needed' ? result : null}
          saveState={saveState}
          calendarBusy={calendarBusy}
          extracting={extracting}
          extractPhase={extractPhase}
          extractError={vintedActive && extraction && !extraction.ok ? extraction.message : null}
          onAnalyze={(link) => { if (extractRef.current) extractRef.current(link) }}
          onPick={pickInBrowser}
          onSave={saveCurrent}
          onSaveAndMarkSent={saveAndMarkSent}
          onCalendar={() => addCalendar(result, saveState && saveState.itemId)}
          onCounter={openCounterFromAnalysis}
          onCopyMessage={noteMessageCopied}
          onDetails={() => setTab('calcola')}
          onToast={browserToast}
          onAim={changeAim}
          onResale={changeResale}
          onMargin={changeMargin}
          capture={capture}
          onConversation={onConversation}
          onInbox={onInbox}
          onRecordOffer={analyseAndRecord}
          onOpenCounter={openCapturedCounter}
          analysisReport={analysisReport}
        />
      </View>

      <KeyboardAvoidingView style={{ flex: 1, display: vintedActive ? 'none' : 'flex' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
              market={marketShownFor(counterContext.form) ? marketShownFor(counterContext.form).market : null}
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
                  strategy={strategy}
                  onPickProposal={pickProposal}
                  onAim={changeAim}
                  onResale={changeResale}
          onMargin={changeMargin}
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
          {!counterContext && !labOpen && !searchOpen && tab === 'lista' && <VintedNotices bridge={vinted} items={watchlist.items} onCounter={openCounterFromItem} onReanalyze={reanalyzeItem} onGoCalcola={() => setTab('calcola')} />}
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
              onOpenConversation={Platform.OS === 'web' ? null : openConversation}
              onGoCalcola={() => setTab('calcola')}
              onGoInfo={() => setTab('info')}
              onReanalyze={reanalyzeItem}
              onToast={showToast}
              scrollRef={scrollRef}
            />
          )}
          {!counterContext && !labOpen && !searchOpen && tab === 'info' && <InfoView stats={watchlist.stats} items={watchlist.allItems} learning={learning} onToast={(m) => showToast(m, 4000)} onOpenLab={openLab} onOpenSearch={() => openSearch(false)} onRestore={watchlist.restoreItems} vinted={vinted} />}
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
