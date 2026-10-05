// The root export of expo-calendar 57 is the new object API; the function API lives under /legacy.
import * as Calendar from 'expo-calendar/legacy'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Linking } from 'react-native'

const PREFERRED_KEY = 'offerta-vinted.calendar.preferred.v1'
const pad = (n) => String(n).padStart(2, '0')
const localStamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`
const utcStamp = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`

/** Last outcome of a calendar operation, shown in the Info tab so a silent failure can be reported. */
export const calendarDiagnostics = { last: null }
const note = (entry) => { calendarDiagnostics.last = { at: new Date().toISOString(), ...entry } }

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

export async function getCalendarPermissionStatus() {
  try {
    const p = await Calendar.getCalendarPermissionsAsync()
    return p.granted ? 'granted' : p.canAskAgain === false ? 'denied' : 'undetermined'
  } catch (error) {
    note({ step: 'permission-status', error: String(error && error.message ? error.message : error) })
    return 'unavailable'
  }
}

/** Writable calendars on the device, as { id, title, source, isPrimary }. Requires permission. */
export async function listWritableCalendars() {
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT)
  return calendars
    .filter((c) => c.allowsModifications)
    .map((c) => ({ id: String(c.id), title: c.title || c.name || 'Calendario', source: (c.source && (c.source.name || c.source.type)) || '', isPrimary: Boolean(c.isPrimary), color: c.color }))
}

export async function getPreferredCalendarId() {
  try {
    return await AsyncStorage.getItem(PREFERRED_KEY)
  } catch {
    return null
  }
}

export async function setPreferredCalendarId(id) {
  try {
    if (id) await AsyncStorage.setItem(PREFERRED_KEY, String(id))
    else await AsyncStorage.removeItem(PREFERRED_KEY)
  } catch {
    // storage unavailable: the choice simply does not persist
  }
}

const pickCalendar = (writable, preferredId) =>
  writable.find((c) => c.id === preferredId)
  || writable.find((c) => c.isPrimary)
  || writable.find((c) => /google|gmail/i.test(c.source))
  || writable.find((c) => /samsung|local|phone|telefono/i.test(c.source))
  || writable[0]

/**
 * Adds a 30-minute event with a 10-minute alarm to the preferred (or primary) writable calendar.
 * Never throws: returns { ok, reason, error?, eventId?, calendarName? } and records diagnostics.
 */
export async function addToDeviceCalendar({ title, link, sendAt, notes }) {
  const start = new Date(sendAt)
  const end = new Date(start.getTime() + 30 * 60_000)
  try {
    const permission = await Calendar.requestCalendarPermissionsAsync()
    if (!permission.granted) {
      note({ step: 'permission', granted: false, canAskAgain: permission.canAskAgain })
      return { ok: false, reason: permission.canAskAgain === false ? 'permission_blocked' : 'permission' }
    }
    const writable = await listWritableCalendars()
    note({ step: 'calendars', count: writable.length, names: writable.map((c) => c.title).slice(0, 6) })
    if (writable.length === 0) return { ok: false, reason: 'no_calendar' }
    const preferred = pickCalendar(writable, await getPreferredCalendarId())
    const eventId = await Calendar.createEventAsync(preferred.id, {
      title: eventTitleFor(title),
      startDate: start,
      endDate: end,
      notes: notes || (link ? `Annuncio: ${link}` : ''),
      timeZone: deviceTimeZone(),
      alarms: [{ relativeOffset: -10 }],
    })
    note({ step: 'created', eventId: String(eventId), calendar: preferred.title })
    return { ok: true, eventId: String(eventId), calendarName: preferred.title }
  } catch (error) {
    const message = String(error && error.message ? error.message : error)
    note({ step: 'error', error: message })
    return { ok: false, reason: 'error', error: message }
  }
}

/**
 * Second path, no permission needed: the calendar app's own "new event" screen, pre-filled (Android ACTION_INSERT).
 * Android cannot tell whether the user saved or cancelled, so the result is just { ok, action }.
 */
export async function openCalendarEditor({ title, link, sendAt, notes }) {
  const start = new Date(sendAt)
  const end = new Date(start.getTime() + 30 * 60_000)
  try {
    const result = await Calendar.createEventInCalendarAsync({
      title: eventTitleFor(title),
      startDate: start,
      endDate: end,
      notes: notes || (link ? `Annuncio: ${link}` : ''),
      timeZone: deviceTimeZone(),
      alarms: [{ relativeOffset: -10 }],
    })
    note({ step: 'editor', action: result && result.action })
    return { ok: true, action: result && result.action ? result.action : 'done', eventId: result && result.id ? String(result.id) : null }
  } catch (error) {
    const message = String(error && error.message ? error.message : error)
    note({ step: 'editor-error', error: message })
    return { ok: false, reason: 'error', error: message }
  }
}

export async function removeFromDeviceCalendar(eventId) {
  if (!eventId) return
  try {
    await Calendar.deleteEventAsync(String(eventId))
  } catch {
    // already removed by the user
  }
}

/** Fallback that needs no permission: opens Google Calendar with the event pre-filled. */
export function openGoogleCalendar({ title, sendAt, notes }) {
  const start = new Date(sendAt)
  const end = new Date(start.getTime() + 30 * 60_000)
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: eventTitleFor(title),
    dates: `${localStamp(start)}/${localStamp(end)}`,
    details: notes || '',
  })
  return Linking.openURL(`https://calendar.google.com/calendar/render?${params.toString()}`)
}

const icsEscape = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

/** Builds a standard .ics (iCalendar) text for the reminder event. */
export function buildIcs({ title, sendAt, notes, uid }) {
  const start = new Date(sendAt)
  const end = new Date(start.getTime() + 30 * 60_000)
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

/** Third path: hand the event to any calendar app through the share sheet as a .ics file. */
export async function shareIcs(payload) {
  try {
    const dir = FileSystem.cacheDirectory
    if (!dir) return { ok: false, reason: 'no_fs' }
    const uri = `${dir}offerta-vinted-${Date.now()}.ics`
    await FileSystem.writeAsStringAsync(uri, buildIcs(payload), { encoding: FileSystem.EncodingType.UTF8 })
    if (!(await Sharing.isAvailableAsync())) return { ok: false, reason: 'no_share' }
    await Sharing.shareAsync(uri, { mimeType: 'text/calendar', dialogTitle: 'Apri con il calendario', UTI: 'public.calendar-event' })
    note({ step: 'ics-shared', uri })
    return { ok: true }
  } catch (error) {
    const message = String(error && error.message ? error.message : error)
    note({ step: 'ics-error', error: message })
    return { ok: false, reason: 'error', error: message }
  }
}

export const openAppSettings = () => Linking.openSettings().catch(() => {})
