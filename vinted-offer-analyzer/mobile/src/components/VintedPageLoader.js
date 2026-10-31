import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { BackHandler, Keyboard, Platform, StatusBar, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'
import { space, useTheme } from '../theme.js'
import { Body, Button, Title } from './ui.js'

/** Silent attempt: Cloudflare's automatic check usually passes in 2–6 s on a phone. */
const HIDDEN_MS = 14_000
/** A slow connection that is still loading the page (not a challenge) gets this much in total before giving up. */
const LOADING_MS = 30_000
/** Time the user has to complete a visible check (a checkbox, rarely a puzzle). */
const VISIBLE_MS = 120_000
/** A complete page that is neither a challenge nor a listing (removed item, new layout) is reported after this. */
const NO_DATA_MS = 4_000
/** Larger pages are cut: the listing data sits in the first few megabytes. */
const MAX_HTML_CHARS = 6_000_000
/**
 * The probe is re-injected this often while a page is open. Android runs injectedJavaScript only at onPageFinished,
 * which waits for every image and tracker of the listing; a periodic injection starts reading as soon as the HTML is
 * parsed. The probe guards itself, so each document runs it once.
 */
const REINJECT_MS = 1_000
/**
 * Once the listing is in the document, the probe waits this long for the hydrated details (views, interested buyers,
 * the attributes list), which React renders after the server HTML. Spec §3.1: at most 1,5 s, then the page is sent as is.
 */
const ATTR_WAIT_MS = 1_500

/**
 * Runs inside the page (injected repeatedly; Cloudflare reloads the page once its check passes). Once the document
 * is fully parsed and carries the listing (JSON-LD Product or og:title), it waits up to ATTR_WAIT_MS for the hydrated
 * details and sends the whole DOM back with a read-only scrape of them (`details`, every field nullable, nothing
 * invented); until then it reports every 700 ms whether the page is a challenge. The HTML and the details are parsed in
 * the app by the shared extractor (parseVintedItemHtml). The probe only reads the page: no clicks, no form input.
 */
export const PAGE_PROBE = `(function () {
  if (window.__ovtProbe) return;
  window.__ovtProbe = true;
  var post = function (m) { try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {} };
  var hasItem = function () {
    var ld = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < ld.length; i++) { if (/"@type"\\s*:\\s*"Product"/.test(ld[i].textContent || '')) return true; }
    var og = document.querySelector('meta[property="og:title"]');
    return !!(og && og.getAttribute('content') && og.getAttribute('content').length > 1);
  };
  // Every Vinted page loads Cloudflare's /cdn-cgi/challenge-platform/scripts/jsd/ snippet: only the challenge
  // itself (window._cf_chl_opt, the /h/ orchestrator, the Turnstile iframe) counts.
  var isChallenge = function () {
    return !!(window._cf_chl_opt || document.querySelector('script[src*="/cdn-cgi/challenge-platform/h/"], iframe[src*="challenges.cloudflare.com"], #challenge-form')
      || /^(just a moment|un momento|please wait)/i.test(document.title || '')
      || document.querySelector('iframe[src*="captcha-delivery.com"]'));
  };
  // Cloudflare's own error and block pages (5xx, 1015 rate limit, 1020 "you have been blocked"): no check to pass.
  var isCfError = function () {
    return !!(document.querySelector('#cf-error-details, .cf-error-details')
      || /attention required|you have been blocked|access denied|\\| 5\\d\\d:/i.test(document.title || ''));
  };

  /* ----- read-only scrape of the hydrated details (spec §3.1) ----- */
  var ATTR_SEL = '[data-testid^="item-attributes-"]';
  var ATTR_WORDS = { view_count: 'Visualizzazioni', favourite_count: 'Interessati', upload_date: 'Caricato', condition: 'Condizioni', brand: 'Marca', size: 'Taglia', color: 'Colore' };
  var text = function (node) { return node ? String(node.textContent || '').replace(/\\s+/g, ' ').trim() : ''; };
  var itemId = (location.pathname.match(/\\/items\\/(\\d+)/) || [])[1] || null;
  var hasAttributes = function () {
    if (document.querySelector(ATTR_SEL)) return true;
    var body = document.body ? document.body.textContent || '' : '';
    return /Visualizzazioni|Interessati/.test(body);
  };
  // [label, value] pairs: the visible label (or the testid's key in Italian) and the value shown next to it.
  var readAttributes = function () {
    var out = [];
    var nodes = document.querySelectorAll(ATTR_SEL);
    for (var i = 0; i < nodes.length && out.length < 30; i++) {
      var node = nodes[i];
      var testid = String(node.getAttribute('data-testid') || '');
      if (/--/.test(testid)) continue; // the container holds both the title and the value node
      var key = testid.replace(/^item-attributes-/, '');
      var kids = node.children || [];
      var label = kids.length >= 2 ? text(kids[0]) : '';
      var value = kids.length >= 2 ? text(kids[kids.length - 1]) : text(node);
      if (!value) continue;
      out.push([(label || ATTR_WORDS[key] || key).slice(0, 60), value.slice(0, 120)]);
    }
    return out;
  };
  var readTexts = function (selector, needDigit, max) {
    var out = [];
    var nodes;
    try { nodes = document.querySelectorAll(selector); } catch (e) { return out; }
    for (var i = 0; i < nodes.length && out.length < max; i++) {
      var v = text(nodes[i]).slice(0, 40);
      if (v && (!needDigit || /\\d/.test(v)) && out.indexOf(v) < 0) out.push(v);
    }
    return out;
  };
  var readStrikethrough = function () { return readTexts('s, del, [class*="strikethrough" i], [class*="line-through" i], [style*="line-through"]', true, 10); };
  var readBadges = function () { return readTexts('[data-testid*="badge" i]', false, 10); };
  var readBundleText = function () {
    var parts = readTexts('[data-testid*="bundle" i]', false, 6);
    var joined = parts.join(' \\u00b7 ').slice(0, 300);
    return joined || null;
  };
  // Other listings of the same seller: distinct item links under the «altri articoli» heading, null when there is none.
  var readSellerItemCards = function () {
    var heads = document.querySelectorAll('h2, h3, [data-testid*="seller-items" i], [data-testid*="closet" i]');
    var box = null;
    for (var i = 0; i < heads.length; i++) {
      var h = heads[i];
      var byId = /seller-items|closet/i.test(String(h.getAttribute('data-testid') || ''));
      if (byId || /altri articoli|articoli del (venditore|membro)|dello stesso venditore|armadio/i.test(text(h))) { box = byId ? h : (h.closest('section') || h.parentElement); break; }
    }
    if (!box) return null;
    var links = box.querySelectorAll('a[href*="/items/"]');
    var seen = {};
    var n = 0;
    for (var j = 0; j < links.length; j++) {
      var m = String(links[j].getAttribute('href') || '').match(/\\/items\\/(\\d+)/);
      if (m && m[1] !== itemId && !seen[m[1]]) { seen[m[1]] = 1; n++; }
    }
    return n;
  };
  // Next.js flight chunks (self.__next_f) carry the item JSON: a key is read next to this item's id, or anywhere in the
  // chunks only when every occurrence agrees (other listings on the page carry the same keys). is_reserved: id-near only.
  var FLIGHT_RES = {
    view_count: /\\\\?"view_count\\\\?":\\s*(\\d+)/g,
    favourite_count: /\\\\?"favourite_count\\\\?":\\s*(\\d+)/g,
    item_count: /\\\\?"item_count\\\\?":\\s*(\\d+)/g,
    is_reserved: /\\\\?"is_reserved\\\\?":\\s*(true|false)/g,
  };
  var readFlight = function () {
    var out = { view_count: null, favourite_count: null, item_count: null, is_reserved: null };
    var chunks = self.__next_f;
    if (!Array.isArray(chunks)) return out;
    var all = { view_count: [], favourite_count: [], item_count: [] };
    var near = {};
    var convert = function (raw) { return raw === 'true' ? true : raw === 'false' ? false : Number(raw); };
    for (var i = 0; i < chunks.length; i++) {
      var s = Array.isArray(chunks[i]) ? chunks[i][1] : chunks[i];
      if (typeof s !== 'string' || s.length < 20) continue;
      var idx = itemId ? s.indexOf('"id":' + itemId) : -1;
      if (idx < 0 && itemId) idx = s.indexOf('\\\\"id\\\\":' + itemId);
      var win = idx >= 0 ? s.slice(idx, idx + 6000) : '';
      for (var key in FLIGHT_RES) {
        var re = FLIGHT_RES[key];
        if (win && near[key] === undefined) {
          re.lastIndex = 0;
          var hit = re.exec(win);
          if (hit) near[key] = convert(hit[1]);
        }
        if (all[key]) {
          re.lastIndex = 0;
          var m;
          while ((m = re.exec(s)) && all[key].length < 50) all[key].push(convert(m[1]));
        }
      }
    }
    for (var k in out) {
      if (near[k] !== undefined) out[k] = near[k];
      else if (all[k] && all[k].length && all[k].every(function (v) { return v === all[k][0]; })) out[k] = all[k][0];
    }
    return out;
  };
  var readDetails = function () {
    try {
      return { attributes: readAttributes(), strikethrough: readStrikethrough(), badges: readBadges(), bundleText: readBundleText(), sellerItemCards: readSellerItemCards(), flight: readFlight() };
    } catch (e) {
      return null;
    }
  };

  var itemSince = null;
  var tick = function () {
    var ready = document.readyState !== 'loading';
    if (ready && hasItem()) {
      if (itemSince === null) itemSince = Date.now();
      if (!hasAttributes() && Date.now() - itemSince < ${ATTR_WAIT_MS}) {
        post({ type: 'state', url: location.href, ready: true, complete: document.readyState === 'complete', challenge: false, cfError: false, item: true, vh: window.innerHeight, title: (document.title || '').slice(0, 80) });
        setTimeout(tick, 250);
        return;
      }
      var html = document.documentElement ? document.documentElement.outerHTML : '';
      post({ type: 'html', url: location.href, html: html.length > ${MAX_HTML_CHARS} ? html.slice(0, ${MAX_HTML_CHARS}) : html, details: readDetails() });
      return;
    }
    var challenge = isChallenge();
    post({ type: 'state', url: location.href, ready: ready, complete: document.readyState === 'complete', challenge: challenge, cfError: !challenge && ready && isCfError(), vh: window.innerHeight, title: (document.title || '').slice(0, 80) });
    setTimeout(tick, 700);
  };
  tick();
})();
true;`

const ALLOWED_SCHEMES = /^(https?:|about:|data:|blob:)/i

/**
 * The in-app browser used when Vinted's anti-bot check refuses the quick download. It loads the listing in a WebView
 * (a real Chrome engine, so Cloudflare's automatic check passes and its cookie is kept for the next time), hidden
 * behind the app. If the check wants a tap, the WebView is shown full screen with a short explanation and «Annulla».
 *
 * Imperative API through `ref`: `load(url, { onVisible })` → Promise<{ ok, html, details, url } | { ok: false, reason, status }>
 * with reason one of challenge, timeout, network, crashed, cferror, http (404/410), empty, cancelled, unsupported.
 * `details` is the probe's read-only scrape of the hydrated page (see PAGE_PROBE), or null.
 * Never rejects.
 */
export function VintedPageLoader({ ref }) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const [job, setJob] = useState(null)
  const jobRef = useRef(null)
  const webRef = useRef(null)
  const timersRef = useRef([])
  const stateRef = useRef(null)

  const clearTimers = () => {
    timersRef.current.forEach((timer) => { clearTimeout(timer); clearInterval(timer) })
    timersRef.current = []
  }

  const finish = useCallback((result, id) => {
    const current = jobRef.current
    if (!current || (id !== undefined && current.id !== id)) return
    jobRef.current = null
    clearTimers()
    setJob(null)
    current.resolve(result)
  }, [])

  const showToUser = useCallback((id) => {
    const current = jobRef.current
    if (!current || current.id !== id || current.visible) return
    current.visible = true
    Keyboard.dismiss()
    setJob((j) => (j && j.id === id ? { ...j, visible: true } : j))
    if (current.onVisible) current.onVisible()
    timersRef.current.push(setTimeout(() => finish({ ok: false, reason: 'challenge' }, id), VISIBLE_MS))
  }, [finish])

  /**
   * End of the silent attempt: a challenge goes to the user, a page still loading gets a little longer (returns
   * 'wait'), a parsed page without the listing is reported.
   */
  const decide = useCallback((id) => {
    const current = jobRef.current
    if (!current || current.id !== id || current.visible) return 'done'
    const s = stateRef.current
    if (s && s.challenge) {
      showToUser(id)
      return 'done'
    }
    if (!s || !s.ready) {
      if (Date.now() - current.startedAt < LOADING_MS) return 'wait'
      finish({ ok: false, reason: 'timeout' }, id)
      return 'done'
    }
    finish({ ok: false, reason: 'empty' }, id)
    return 'done'
  }, [finish, showToUser])

  useImperativeHandle(ref, () => ({
    load(url, { onVisible } = {}) {
      if (Platform.OS === 'web') return Promise.resolve({ ok: false, reason: 'unsupported' })
      finish({ ok: false, reason: 'cancelled' })
      return new Promise((resolve) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        jobRef.current = { id, url, resolve, onVisible, visible: false, startedAt: Date.now(), noDataSince: null }
        stateRef.current = null
        setJob({ id, url, visible: false })
        timersRef.current.push(setTimeout(() => {
          if (decide(id) !== 'wait') return
          const poll = setInterval(() => { if (decide(id) !== 'wait') clearInterval(poll) }, 2_000)
          timersRef.current.push(poll)
        }, HIDDEN_MS))
      })
    },
    cancel() {
      finish({ ok: false, reason: 'cancelled' })
    },
  }), [finish, decide])

  // Settle a pending promise if the loader ever unmounts.
  useEffect(() => () => {
    clearTimers()
    const current = jobRef.current
    jobRef.current = null
    if (current) current.resolve({ ok: false, reason: 'cancelled' })
  }, [])

  // Periodic injection (see REINJECT_MS); harmless while the old document is still showing.
  const jobId = job ? job.id : null
  useEffect(() => {
    if (!jobId) return undefined
    const timer = setInterval(() => {
      if (webRef.current) webRef.current.injectJavaScript(PAGE_PROBE)
    }, REINJECT_MS)
    return () => clearInterval(timer)
  }, [jobId])

  // Android back button closes the visible check instead of leaving the app.
  const visible = Boolean(job && job.visible)
  useEffect(() => {
    if (!visible) return undefined
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      finish({ ok: false, reason: 'cancelled' })
      return true
    })
    return () => sub.remove()
  }, [visible, finish])

  if (!job || Platform.OS === 'web') return null
  const id = job.id

  const onMessage = (event) => {
    const current = jobRef.current
    if (!current || current.id !== id) return
    let msg
    try {
      msg = JSON.parse(event.nativeEvent.data)
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return
    if (msg.type === 'html' && typeof msg.html === 'string') {
      // `details` is the probe's scrape of the hydrated page (null when it failed): parseVintedItemHtml's second argument.
      finish({ ok: true, html: msg.html, details: msg.details && typeof msg.details === 'object' ? msg.details : null, url: msg.url || job.url, via: 'browser' }, id)
      return
    }
    if (msg.type !== 'state') return
    stateRef.current = msg
    if (msg.cfError) {
      finish({ ok: false, reason: 'cferror' }, id)
      return
    }
    if (msg.challenge || msg.item) {
      // A challenge, or the listing found while the probe waits for its hydrated details: not a page without data.
      current.noDataSince = null
      return
    }
    // A finished page with no listing and no challenge: do not keep the user waiting for the full silent attempt.
    if (msg.complete) {
      current.noDataSince = current.noDataSince || Date.now()
      if (Date.now() - current.noDataSince >= NO_DATA_MS) finish({ ok: false, reason: 'empty' }, id)
    } else current.noDataSince = null
  }

  const onHttpError = (event) => {
    const status = event.nativeEvent && event.nativeEvent.statusCode
    // 403/503 are Cloudflare's challenge itself: keep going. A missing listing is final.
    if (status === 404 || status === 410) finish({ ok: false, reason: 'http', status }, id)
  }

  const onError = () => finish({ ok: false, reason: 'network' }, id)
  // Android may kill the WebView's renderer (low memory, app in background): the view is dead, end this attempt.
  const onRenderProcessGone = () => finish({ ok: false, reason: 'crashed' }, id)

  // Also injected at every load end, right away rather than at the next tick.
  const onLoadEnd = () => {
    if (webRef.current) webRef.current.injectJavaScript(PAGE_PROBE)
  }

  return (
    <View
      pointerEvents={visible ? 'auto' : 'none'}
      style={visible
        ? [StyleSheet.absoluteFill, styles.visible, { backgroundColor: t.bg, paddingTop: insets.top || StatusBar.currentHeight || 24, paddingBottom: insets.bottom }]
        : styles.hidden}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
    >
      {visible && (
        <View style={[styles.header, { borderBottomColor: t.line, backgroundColor: t.card }]}>
          <Title>Verifica di Vinted</Title>
          <Body small>Vinted controlla che dall'altra parte ci sia una persona. Se compare una casella, toccala: appena si apre l'annuncio leggo i dati e torno qui da solo.</Body>
          <Button label="Annulla" variant="secondary" small onPress={() => finish({ ok: false, reason: 'cancelled' }, id)} />
        </View>
      )}
      <WebView
        ref={webRef}
        key={id}
        source={{ uri: job.url }}
        style={visible ? styles.webVisible : styles.webHidden}
        injectedJavaScript={PAGE_PROBE}
        onMessage={onMessage}
        onLoadEnd={onLoadEnd}
        onHttpError={onHttpError}
        onError={onError}
        onRenderProcessGone={onRenderProcessGone}
        onShouldStartLoadWithRequest={(req) => ALLOWED_SCHEMES.test(req.url || '')}
        originWhitelist={['https://*', 'http://*']}
        javaScriptEnabled
        domStorageEnabled
        thirdPartyCookiesEnabled
        sharedCookiesEnabled
        cacheEnabled
        incognito={false}
        setSupportMultipleWindows={false}
        javaScriptCanOpenWindowsAutomatically={false}
        mediaPlaybackRequiresUserAction
        mixedContentMode="never"
        allowFileAccess={false}
        allowsBackForwardNavigationGestures={false}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  // Behind everything, clipped to 2×2 px and transparent: the page runs normally but is never seen or touched.
  hidden: { position: 'absolute', left: 0, bottom: 0, width: 2, height: 2, overflow: 'hidden', opacity: 0.01 },
  // flex: 0 overrides the library's own flex: 1, which would otherwise shrink the page to the 2 px parent (a 2 px
  // viewport throttles Cloudflare's iframe and looks like a bot).
  webHidden: { flex: 0, width: 360, height: 640 },
  visible: { zIndex: 100, elevation: 100 },
  header: { padding: space.lg, gap: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  webVisible: { flex: 1 },
})
