import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react'
import { Linking, Platform, StyleSheet, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { PAY_WINDOW_MINUTES, VINTED_HOME, decideNavigation, isCheckoutUrl, isVintedUrl } from '../../services/vintedNav.js'
import { useTheme } from '../../theme.js'
import { Body, Card } from '../ui.js'

/**
 * Runs in every page: reports the address when it changes (Vinted moves between pages without reloading) and, on
 * request, an outline of the page for tuning (the elements Vinted itself labels, with a few characters of their text).
 * It only reads: nothing is clicked, typed or sent, and no function of the page is replaced.
 */
const WATCH = `(function () {
  if (window.__ovtWatch) return;
  window.__ovtWatch = true;
  var post = function (m) { try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {} };
  var last = '';
  var tick = function () {
    if (location.href !== last) { last = location.href; post({ type: 'nav', url: last, title: (document.title || '').slice(0, 80) }); }
  };
  tick();
  setInterval(tick, 600);
  window.__ovtOutline = function () {
    var out = [];
    var nodes = document.querySelectorAll('[data-testid]');
    for (var i = 0; i < nodes.length && out.length < 350; i++) {
      var n = nodes[i];
      var id = String(n.getAttribute('data-testid') || '').replace(/\\d{4,}/g, '{id}').slice(0, 70);
      var kids = n.querySelectorAll('[data-testid]').length;
      var text = kids ? '' : String(n.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40);
      out.push(n.tagName.toLowerCase() + ' ' + id + (text ? ' = ' + text : ''));
    }
    post({ type: 'outline', url: location.href, lines: out });
  };
})();
true;`

/**
 * The Vinted browser: one WebView that stays on Vinted (services/vintedNav.js decides), keeps the session between
 * launches like any browser, and reports where the user is. Imperative API: goBack(), canGoBack(), reload(), home(),
 * outline() (asks the page for its outline, answered through `onOutline`).
 */
export const VintedBrowser = forwardRef(function VintedBrowser({ onPage, onBlocked, onOutline, onLoading }, ref) {
  const t = useTheme()
  const webRef = useRef(null)
  const backRef = useRef(false)
  const payUntilRef = useRef(0)
  const lastGoodRef = useRef(VINTED_HOME)
  const [progress, setProgress] = useState(0)

  useImperativeHandle(ref, () => ({
    canGoBack: () => backRef.current,
    goBack: () => { if (webRef.current) webRef.current.goBack() },
    reload: () => { if (webRef.current) webRef.current.reload() },
    home: () => { if (webRef.current) webRef.current.injectJavaScript(`location.href = ${JSON.stringify(VINTED_HOME)}; true;`) },
    open: (url) => { if (webRef.current && isVintedUrl(url)) webRef.current.injectJavaScript(`location.href = ${JSON.stringify(url)}; true;`) },
    outline: () => { if (webRef.current) webRef.current.injectJavaScript('window.__ovtOutline && window.__ovtOutline(); true;') },
  }), [])

  const seen = useCallback((url) => {
    if (!url) return
    if (isCheckoutUrl(url)) payUntilRef.current = Date.now() + PAY_WINDOW_MINUTES * 60_000
    if (isVintedUrl(url)) lastGoodRef.current = url
    if (onPage) onPage(url)
  }, [onPage])

  const shouldStart = useCallback((req) => {
    // Frames inside a page (payment fields, consent, sign-in widgets) are the page's own business: only the page itself is ruled.
    if (req && req.isTopFrame === false) return true
    const url = (req && req.url) || ''
    const verdict = decideNavigation(url, { payUntil: payUntilRef.current })
    if (verdict === 'allow') return true
    if (verdict === 'external') {
      Linking.openURL(url).catch(() => {})
      return false
    }
    if (onBlocked) onBlocked(url)
    return false
  }, [onBlocked])

  const onMessage = useCallback((event) => {
    let msg
    try {
      msg = JSON.parse(event.nativeEvent.data)
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return
    if (msg.type === 'nav' && typeof msg.url === 'string') seen(msg.url)
    else if (msg.type === 'outline' && onOutline) onOutline({ url: msg.url, lines: Array.isArray(msg.lines) ? msg.lines : [] })
  }, [seen, onOutline])

  if (Platform.OS === 'web') {
    return <View style={styles.fill}><Card><Body>Il browser di Vinted funziona solo nell'app Android.</Body></Card></View>
  }
  return (
    <View style={styles.fill}>
      {progress > 0 && progress < 1 ? <View style={[styles.progress, { backgroundColor: t.accent, width: `${Math.round(progress * 100)}%` }]} /> : null}
      <WebView
        ref={webRef}
        source={{ uri: VINTED_HOME }}
        style={styles.fill}
        originWhitelist={['*']}
        onShouldStartLoadWithRequest={shouldStart}
        onNavigationStateChange={(nav) => {
          backRef.current = Boolean(nav.canGoBack)
          if (nav.url && /^https?:/i.test(nav.url)) seen(nav.url)
        }}
        onLoadProgress={(e) => {
          const p = e.nativeEvent.progress
          setProgress(p)
          if (onLoading) onLoading(p < 1)
        }}
        onMessage={onMessage}
        injectedJavaScript={WATCH}
        injectedJavaScriptBeforeContentLoaded={WATCH}
        javaScriptEnabled
        domStorageEnabled
        thirdPartyCookiesEnabled
        sharedCookiesEnabled
        cacheEnabled
        incognito={false}
        setSupportMultipleWindows={false}
        pullToRefreshEnabled
        allowsBackForwardNavigationGestures
        mediaPlaybackRequiresUserAction
        overScrollMode="never"
        textZoom={100}
      />
    </View>
  )
})

const styles = StyleSheet.create({
  fill: { flex: 1 },
  progress: { position: 'absolute', top: 0, left: 0, height: 2, zIndex: 2 },
})
