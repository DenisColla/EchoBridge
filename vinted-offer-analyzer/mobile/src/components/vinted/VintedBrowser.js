import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react'
import { Linking, Platform, StyleSheet, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { PAY_WINDOW_MINUTES, SIGNIN_WINDOW_MINUTES, VINTED_HOME, decideNavigation, isCheckoutUrl, isGoogleSignInUrl, isVintedUrl } from '../../services/vintedNav.js'
import { useTheme } from '../../theme.js'
import { Body, Card } from '../ui.js'

/**
 * Runs in every page: reports the address when it changes (Vinted moves between pages without reloading) and, on
 * request, an outline of the page for tuning: the elements Vinted itself labels, with a few characters of their text,
 * and the fields and buttons with their attributes (never what is typed in them). On a conversation page of Vinted
 * it also reports the offers shown (the user's requests and the seller's own offers: price, crossed price, status,
 * whether it can still be bought) with the listing they are about, and the rows of
 * the conversation list (who, last message): this is how an offer made on Vinted reaches the list by itself.
 * It only reads: nothing is clicked, typed or sent, and no function of the page is replaced.
 */
const WATCH = `(function () {
  if (window.__ovtWatch) return;
  window.__ovtWatch = true;
  var post = function (m) { try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {} };
  var last = '';
  var onVinted = /(^|\\.)vinted\\.[a-z]{2,3}(\\.[a-z]{2})?$/.test(location.hostname);
  var q = function (id, root) { return (root || document).querySelector('[data-testid="' + id + '"]'); };
  var txt = function (n, max) { return n ? String(n.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, max || 80) : ''; };
  // A buyer's request (offer-request-*) and a seller's own offer (offer-*), in the order of the page.
  var PRICE = '[data-testid="offer-request-current-price-label"], [data-testid="offer-current-price-label"]';
  var readConv = function () {
    var m = location.pathname.match(/\\/inbox\\/([0-9a-zA-Z][0-9a-zA-Z-]+)/);
    if (!m) return null;
    var hero = q('hero-message');
    var link = '';
    if (hero) {
      var a = hero.getAttribute('href') ? hero : (hero.closest && hero.closest('a[href]')) || hero.querySelector('a[href*="/items/"]');
      link = a ? a.getAttribute('href') || '' : '';
    }
    var offers = [];
    var labels = document.querySelectorAll(PRICE);
    for (var i = 0; i < labels.length && offers.length < 12; i++) {
      var request = labels[i].getAttribute('data-testid') === 'offer-request-current-price-label';
      // The offer's own box: the nearest ancestor that holds its status or its button, and no other offer.
      var box = labels[i];
      for (var up = 0; up < 8 && box.parentElement; up++) {
        if (box.parentElement.querySelectorAll(PRICE).length > 1) break;
        box = box.parentElement;
        if (q('offer-status-title', box) || q('offer-message-buy-button', box)) break;
      }
      var buttons = [];
      var bs = box.querySelectorAll('button');
      for (var b = 0; b < bs.length && buttons.length < 4; b++) { var bt = txt(bs[b], 30); if (bt) buttons.push(bt); }
      offers.push({
        kind: request ? 'request' : 'offer', price: txt(labels[i], 20),
        original: txt(q(request ? 'offer-request-original-price-label' : 'offer-original-price-label', box), 20),
        status: txt(q('offer-status-title', box), 40), buy: !!q('offer-message-buy-button', box), buttons: buttons
      });
    }
    // What Vinted says of the deal in the conversation itself (the list of the other conversations is left out).
    var area = q('inbox-page-container') || document.body;
    var said = String(area.textContent || '');
    var list = q('conversation-list');
    if (list && area.contains(list)) said = said.replace(String(list.textContent || ''), ' ');
    return {
      id: m[1], link: link, title: txt(q('hero-message--title'), 80), price: txt(q('hero-message-price'), 20), seller: txt(q('inbox-list-item-' + m[1] + '--title'), 60),
      canOffer: !!q('make-offer-request-button'), offers: offers,
      purchased: /acquisto andato a buon fine/i.test(said), unavailable: /articolo non disponibile|venduto o cancellato/i.test(said)
    };
  };
  var readRows = function () {
    var nodes = document.querySelectorAll('[data-testid^="inbox-list-item-"][data-testid$="--title"]');
    var rows = [];
    for (var i = 0; i < nodes.length && rows.length < 40; i++) {
      var id = String(nodes[i].getAttribute('data-testid')).slice(16, -7);
      var root = q('inbox-list-item-' + id + '-container') || q('inbox-list-item-' + id);
      rows.push({ id: id, seller: txt(nodes[i], 60), text: txt(root ? q('inbox-list-item-description', root) : null, 160) });
    }
    return rows;
  };
  var lastConv = '';
  var lastRows = '';
  var beat = 0;
  var tick = function () {
    if (location.href !== last) { last = location.href; post({ type: 'nav', url: last, title: (document.title || '').slice(0, 80) }); }
    if (!onVinted || (++beat % 2)) return;
    try {
      var c = readConv();
      var cs = c ? JSON.stringify(c) : '';
      if (cs !== lastConv) { lastConv = cs; if (c) post({ type: 'conv', url: location.href, conv: c }); }
      var rows = readRows();
      var rs = rows.length ? JSON.stringify(rows) : '';
      if (rs !== lastRows) { lastRows = rs; if (rows.length) post({ type: 'inbox', rows: rows }); }
    } catch (e) {}
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
    var ctl = [];
    var cs = document.querySelectorAll('input, textarea, select, button, form, [role="dialog"], [contenteditable="true"]');
    var attrs = ['type', 'name', 'inputmode', 'placeholder', 'aria-label', 'role', 'data-testid', 'autocomplete'];
    for (var j = 0; j < cs.length && ctl.length < 120; j++) {
      var c = cs[j];
      if (c.tagName === 'INPUT' && c.type === 'hidden') continue;
      if (c.closest && c.closest('[id^="onetrust"], [id^="ot-sdk"]')) continue;
      var bits = [c.tagName.toLowerCase()];
      for (var k = 0; k < attrs.length; k++) {
        var v = c.getAttribute(attrs[k]);
        if (v) bits.push(attrs[k] + '=' + String(v).replace(/\\d{4,}/g, '{id}').slice(0, 50));
      }
      if (c.tagName === 'BUTTON') {
        var bt = String(c.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 30);
        if (bt) bits.push('testo=' + bt);
      }
      ctl.push(bits.join(' '));
    }
    post({ type: 'outline', url: location.href, lines: out, controls: ctl });
  };
})();
true;`

/**
 * The Vinted browser: one WebView that stays on Vinted (services/vintedNav.js decides), keeps the session between
 * launches like any browser, and reports where the user is. `onConversation({ url, conv })` and `onInbox(rows)` carry
 * what a conversation page shows (services/vintedConversation.js reads them). Imperative API: goBack(), canGoBack(),
 * reload(), home(), outline() (asks the page for its outline, answered through `onOutline`).
 */
export const VintedBrowser = forwardRef(function VintedBrowser({ onPage, onBlocked, onOutline, onLoading, onConversation, onInbox }, ref) {
  const t = useTheme()
  const webRef = useRef(null)
  const backRef = useRef(false)
  const payUntilRef = useRef(0)
  const signInUntilRef = useRef(0)
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
    if (isGoogleSignInUrl(url)) signInUntilRef.current = Date.now() + SIGNIN_WINDOW_MINUTES * 60_000
    if (isVintedUrl(url)) lastGoodRef.current = url
    if (onPage) onPage(url)
  }, [onPage])

  const shouldStart = useCallback((req) => {
    // Frames inside a page (payment fields, consent, sign-in widgets) are the page's own business: only the page itself is ruled.
    if (req && req.isTopFrame === false) return true
    const url = (req && req.url) || ''
    // Asked before the page loads: the window must be open for the hop that follows a sign-in page at once.
    if (isGoogleSignInUrl(url)) signInUntilRef.current = Date.now() + SIGNIN_WINDOW_MINUTES * 60_000
    const verdict = decideNavigation(url, { payUntil: payUntilRef.current, signInUntil: signInUntilRef.current })
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
    const at = String((event.nativeEvent && event.nativeEvent.url) || msg.url || '')
    if (msg.type === 'nav' && typeof msg.url === 'string') seen(msg.url)
    else if (msg.type === 'outline' && onOutline) onOutline({ url: msg.url, lines: Array.isArray(msg.lines) ? msg.lines : [], controls: Array.isArray(msg.controls) ? msg.controls : [] })
    // What a page says about offers counts only when the page shown is Vinted's (the address comes from the WebView, not from the page).
    // (the WebView's address lags on Vinted, which moves between pages without loading: the page's own is the one kept)
    else if (msg.type === 'conv' && onConversation && msg.conv && typeof msg.conv === 'object' && isVintedUrl(at) && isVintedUrl(msg.url)) onConversation({ url: msg.url, conv: msg.conv })
    else if (msg.type === 'inbox' && onInbox && Array.isArray(msg.rows) && isVintedUrl(at)) onInbox(msg.rows)
  }, [seen, onOutline, onConversation, onInbox])

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
