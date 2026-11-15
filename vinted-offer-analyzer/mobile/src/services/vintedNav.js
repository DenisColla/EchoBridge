/**
 * The rules of the in-app Vinted browser, as pure functions (no React Native: the Node tests run them as they are).
 * The browser shows Vinted and nothing else, with the exceptions a purchase and a login cannot do without: the
 * anti-robot checks, the sign-in providers (Google's whole sign-in, with the hops it makes across its own sites) and,
 * while a checkout is open, the payment and bank confirmation pages.
 */
export const VINTED_HOME = 'https://www.vinted.it/'
/** Minutes during which sites outside Vinted may open after a checkout page (bank 3-D Secure, PayPal…). */
export const PAY_WINDOW_MINUTES = 15
/** Minutes during which Google's other sites may open after one of its sign-in pages (a recovery reminder, a consent page). */
export const SIGNIN_WINDOW_MINUTES = 15

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
const AUX_HOSTS = [/(^|\.)captcha-delivery\.com$/, /(^|\.)datadome\.co$/, /^challenges\.cloudflare\.com$/, /^appleid\.apple\.com$/, /(^|\.)facebook\.com$/]
/** google.com and Google's country sites: google.it, google.co.uk, google.com.br. */
const GOOGLE_TLD = '(com|[a-z]{2}|com?\\.[a-z]{2})'
/**
 * Google's sign-in. Besides accounts.google.com, a sign-in hops through accounts.youtube.com and the country site
 * (accounts.google.it) to carry the session there («SetSID»): with one hop blocked Google answers «unknown error».
 */
const GOOGLE_SIGNIN_HOSTS = [new RegExp(`^accounts\\.google\\.${GOOGLE_TLD}$`), /^accounts\.youtube\.com$/]
/** Google's own sites: a sign-in may pass through one of them, so they open only while a sign-in is under way. */
const GOOGLE_HOSTS = [new RegExp(`(^|\\.)google\\.${GOOGLE_TLD}$`), /(^|\.)youtube\.com$/]
/** Payment providers: opening one starts the payment window as a checkout page does. */
const PAY_HOSTS = [/(^|\.)adyen\.com$/, /(^|\.)adyenpayments\.com$/, /(^|\.)checkout\.com$/, /(^|\.)mangopay\.com$/, /(^|\.)paypal\.com$/, /(^|\.)stripe\.com$/, /(^|\.)klarna\.com$/]
const matches = (list, host) => Boolean(host && list.some((re) => re.test(host)))

/** A page of Google's sign-in (https only). Opening one starts the sign-in window. */
export const isGoogleSignInUrl = (url) => /^https:/i.test(String(url || '')) && matches(GOOGLE_SIGNIN_HOSTS, hostOf(url))

export const isCheckoutUrl = (url) => (isVintedUrl(url) && /\/(checkout|transaction|transactions|pay|payment|payments)(\/|$)/i.test(pathOf(url))) || matches(PAY_HOSTS, hostOf(url))

/**
 * What a page of the browser is: 'item' | 'member' | 'conversation' | 'inbox' | 'catalog' | 'checkout' | 'home' |
 * 'vinted' (any other Vinted page) | 'signin' (Google's sign-in) | 'external'. With the listing or member id when
 * the address has one.
 */
export function pageOf(url) {
  if (!isVintedUrl(url)) return { type: isGoogleSignInUrl(url) ? 'signin' : 'external', id: null }
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
 * during a payment, a phone number, an e-mail). `payUntil` is the end of the payment window (ms), 0 when closed;
 * `signInUntil` the end of the sign-in window, during which Google's other sites open too.
 * Vinted's own app links (intent:, vinted:) are blocked so the page stays here instead of jumping to the app.
 */
export function decideNavigation(url, { payUntil = 0, signInUntil = 0, now = Date.now() } = {}) {
  const u = String(url || '')
  if (/^(about:|data:|blob:)/i.test(u)) return 'allow'
  if (/^(tel:|mailto:|sms:)/i.test(u)) return 'external'
  const paying = payUntil > now
  if (!/^https?:/i.test(u)) return paying && /^intent:/i.test(u) ? 'external' : 'block'
  if (isVintedUrl(u)) return 'allow'
  const host = hostOf(u)
  if (isGoogleSignInUrl(u) || matches(AUX_HOSTS, host) || matches(PAY_HOSTS, host)) return 'allow'
  if (signInUntil > now && /^https:/i.test(u) && matches(GOOGLE_HOSTS, host)) return 'allow'
  return paying ? 'allow' : 'block'
}

/** The site of an address, for a message: 'accounts.google.it'. '' when it has none. */
export const siteOf = (url) => hostOf(url) || ''

/** The address without what identifies anything: digits become {id}, the query keeps only its names. For the log. */
export function templateOf(url) {
  const host = hostOf(url) || ''
  const path = pathOf(url).replace(/\d{3,}[^/]*/g, '{id}')
  const q = String(url || '').split('?')[1]
  const names = q ? [...new Set(q.split('#')[0].split('&').map((p) => p.split('=')[0]).filter(Boolean))].slice(0, 8) : []
  return `${host}${path}${names.length ? `?${names.join('&')}` : ''}`
}
