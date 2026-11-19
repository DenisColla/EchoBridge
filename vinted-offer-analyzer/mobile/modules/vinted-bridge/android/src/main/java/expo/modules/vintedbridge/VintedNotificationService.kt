package expo.modules.vintedbridge

import android.app.Notification
import android.content.Context
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject

/**
 * Copies the title and text of Vinted's notifications into a small queue (SharedPreferences) that the app reads when
 * it opens. Nothing else is read, nothing is dismissed or answered, and no other app's notifications are stored.
 */
class VintedNotificationService : NotificationListenerService() {
  companion object {
    const val PREFS = "vinted_bridge"
    const val KEY_QUEUE = "queue"
    const val MAX_EVENTS = 200
    val PACKAGES = setOf("fr.vinted")
    @Volatile var onEvent: ((String) -> Unit)? = null

    fun readQueue(context: Context): String =
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_QUEUE, "[]") ?: "[]"

    fun clearQueue(context: Context, upTo: Double) {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      synchronized(PREFS) {
        try {
          val old = JSONArray(prefs.getString(KEY_QUEUE, "[]") ?: "[]")
          val kept = JSONArray()
          for (i in 0 until old.length()) {
            val o = old.optJSONObject(i) ?: continue
            if (o.optDouble("at", 0.0) > upTo) kept.put(o)
          }
          prefs.edit().putString(KEY_QUEUE, kept.toString()).apply()
        } catch (e: Exception) {
          prefs.edit().putString(KEY_QUEUE, "[]").apply()
        }
      }
    }
  }

  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    try {
      if (sbn == null || !PACKAGES.contains(sbn.packageName)) return
      val n = sbn.notification ?: return
      val extras = n.extras ?: return
      val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
      val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""
      val big = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString() ?: ""
      val sub = extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString() ?: ""
      if (title.isEmpty() && text.isEmpty() && big.isEmpty()) return
      val event = JSONObject()
      event.put("key", sbn.key ?: "")
      event.put("at", sbn.postTime.toDouble())
      event.put("title", title.take(300))
      event.put("text", text.take(600))
      event.put("bigText", big.take(900))
      event.put("subText", sub.take(200))
      event.put("channel", n.channelId ?: "")
      event.put("summary", (n.flags and Notification.FLAG_GROUP_SUMMARY) != 0)
      val prefs = applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      synchronized(PREFS) {
        val old = try { JSONArray(prefs.getString(KEY_QUEUE, "[]") ?: "[]") } catch (e: Exception) { JSONArray() }
        val next = JSONArray()
        val from = if (old.length() >= MAX_EVENTS) old.length() - MAX_EVENTS + 1 else 0
        for (i in from until old.length()) next.put(old.opt(i))
        next.put(event)
        prefs.edit().putString(KEY_QUEUE, next.toString()).apply()
      }
      onEvent?.invoke(event.toString())
    } catch (e: Exception) {
      // A listener must never crash the process: a notification it cannot read is simply skipped.
    }
  }
}
