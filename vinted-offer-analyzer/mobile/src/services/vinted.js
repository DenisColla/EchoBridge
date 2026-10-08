import * as Clipboard from 'expo-clipboard'
import { detectVintedChallenge } from '../../core/index.js'

const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'

export const VINTED_ITEM_RE = /https?:\/\/(?:www\.)?vinted\.[a-z.]+\/items\/(\d+)[^\s"'<>]*/i

export const isVintedItemLink = (text) => VINTED_ITEM_RE.test(String(text || ''))

export const normalizeVintedLink = (text) => {
  const m = String(text || '').match(VINTED_ITEM_RE)
  return m ? m[0] : null
}

/**
 * Downloads the public item page the way a phone browser would. Returns { ok, html, status } and never throws.
 * The page is server-rendered: title, price, brand, condition, upload age and seller activity are in the HTML.
 * Failure reasons: not_a_vinted_link, http (with status), challenge (Cloudflare/DataDome page), timeout, network.
 * Since October 2026 www.vinted.it sits behind Cloudflare, which often answers a plain HTTP client (OkHttp) with a
 * JavaScript challenge: the caller then opens the page in the in-app browser (VintedPageLoader). The quick download is
 * always tried first (about a second): it still works part of the time and tells a removed listing (404) apart.
 */
export async function fetchVintedItemPage(link, { timeoutMs = 12_000 } = {}) {
  const url = normalizeVintedLink(link)
  if (!url) return { ok: false, reason: 'not_a_vinted_link' }
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller ? controller.signal : undefined,
      headers: {
        'User-Agent': MOBILE_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'it-IT,it;q=0.9,en;q=0.5',
      },
    })
    const html = await response.text()
    // A removed listing is final, whatever scripts its page carries.
    if (response.status === 404 || response.status === 410) return { ok: false, reason: 'http', status: response.status, html }
    // Cloudflare answers 403 (sometimes 503 or 200) with its challenge page: never read that as an error of Vinted.
    const mitigated = response.headers && typeof response.headers.get === 'function' ? response.headers.get('cf-mitigated') : null
    const challenge = mitigated === 'challenge' ? 'cloudflare' : detectVintedChallenge(html)
    if (challenge) return { ok: false, reason: 'challenge', challenge, status: response.status, html }
    if (!response.ok) return { ok: false, reason: 'http', status: response.status, html }
    return { ok: true, html, status: response.status, url: response.url || url }
  } catch (error) {
    return { ok: false, reason: error && error.name === 'AbortError' ? 'timeout' : 'network', error: String(error && error.message ? error.message : error) }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Reads the clipboard and returns a Vinted item link if one is there (null otherwise, never throws). */
export async function readVintedLinkFromClipboard() {
  try {
    if (!(await Clipboard.hasStringAsync())) return null
    const text = await Clipboard.getStringAsync()
    return normalizeVintedLink(text)
  } catch {
    return null
  }
}
