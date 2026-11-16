import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Pressable, ScrollView, Share, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { formatEuro } from '../../../core/index.js'
import { logVisit, visitLogText } from '../../services/vintedDiag.js'
import { pageOf, siteOf } from '../../services/vintedNav.js'
import { space, useTheme } from '../../theme.js'
import { StrategyHero } from '../result/StrategyHero.js'
import { Body, Button, InlineAction } from '../ui.js'
import { VintedBrowser } from './VintedBrowser.js'

const PHASE = { browser: 'Apro la pagina…', verify: 'Completa la verifica', seller: 'Studio il venditore…', market: 'Cerco lo stesso libro…', product: 'Cerco lo stesso articolo…' }

function Tool({ glyph, label, onPress }) {
  const t = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6} style={({ pressed }) => [styles.tool, { opacity: pressed ? 0.5 : 1 }]}>
      <Text style={{ fontSize: 20, color: t.ink2, fontWeight: '700' }}>{glyph}</Text>
    </Pressable>
  )
}

/**
 * The Vinted tab: the browser over the whole screen and, under it, one strip that follows the page. On a listing it
 * offers «Analizza»; once analysed it shows the best proposal and opens a panel with the seller, the three
 * proposals and the moves, without leaving the page. On a conversation it says what became of the offer seen there
 * (`capture`, decided by the app from what the browser read). Imperative API: handleBack() → true when it used the gesture.
 */
export const VintedTab = forwardRef(function VintedTab({
  normalizeLink, analysedLink, strategy, result, saveState, calendarBusy, extracting, extractPhase, extractError = null,
  onAnalyze, onPick, onSave, onSaveAndMarkSent, onCalendar, onCounter, onCopyMessage, onDetails, onToast,
  onAim = null, onResale = null, onMargin = null, aiDepth = 'fast', onAiDepth = null,
  capture = null, onConversation = null, onInbox = null, onRecordOffer = null, onOpenCounter = null, analysisReport = null,
}, ref) {
  const t = useTheme()
  const { height } = useWindowDimensions()
  const browserRef = useRef(null)
  const [url, setUrl] = useState('')
  const [panel, setPanel] = useState(false)
  const [menu, setMenu] = useState(false)
  const page = pageOf(url)
  const link = page.type === 'item' ? normalizeLink(url) : null
  const ready = Boolean(link && strategy && result && analysedLink && analysedLink === link)
  const chosen = ready ? strategy.options.find((o) => o.id === strategy.chosenId) || strategy.options[0] : null

  useImperativeHandle(ref, () => ({
    handleBack: () => {
      if (panel || menu) {
        setPanel(false)
        setMenu(false)
        return true
      }
      if (browserRef.current && browserRef.current.canGoBack()) {
        browserRef.current.goBack()
        return true
      }
      return false
    },
    open: (target) => { if (browserRef.current) browserRef.current.open(target) },
  }), [panel, menu])

  const onPage = useCallback((next) => {
    setUrl((prev) => (prev === next ? prev : next))
    logVisit(next)
  }, [])
  // The browser keeps one set of callbacks: the latest handlers are reached through refs.
  const convRef = useRef(onConversation)
  const inboxRef = useRef(onInbox)
  useEffect(() => {
    convRef.current = onConversation
    inboxRef.current = onInbox
  })
  const handleConversation = useCallback((msg) => { if (convRef.current) convRef.current(msg) }, [])
  const handleInbox = useCallback((rows) => { if (inboxRef.current) inboxRef.current(rows) }, [])
  const cap = page.type === 'conversation' && capture && capture.convId === page.id ? capture : null
  // A new page closes the panel of the previous listing; a finished analysis of this listing opens it.
  const lastLinkRef = useRef(null)
  useEffect(() => {
    if (lastLinkRef.current !== link) {
      lastLinkRef.current = link
      setPanel(false)
    }
  }, [link])
  // A reading that failed says so here: the message otherwise sits in Calcola, out of sight.
  const lastErrorRef = useRef(null)
  useEffect(() => {
    if (extractError && extractError !== lastErrorRef.current) onToast(extractError)
    lastErrorRef.current = extractError
  }, [extractError, onToast])
  const wasReady = useRef(false)
  useEffect(() => {
    if (ready && !wasReady.current) setPanel(true)
    wasReady.current = ready
  }, [ready])

  const shareText = async (title, message) => {
    try {
      await Share.share({ title, message })
    } catch { /* cancelled */ }
  }

  let action = null
  if (extracting) action = <Body small muted>{PHASE[extractPhase] || 'Leggo l\'annuncio…'}</Body>
  else if (ready) action = <Button label={panel ? 'Chiudi' : `★ ${formatEuro(chosen.price)} · proposte`} small variant={panel ? 'secondary' : 'primary'} onPress={() => setPanel((v) => !v)} />
  else if (link) action = <Button label="Analizza" small onPress={() => onAnalyze(link)} />
  else if (cap && cap.state === 'needs_analysis') {
    action = cap.link && onRecordOffer
      ? <Button label={`Analizza e registra ${formatEuro(cap.price)}`} small onPress={onRecordOffer} />
      : <Body small muted numberOfLines={2}>Offerta di {formatEuro(cap.price)} vista: analizza l'annuncio per registrarla</Body>
  } else if (cap && cap.state === 'recorded') action = <Body small numberOfLines={1}>✓ Offerta di {formatEuro(cap.price)} in Lista</Body>
  else if (cap && cap.state === 'counter') {
    action = onOpenCounter
      ? <Button label={`Controproposta ${formatEuro(cap.price)} · piano`} small onPress={onOpenCounter} />
      : <Body small numberOfLines={2}>Controproposta di {formatEuro(cap.price)} in Lista</Body>
  } else if (cap && cap.state === 'incoming') action = <Body small muted numberOfLines={2}>Proposta di {formatEuro(cap.price)} dal venditore: annuncio non in Lista</Body>
  else if (cap && cap.state === 'closed') action = <Body small numberOfLines={1}>✓ Esito registrato in Lista</Body>
  else action = <Body small muted numberOfLines={1}>{page.type === 'signin' ? 'Accesso con Google' : page.type === 'external' ? 'Pagina esterna' : 'Apri un annuncio per analizzarlo'}</Body>

  return (
    <View style={styles.fill}>
      <VintedBrowser
        ref={browserRef}
        onPage={onPage}
        onBlocked={(blocked) => {
          // In the log too: a blocked page is the first thing to look at when a sign-in or a payment stops.
          logVisit(blocked, 'bloccata')
          const site = siteOf(blocked)
          onToast(`${site ? `Bloccato ${site}` : 'Sito esterno bloccato'}: qui si naviga solo su Vinted.`)
        }}
        onConversation={handleConversation}
        onInbox={handleInbox}
        onOutline={({ url: at, lines, controls }) => {
          logVisit(at, 'struttura condivisa')
          shareText('Struttura pagina Vinted', JSON.stringify({ pagina: pageOf(at).type, elementi: lines, controlli: controls }, null, 1))
        }}
      />
      {panel && ready ? (
        <View style={[styles.panel, { backgroundColor: t.bg, borderTopColor: t.line, maxHeight: Math.round(height * 0.62) }]}>
          <ScrollView contentContainerStyle={{ padding: space.md, gap: space.sm }} keyboardShouldPersistTaps="handled">
            <StrategyHero strategy={strategy} result={result} saveState={saveState} calendarBusy={calendarBusy} onPick={onPick} onEdit={onDetails} onSave={onSave} onSaveAndMarkSent={onSaveAndMarkSent} onCalendar={onCalendar} onCounter={onCounter} onCopyMessage={onCopyMessage} onGoal={onAim} onResale={onResale} onMargin={onMargin} aiDepth={aiDepth} onAiDepth={onAiDepth} />
            <Button label="Tutti i dettagli in Calcola" variant="ghost" small onPress={onDetails} />
          </ScrollView>
        </View>
      ) : null}
      {menu ? (
        <View style={[styles.menu, { backgroundColor: t.card, borderTopColor: t.line }]}>
          <InlineAction label="Condividi la struttura di questa pagina" onPress={() => { setMenu(false); if (browserRef.current) browserRef.current.outline() }} />
          <InlineAction label="Condividi il registro di navigazione" onPress={async () => { setMenu(false); shareText('Registro browser Vinted', await visitLogText()) }} />
          {ready && analysisReport ? (
            <InlineAction
              label="Condividi cosa ha letto l'analisi"
              onPress={() => {
                setMenu(false)
                const text = analysisReport()
                if (text) shareText('Analisi del venditore', text)
              }}
            />
          ) : null}
          <Body small muted>Servono per adattare l'app alle pagine di Vinted. Il registro contiene indirizzi senza numeri e lo stato delle offerte; la struttura i nomi degli elementi, le prime parole del loro testo e i campi della pagina, mai quello che ci scrivi; l'analisi i dati letti dall'annuncio aperto, senza nomi.</Body>
        </View>
      ) : null}
      <View style={[styles.strip, { backgroundColor: t.card, borderTopColor: t.line }]}>
        <Tool glyph="‹" label="Indietro" onPress={() => browserRef.current && browserRef.current.goBack()} />
        <Tool glyph="↻" label="Ricarica" onPress={() => browserRef.current && browserRef.current.reload()} />
        <Tool glyph="⌂" label="Pagina iniziale di Vinted" onPress={() => browserRef.current && browserRef.current.home()} />
        <View style={styles.action}>{action}</View>
        <Tool glyph="⋯" label="Altro" onPress={() => setMenu((v) => !v)} />
      </View>
    </View>
  )
})

const styles = StyleSheet.create({
  fill: { flex: 1 },
  strip: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: space.sm, minHeight: 52, borderTopWidth: StyleSheet.hairlineWidth },
  tool: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  action: { flex: 1, minWidth: 0, alignItems: 'flex-end', justifyContent: 'center', paddingHorizontal: space.sm },
  panel: { borderTopWidth: StyleSheet.hairlineWidth },
  menu: { padding: space.md, gap: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
})
