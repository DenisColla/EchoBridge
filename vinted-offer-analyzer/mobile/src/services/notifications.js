import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

export const CHANNEL_ID = 'offerte'
export const MINUTES_BEFORE = 10

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

export async function ensureNotificationPermission() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Promemoria offerte',
      description: 'Ti avvisa pochi minuti prima della finestra giusta per inviare l\'offerta.',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#0f766e',
    })
  }
  const current = await Notifications.getPermissionsAsync()
  if (current.granted) return true
  const asked = await Notifications.requestPermissionsAsync()
  return Boolean(asked.granted)
}

export async function getNotificationStatus() {
  try {
    const p = await Notifications.getPermissionsAsync()
    return p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied'
  } catch {
    return 'unavailable'
  }
}

/**
 * Schedules the reminder `MINUTES_BEFORE` minutes before the send moment.
 * Returns the notification id, or null when the moment is too close to schedule.
 */
export async function scheduleOfferReminder({ id, title, link, sendAt }) {
  const fireAt = new Date(new Date(sendAt).getTime() - MINUTES_BEFORE * 60_000)
  if (fireAt.getTime() <= Date.now() + 5_000) return null
  const name = title && title.trim() ? title.trim() : "l'articolo"
  return Notifications.scheduleNotificationAsync({
    content: {
      title: `Tra ${MINUTES_BEFORE} minuti: invia l'offerta`,
      body: `${name}: apri l'annuncio e manda l'offerta nella finestra giusta.`,
      data: { itemId: id, link: link || null },
      sound: 'default',
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt, channelId: CHANNEL_ID },
  })
}

/**
 * A reminder at an exact moment with its own title and body (counter-offer plan: send, last call, nudge, give up).
 * Returns the notification id, or null when the moment is already past.
 */
export async function scheduleReminderAt({ itemId, link, at, title, body, kind = 'counter' }) {
  const fireAt = new Date(at)
  if (!Number.isFinite(fireAt.getTime()) || fireAt.getTime() <= Date.now() + 5_000) return null
  return Notifications.scheduleNotificationAsync({
    content: { title, body, data: { itemId, link: link || null, kind }, sound: 'default' },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt, channelId: CHANNEL_ID },
  })
}

export async function cancelReminder(notificationId) {
  if (!notificationId) return
  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId)
  } catch {
    // already fired or unknown: nothing to do
  }
}

/** Calls `onOpen(data)` when the user taps a reminder (app running or cold start). */
export function listenToReminderTaps(onOpen) {
  Notifications.getLastNotificationResponseAsync().then((response) => {
    if (response) onOpen(response.notification.request.content.data || {})
  }).catch(() => {})
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    onOpen(response.notification.request.content.data || {})
  })
  return () => sub.remove()
}
