/**
 * The rules of the in-app Vinted browser, as pure functions (no React Native: the Node tests run them as they are).
 * The browser shows Vinted and nothing else, with the exceptions a purchase and a login cannot do without: the
 * anti-robot checks, the sign-in providers and, while a checkout is open, the payment and bank confirmation pages.
 */
export const VINTED_HOME = 'https://www.vinted.it/'
/** Minutes during which sites outside Vinted may open after a checkout page (bank 3-D Secure, PayPal…). */
export const PAY_WINDOW_MINUTES = 15

const hostOf = (url) => {
  const m = String(url || '').match(/^https?:\/\/([^/?#:]+)/i)
  return m ? m[1].toLowerCase() : null
}
const pathOf = (url) => {
  const m = String(url || '').match(/^https?:\/\/[^/?#]+([^?#]*)/i)
  return m ? m[1] || '/' : '/'
}

/** Any Vinted country site: vinted.it, www.vinted.it, vinted.fr… */
export const isVintedUrl = (url) => {
  const host = hostOf(url)
  return Boolean(host && /^([a-z0-9-]+\.)*vinted\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host))
}

/** Hosts always allowed as a page of their own: the checks Vinted itself hands the visitor to, and the sign-in providers. */
const AUX_HOSTS = [/(^|\.)captcha-delivery\.com$/, /(^|\.)datadome\.co$/, /^challenges\.cloudflare\.com$/, /^accounts\.google\.com$/, /^appleid\.apple\.com$/, /(^|\.)facebook\.com$/]
/** Payment providers: opening one starts the payment window as a checkout page does. */
const PAY_HOSTS = [/(^|\.)adyen\.com$/, /(^|\.)adyenpayments\.com$/, /(^|\.)checkout\.com$/, /(^|\.)mangopay\.com$/, /(^|\.)paypal\.com$/, /(^|\.)stripe\.com$/, /(^|\.)klarna\.com$/]
const matches = (list, host) => Boolean(host && list.some((re) => re.test(host)))

export const isCheckoutUrl = (url) => (isVintedUrl(url) && /\/(checkout|transaction|transactions|pay|payment|payments)(\/|$)/i.test(pathOf(url))) || matches(PAY_HOSTS, hostOf(url))

/**
 * What a page of the browser is: 'item' | 'member' | 'conversation' | 'inbox' | 'catalog' | 'checkout' | 'home' |
 * 'vinted' (any other Vinted page) | 'external'. With the listing or member id when the address has one.
 */
export function pageOf(url) {
  if (!isVintedUrl(url)) return { type: 'external', id: null }
  const path = pathOf(url)
  let m = path.match(/\/items\/(\d+)/)
  if (m) return { type: 'item', id: m[1] }
  m = path.match(/\/member\/(\d+)/)
  if (m) return { type: 'member', id: m[1] }
  m = path.match(/\/inbox\/(\d+)/)
  if (m) return { type: 'conversation', id: m[1] }
  if (/\/inbox(\/|$)/.test(path)) return { type: 'inbox', id: null }
  if (isCheckoutUrl(url)) return { type: 'checkout', id: null }
  if (/\/catalog(\/|$)/.test(path) || /[?&]search_text=/.test(String(url))) return { type: 'catalog', id: null }
  if (path === '/' || path === '') return { type: 'home', id: null }
  return { type: 'vinted', id: null }
}

/**
 * May the browser show this address as its page? 'allow' | 'block' | 'external' (hand it to the phone: a bank app
 * during a payment, a phone number, an e-mail). `payUntil` is the end of the payment window (ms), 0 when closed.
 * Vinted's own app links (intent:, vinted:) are blocked so the page stays here instead of jumping to the app.
 */
export function decideNavigation(url, { payUntil = 0, now = Date.now() } = {}) {
  const u = String(url || '')
  if (/^(about:|data:|blob:)/i.test(u)) return 'allow'
  if (/^(tel:|mailto:|sms:)/i.test(u)) return 'external'
  const paying = payUntil > now
  if (!/^https?:/i.test(u)) return paying && /^intent:/i.test(u) ? 'external' : 'block'
  if (isVintedUrl(u)) return 'allow'
  const host = hostOf(u)
  if (matches(AUX_HOSTS, host) || matches(PAY_HOSTS, host)) return 'allow'
  return paying ? 'allow' : 'block'
}

/** The address without what identifies anything: digits become {id}, the query keeps only its names. For the log. */
export function templateOf(url) {
  const host = hostOf(url) || ''
  const path = pathOf(url).replace(/\d{3,}[^/]*/g, '{id}')
  const q = String(url || '').split('?')[1]
  const names = q ? [...new Set(q.split('#')[0].split('&').map((p) => p.split('=')[0]).filter(Boolean))].slice(0, 8) : []
  return `${host}${path}${names.length ? `?${names.join('&')}` : ''}`
}
