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
  // The listing's own heart: aria-label «Aggiungi ai preferiti. Aggiunto ai preferiti da 4», text «4». The hearts of
  // the other listings on the page have other test ids, so this count is surely this listing's.
  var readFavourites = function () {
    try {
      var b = document.querySelector('[data-testid="favourite-button"]');
      if (!b) return null;
      var label = String(b.getAttribute('aria-label') || '');
      var n = label.match(/preferiti da\\s*(\\d[\\d.]*)/i) || text(b).match(/(\\d[\\d.]*)/);
      if (!n) return label ? 0 : null;
      var v = Number(String(n[1]).replace(/\\./g, ''));
      return isFinite(v) ? v : null;
    } catch (e) { return null; }
  };
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
  // 1.8: the seller's wardrobe. On the listing page only the link to it is read; on the wardrobe page itself the
  // counts, a sample of prices and the bundle text. Read-only like everything else here.
  var isMember = /\\/member\\//.test(location.pathname);
  var readSellerUrl = function () {
    var pick = function (a) {
      var m = String((a && a.getAttribute && a.getAttribute('href')) || '').match(/\\/member\\/(\\d+)[^?#"]*/);
      return m ? location.origin + m[0] : null;
    };
    // The link around the seller's name, or the nearest one in his box: a logged-in page also links the visitor's
    // own profile (menu, header), which the first link of the page may well be.
    var name = document.querySelector('[data-testid="profile-username"]');
    if (name) {
      var own = pick(name.closest ? name.closest('a[href*="/member/"]') : null);
      if (own) return own;
      var box = name;
      for (var up = 0; up < 6 && box.parentElement; up++) {
        box = box.parentElement;
        var inner = pick(box.querySelector('a[href*="/member/"]'));
        if (inner) return inner;
      }
      var who = text(name).toLowerCase();
      if (who) {
        var named = document.querySelectorAll('a[href*="/member/"]');
        for (var n = 0; n < named.length; n++) {
          var href = String(named[n].getAttribute('href') || '').toLowerCase();
          if (href.indexOf('-' + who) > 0 && pick(named[n])) return pick(named[n]);
        }
      }
    }
    var links = document.querySelectorAll('a[href*="/member/"]');
    for (var i = 0; i < links.length; i++) {
      if (links[i].closest && links[i].closest('header, nav, [data-testid*="header" i], [data-testid*="menu" i]')) continue;
      var url = pick(links[i]);
      if (url) return url;
    }
    return null;
  };
  // The article cards of a page (a profile, a search): { id, price, text } for each distinct article. The card is the
  // widest box around the link that holds no other article. On Vinted the link is an empty overlay with its own
  // data-testid («product-item-id-…--overlay-link»): price and title are its siblings, so they are looked for going
  // up from the link (1.11.1 stopped at the link itself and read no price at all).
  var PRICE = /(\\d{1,5}(?:[.,]\\d{2})?)\\s?\\u20ac/;
  var readCards = function (limit) {
    var links = document.querySelectorAll('a[href*="/items/"]');
    var seen = {};
    var out = [];
    for (var i = 0; i < links.length && out.length < limit; i++) {
      var a = links[i];
      var m = String(a.getAttribute('href') || '').match(/\\/items\\/(\\d+)/);
      if (!m || seen[m[1]]) continue;
      seen[m[1]] = 1;
      var title = String(a.getAttribute('title') || '');
      var p = title.match(PRICE);
      var box = null;
      var node = a;
      for (var up = 0; up < 7; up++) {
        node = node.parentElement;
        if (!node || node === document.body) break;
        var inside = node.querySelectorAll('a[href*="/items/"]');
        var foreign = false;
        for (var q = 0; q < inside.length && !foreign; q++) {
          var other = String(inside[q].getAttribute('href') || '').match(/\\/items\\/(\\d+)/);
          if (other && other[1] !== m[1]) foreign = true;
        }
        if (foreign) break;
        box = node;
        // Laid out, one element per line: glued, a title ending in a digit would change the price after it.
        if (!p) p = String(node.innerText || text(node)).slice(0, 600).match(PRICE);
      }
      var img = box ? box.querySelector('img[alt]') : null;
      var words = (title + ' ' + (img ? String(img.getAttribute('alt') || '') : '') + ' ' + (box ? String(box.innerText || text(box)) : '')).replace(/\\s+/g, ' ').trim().slice(0, 300);
      out.push({ id: m[1], price: p ? p[1] : null, text: words, mark: String(a.getAttribute('data-testid') || a.className || '').replace(/\\d{3,}/g, '{id}').slice(0, 60) });
    }
    return out;
  };
  var countItemLinks = function () {
    var linked = document.querySelectorAll('a[href*="/items/"]');
    var ids = {};
    var n = 0;
    for (var li = 0; li < linked.length; li++) {
      var hit = String(linked[li].getAttribute('href') || '').match(/\\/items\\/(\\d+)/);
      if (hit && !ids[hit[1]]) { ids[hit[1]] = 1; n++; }
    }
    return n;
  };
  var MEMBER_RES = {
    item_count: /\\\\?"item_count\\\\?":\\s*(\\d+)/,
    given_item_count: /\\\\?"given_item_count\\\\?":\\s*(\\d+)/,
    taken_item_count: /\\\\?"taken_item_count\\\\?":\\s*(\\d+)/,
    followers_count: /\\\\?"followers_count\\\\?":\\s*(\\d+)/,
    feedback_count: /\\\\?"feedback_count\\\\?":\\s*(\\d+)/,
    positive_feedback_count: /\\\\?"positive_feedback_count\\\\?":\\s*(\\d+)/,
    negative_feedback_count: /\\\\?"negative_feedback_count\\\\?":\\s*(\\d+)/
  };
  var readMember = function () {
    try {
      // The text as laid out, one element per line: glued together («kokosc23» + «7 follower») a name ending in
      // digits would change the figure that follows it.
      var laidOut = String(document.body.innerText || '').replace(/[ \\t]+/g, ' ');
      var body = (laidOut.length > 40 ? laidOut : text(document.body)).slice(0, 30000);
      var got = readCards(120);
      var prices = [];
      for (var i = 0; i < got.length; i++) { if (got[i].price) prices.push(got[i].price); }
      var cards = got.length;
      var firstCard = got.length ? got[0].mark : null;
      var num = function (re) { var x = body.match(re); return x ? x[1] : null; };
      // «5 articoli» is the wardrobe's size; «almeno 5 articoli» is the text of the «Annunci frequenti» badge.
      var itemCount = null;
      var counts = /(\\d[\\d.]*)\\s+articol[oi]/gi;
      for (var hitC = counts.exec(body); hitC && itemCount === null; hitC = counts.exec(body)) {
        if (!/almeno\\s*$/i.test(body.slice(Math.max(0, hitC.index - 10), hitC.index))) itemCount = hitC[1];
      }
      // The embedded data of the page, only around this member's own name: a logged-in page embeds the visitor's
      // account too, and its figures would come first.
      var flight = {};
      var who = String((location.pathname.match(/\\/member\\/\\d+-([^/?#]+)/) || [])[1] || '').toLowerCase();
      var chunks = self.__next_f;
      if (who && Array.isArray(chunks)) {
        var plain = '"login":"' + who + '"';
        var escaped = '\\\\"login\\\\":\\\\"' + who + '\\\\"';
        for (var j = 0; j < chunks.length; j++) {
          var c = Array.isArray(chunks[j]) ? chunks[j][1] : chunks[j];
          if (typeof c !== 'string') continue;
          var low = c.toLowerCase();
          var at = low.indexOf(escaped);
          if (at < 0) at = low.indexOf(plain);
          if (at < 0) continue;
          var near = c.slice(Math.max(0, at - 3000), at + 3000);
          for (var k in MEMBER_RES) {
            if (flight[k] !== undefined) continue;
            var hit = near.match(MEMBER_RES[k]);
            if (hit) flight[k] = Number(hit[1]);
          }
        }
      }
      // «Acquista set · Ottieni fino al 25% di sconto · Crea set» (the bundle was called «lotti» before).
      var bundle = body.match(/[^.]{0,80}(acquista set|crea set|sconto sui lotti|sconti sui lotti|lotti)[^.]{0,80}/i);
      return { kind: 'member', frequentLister: /annunci frequenti/i.test(body), cards: cards, prices: prices, cardMark: firstCard, itemCountText: itemCount, followersText: num(/(\\d[\\d.]*)\\s+follower/i), feedbackText: num(/(\\d[\\d.]*)\\s+recension/i), bundleText: bundle ? bundle[0].slice(0, 200) : null, flight: flight, sample: body.slice(0, 600) };
    } catch (e) {
      return null;
    }
  };
  var readDetails = function () {
    try {
      return { attributes: readAttributes(), strikethrough: readStrikethrough(), badges: readBadges(), bundleText: readBundleText(), favourites: readFavourites(), sellerItemCards: readSellerItemCards(), flight: readFlight(), sellerUrl: readSellerUrl() };
    } catch (e) {
      return null;
    }
  };

  // 1.12: a search page (the same book in the other listings). Read when its cards stop growing, or when it says
  // there is none; the cards are the same as a profile's.
  var isCatalog = /^\\/catalog/.test(location.pathname);
  var lastCount = -1;
  var stableSince = 0;
  var itemSince = null;
  var tick = function () {
    var ready = document.readyState !== 'loading';
    if (isCatalog) {
      var stopped = isChallenge();
      if (ready && !stopped && !isCfError()) {
        if (itemSince === null) itemSince = Date.now();
        var waitedC = Date.now() - itemSince;
        var count = countItemLinks();
        if (count !== lastCount) { lastCount = count; stableSince = Date.now(); }
        var none = /nessun risultato|nessun articolo|non abbiamo trovato|niente da mostrare/i.test(String(document.body ? document.body.innerText || '' : '').slice(0, 6000));
        var settledC = (count > 0 && Date.now() - stableSince > 900) || (none && waitedC > 1500) || waitedC > 6000;
        if (!settledC) {
          post({ type: 'state', url: location.href, ready: true, complete: document.readyState === 'complete', challenge: false, cfError: false, item: true, vh: window.innerHeight, title: (document.title || '').slice(0, 80) });
          setTimeout(tick, 400);
          return;
        }
        var found = readCards(80);
        var pricedC = 0;
        for (var fc = 0; fc < found.length; fc++) { if (found[fc].price) pricedC++; }
        post({ type: 'html', url: location.href, html: '', details: { kind: 'catalog', cards: found, diag: { waitedMs: waitedC, cards: found.length, priced: pricedC, none: none, card: found.length ? found[0].mark : null, sample: found.length ? found[0].text.slice(0, 90) : null } } });
        return;
      }
      post({ type: 'state', url: location.href, ready: ready, complete: document.readyState === 'complete', challenge: stopped, cfError: !stopped && ready && isCfError(), vh: window.innerHeight, title: (document.title || '').slice(0, 80) });
      setTimeout(tick, 700);
      return;
    }
    if (isMember) {
      var blocked = isChallenge();
      if (ready && !blocked && !isCfError()) {
        if (itemSince === null) itemSince = Date.now();
        // The profile fills in steps (the page is heavy and this view is hidden): wait for the articles, or for the
        // profile's own figures and then a little more, before reading. 4 s were not enough on a real phone.
        var waited = Date.now() - itemSince;
        // Real articles only: every page carries the header's «Vendi subito» (/items/new), which made the wait end at
        // once and the profile be read while still empty (seen on a real phone: the step lasted one second).
        var itemLinks = 0;
        var linked = document.querySelectorAll('a[href*="/items/"]');
        for (var li = 0; li < linked.length; li++) { if (/\\/items\\/\\d+/.test(String(linked[li].getAttribute('href') || ''))) itemLinks++; }
        var hasInfo = /\\d\\s+follower|\\d\\s+recension|\\d\\s+articol/i.test(document.body ? document.body.textContent || '' : '');
        var settled = itemLinks > 0 ? (hasInfo || waited > 3000) : (hasInfo && waited > 5000);
        if (!settled && waited < 12000) {
          post({ type: 'state', url: location.href, ready: true, complete: document.readyState === 'complete', challenge: false, cfError: false, item: true, vh: window.innerHeight, title: (document.title || '').slice(0, 80) });
          setTimeout(tick, 400);
          return;
        }
        var read = readMember();
        // What the page looked like when it was read, without a name or a number: tells an empty wardrobe from a page not read.
        if (read) read.diag = { waitedMs: waited, textLen: (document.body ? document.body.textContent || '' : '').length, itemLinks: itemLinks, priced: read.prices ? read.prices.length : 0, card: read.cardMark || null, hasInfo: hasInfo, path: location.pathname.replace(/\\d{3,}/g, '{id}').replace(/\\{id\\}-[^/]+/, '{id}-{nome}') };
        post({ type: 'html', url: location.href, html: '', details: read });
        return;
      }
      post({ type: 'state', url: location.href, ready: ready, complete: document.readyState === 'complete', challenge: blocked, cfError: !blocked && ready && isCfError(), vh: window.innerHeight, title: (document.title || '').slice(0, 80) });
      setTimeout(tick, 700);
      return;
    }
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
 * The verdict of the silent attempt from the probe's last `state` message `s` (null before the first one), the job's
 * start and the current time: 'challenge' (hand the check to the user), 'wait' (a page still loading, or the listing
 * found while the probe waits for the hydrated details: its 'html' message follows within ATTR_WAIT_MS, so this is not
 * an empty page), 'timeout' (still nothing after LOADING_MS) or 'empty' (a parsed page without the listing). Pure.
 */
export const decideState = (s, startedAt, now = Date.now()) => {
  if (s && s.challenge) return 'challenge'
  if (!s || !s.ready || s.item) return now - startedAt < LOADING_MS ? 'wait' : 'timeout'
  return 'empty'
}

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
   * End of the silent attempt (decideState): a challenge goes to the user, a page still loading or waiting for its
   * hydrated details gets a little longer (returns 'wait'), a parsed page without the listing is reported.
   */
  const decide = useCallback((id) => {
    const current = jobRef.current
    if (!current || current.id !== id || current.visible) return 'done'
    const verdict = decideState(stateRef.current, current.startedAt, Date.now())
    if (verdict === 'wait') return 'wait'
    if (verdict === 'challenge') showToUser(id)
    else finish({ ok: false, reason: verdict }, id)
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
