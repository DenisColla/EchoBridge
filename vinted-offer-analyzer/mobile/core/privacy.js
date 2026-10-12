/**
 * Contacts never reach the AI providers: e-mail addresses (also written "nome @ gmail . com", "(at)", "chiocciola"),
 * social handles and links, and Italian phone numbers in listing titles and descriptions are replaced by "[contatto]".
 * Phone numbers are recognised by shape: mobile 3xx + 6–7 digits, landline 0 + 7–10 digits, optional +39/0039, digit
 * groups joined by short runs of separators (also spaced single digits). Shapes that are usually product data stay
 * unless a contact word ("tel", "cell", "whatsapp"…) or +39 comes first: size lists ("38 39 40 41 42"), price lists
 * ("300 350 400"), set and article codes ("31120 31121", "002.638.50"), dates and date ranges.
 * Linear in the text length (only phone-sized spans are tried), so long numeric lists stay fast.
 */

const MAIL_DOMAINS = 'gmail|googlemail|hotmail|libero|yahoo|outlook|icloud|live|alice|tiscali|virgilio|tim|fastwebnet|email|pec'
const EMAIL_PLAIN = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
const EMAIL_SPELLED = new RegExp(`[\\w.+-]+\\s*(?:＠|\\(\\s*@\\s*\\)|\\(\\s*at\\s*\\)|\\[\\s*at\\s*\\]|\\bchiocciola\\b|@)\\s*[\\w-]+\\s*(?:\\.|\\(\\s*dot\\s*\\)|\\[\\s*dot\\s*\\]|\\bpunto\\b|\\bdot\\b)\\s*(?:com|it|net|org|eu|info|me|io)\\b`, 'gi')
const EMAIL_AT_WORD = new RegExp(`[\\w.+-]+\\s+at\\s+(?:${MAIL_DOMAINS})\\s*(?:\\.|\\bpunto\\b|\\bdot\\b)\\s*(?:com|it|net)\\b`, 'gi')
const SOCIAL_LINK = /\b(?:https?:\/\/)?(?:www\.)?(?:t\.me|wa\.me|instagram\.com|facebook\.com|fb\.me|tiktok\.com)\/[\w.\-/@?=&]+/gi
const SOCIAL_LABEL = /\b(?:ig|insta|instagram|telegram|tg|fb|facebook|tiktok|snap|snapchat)\s*:\s*@?[\w.]{3,}/gi
// Without a colon, only a token that looks like a handle ("IG mario.rossi", "tg mario_92"), not "Instagram story".
const SOCIAL_LABEL_BARE = /\b(?:ig|insta|instagram|telegram|tg|tiktok|snapchat)\s*-?\s*@?(?=[a-z])(?=[\w.]*[._\d])[\w.]{3,}/gi
const HANDLE = /(^|[^\w@])@[\w.]{3,}/g
const PHONE_RUN = /\+?\(?\d(?:[\s()./,_·•–—-]{0,4}\d)+/g
const DATE_TOKEN = /(?<!\d)\d{1,2}[/.-]\d{1,2}[/.-](?:\d{4}|\d{2})(?!\d)/g
const CONTACT_CUE = /(?:\btel\w*|\bcell\w*|\bwhats\s?app|\bwapp|\bwa|\bsms|\bchiam\w*|\bnumero|\bnum|\bcontatt\w*|\bscriv\w*|\brecapito)\W{0,6}$/i
const MAX_DIGITS = 15

const isPhone = (digits) => /^3\d{8,9}$/.test(digits) || /^0\d{7,10}$/.test(digits)

/** Whether a span of digit groups is a phone number, given whether a contact word or +39 comes before it. */
function phoneSpan(parts, spanText, cue) {
  let digits = parts.join('')
  const plus = spanText.startsWith('+')
  const intl = /^(?:00)?39(?=3\d{8,9}$|0\d{7,10}$)/.test(digits) && (plus || digits.startsWith('0039') || parts[0] === '39')
  if (intl) digits = digits.replace(/^(?:00)?39/, '')
  const prefixed = plus || intl
  if (!isPhone(digits)) return false
  if (cue || prefixed) return true
  const lens = parts.map((p) => p.length)
  if (lens.every((l) => l === 1)) return lens.length >= 9 // "3 3 3 1 2 3 4 5 6 7"
  if (Math.max(...lens) < 3) return false // sizes, "11 12 13 14"
  if (lens.length >= 3 && lens.every((l) => l === 3)) return false // price lists
  if (lens.length >= 2 && (lens.every((l) => l === 4) || lens.every((l) => l === 5))) return false // set / article codes
  if (digits[0] === '0' && lens.length > 1) {
    // Landline written as prefix + number ("06 1234 5678", "0521/123456"), not dotted article numbers.
    if (!/^0\d{1,3}$/.test(parts[0]) || lens.slice(1).some((l) => l < 3) || spanText.includes('.')) return false
  }
  return true
}

/** One run of digits and separators (no dates inside): blanks each phone-shaped span, longest first. */
function scrubRun(run, before) {
  const groups = [...run.matchAll(/\d+/g)]
  for (let i = 0; i < groups.length; i++) {
    // Only phone-sized spans: at most MAX_DIGITS digits, so the work stays proportional to the run.
    let count = 0
    let last = i
    while (last < groups.length && count + groups[last][0].length <= MAX_DIGITS) count += groups[last++][0].length
    for (let j = last; j > i; j--) {
      const parts = groups.slice(i, j)
      const start = parts[0].index
      const end = parts[parts.length - 1].index + parts[parts.length - 1][0].length
      const lead = run.slice(0, start)
      const spanText = (lead.match(/\+\s*$/) ? '+' : '') + run.slice(start, end)
      const cue = CONTACT_CUE.test(`${before}${lead}`.slice(-30))
      // Part of a longer code glued with "-", "/" or "." ("010-02540-01"): not a phone unless a contact word says so.
      if (!cue && (/\d[()./,_·•–—-]$/.test(lead) || /^[()./,_·•–—-]\d/.test(run.slice(end)))) continue
      if (phoneSpan(parts.map((g) => g[0]), spanText, cue)) {
        const head = lead.replace(/[+(\s]+$/, '')
        return `${head}${head && /\d/.test(head) ? ' ' : ''}[contatto]${scrubRun(run.slice(end), '')}`
      }
    }
  }
  return run
}

function scrubPhones(text) {
  return text.replace(PHONE_RUN, (run, offset, whole) => {
    const before = whole.slice(Math.max(0, offset - 30), offset)
    // Dates split the run: no phone span may start, end or pass inside a date.
    let out = ''
    let pos = 0
    for (const d of run.matchAll(DATE_TOKEN)) {
      out += scrubRun(run.slice(pos, d.index), pos === 0 ? before : '') + d[0]
      pos = d.index + d[0].length
    }
    return out + scrubRun(run.slice(pos), pos === 0 ? before : '')
  })
}

// The same texts come back many times (the reference in every verification prompt): remember recent results.
const memo = new Map()

export function scrubContacts(value) {
  const input = String(value || '')
  if (memo.has(input)) return memo.get(input)
  const text = input
    .replace(/[ \t\u00a0]{2,}/g, ' ')
    .replace(EMAIL_PLAIN, '[contatto]')
    .replace(EMAIL_SPELLED, '[contatto]')
    .replace(EMAIL_AT_WORD, '[contatto]')
    .replace(SOCIAL_LINK, '[contatto]')
    .replace(SOCIAL_LABEL, '[contatto]')
    .replace(SOCIAL_LABEL_BARE, '[contatto]')
    .replace(HANDLE, '$1[contatto]')
  const out = scrubPhones(text)
  memo.set(input, out)
  if (memo.size > 300) memo.delete(memo.keys().next().value)
  return out
}
