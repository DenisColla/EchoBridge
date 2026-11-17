package expo.modules.vintedbridge

import android.content.ComponentName
import android.content.Context
import android.app.NotificationManager
import android.content.Intent
import android.os.PowerManager
import android.provider.Settings
import androidx.core.os.bundleOf
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

/**
 * JS bridge: whether the notification access is granted, the settings screen that grants it, the queue of Vinted's
 * notifications, and the text shared into the app from Vinted's «Condividi».
 */
class VintedBridgeModule : Module() {
  private var lastSharedKey: String? = null

  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context lost" }

  private fun sharedTextOf(intent: Intent?): String? {
    if (intent == null || intent.action != Intent.ACTION_SEND) return null
    val type = intent.type ?: return null
    if (!type.startsWith("text/")) return null
    return intent.getStringExtra(Intent.EXTRA_TEXT)
  }

  override fun definition() = ModuleDefinition {
    Name("VintedBridge")

    Events("onVintedNotification", "onSharedText")

    Function("isListenerEnabled") {
      val flat = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners") ?: ""
      val mine = ComponentName(context, VintedNotificationService::class.java)
      flat.split(":").any { ComponentName.unflattenFromString(it) == mine }
    }

    Function("openListenerSettings") {
      val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      true
    }

    Function("openAppSettings") {
      val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:" + context.packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      true
    }

    Function("readEvents") {
      VintedNotificationService.readQueue(context)
    }

    Function("clearEvents") { upTo: Double ->
      VintedNotificationService.clearQueue(context, upTo)
      true
    }

    // 1.15: the service that keeps a hunt reading with the app behind. Started with the app in front, by the user
    // starting a job; every call answers false instead of failing.
    Function("startWatchService") { title: String, text: String ->
      try {
        val intent = Intent(context, WatchKeepAliveService::class.java)
          .putExtra(WatchKeepAliveService.EXTRA_TITLE, title)
          .putExtra(WatchKeepAliveService.EXTRA_TEXT, text)
        context.startService(intent)
        true
      } catch (e: Throwable) {
        WatchKeepAliveService.lastError = "start " + e.javaClass.simpleName + ": " + (e.message ?: "")
        false
      }
    }

    Function("updateWatchService") { title: String, text: String ->
      try {
        if (!WatchKeepAliveService.running) false else {
          val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
          manager.notify(WatchKeepAliveService.NOTIFICATION_ID, WatchKeepAliveService.notificationOf(context, title, text))
          true
        }
      } catch (e: Throwable) {
        false
      }
    }

    Function("stopWatchService") {
      try {
        context.stopService(Intent(context, WatchKeepAliveService::class.java))
      } catch (e: Throwable) {
        false
      }
    }

    Function("watchServiceState") {
      bundleOf("running" to WatchKeepAliveService.running, "error" to WatchKeepAliveService.lastError)
    }

    // Whether Android lets the app work without battery restrictions («Senza restrizioni»).
    Function("isBatteryUnrestricted") {
      try {
        (context.getSystemService(Context.POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(context.packageName)
      } catch (e: Throwable) {
        false
      }
    }

    // The text of a «Condividi» that opened the app, once: the same intent is not handed out twice.
    Function("getSharedText") {
      val intent = appContext.currentActivity?.intent
      val text = sharedTextOf(intent)
      val key = if (text != null) text + "|" + (intent?.getLongExtra("ovt_seen", 0L) ?: 0L) + "|" + System.identityHashCode(intent) else null
      if (text == null || key == lastSharedKey) null else {
        lastSharedKey = key
        text
      }
    }

    OnNewIntent { intent ->
      val text = sharedTextOf(intent)
      if (text != null) {
        lastSharedKey = text + "|0|" + System.identityHashCode(intent)
        sendEvent("onSharedText", bundleOf("text" to text))
      }
    }

    OnStartObserving("onVintedNotification") {
      val weak = WeakReference(this@VintedBridgeModule)
      VintedNotificationService.onEvent = { json -> weak.get()?.sendEvent("onVintedNotification", bundleOf("event" to json)) }
    }

    OnStopObserving("onVintedNotification") {
      VintedNotificationService.onEvent = null
    }
  }
}
