import { useMemo, useRef, useState } from 'react'
import { Alert, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'
import { PAIR_LABELS, formatEuro, parseVintedCatalog, vintedSearchUrl } from '../../../core/index.js'
import { radius, space, useTheme } from '../../theme.js'
import { Body, Button, ButtonRow, Note, Title } from '../ui.js'

/**
 * Runs inside the visible search page: once the document is parsed and the server-rendered results are there, it
 * sends back only the React flight scripts (where the results live), not the whole page.
 */
const CATALOG_PROBE = `(function () {
  if (window.__ovtCatalog) return;
  window.__ovtCatalog = true;
  var post = function (m) { try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {} };
  var tick = function () {
    var ready = document.readyState !== 'loading';
    var parts = [];
    if (ready) {
      var scripts = document.querySelectorAll('script');
      for (var i = 0; i < scripts.length; i++) {
        var t = scripts[i].textContent || '';
        if (t.indexOf('self.__next_f.push') >= 0) parts.push(t);
      }
    }
    var joined = parts.join('\\n');
    if (ready && joined.indexOf('productItem') >= 0) { post({ type: 'catalog', url: location.href, text: joined }); return; }
    post({ type: 'state', ready: ready, challenge: !!(window._cf_chl_opt || document.querySelector('iframe[src*="challenges.cloudflare.com"]')) });
    setTimeout(tick, 800);
  };
  tick();
})();
true;`

const hostOf = (u) => {
  try {
    return new URL(u).hostname.toLowerCase()
  } catch {
    return ''
  }
}
const isVintedHost = (h) => h === 'vinted.it' || h.endsWith('.vinted.it')
const isCatalogUrl = (u) => isVintedHost(hostOf(u)) && /^https:\/\/[^/]+\/catalog(\?|\/|$)/i.test(u)
// Same search? Vinted may stamp the address with its own ids (time, search_id): compare the rest, order-free.
const searchKey = (u) => {
  const [base, query = ''] = String(u || '').split('#')[0].split('?')
  const params = query.split('&').filter((kv) => kv && !/^(time|search_id|search_session_id)=/i.test(kv)).sort()
  return `${base.replace(/\/$/, '')}?${params.join('&')}`
}
// Main-frame navigation stays on Vinted (plus Cloudflare's check), without login or sign-up pages.
const NO_LOGIN = /^https:\/\/[^/]+\/(member\/(general\/)?(login|signup|register)|oauth|auth)(\/|\?|$)/i
const allowNavigation = (u) => {
  if (u === 'about:blank') return true
  if (!/^https:\/\//i.test(u || '')) return false
  const h = hostOf(u)
  return (isVintedHost(h) && !NO_LOGIN.test(u)) || h === 'challenges.cloudflare.com'
}
// The words of a Vinted search address (search_text=…), to compare what was searched with the reference.
const searchTextOf = (u) => {
  const m = String(u || '').match(/[?&]search_text=([^&#]*)/)
  if (!m) return ''
  try {
    return decodeURIComponent(m[1].replace(/\+/g, ' '))
  } catch {
    return m[1]
  }
}
// A page without search words (a category, only filters): its address minus paging and Vinted's own ids, so two
// different category pages never look like the same search, and none looks like a typed search.
const browseKey = (u) => {
  const [base, q = ''] = String(u || '').split('#')[0].split('?')
  return `${base.replace(/\/$/, '')}?${q.split('&').filter((kv) => kv && !/^(time|search_id|search_session_id|page)=/i.test(kv)).sort().join('&')}`
}
const searchLabel = (s) => (/^https?:\/\//i.test(String(s || '')) ? 'una categoria o dei filtri di Vinted' : `«${s}»`)
const sameSearch = (a, b) => String(a || '').trim().toLowerCase().replace(/\s+/g, ' ') === String(b || '').trim().toLowerCase().replace(/\s+/g, ' ')
const describe = (c) => [c.brand, c.size, c.condition].filter(Boolean).join(' · ')

function ListingRow({ item, children, highlight }) {
  const t = useTheme()
  return (
    <View style={[styles.row, { borderColor: highlight ? t.accent : t.line, backgroundColor: t.card }]}>
      {item.thumb || item.photo ? <Image source={{ uri: item.thumb || item.photo }} style={styles.thumb} resizeMode="cover" accessibilityIgnoresInvertColors /> : <View style={[styles.thumb, { backgroundColor: t.cardMuted }]} />}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14 }} numberOfLines={2}>{item.title}</Text>
        {describe(item) ? <Text style={{ color: t.ink3, fontSize: 12 }} numberOfLines={1}>{describe(item)}</Text> : null}
        <Text style={{ color: t.ink2, fontSize: 13 }}>{item.price != null ? formatEuro(item.price) : '—'}{item.total != null ? ` · ${formatEuro(item.total)} con commissione` : ''}</Text>
        {children}
      </View>
    </View>
  )
}

/**
 * «Raccogli coppie»: the user searches Vinted in a VISIBLE in-app browser. The results of each loaded search page are
 * read on the phone; when the user changed filters inside the page, «Usa questi risultati» reloads that search first.
 * The user picks or keeps the reference listing and labels candidates with one tap. Returns labelled pairs.
 */
export function CollectSheet({ visible, initialQuery = '', reference = null, onClose, onSave }) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const webRef = useRef(null)
  const [query, setQuery] = useState(initialQuery)
  const [url, setUrl] = useState(initialQuery ? vintedSearchUrl(initialQuery) : null)
  const [found, setFound] = useState(null)
  const [challenge, setChallenge] = useState(false)
  const [phase, setPhase] = useState('browse')
  const [ref, setRef] = useState(reference)
  // The search the reference belongs to. Results of another search are compared with it only after the user says so:
  // otherwise tablets end up labelled against a comic book analysed earlier.
  const [refQuery, setRefQuery] = useState(reference ? initialQuery : '')
  const [searched, setSearched] = useState(initialQuery)
  // id → { label, candidate }: a label keeps its listing, so it survives a new search.
  const [labels, setLabels] = useState({})
  const [loadKey, setLoadKey] = useState(0)
  const [parsedUrl, setParsedUrl] = useState(null)
  const [nav, setNav] = useState({ url: null, canGoBack: false })
  const [pendingLabel, setPendingLabel] = useState(false)
  const [savedNote, setSavedNote] = useState(null)

  const candidates = useMemo(() => (found || []).filter((c) => !ref || c.id !== ref.id), [found, ref])
  const labelled = Object.values(labels).filter((v) => v && (!ref || v.candidate.id !== ref.id))
  const refMismatch = Boolean(ref) && !sameSearch(searched, refQuery)
  // Changing the reference makes the labels meaningless: ask first when there are some.
  const withLabelsGone = (action) => {
    if (!labelled.length) return action()
    Alert.alert('Cambiare riferimento?', `Le ${labelled.length} etichette non salvate andranno perse. Salvale prima, se erano giuste.`, [
      { text: 'Annulla', style: 'cancel' },
      { text: 'Cambia', style: 'destructive', onPress: action },
    ])
  }
  const pickRef = (r) => {
    setRef(r)
    setRefQuery(searched)
    setLabels({})
  }
  // The analysed listing belongs to its own search: on another search the mismatch question still comes up.
  const pickAnalysed = () => withLabelsGone(() => {
    setRef(reference)
    setRefQuery(initialQuery)
    setLabels({})
  })
  const dropRef = () => withLabelsGone(() => {
    setRef(null)
    setLabels({})
  })

  const leave = () => {
    if (!labelled.length) return onClose()
    Alert.alert('Uscire?', 'Le etichette non salvate andranno perse.', [
      { text: 'Annulla', style: 'cancel' },
      { text: 'Esci', style: 'destructive', onPress: onClose },
    ])
  }
  // Android back: from the labels to the search, then back inside the page, then out (asking if labels would be lost).
  // Back to the page whose results were read (the WebView remounts on `url`, which in-page navigation does not change).
  const backToSearch = () => {
    if (parsedUrl) setUrl(parsedUrl)
    setPhase('browse')
  }
  const onBack = () => {
    if (phase === 'label') backToSearch()
    else if (nav.canGoBack && webRef.current) webRef.current.goBack()
    else leave()
  }
  const takeResults = () => {
    // Filters and pages changed inside Vinted's page do not load a new document: load that search to read it.
    if (nav.url && isCatalogUrl(nav.url) && searchKey(nav.url) !== searchKey(parsedUrl)) {
      setFound(null)
      setPendingLabel(true)
      setUrl(nav.url)
      setLoadKey((k) => k + 1)
      return
    }
    setPhase('label')
  }

  const search = () => {
    const q = query.trim()
    if (!q) return
    setFound(null)
    setChallenge(false)
    setPendingLabel(false)
    setSavedNote(null)
    setPhase('browse')
    setSearched(q)
    setUrl(vintedSearchUrl(q))
    setLoadKey((k) => k + 1)
  }

  const onMessage = (event) => {
    let msg
    try {
      msg = JSON.parse(event.nativeEvent.data)
    } catch {
      return
    }
    // Only Vinted's own search pages are read (any frame can post: ads and other sites are ignored).
    if (!isVintedHost(hostOf(event.nativeEvent.url))) return
    if (msg && msg.type === 'catalog' && typeof msg.text === 'string' && isCatalogUrl(String(msg.url || ''))) {
      const { items } = parseVintedCatalog(msg.text)
      setFound(items)
      setParsedUrl(msg.url)
      // The analysed listing has no size: fill its missing fields from its own entry as soon as it shows up.
      setRef((r) => {
        const own = r && items.find((c) => c.id === r.id)
        return own ? Object.fromEntries(Object.keys({ ...own, ...r }).map((k) => [k, r[k] ?? own[k] ?? null])) : r
      })
      // What was really loaded decides: a page without words never inherits the previous search.
      setSearched(searchTextOf(msg.url) || browseKey(msg.url))
      setChallenge(false)
      if (pendingLabel) {
        setPendingLabel(false)
        if (items.length) setPhase('label')
      }
    } else if (msg && msg.type === 'state') setChallenge(Boolean(msg.challenge))
  }

  const save = async () => {
    const now = new Date().toISOString()
    // The analysed listing has no size: take the missing fields from its own entry in the results, when it is there.
    const own = (found || []).find((c) => c.id === ref.id)
    const source = own ? Object.fromEntries(Object.keys({ ...own, ...ref }).map((k) => [k, ref[k] ?? own[k] ?? null])) : ref
    const pairs = labelled.map(({ label, candidate }) => ({ id: `${ref.id || ref.url || 'ref'}~${candidate.id}`, source, candidate, label, labelledAt: now, query: refQuery }))
    setLabels({})
    const total = await onSave(pairs)
    setSavedNote(`${pairs.length} ${pairs.length === 1 ? 'coppia salvata' : 'coppie salvate'}${total ? ` (totale ${total})` : ''}. Puoi fare un'altra ricerca qui sopra, con il suo riferimento.`)
  }
  const confirmRef = () => setRefQuery(searched)

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onBack} statusBarTranslucent>
      <View style={[styles.sheet, { backgroundColor: t.bg, paddingTop: insets.top || 24, paddingBottom: insets.bottom }]}>
        <View style={[styles.header, { borderBottomColor: t.line, backgroundColor: t.card }]}>
          <Title>Raccogli coppie</Title>
          <View style={styles.searchRow}>
            <TextInput value={query} onChangeText={setQuery} onSubmitEditing={search} placeholder="Cosa cerchi su Vinted?" placeholderTextColor={t.ink3} returnKeyType="search" autoCorrect={false} style={[styles.input, { color: t.ink, borderColor: t.line, backgroundColor: t.bg }]} />
            <Button label="Cerca" small onPress={search} disabled={!query.trim()} />
          </View>
          {phase === 'browse' ? (
            <Body muted small>Leggo i risultati della ricerca caricata, solo nel telefono. Se cambi filtri nella pagina, li ricarico quando tocchi «Usa questi risultati».</Body>
          ) : null}
          {savedNote ? <Note tone="good">{savedNote}</Note> : null}
        </View>

        {phase === 'browse' ? (
          <View style={{ flex: 1 }}>
            {url && Platform.OS !== 'web' ? (
              <WebView
                ref={webRef}
                key={loadKey}
                source={{ uri: url }}
                style={{ flex: 1 }}
                injectedJavaScript={CATALOG_PROBE}
                onLoadEnd={() => webRef.current && webRef.current.injectJavaScript(CATALOG_PROBE)}
                onMessage={onMessage}
                onNavigationStateChange={(s) => setNav({ url: s.url || null, canGoBack: Boolean(s.canGoBack) })}
                onShouldStartLoadWithRequest={(req) => allowNavigation(req.url || '')}
                originWhitelist={['https://*']}
                javaScriptEnabled
                domStorageEnabled
                thirdPartyCookiesEnabled
                setSupportMultipleWindows={false}
                mixedContentMode="never"
                allowFileAccess={false}
              />
            ) : (
              <View style={{ padding: space.lg }}><Note>{Platform.OS === 'web' ? 'La ricerca su Vinted funziona solo nell\'app Android.' : 'Scrivi cosa cerchi e tocca «Cerca».'}</Note></View>
            )}
            <View style={[styles.footer, { borderTopColor: t.line, backgroundColor: t.card }]}>
              {challenge ? <Body small>Vinted sta facendo un controllo anti-robot: se compare una casella, toccala.</Body> : null}
              <ButtonRow>
                <Button label="Chiudi" variant="secondary" onPress={leave} />
                <Button label={found ? `Usa questi risultati (${found.length})` : 'In attesa dei risultati…'} onPress={takeResults} disabled={!found || !found.length} />
              </ButtonRow>
            </View>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
              {ref ? (
                <View style={{ gap: space.xs }}>
                  <Text style={{ color: t.ink3, fontSize: 12, fontWeight: '700' }}>ANNUNCIO DI RIFERIMENTO</Text>
                  <ListingRow item={ref} highlight>
                    <Pressable onPress={dropRef}><Text style={{ color: t.accentInk, fontSize: 13, fontWeight: '700' }}>Cambia riferimento</Text></Pressable>
                  </ListingRow>
                  {refMismatch ? (
                    <View style={{ gap: space.xs }}>
                      <Note tone="warn">Stai guardando {searchLabel(searched)}, ma il riferimento è «{ref.title}». Confronti questi risultati con l'oggetto giusto?{labelled.length ? ` Le ${labelled.length} etichette già fatte con questo riferimento puoi salvarle subito.` : ''}</Note>
                      <ButtonRow>
                        <Button label="Sì, con questo" small onPress={confirmRef} />
                        <Button label="Scegli tra i risultati" variant="secondary" small onPress={dropRef} />
                      </ButtonRow>
                    </View>
                  ) : null}
                </View>
              ) : (
                <View style={{ gap: space.xs }}>
                  <Note tone="warn">Tocca «Riferimento» sull'annuncio che vorresti comprare: gli altri li confronti con quello.</Note>
                  {reference ? <Pressable onPress={pickAnalysed}><Text style={{ color: t.accentInk, fontSize: 13, fontWeight: '700' }}>Usa l'annuncio analizzato: {reference.title}</Text></Pressable> : null}
                </View>
              )}
              {ref && !refMismatch ? <Body small muted>Per ogni annuncio, rispetto al riferimento qui sopra: Stesso (lo stesso articolo), Variante (stesso modello ma colore, taglia, capacità o edizione diversi) o Diverso. Etichetta anche quelli diversi: servono a misurare i falsi «stesso».</Body> : null}
              {candidates.map((c) => (
                <ListingRow key={c.id} item={c}>
                  <View style={styles.labelRow}>
                    {!ref ? (
                      <Chip t={t} label="Riferimento" active={false} onPress={() => pickRef(c)} />
                    ) : refMismatch ? null : PAIR_LABELS.map((l) => (
                      <Chip key={l.id} t={t} label={l.label} active={Boolean(labels[c.id]) && labels[c.id].label === l.id} onPress={() => setLabels((s) => ({ ...s, [c.id]: s[c.id] && s[c.id].label === l.id ? null : { label: l.id, candidate: c } }))} />
                    ))}
                  </View>
                </ListingRow>
              ))}
            </ScrollView>
            <View style={[styles.footer, { borderTopColor: t.line, backgroundColor: t.card }]}>
              {ref ? <Text style={{ color: t.ink2, fontSize: 12 }} numberOfLines={1}>Confronti con: {ref.title}</Text> : null}
              <ButtonRow>
                <Button label="Torna alla ricerca" variant="secondary" onPress={backToSearch} />
                <Button label={labelled.length ? `Salva ${labelled.length} ${labelled.length === 1 ? 'coppia' : 'coppie'}` : 'Etichetta qualche annuncio'} onPress={save} disabled={!ref || !labelled.length} />
              </ButtonRow>
            </View>
          </View>
        )}
      </View>
    </Modal>
  )
}

function Chip({ t, label, active, onPress }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }} hitSlop={4} style={({ pressed }) => [styles.chip, { borderColor: active ? t.accent : t.line, backgroundColor: active ? t.accent : t.card, opacity: pressed ? 0.8 : 1 }]}>
      <Text style={{ color: active ? t.onAccent : t.ink, fontSize: 13, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { padding: space.lg, gap: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  searchRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  input: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 15 },
  footer: { padding: space.md, gap: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', gap: space.md, padding: space.sm, borderWidth: 1, borderRadius: radius.md },
  thumb: { width: 72, height: 96, borderRadius: 8 },
  labelRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },
  chip: { paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1 },
})
