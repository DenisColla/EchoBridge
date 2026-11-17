package expo.modules.vintedbridge

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Keeps the readings of a hunt going while the app is behind or the screen is off (1.15): a foreground service with
 * its own fixed notification, and a background task of React Native that lasts until the app ends it. While that
 * task is active the timers of the app keep firing and the phone does not go to sleep. It reads nothing itself, and
 * it is started only by the user starting a job.
 */
class WatchKeepAliveService : HeadlessJsTaskService() {
  private var taskStarted = false

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Ricerca in corso"
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: ""
    try {
      val notification = notificationOf(this, title, text)
      if (Build.VERSION.SDK_INT >= 34) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (e: Throwable) {
      // Not allowed now (the app is not in front, a permission is missing): no service, the readings go on as before.
      running = false
      lastError = e.javaClass.simpleName + ": " + (e.message ?: "")
      stopSelf()
      return START_NOT_STICKY
    }
    running = true
    lastError = null
    if (!taskStarted) {
      taskStarted = true
      try {
        super.onStartCommand(intent, flags, startId)
      } catch (e: Throwable) {
        lastError = "task " + e.javaClass.simpleName + ": " + (e.message ?: "")
      }
    }
    return START_NOT_STICKY
  }

  // No time limit, and allowed with the app in front: the user starts a job from the app itself.
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? = HeadlessJsTaskConfig(TASK, Arguments.createMap(), 0, true)

  override fun onDestroy() {
    running = false
    super.onDestroy()
  }

  companion object {
    const val TASK = "OvtWatchKeepAlive"
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    const val NOTIFICATION_ID = 41014
    private const val CHANNEL = "ovt-watch"

    @Volatile var running = false
    @Volatile var lastError: String? = null

    fun notificationOf(context: Context, title: String, text: String): Notification {
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(CHANNEL) == null) {
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Ricerca in corso", NotificationManager.IMPORTANCE_LOW))
      }
      var icon = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
      if (icon == 0) icon = context.applicationInfo.icon
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      val open = if (launch == null) null else PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      return NotificationCompat.Builder(context, CHANNEL)
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
  }
}
