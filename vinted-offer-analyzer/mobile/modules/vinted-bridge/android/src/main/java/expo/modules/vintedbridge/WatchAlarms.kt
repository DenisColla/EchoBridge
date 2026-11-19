package expo.modules.vintedbridge

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.core.os.bundleOf
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * The readings of a hunt, started by Android's own alarm clock (1.17). The app asks for one alarm at the moment of the
 * next reading; when it rings, WatchAlarmReceiver starts WatchTickService, which runs the app's background task
 * «OvtWatchTick» (the reading itself, in JavaScript) and stops when the task ends. It works with the app behind, the
 * screen off or the app closed, and nothing stays awake between one reading and the next.
 * What happened last (alarm set, alarm rung, task started, error) is kept for the diary.
 */
object WatchAlarms {
  const val TASK = "OvtWatchTick"
  private const val PREFS = "ovt-watch"
  private const val REQUEST = 41015
  private const val STATUS_ID = 41014
  const val TICK_ID = 41016
  private const val STATUS_CHANNEL = "ovt-watch"
  private const val TICK_CHANNEL = "ovt-watch-tick"

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun note(context: Context, key: String, at: Long) {
    prefs(context).edit().putLong(key, at).apply()
  }

  fun noteError(context: Context, text: String?) {
    prefs(context).edit().putString("error", text).putLong("errorAt", System.currentTimeMillis()).apply()
  }

  private fun pending(context: Context): PendingIntent {
    val intent = Intent(context, WatchAlarmReceiver::class.java).setAction("expo.modules.vintedbridge.WATCH_TICK")
    return PendingIntent.getBroadcast(context, REQUEST, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun canExact(context: Context): Boolean {
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    return Build.VERSION.SDK_INT < 31 || manager.canScheduleExactAlarms()
  }

  /** "exact", "inexact" (Android may delay it, and may not let the reading start with the app behind) or "failed". */
  fun schedule(context: Context, atMs: Long): String {
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val exact = canExact(context)
    return try {
      if (exact) {
        manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, pending(context))
      } else {
        manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, pending(context))
      }
      note(context, "scheduledAt", atMs)
      if (exact) "exact" else "inexact"
    } catch (e: Throwable) {
      noteError(context, "schedule " + e.javaClass.simpleName + ": " + (e.message ?: ""))
      "failed"
    }
  }

  fun cancel(context: Context) {
    try {
      (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(pending(context))
      note(context, "scheduledAt", 0L)
    } catch (e: Throwable) {
      noteError(context, "cancel " + e.javaClass.simpleName)
    }
  }

  fun info(context: Context) = bundleOf(
    "exact" to canExact(context),
    "scheduledAt" to prefs(context).getLong("scheduledAt", 0L).toDouble(),
    "firedAt" to prefs(context).getLong("firedAt", 0L).toDouble(),
    "tickAt" to prefs(context).getLong("tickAt", 0L).toDouble(),
    "error" to prefs(context).getString("error", null),
    "errorAt" to prefs(context).getLong("errorAt", 0L).toDouble(),
  )

  private fun notification(context: Context, channel: String, channelName: String, importance: Int, title: String, text: String): Notification {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(channel) == null) {
      manager.createNotificationChannel(NotificationChannel(channel, channelName, importance))
    }
    var icon = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
    if (icon == 0) icon = context.applicationInfo.icon
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
    val open = if (launch == null) null else PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    return NotificationCompat.Builder(context, channel)
      .setSmallIcon(icon)
      .setContentTitle(title)
      .setContentText(text)
      .setStyle(NotificationCompat.BigTextStyle().bigText(text))
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setContentIntent(open)
      .build()
  }

  /** The notification that says a job is running, between one reading and the next. */
  fun showStatus(context: Context, title: String, text: String): Boolean = try {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.notify(STATUS_ID, notification(context, STATUS_CHANNEL, "Ricerca in corso", NotificationManager.IMPORTANCE_LOW, title, text))
    true
  } catch (e: Throwable) {
    false
  }

  fun hideStatus(context: Context) {
    try {
      (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(STATUS_ID)
    } catch (e: Throwable) {
      // nothing to hide
    }
  }

  fun tickNotification(context: Context): Notification =
    notification(context, TICK_CHANNEL, "Lettura in corso", NotificationManager.IMPORTANCE_MIN, "Leggo la ricerca…", "")
}

/** The alarm rang: the reading starts, whatever the state of the app. */
class WatchAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    WatchAlarms.note(context, "firedAt", System.currentTimeMillis())
    try {
      ContextCompat.startForegroundService(context, Intent(context, WatchTickService::class.java))
    } catch (e: Throwable) {
      // Android did not allow it (an alarm that is not exact, with the app behind): the reading waits for the app.
      WatchAlarms.noteError(context, "start " + e.javaClass.simpleName + ": " + (e.message ?: ""))
    }
  }
}

/**
 * One reading: in the foreground for the seconds it takes, it runs the app's background task and stops when the task
 * ends (or after two minutes, whatever the task is doing).
 */
class WatchTickService : HeadlessJsTaskService() {
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    try {
      val notification = WatchAlarms.tickNotification(this)
      if (Build.VERSION.SDK_INT >= 34) {
        startForeground(WatchAlarms.TICK_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
      } else {
        startForeground(WatchAlarms.TICK_ID, notification)
      }
    } catch (e: Throwable) {
      WatchAlarms.noteError(this, "foreground " + e.javaClass.simpleName + ": " + (e.message ?: ""))
    }
    WatchAlarms.note(this, "tickAt", System.currentTimeMillis())
    return try {
      super.onStartCommand(intent, flags, startId)
      START_NOT_STICKY
    } catch (e: Throwable) {
      WatchAlarms.noteError(this, "task " + e.javaClass.simpleName + ": " + (e.message ?: ""))
      stopSelf()
      START_NOT_STICKY
    }
  }

  // Two minutes at most, and allowed with the app in front: the same alarm drives the readings there too.
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? = HeadlessJsTaskConfig(WatchAlarms.TASK, Arguments.createMap(), 120_000, true)
}
