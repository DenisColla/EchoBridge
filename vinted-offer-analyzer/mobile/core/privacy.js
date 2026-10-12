/**
 * Contacts never reach the AI providers: e-mail addresses (also written "nome @ gmail . com", "(at)", "chiocciola"),
 * social handles and links, and Italian phone numbers in listing titles and descriptions are replaced by "[contatto]".
 * Phone numbers are recognised by shape (mobile 3xx + 6–7 digits, landline 0 + 7–10 digits, optional +39/0039, up to
 * three separator characters between digit groups), so model lists ("iPhone 11 12 13 14"), sizes ("38 39 40 41 42"),
 * dates and prices stay as they are.
 */

const EMAIL = /[\w.+-]+\s*(?:@|\(\s*at\s*\)|\[\s*at\s*\]|\bchiocciola\b)\s*[\w-]+(?:\s*(?:\.|\(\s*dot\s*\)|\[\s*dot\s*\]|\bpunto\b)\s*[\w-]+)+/gi
const SOCIAL_LINK = /\b(?:https?:\/\/)?(?:www\.)?(?:t\.me|wa\.me|instagram\.com|facebook\.com|fb\.me|tiktok\.com)\/[\w.\-/@?=&]+/gi
const SOCIAL_LABEL = /\b(?:ig|insta|instagram|telegram|tg|fb|facebook|tiktok|snap|snapchat)\s*:\s*@?[\w.]{3,}/gi
const HANDLE = /(^|[^\w@])@[\w.]{3,}/g
const PHONE_RUN = /\+?\(?\d(?:[\s()./-]{0,3}\d)+/g
const DATE = /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/

const isPhone = (digits) => /^3\d{8,9}$/.test(digits) || /^0\d{7,10}$/.test(digits)

/** Blanks the longest phone-shaped span of each run of digits and separators (a model number before it stays). */
function scrubPhones(text) {
  return text.replace(PHONE_RUN, (run) => {
    const groups = [...run.matchAll(/\d+/g)]
    for (let i = 0; i < groups.length; i++) {
      for (let j = groups.length; j > i; j--) {
        const parts = groups.slice(i, j)
        if (Math.max(...parts.map((g) => g[0].length)) < 3) continue
        const start = parts[0].index
        const end = parts[parts.length - 1].index + parts[parts.length - 1][0].length
        if (DATE.test(run.slice(start, end))) continue
        const digits = parts.map((g) => g[0]).join('').replace(/^(?:00)?39(?=3\d{8,9}$|0\d{7,10}$)/, '')
        if (isPhone(digits)) return `${run.slice(0, start).replace(/[+(\s]+$/, '')}${start > 0 && /\d/.test(run.slice(0, start)) ? ' ' : ''}[contatto]${scrubPhones(run.slice(end))}`
      }
    }
    return run
  })
}

export function scrubContacts(value) {
  const text = String(value || '')
    .replace(EMAIL, '[contatto]')
    .replace(SOCIAL_LINK, '[contatto]')
    .replace(SOCIAL_LABEL, '[contatto]')
    .replace(HANDLE, '$1[contatto]')
  return scrubPhones(text)
}
