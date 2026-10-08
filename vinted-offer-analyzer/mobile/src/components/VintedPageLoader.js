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
 * Runs inside the page (injected repeatedly; Cloudflare reloads the page once its check passes). Once the document
 * is fully parsed and carries the listing (JSON-LD Product or og:title), it sends the whole DOM back; until then it
 * reports every 700 ms whether the page is a challenge. The HTML is parsed in the app by the shared extractor.
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
  var tick = function () {
    var ready = document.readyState !== 'loading';
    if (ready && hasItem()) {
      var html = document.documentElement ? document.documentElement.outerHTML : '';
      post({ type: 'html', url: location.href, html: html.length > ${MAX_HTML_CHARS} ? html.slice(0, ${MAX_HTML_CHARS}) : html });
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
 * Imperative API through `ref`: `load(url, { onVisible })` → Promise<{ ok, html, url } | { ok: false, reason, status }>
 * with reason one of challenge, timeout, network, crashed, cferror, http (404/410), empty, cancelled, unsupported.
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
      finish({ ok: true, html: msg.html, url: msg.url || job.url, via: 'browser' }, id)
      return
    }
    if (msg.type !== 'state') return
    stateRef.current = msg
    if (msg.cfError) {
      finish({ ok: false, reason: 'cferror' }, id)
      return
    }
    if (msg.challenge) {
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
