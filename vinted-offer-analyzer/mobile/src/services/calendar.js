/**
 * Calendar without permissions: "Metti in calendario" opens the phone's calendar app on its own
 * "new event" screen, already filled in (title, start, end, notes). The user checks and taps Save.
 *
 * Paths, tried in order until one opens something:
 *  1. Android ACTION_INSERT on the calendar provider (Samsung Calendar, Google Calendar, any calendar app).
 *  2. Google Calendar pre-filled link (the Google Calendar app claims it; otherwise the browser).
 *  3. A .ics file handed to the share sheet, for calendar apps that answer neither.
 * Nothing here asks for the READ/WRITE_CALENDAR permission.
 */
import * as IntentLauncher from 'expo-intent-launcher'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { Linking, Platform } from 'react-native'

const EVENT_MINUTES = 30
const pad = (n) => String(n).padStart(2, '0')
const localStamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`
const utcStamp = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`

/** Last outcome of a calendar operation, shown in the Info tab so a silent failure can be reported. */
export const calendarDiagnostics = { last: null }
const note = (entry) => { calendarDiagnostics.last = { at: new Date().toISOString(), ...entry } }
const errorText = (error) => String(error && error.message ? error.message : error)

const deviceTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Rome'
  } catch {
    return 'Europe/Rome'
  }
}

export const eventTitleFor = (title) => `Invia l'offerta: ${title && title.trim() ? title.trim() : 'articolo Vinted'}`

export const eventNotesFor = ({ link, targetPrice, probability, message }) => [
  targetPrice ? `Offerta: ${targetPrice} €` : null,
  probability ? `Probabilità stimata: ${Math.round(probability * 100)}%` : null,
  link ? `Annuncio: ${link}` : null,
  message ? `\nMessaggio da incollare:\n${message}` : null,
].filter(Boolean).join('\n')

const eventWindow = (sendAt) => {
  const start = new Date(sendAt)
  const end = new Date(start.getTime() + EVENT_MINUTES * 60_000)
  return { start, end }
}

/**
 * Path 1: the calendar app's own "new event" screen (Android ACTION_INSERT, no permission).
 * Resolves when the user comes back from the calendar app; Android does not say whether they saved.
 */
export async function openCalendarInsert({ title, link, sendAt, notes }) {
  if (Platform.OS !== 'android') return { ok: false, reason: 'not_android' }
  const { start, end } = eventWindow(sendAt)
  try {
    const result = await IntentLauncher.startActivityAsync('android.intent.action.INSERT', {
      data: 'content://com.android.calendar/events',
      extra: {
        title: eventTitleFor(title),
        description: notes || (link ? `Annuncio: ${link}` : ''),
        beginTime: start.getTime(),
        endTime: end.getTime(),
        allDay: false,
        eventTimezone: deviceTimeZone(),
      },
    })
    note({ step: 'insert-intent', resultCode: result && result.resultCode })
    return { ok: true, via: 'intent', resultCode: result && result.resultCode }
  } catch (error) {
    note({ step: 'insert-intent-error', error: errorText(error) })
    return { ok: false, reason: 'error', error: errorText(error) }
  }
}

/** Path 2: Google Calendar with the event pre-filled (the app claims the link when installed). */
export async function openGoogleCalendar({ title, sendAt, notes }) {
  const { start, end } = eventWindow(sendAt)
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: eventTitleFor(title),
    dates: `${localStamp(start)}/${localStamp(end)}`,
    details: notes || '',
    ctz: deviceTimeZone(),
  })
  try {
    await Linking.openURL(`https://calendar.google.com/calendar/render?${params.toString()}`)
    note({ step: 'google-calendar' })
    return { ok: true, via: 'google' }
  } catch (error) {
    note({ step: 'google-calendar-error', error: errorText(error) })
    return { ok: false, reason: 'error', error: errorText(error) }
  }
}

const icsEscape = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

/** Builds a standard .ics (iCalendar) text for the reminder event, with a 10-minute alarm. */
export function buildIcs({ title, sendAt, notes, uid }) {
  const { start, end } = eventWindow(sendAt)
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Offerta Vinted Timing//IT',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid || `${start.getTime()}@offertavinted`}`,
    `DTSTAMP:${utcStamp(new Date())}`,
    `DTSTART:${utcStamp(start)}`,
    `DTEND:${utcStamp(end)}`,
    `SUMMARY:${icsEscape(eventTitleFor(title))}`,
    `DESCRIPTION:${icsEscape(notes)}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT10M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Invia l\'offerta',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n')
}

/** Path 3: hand the event to any calendar app through the share sheet as a .ics file. */
export async function shareIcs(payload) {
  try {
    const dir = FileSystem.cacheDirectory
    if (!dir) return { ok: false, reason: 'no_fs' }
    const uri = `${dir}offerta-vinted-${Date.now()}.ics`
    await FileSystem.writeAsStringAsync(uri, buildIcs(payload), { encoding: FileSystem.EncodingType.UTF8 })
    if (!(await Sharing.isAvailableAsync())) return { ok: false, reason: 'no_share' }
    await Sharing.shareAsync(uri, { mimeType: 'text/calendar', dialogTitle: 'Apri con il calendario', UTI: 'public.calendar-event' })
    note({ step: 'ics-shared', uri })
    return { ok: true, via: 'ics' }
  } catch (error) {
    note({ step: 'ics-error', error: errorText(error) })
    return { ok: false, reason: 'error', error: errorText(error) }
  }
}

/**
 * The one entry point behind "Metti in calendario": tries the three paths in order and returns the first
 * that opened something, as { ok, via: 'intent' | 'google' | 'ics' } or { ok: false, errors: [...] }.
 */
export async function openCalendarWithEvent(payload) {
  const errors = []
  for (const step of [openCalendarInsert, openGoogleCalendar, shareIcs]) {
    const outcome = await step(payload)
    if (outcome.ok) return outcome
    errors.push(`${step.name}: ${outcome.error || outcome.reason}`)
  }
  note({ step: 'all-failed', error: errors.join(' | ') })
  return { ok: false, errors }
}

export const VIA_LABEL = {
  intent: 'Calendario aperto con l\'evento compilato: controlla e tocca Salva.',
  google: 'Google Calendar aperto con l\'evento compilato: tocca Salva.',
  ics: 'Scegli l\'app calendario nella finestra di condivisione per salvare l\'evento.',
}

export const openAppSettings = () => Linking.openSettings().catch(() => {})
