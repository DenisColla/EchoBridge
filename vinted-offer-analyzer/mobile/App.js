import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StatusBar as RNStatusBar, StyleSheet, Text, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import { analyzeOffer, nextGoalFor, optimizeOffer } from './core/index.js'
import { EMPTY_FORM, OfferForm } from './src/components/OfferForm.js'
import { ResultView } from './src/components/ResultView.js'
import { WatchlistView } from './src/components/WatchlistView.js'
import { InfoView } from './src/components/InfoView.js'
import { useWatchlist } from './src/hooks/useWatchlist.js'
import { addToDeviceCalendar, eventNotesFor, openGoogleCalendar } from './src/services/calendar.js'
import { listenToReminderTaps } from './src/services/notifications.js'
import { space, useTheme } from './src/theme.js'

const TABS = [
  { id: 'calcola', label: 'Calcola' },
  { id: 'lista', label: 'Lista' },
  { id: 'info', label: 'Info' },
]

const EXAMPLE_FORM = { ...EMPTY_FORM, itemTitle: 'Nike Air Force 1 bianche, 42', category: 'sneakers', listPrice: '60', targetPrice: '45', listingAge: 'weeks_1_2' }

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
  const scrollRef = useRef(null)
  const watchlist = useWatchlist()
  const now = useMemo(() => new Date(), [tab, result]) // eslint-disable-line react-hooks/exhaustive-deps

  const showToast = useCallback((message) => {
    setToast(message)
    setTimeout(() => setToast(null), 2500)
  }, [])

  useEffect(() => listenToReminderTaps((data) => {
    if (data && data.itemId) {
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
  }

  const saveCurrent = async () => {
    if (!result || result.kind === 'no_offer_needed') return
    const { item, reminder } = await watchlist.addFromAnalysis({ result, link: form.link })
    const messages = {
      scheduled: { tone: 'good', message: `Salvato. Ti avviso 10 minuti prima: ${result.verdict.headline.replace("Invia l'offerta ", '')}.` },
      too_soon: { tone: 'warn', message: 'Salvato. Il momento consigliato è troppo vicino per una notifica: invia l\'offerta adesso.' },
      denied: { tone: 'warn', message: 'Salvato senza promemoria: le notifiche sono disattivate. Puoi attivarle nella scheda Info.' },
      skipped: { tone: 'neutral', message: 'Salvato nella lista.' },
    }
    setSaveState({ saved: true, itemId: item.id, ...messages[reminder] })
  }

  const calendarPayload = (source) => ({
    title: source.title || source.input?.itemTitle || '',
    link: source.link || form.link,
    sendAt: source.sendAt || source.optimal.date,
    notes: eventNotesFor({
      link: source.link || form.link,
      targetPrice: source.targetPrice || source.input?.targetPrice,
      probability: source.probability,
      message: source.message || (source.messages ? (source.messages.find((m) => m.tone === source.recommendedTone) || source.messages[0]).text : ''),
    }),
  })

  /** One action: device calendar first; if it is refused or fails, open Google Calendar pre-filled instead. */
  const addCalendar = async (source, itemId) => {
    const payload = calendarPayload(source)
    try {
      const outcome = await addToDeviceCalendar(payload)
      if (outcome.ok) {
        if (itemId) await watchlist.update(itemId, { calendarEventId: outcome.eventId })
        showToast(`Evento aggiunto al calendario${outcome.calendarName ? ` "${outcome.calendarName}"` : ''}.`)
        return
      }
      showToast(outcome.reason === 'permission' ? 'Permesso negato: apro Google Calendar.' : 'Calendario del telefono non disponibile: apro Google Calendar.')
    } catch {
      showToast('Calendario del telefono non disponibile: apro Google Calendar.')
    }
    openGoogleCalendar(payload).catch(() => showToast('Impossibile aprire Google Calendar.'))
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
          {tab === 'calcola' && (
            <View style={{ gap: space.lg }}>
              {result && (
                <ResultView
                  result={result}
                  saveState={saveState}
                  onSave={saveCurrent}
                  onCalendar={() => addCalendar(result, saveState && saveState.itemId)}
                  goal={goal}
                  onGoal={setGoal}
                  plan={plan}
                  onOptimize={optimize}
                  onApply={applyOption}
                  optimizing={optimizing}
                  onRecalc={recalcKeepingPin}
                />
              )}
              <OfferForm form={form} errors={errors} onChange={setField} onSubmit={analyze} onReset={reset} />
            </View>
          )}
          {tab === 'lista' && (
            <WatchlistView
              items={watchlist.items}
              ready={watchlist.ready}
              highlightId={highlightId}
              now={now}
              onStatus={watchlist.setStatus}
              onRemove={watchlist.remove}
              onCalendar={(item) => addCalendar(item, item.id)}
            />
          )}
          {tab === 'info' && <InfoView stats={watchlist.stats} items={watchlist.items} />}
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
            <Pressable key={item.id} onPress={() => { setTab(item.id); if (item.id !== 'lista') setHighlightId(null) }} style={styles.tab} accessibilityRole="tab" accessibilityState={{ selected: active }}>
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
  tabBar: { flexDirection: 'row', borderTopWidth: 1 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabLabel: { fontSize: 14 },
})
