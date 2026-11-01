/**
 * Date helpers with Italian formatting. Deliberately avoids Intl so that the
 * output is identical on web, Node and React Native (Hermes). All day
 * arithmetic goes through setDate/setHours on local fields, which is DST-safe.
 */

export const WEEKDAYS_IT = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato']
export const WEEKDAYS_SHORT_IT = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab']
export const MONTHS_IT = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
]

export const pad2 = (n) => String(n).padStart(2, '0')

export const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

export const startOfDay = (date) => {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

export const addDays = (date, days) => {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

export const addMinutes = (date, minutes) => new Date(date.getTime() + minutes * 60_000)

/** Returns a copy of `date` with the local time set to hours:minutes. */
export const atTime = (date, hours, minutes = 0) => {
  const d = new Date(date)
  d.setHours(hours, minutes, 0, 0)
  return d
}

export const minutesOfDay = (date) => date.getHours() * 60 + date.getMinutes()

export const daysInMonth = (date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()

/** Whole calendar days between the two dates (ignores the time of day; DST-safe thanks to rounding). */
export const calendarDaysBetween = (from, to) => {
  const a = startOfDay(from)
  const b = startOfDay(to)
  return Math.round((b - a) / 86_400_000)
}

export const isSameDay = (a, b) => calendarDaysBetween(a, b) === 0

export const formatTime = (date) => `${pad2(date.getHours())}:${pad2(date.getMinutes())}`

export const formatMinutes = (minutes) => `${pad2(Math.floor(minutes / 60) % 24)}:${pad2(minutes % 60)}`

/** "12:30–14:00" */
export const formatRange = (from, to) => `${formatMinutes(from)}–${formatMinutes(to)}`

/** "domenica 5 ottobre" (+ " 2027" when the year differs from `reference`). */
export const formatLongDate = (date, reference) => {
  const base = `${WEEKDAYS_IT[date.getDay()]} ${date.getDate()} ${MONTHS_IT[date.getMonth()]}`
  return reference && reference.getFullYear() !== date.getFullYear() ? `${base} ${date.getFullYear()}` : base
}

/** "oggi" | "domani" | "tra 5 giorni" relative to `now`. */
export const formatRelativeDay = (date, now) => {
  const days = calendarDaysBetween(now, date)
  if (days <= 0) return 'oggi'
  if (days === 1) return 'domani'
  return `tra ${days} giorni`
}

/** [1,2,3,4,5] → "lun–ven", [0,6] → "sab e dom", [0] → "dom", all → "tutti i giorni". */
export function formatDayList(days) {
  const sorted = [...new Set(days)].sort((a, b) => a - b)
  if (sorted.length === 7) return 'tutti i giorni'
  if (sorted.length === 1) return WEEKDAYS_SHORT_IT[sorted[0]]
  if (sorted.length === 2 && sorted[0] === 0 && sorted[1] === 6) return 'sab e dom'
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1)
  if (contiguous) return `${WEEKDAYS_SHORT_IT[sorted[0]]}–${WEEKDAYS_SHORT_IT[sorted[sorted.length - 1]]}`
  return sorted.map((d) => WEEKDAYS_SHORT_IT[d]).join(', ')
}

/** Rounds a date UP to the next multiple of `stepMinutes`. */
export const ceilToMinutes = (date, stepMinutes = 5) => {
  const d = new Date(date)
  d.setSeconds(0, 0)
  const rem = d.getMinutes() % stepMinutes
  if (rem !== 0) d.setMinutes(d.getMinutes() + (stepMinutes - rem))
  return d
}

/** Easter Sunday (Gregorian, Meeus/Jones/Butcher). */
export function easterSunday(year) {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month, day)
}

const FIXED_HOLIDAYS_IT = new Set(['1-1', '1-6', '4-25', '5-1', '6-2', '8-15', '11-1', '12-8', '12-25', '12-26'])

/** Italian national public holidays (fixed dates + Easter Monday). */
export function isItalianHoliday(date) {
  if (FIXED_HOLIDAYS_IT.has(`${date.getMonth() + 1}-${date.getDate()}`)) return true
  return isSameDay(date, addDays(easterSunday(date.getFullYear()), 1))
}

/** UTC offset of Europe/Rome in minutes for the given instant (EU DST rule: last Sunday of March → last Sunday of October, 01:00 UTC). */
export function romeOffsetMinutes(date) {
  const year = date.getUTCFullYear()
  const lastSundayUtc = (month) => {
    const d = new Date(Date.UTC(year, month + 1, 0, 1, 0, 0, 0))
    d.setUTCDate(d.getUTCDate() - d.getUTCDay())
    return d
  }
  const start = lastSundayUtc(2)
  const end = lastSundayUtc(9)
  return date >= start && date < end ? 120 : 60
}

export const deviceOffsetMinutes = (date) => -date.getTimezoneOffset()
