import { useMemo, useRef, useState } from 'react'
import { Alert, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'
import { CHANNELS, CHANNEL_IDS, parseSubitoSearch, parseWallapopSearch, readVinted } from '../../../core/index.js'
import { radius, space, useTheme } from '../../theme.js'
import { Body, Button, ButtonRow, Note } from '../ui.js'
import { shareDiagnostic } from '../../services/searchStore.js'

/*
 * The three search pages, one after the other, in a VISIBLE browser. The app reads only the page the user is looking
 * at, once it has loaded: Vinted's flight data, Subito's __NEXT_DATA__, and on Wallapop the search JSON the page itself
 * downloads while the user scrolls. No login, no background requests, no automated clicks.
 */

const VINTED_PROBE = `(function () {
  if (window.__ovtRead) return; window.__ovtRead = true;
  var post = function (m) { try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {} };
  var waited = 0, n = 0;
  var tick = function () {
    var ready = document.readyState !== 'loading';
    var challenge = !!(window._cf_chl_opt || document.querySelector('iframe[src*="challenges.cloudflare.com"]'));
    var parts = [];
    if (ready) { var s = document.querySelectorAll('script'); for (var i = 0; i < s.length; i++) { var t = s[i].textContent || ''; if (t.indexOf('self.__next_f.push') >= 0) parts.push(t); } }
    var joined = parts.join('\\n');
    if (ready && joined.indexOf('productItem') >= 0) { post({ type: 'page', channel: 'vinted', url: location.href, text: joined }); return; }
    // No results, or a page the reader does not know: after ~12 s on a loaded page, report it (0 read + diagnosis).
    if (ready && !challenge && ++waited >= 15) { post({ type: 'page', channel: 'vinted', url: location.href, text: joined || document.documentElement.outerHTML.slice(0, 2500000) }); return; }
    post({ type: 'state', channel: 'vinted', url: location.href, ready: ready, challenge: challenge });
    if (++n < 150) setTimeout(tick, 800);
  };
  tick();
})();
true;`

const SUBITO_PROBE = `(function () {
  if (window.__ovtRead) return; window.__ovtRead = true;
  var post = function (m) { try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {} };
  var waited = 0, n = 0;
  var tick = function () {
    var el = document.getElementById('__NEXT_DATA__');
    if (el && el.textContent) { post({ type: 'page', channel: 'subito', url: location.href, text: el.textContent }); return; }
    var ready = document.readyState !== 'loading';
    var challenge = !!document.querySelector('iframe[src*="captcha-delivery.com"]');
    // A loaded page without the data the reader expects: report it after ~12 s (0 read + diagnosis).
    if (ready && !challenge && ++waited >= 15) { post({ type: 'page', channel: 'subito', url: location.href, text: document.documentElement.outerHTML.slice(0, 2500000) }); return; }
    post({ type: 'state', channel: 'subito', url: location.href, ready: ready, challenge: challenge });
    if (++n < 150) setTimeout(tick, 800);
  };
  tick();
})();
true;`

// Before the page's own scripts: observe the search JSON that Wallapop's page requests (XHR and fetch), read-only.
const WALLAPOP_BEFORE = `(function () {
  if (window.__ovtWp) return; window.__ovtWp = true;
  var re = /\\/api\\/v3\\/search(\\/section)?\\?/; var skip = /searchalerts|filters|components/;
  var post = function (u, t) { try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'json', channel: 'wallapop', url: location.href, api: String(u), text: t })); } catch (e) {} };
  var want = function (u) { u = String(u || ''); return re.test(u) && !skip.test(u); };
  try {
    var open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) { this.__ovtUrl = u; return open.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function () { var x = this; try { x.addEventListener('load', function () { if (want(x.__ovtUrl)) { try { post(x.__ovtUrl, x.responseText); } catch (e) {} } }); } catch (e) {} return send.apply(this, arguments); };
  } catch (e) {}
  try {
    if (window.fetch) { var f = window.fetch; window.fetch = function (input) { var u = typeof input === 'string' ? input : (input && input.url) || ''; return f.apply(this, arguments).then(function (res) { try { if (want(u)) res.clone().text().then(function (t) { post(u, t); }); } catch (e) {} return res; }); }; }
  } catch (e) {}
})();
true;`

const HOSTS = {
  vinted: (h) => h === 'vinted.it' || h.endsWith('.vinted.it') || h === 'challenges.cloudflare.com',
  subito: (h) => ((h === 'subito.it' || h.endsWith('.subito.it')) && h !== 'areariservata.subito.it') || h === 'captcha-delivery.com' || h.endsWith('.captcha-delivery.com'),
  wallapop: (h) => h === 'wallapop.com' || h.endsWith('.wallapop.com'),
}
/** Pages whose messages are read: the channel's own site only (never the anti-robot check frames). */
const OWN = {
  vinted: (h) => h === 'vinted.it' || h.endsWith('.vinted.it'),
  subito: (h) => (h === 'subito.it' || h.endsWith('.subito.it')) && h !== 'areariservata.subito.it',
  wallapop: (h) => h === 'wallapop.com' || h.endsWith('.wallapop.com'),
}
const NO_LOGIN = /^https:\/\/[^/]+\/(member\/(general\/)?(login|signup|register)|oauth|auth|login|app|areariservata)(\/|\?|$)/i
const SEARCH_PAGE = {
  vinted: (u) => /^https:\/\/[^/]+\/catalog(\?|\/|$)/i.test(u),
  subito: (u) => /^https:\/\/[^/]*subito\.it\/annunci-/i.test(u),
  wallapop: (u) => /^https:\/\/[^/]*wallapop\.com\/search(\?|\/|$)/i.test(u),
}
const hostOf = (u) => {
  try {
    return new URL(u).hostname.toLowerCase()
  } catch {
    return ''
  }
}
const allowNavigation = (channel, url) => {
  if (url === 'about:blank') return true
  if (!/^https:\/\//i.test(url || '')) return false
  return HOSTS[channel](hostOf(url)) && !NO_LOGIN.test(url)
}

/**
 * Props: `search` (useSearch), `onClose`, `onDone` (analysis requested). Channels can be skipped; each one shows how
 * many listings were read from it.
 */
export function ChannelSweep({ search, onClose, onDone }) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const webRef = useRef(null)
  const run = search.run
  const [index, setIndex] = useState(0)
  const [loadKey, setLoadKey] = useState(0)
  const [nav, setNav] = useState({ canGoBack: false })
  const [challenge, setChallenge] = useState(false)
  const channel = CHANNEL_IDS[index]
  const [draft, setDraft] = useState(run ? run.queries[channel] : '')
  // Recomputed only when the user moves or searches: a product card arriving meanwhile never reloads the page.
  const url = useMemo(() => search.searchUrlFor(channel), [channel, loadKey]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!run) return null
  const read = run.channels[channel]
  const totalRead = CHANNEL_IDS.reduce((n, id) => n + run.channels[id].items.length, 0)

  const goTo = (i) => {
    setIndex(i)
    setDraft(run.queries[CHANNEL_IDS[i]] || run.product.query)
    setChallenge(false)
    setLoadKey((k) => k + 1)
  }
  const searchAgain = () => {
    if (!draft.trim()) return
    search.setQuery(channel, draft.trim())
    // A new query replaces what this channel read before (Wallapop would otherwise add to the old results).
    search.resetChannel(channel)
    setChallenge(false)
    setTimeout(() => setLoadKey((k) => k + 1), 0)
  }
  const leave = () => {
    if (!totalRead) return onClose()
    Alert.alert('Uscire dalla ricerca?', 'Gli annunci letti restano: puoi analizzarli dalla schermata della ricerca.', [
      { text: 'Annulla', style: 'cancel' },
      { text: 'Esci', onPress: onClose },
    ])
  }
  const onBack = () => {
    if (nav.canGoBack && webRef.current) webRef.current.goBack()
    else leave()
  }

  const onMessage = (event) => {
    if (!OWN[channel](hostOf(event.nativeEvent.url))) return
    let msg
    try {
      msg = JSON.parse(event.nativeEvent.data)
    } catch {
      return
    }
    if (!msg || msg.channel !== channel) return
    if (msg.type === 'state') {
      setChallenge(Boolean(msg.challenge))
      return
    }
    if (typeof msg.text !== 'string' || !SEARCH_PAGE[channel](String(msg.url || ''))) return
    setChallenge(false)
    if (channel === 'vinted' && msg.type === 'page') search.setChannelResults('vinted', readVinted(msg.text), msg.text, url)
    else if (channel === 'subito' && msg.type === 'page') search.setChannelResults('subito', parseSubitoSearch(msg.text).items, msg.text, url)
    else if (channel === 'wallapop' && msg.type === 'json') {
      const { items } = parseWallapopSearch(msg.text)
      if (items.length) search.addChannelResults('wallapop', items, url)
      else if (!read.items.length || read.from !== url) search.setChannelResults('wallapop', [], msg.text, url)
    }
  }

  const last = index === CHANNEL_IDS.length - 1
  const isWeb = Platform.OS === 'web'
  return (
    <Modal visible animationType="slide" onRequestClose={onBack} statusBarTranslucent>
      <View style={[styles.sheet, { backgroundColor: t.bg, paddingTop: insets.top || 24, paddingBottom: insets.bottom }]}>
        <View style={[styles.header, { borderBottomColor: t.line, backgroundColor: t.card }]}>
          <View style={styles.tabs}>
            {CHANNEL_IDS.map((id, i) => (
              <Pressable key={id} onPress={() => goTo(i)} style={[styles.tab, { borderColor: i === index ? t.accent : t.line, backgroundColor: i === index ? t.accent : t.card }]} accessibilityRole="tab" accessibilityState={{ selected: i === index }}>
                <Text style={{ color: i === index ? t.onAccent : t.ink, fontWeight: '700', fontSize: 13 }}>{CHANNELS[id].label}{run.channels[id].read ? ` · ${run.channels[id].items.length}` : ''}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.searchRow}>
            <TextInput value={draft} onChangeText={setDraft} onSubmitEditing={searchAgain} placeholder="Cosa cerchi?" placeholderTextColor={t.ink3} returnKeyType="search" autoCorrect={false} style={[styles.input, { color: t.ink, borderColor: t.line, backgroundColor: t.bg }]} />
            <Button label="Cerca" small onPress={searchAgain} disabled={!draft.trim()} />
          </View>
          <Body muted small>Leggo gli annunci della pagina che vedi, solo nel telefono. {channel === 'wallapop' ? 'Su Wallapop scorri per caricarne altri.' : 'Puoi scorrere e aprire gli annunci.'}</Body>
        </View>
        <View style={{ flex: 1 }}>
          {isWeb ? (
            <View style={{ padding: space.lg }}><Note>La ricerca nei siti funziona solo nell'app Android.</Note></View>
          ) : (
            <WebView
              ref={webRef}
              key={`${channel}-${loadKey}`}
              source={{ uri: url }}
              style={{ flex: 1 }}
              injectedJavaScriptBeforeContentLoaded={channel === 'wallapop' ? WALLAPOP_BEFORE : undefined}
              injectedJavaScript={channel === 'vinted' ? VINTED_PROBE : channel === 'subito' ? SUBITO_PROBE : undefined}
              onLoadEnd={() => { if (webRef.current && channel !== 'wallapop') webRef.current.injectJavaScript(channel === 'vinted' ? VINTED_PROBE : SUBITO_PROBE) }}
              onMessage={onMessage}
              onNavigationStateChange={(s) => setNav({ canGoBack: Boolean(s.canGoBack) })}
              onShouldStartLoadWithRequest={(req) => allowNavigation(channel, req.url || '')}
              originWhitelist={['*']}
              javaScriptEnabled
              domStorageEnabled
              thirdPartyCookiesEnabled
              setSupportMultipleWindows={false}
              mixedContentMode="never"
              allowFileAccess={false}
            />
          )}
        </View>
        <View style={[styles.footer, { borderTopColor: t.line, backgroundColor: t.card }]}>
          {challenge ? <Body small>Il sito sta facendo un controllo anti-robot: se compare una casella, toccala.</Body> : null}
          {read.read && !read.items.length ? (
            <View style={{ gap: space.xs }}>
              <Note tone="warn">Nessun annuncio letto da {CHANNELS[channel].label}. {channel === 'wallapop' ? 'Prova a scorrere o a cambiare le parole.' : 'Prova a cambiare le parole.'}</Note>
              {read.raw ? <Button label="Invia la pagina per diagnosi" variant="ghost" small onPress={() => shareDiagnostic(channel, read.raw)} /> : null}
            </View>
          ) : null}
          <ButtonRow>
            <Button label="Chiudi" variant="secondary" onPress={leave} />
            {last
              ? <Button label={`Analizza ${totalRead} annunci`} onPress={onDone} disabled={!totalRead} />
              : <Button label={read.read ? `Avanti (${read.items.length} letti)` : 'Salta'} onPress={() => goTo(index + 1)} />}
          </ButtonRow>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { padding: space.md, gap: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  tabs: { flexDirection: 'row', gap: space.xs },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1 },
  searchRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  input: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 15 },
  footer: { padding: space.md, gap: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
})
