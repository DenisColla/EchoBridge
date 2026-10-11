import { useMemo, useRef, useState } from 'react'
import { Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
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

const ALLOWED = /^(https?:|about:|data:|blob:)/i
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
 * «Raccogli coppie»: the user searches Vinted in a VISIBLE in-app browser (read only when they tap «Usa questi
 * risultati»), picks or keeps the reference listing and labels candidates with one tap. Returns labelled pairs.
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
  const [labels, setLabels] = useState({})
  const [loadKey, setLoadKey] = useState(0)

  const candidates = useMemo(() => (found || []).filter((c) => !ref || c.id !== ref.id), [found, ref])
  const labelled = Object.entries(labels).filter(([, v]) => v)

  const search = () => {
    const q = query.trim()
    if (!q) return
    setFound(null)
    setChallenge(false)
    setPhase('browse')
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
    if (msg && msg.type === 'catalog' && typeof msg.text === 'string') {
      const { items } = parseVintedCatalog(msg.text)
      setFound(items)
      setChallenge(false)
    } else if (msg && msg.type === 'state') setChallenge(Boolean(msg.challenge))
  }

  const save = () => {
    const now = new Date().toISOString()
    const pairs = labelled.map(([id, label]) => {
      const candidate = candidates.find((c) => c.id === id)
      return candidate ? { id: `${ref.id || ref.url || 'ref'}~${candidate.id}`, source: ref, candidate, label, labelledAt: now, query: query.trim() } : null
    }).filter(Boolean)
    onSave(pairs)
    setLabels({})
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.sheet, { backgroundColor: t.bg, paddingTop: insets.top || 24, paddingBottom: insets.bottom }]}>
        <View style={[styles.header, { borderBottomColor: t.line, backgroundColor: t.card }]}>
          <Title>Raccogli coppie</Title>
          <View style={styles.searchRow}>
            <TextInput value={query} onChangeText={setQuery} onSubmitEditing={search} placeholder="Cosa cerchi su Vinted?" placeholderTextColor={t.ink3} returnKeyType="search" autoCorrect={false} style={[styles.input, { color: t.ink, borderColor: t.line, backgroundColor: t.bg }]} />
            <Button label="Cerca" small onPress={search} disabled={!query.trim()} />
          </View>
          {phase === 'browse' ? (
            <Body muted small>Scorri pure la pagina: leggo i risultati solo quando tocchi «Usa questi risultati». Per una nuova ricerca usa il campo qui sopra.</Body>
          ) : null}
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
                onShouldStartLoadWithRequest={(req) => ALLOWED.test(req.url || '')}
                originWhitelist={['https://*', 'http://*']}
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
                <Button label="Chiudi" variant="secondary" onPress={onClose} />
                <Button label={found ? `Usa questi risultati (${found.length})` : 'In attesa dei risultati…'} onPress={() => setPhase('label')} disabled={!found || !found.length} />
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
                    {!reference ? <Pressable onPress={() => { setRef(null); setLabels({}) }}><Text style={{ color: t.accentInk, fontSize: 13, fontWeight: '700' }}>Cambia riferimento</Text></Pressable> : null}
                  </ListingRow>
                </View>
              ) : (
                <Note tone="warn">Tocca «Riferimento» sull'annuncio che vorresti comprare: gli altri li confronti con quello.</Note>
              )}
              {ref ? <Body small muted>Per ogni candidato: Stesso, Variante (stesso modello ma colore, taglia o edizione diversi) o Diverso. Etichetta anche quelli diversi: servono a misurare i falsi «stesso».</Body> : null}
              {candidates.map((c) => (
                <ListingRow key={c.id} item={c}>
                  <View style={styles.labelRow}>
                    {!ref ? (
                      <Chip t={t} label="Riferimento" active={false} onPress={() => setRef(c)} />
                    ) : PAIR_LABELS.map((l) => (
                      <Chip key={l.id} t={t} label={l.label} active={labels[c.id] === l.id} onPress={() => setLabels((s) => ({ ...s, [c.id]: s[c.id] === l.id ? null : l.id }))} />
                    ))}
                  </View>
                </ListingRow>
              ))}
            </ScrollView>
            <View style={[styles.footer, { borderTopColor: t.line, backgroundColor: t.card }]}>
              <ButtonRow>
                <Button label="Torna alla ricerca" variant="secondary" onPress={() => setPhase('browse')} />
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
