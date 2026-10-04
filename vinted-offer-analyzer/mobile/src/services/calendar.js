// The root export of expo-calendar 57 is the new object API; the function API lives under /legacy.
import * as Calendar from 'expo-calendar/legacy'
import { Linking } from 'react-native'

const pad = (n) => String(n).padStart(2, '0')
const localStamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`

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

/** Adds a 30-minute event with a 10-minute alarm to the device's main writable calendar. */
export async function addToDeviceCalendar({ title, link, sendAt, notes }) {
  const start = new Date(sendAt)
  const end = new Date(start.getTime() + 30 * 60_000)
  try {
    const { granted } = await Calendar.requestCalendarPermissionsAsync()
    if (!granted) return { ok: false, reason: 'permission' }
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT)
    const writable = calendars.filter((c) => c.allowsModifications)
    const preferred = writable.find((c) => c.isPrimary)
      || writable.find((c) => c.source && /google/i.test(c.source.type || c.source.name || ''))
      || writable[0]
    if (!preferred) return { ok: false, reason: 'no_calendar' }
    const eventId = await Calendar.createEventAsync(preferred.id, {
      title: eventTitleFor(title),
      startDate: start,
      endDate: end,
      notes,
      url: link || undefined,
      timeZone: deviceTimeZone(),
      alarms: [{ relativeOffset: -10 }],
    })
    return { ok: true, eventId, calendarName: preferred.title }
  } catch (error) {
    return { ok: false, reason: 'error', error: String(error && error.message ? error.message : error) }
  }
}

export async function removeFromDeviceCalendar(eventId) {
  if (!eventId) return
  try {
    await Calendar.deleteEventAsync(eventId)
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
