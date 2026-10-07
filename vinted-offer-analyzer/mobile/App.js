import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, KeyboardAvoidingView, Platform, Pressable, ScrollView, StatusBar as RNStatusBar, StyleSheet, Text, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import { analyzeOffer, buildFormFromExtraction, formatEuro, nextGoalFor, optimizeOffer, parseVintedItemHtml } from './core/index.js'
import { EMPTY_FORM, OfferForm } from './src/components/OfferForm.js'
import { ResultView } from './src/components/ResultView.js'
import { WatchlistView } from './src/components/WatchlistView.js'
import { InfoView } from './src/components/InfoView.js'
import { CounterView } from './src/components/CounterView.js'
import { useWatchlist } from './src/hooks/useWatchlist.js'
import { VIA_LABEL, eventNotesFor, openCalendarWithEvent } from './src/services/calendar.js'
import { listenToReminderTaps } from './src/services/notifications.js'
import { fetchVintedItemPage, normalizeVintedLink, readVintedLinkFromClipboard } from './src/services/vinted.js'
import { space, useTheme } from './src/theme.js'

const TABS = [
  { id: 'calcola', label: 'Calcola' },
  { id: 'lista', label: 'Lista' },
  { id: 'info', label: 'Info' },
]

const EXAMPLE_FORM = { ...EMPTY_FORM, itemTitle: 'Nike Air Force 1 bianche, 42', category: 'sneakers', listPrice: '60', targetPrice: '45', listingAge: 'weeks_1_2' }

/** Default ask when the price comes from the listing: −20% sits in the "medium risk" band, the usual starting point on Vinted. */
const DEFAULT_TARGET_DISCOUNT = 20

const EXTRACT_ERRORS = {
  not_a_vinted_link: 'Serve un link a un articolo Vinted, del tipo vinted.it/items/… .',
  timeout: 'Vinted non ha risposto in tempo. Controlla la connessione e riprova.',
  network: 'Nessuna connessione: non riesco a scaricare l\'annuncio. Puoi compilare i dati a mano.',
  blocked: 'Vinted ha bloccato la lettura automatica di questa pagina. Compila i dati a mano: il link resta salvato per il promemoria.',
  empty: 'Pagina scaricata ma senza i dati dell\'annuncio: forse è stato venduto o riservato. Compila i dati a mano.',
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
  const [form, setForm] = useState(EXAMPLE_FORM)
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
  const [extraction, setExtraction] = useState(null)
  const [clipboardLink, setClipboardLink] = useState(null)
  const [counterContext, setCounterContext] = useState(null)
  const scrollRef = useRef(null)
  const formYRef = useRef(0)
  const formViewRef = useRef(null)
  const formRef = useRef(form)
  const offeredLinkRef = useRef(null)
  const watchlist = useWatchlist()
  const now = useMemo(() => new Date(), [tab, result]) // eslint-disable-line react-hooks/exhaustive-deps

  const toastTimer = useRef(null)
  const showToast = useCallback((message, ms = 2500) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(message)
    toastTimer.current = setTimeout(() => setToast(null), ms)
  }, [])

  useEffect(() => listenToReminderTaps((data) => {
    if (data && data.itemId) {
      setCounterContext(null)
      setTab('lista')
      setHighlightId(data.itemId)
    }
  }), [])

  const setField = (name, value) => setForm((prev) => ({ ...prev, [name]: value }))

  const runAnalysis = (nextForm, preferredSendAt) => {
    const outcome = analyzeOffer(nextForm, new Date(), preferredSendAt ? { preferredSendAt } : {})
    if (!outcome.ok) {
      setErrors(outcome.errors)
      setResult(null)
      return null
    }
    setErrors({})
    setResult(outcome)
    setSaveState(null)
    if (outcome.kind !== 'no_offer_needed') setGoal(nextGoalFor(outcome.probability))
    setTimeout(() => scrollRef.current && scrollRef.current.scrollTo({ y: 0, animated: true }), 50)
    return outcome
  }

  const analyze = () => {
    setPlan(null)
    setPinnedSendAt(null)
    runAnalysis(form, null)
  }

  /** Re-runs the analysis keeping the moment chosen through the optimizer (used after edits). */
  const recalcKeepingPin = () => runAnalysis(form, pinnedSendAt)

  const optimize = () => {
    setOptimizing(true)
    setTimeout(() => {
      setPlan(optimizeOffer(form, new Date(), { targetProbability: goal }))
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

  const reset = () => {
    setForm(EMPTY_FORM)
    setErrors({})
    setResult(null)
    setSaveState(null)
    setPlan(null)
    setPinnedSendAt(null)
    setExtraction(null)
  }

  useEffect(() => { formRef.current = form }, [form])

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

  /**
   * The one-tap path: download the public listing page, read title, price, upload age and seller activity,
   * map them onto the form (target = list price −20%) and run the analysis. Every failure ends in a message,
   * never in a silent no-op, and the link stays in the form so the manual path still works.
   */
  const extractFromLink = async (rawLink) => {
    const link = normalizeVintedLink(rawLink)
    offeredLinkRef.current = link || rawLink
    setClipboardLink(null)
    if (!link) {
      setExtraction({ ok: false, message: EXTRACT_ERRORS.not_a_vinted_link })
      return
    }
    if (extracting) return
    setExtracting(true)
    setExtraction(null)
    setField('link', link)
    try {
      const page = await fetchVintedItemPage(link)
      if (!page.ok) {
        const message = page.reason === 'http'
          ? (page.status === 404 ? 'L\'annuncio non esiste più o è stato rimosso.' : `Vinted ha risposto con un errore (${page.status}). Riprova tra poco o compila i dati a mano.`)
          : EXTRACT_ERRORS[page.reason] || EXTRACT_ERRORS.network
        setExtraction({ ok: false, message })
        return
      }
      const ex = parseVintedItemHtml(page.html)
      if (!ex.title && !ex.listPrice) {
        setExtraction({ ok: false, message: EXTRACT_ERRORS.empty })
        return
      }
      const built = buildFormFromExtraction(ex, { link, targetDiscountPct: DEFAULT_TARGET_DISCOUNT, previousForm: { ...EMPTY_FORM, link } })
      setForm(built.form)
      setPlan(null)
      setPinnedSendAt(null)
      const outcome = runAnalysis(built.form, null)
      setExtraction({ ok: true, summary: built.summary, link, at: Date.now() })
      if (!outcome) {
        showToast(ex.listPrice ? 'Letto l\'annuncio: controlla i campi evidenziati.' : 'Letto l\'annuncio ma non il prezzo: inseriscilo a mano.')
        setTimeout(scrollToForm, 80)
      }
    } catch (error) {
      setExtraction({ ok: false, message: `Errore inatteso durante la lettura: ${String(error && error.message ? error.message : error)}` })
    } finally {
      setExtracting(false)
    }
  }

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

  const saveCurrent = async () => {
    if (!result || result.kind === 'no_offer_needed') return
    const { item, reminder } = await watchlist.addFromAnalysis({ result, link: form.link, form })
    const messages = {
      scheduled: { tone: 'good', message: `Salvato. Ti avviso 10 minuti prima: ${result.verdict.headline.replace("Invia l'offerta ", '')}.` },
      too_soon: { tone: 'warn', message: 'Salvato. Il momento consigliato è troppo vicino per una notifica: invia l\'offerta adesso.' },
      denied: { tone: 'warn', message: 'Salvato senza promemoria: le notifiche sono disattivate. Puoi attivarle nella scheda Info.' },
      skipped: { tone: 'neutral', message: 'Salvato nella lista.' },
    }
    setSaveState({ saved: true, itemId: item.id, ...messages[reminder] })
  }

  const calendarPayload = (source) => {
    // A saved item waiting for our counter: the event carries the new price, not the first offer.
    const plan = source.counterPlan && source.counterPlan.price != null && !source.counterPlan.sentAt ? source.counterPlan : null
    return {
      title: source.title || source.input?.itemTitle || '',
      link: source.link || form.link,
      sendAt: source.sendAt || source.optimal.date,
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
   * "Metti in calendario": opens the phone's calendar app on a pre-filled "new event" screen (no permission);
   * the user taps Save there. Falls back to Google Calendar and to a .ics file on its own; every outcome is a toast.
   */
  const addCalendar = async (source, itemId, explicitPayload = null) => {
    if (calendarBusy) return
    const payload = explicitPayload || calendarPayload(source)
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
    setCounterContext({ key: `analysis-${Date.now()}`, source: 'analysis', itemId: null, form, history: [], offerSentAt: null, link: form.link })
    scrollTop()
  }

  const saveCounter = async (counterResult) => {
    const ctx = counterContext
    const { item, reminder } = await watchlist.addCounter({ itemId: ctx.itemId, result: counterResult, link: ctx.link, form: ctx.form })
    setCounterContext((prev) => (prev ? { ...prev, itemId: item.id, history: item.negotiation } : prev))
    const rec = counterResult.recommended
    if (rec && rec.id === 'accept') return { saved: true, tone: 'good', message: 'Salvato nella lista. Quando hai comprato, segna l\'esito «Accettata».' }
    const when = counterResult.verdict.action
    return {
      saved: true,
      ...({
        scheduled: { tone: 'good', message: `Salvato. Ti avviso 10 minuti prima: ${when}, con ${formatEuro(rec.price)} e il messaggio pronto.` },
        too_soon: { tone: 'warn', message: 'Salvato. Il momento è troppo vicino per una notifica: rispondi adesso.' },
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
    const next = await watchlist.markCounterSent(itemId)
    if (next) showToast(`Registrato: hai proposto ${formatEuro(next.counterPlan.price)}. Se non risponde entro un giorno ti ricordo di scrivergli.`, 4000)
  }

  const topInset = insets.top || (Platform.OS === 'android' ? (RNStatusBar.currentHeight || 24) : 44)
  const bottomInset = Math.max(insets.bottom, 8)

  return (
    <View style={[styles.root, { backgroundColor: t.bg, paddingTop: topInset }]}>
      <StatusBar style="auto" />
      <View style={[styles.header, { borderBottomColor: t.line }]}>
        <View style={[styles.logo, { backgroundColor: t.accent }]}><Text style={[styles.logoText, { color: t.onAccent }]}>€</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.appName, { color: t.ink }]} numberOfLines={1}>Offerta Vinted Timing</Text>
          <Text style={[styles.appTagline, { color: t.ink3 }]} numberOfLines={1}>Il momento giusto per proporre il tuo prezzo</Text>
        </View>
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
              onScrollTo={(y) => setTimeout(() => scrollRef.current && scrollRef.current.scrollTo({ y: Math.max(0, y - 8), animated: true }), 30)}
            />
          )}
          {!counterContext && tab === 'calcola' && (
            <View style={{ gap: space.lg }}>
              {clipboardLink && (
                <View style={[styles.banner, { backgroundColor: t.accentSoft, borderColor: t.accent }]}>
                  <Text style={{ color: t.accentInk, fontSize: 14, flex: 1, minWidth: 0 }} numberOfLines={2}>Hai copiato un link Vinted: lo leggo e calcolo subito?</Text>
                  <View style={{ flexDirection: 'row', gap: space.sm }}>
                    <Pressable onPress={() => extractFromLink(clipboardLink)} style={[styles.bannerButton, { backgroundColor: t.accent }]} accessibilityRole="button"><Text style={{ color: t.onAccent, fontWeight: '700', fontSize: 14 }}>Estrai e calcola</Text></Pressable>
                    <Pressable onPress={() => { offeredLinkRef.current = clipboardLink; setClipboardLink(null) }} style={styles.bannerButton} accessibilityRole="button"><Text style={{ color: t.accentInk, fontWeight: '700', fontSize: 14 }}>Ignora</Text></Pressable>
                  </View>
                </View>
              )}
              {result && (
                <ResultView
                  result={result}
                  saveState={saveState}
                  onSave={saveCurrent}
                  onCalendar={() => addCalendar(result, saveState && saveState.itemId)}
                  calendarBusy={calendarBusy}
                  goal={goal}
                  onGoal={setGoal}
                  plan={plan}
                  onOptimize={optimize}
                  onApply={applyOption}
                  optimizing={optimizing}
                  onRecalc={recalcKeepingPin}
                  extraction={extraction}
                  onEditData={scrollToForm}
                  onCounter={openCounterFromAnalysis}
                />
              )}
              <View ref={formViewRef} onLayout={(e) => { formYRef.current = e.nativeEvent.layout.y }}>
                <OfferForm
                  form={form}
                  errors={errors}
                  onChange={setField}
                  onSubmit={analyze}
                  onReset={reset}
                  onExtract={extractFromLink}
                  onPasteLink={pasteLink}
                  extracting={extracting}
                  extraction={extraction}
                />
              </View>
            </View>
          )}
          {!counterContext && tab === 'lista' && (
            <WatchlistView
              items={watchlist.items}
              ready={watchlist.ready}
              highlightId={highlightId}
              now={now}
              onStatus={watchlist.setStatus}
              onRemove={watchlist.remove}
              onCalendar={(item) => addCalendar(item, item.id)}
              onCounter={openCounterFromItem}
              onCounterSent={counterSent}
            />
          )}
          {!counterContext && tab === 'info' && <InfoView stats={watchlist.stats} items={watchlist.items} />}
        </ScrollView>
      </KeyboardAvoidingView>

      {toast && (
        <View style={[styles.toast, { backgroundColor: t.ink, bottom: 72 + bottomInset }]}><Text style={{ color: t.bg, fontSize: 14 }}>{toast}</Text></View>
      )}

      <View style={[styles.tabBar, { backgroundColor: t.card, borderTopColor: t.line, paddingBottom: bottomInset }]}>
        {TABS.map((item) => {
          const active = tab === item.id
          const count = item.id === 'lista' ? watchlist.stats.planned : 0
          return (
            <Pressable key={item.id} onPress={() => { setCounterContext(null); setTab(item.id); if (item.id !== 'lista') setHighlightId(null) }} style={styles.tab} accessibilityRole="tab" accessibilityState={{ selected: active && !counterContext }}>
              <Text style={[styles.tabLabel, { color: active ? t.accent : t.ink3, fontWeight: active ? '700' : '500' }]}>
                {item.label}{count ? ` (${count})` : ''}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: 1 },
  logo: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  logoText: { fontSize: 20, fontWeight: '800' },
  appName: { fontSize: 17, fontWeight: '700' },
  appTagline: { fontSize: 12 },
  content: { padding: space.lg, paddingBottom: 96, gap: space.lg },
  toast: { position: 'absolute', left: space.lg, right: space.lg, borderRadius: 12, padding: space.md },
  banner: { borderWidth: 1, borderRadius: 12, padding: space.md, gap: space.sm },
  bannerButton: { minHeight: 40, borderRadius: 10, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  tabBar: { flexDirection: 'row', borderTopWidth: 1 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabLabel: { fontSize: 14 },
})
