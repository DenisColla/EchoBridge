package expo.modules.vintedbridge

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.webkit.CookieManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONTokener

/**
 * Vinted's own renewal of the session, left to a browser that has no screen (1.18.3).
 *
 * About two hours after the last visit Vinted answers every page with a small one titled «Session refresh»: its
 * script asks Vinted for a new session and then goes on to the page that was asked for. A plain download runs no
 * script, so it gets that page for ever (the night of 17 November 2026: 43 readings out of 48 read nothing).
 *
 * Here the page is opened in a WebView — the same browser engine and the same cookies as the in-app browser, and as
 * the app's own downloads — and left to do what it does. As soon as it moves on to the page asked for, the WebView
 * is closed. Nothing is typed, clicked or answered in the page's place, and no request of Vinted's is written by
 * hand: if Vinted asks for anything else (a check, a login), this stops and says what it saw.
 *
 * Only pages of www.vinted.* are opened. What goes back to the app is how it went: never a cookie.
 */
object SessionRenewal {
  private const val REFRESH_PATH = "session-refresh"
  private const val REFRESH_TITLE = "session refresh"
  private const val EXPIRE_PATH = "expire-cookies"
  private val VINTED_HOST = Regex("^www\\.vinted\\.[a-z.]{2,8}$")

  @Volatile
  private var running = false

  fun isVinted(url: String): Boolean {
    return try {
      val uri = Uri.parse(url)
      uri.scheme == "https" && VINTED_HOST.matches(uri.host ?: "")
    } catch (e: Throwable) {
      false
    }
  }

  private fun pathOf(url: String?): String? = try { Uri.parse(url ?: "").path } catch (e: Throwable) { null }

  /** `evaluateJavascript` hands a JSON value: «"Session refresh"» → Session refresh. */
  private fun textOf(raw: String?): String? = try { JSONTokener(raw ?: "null").nextValue() as? String } catch (e: Throwable) { null }

  /**
   * Opens `url` and waits until Vinted's refresh page has moved on (or the page asked for has loaded with no refresh
   * at all). Call on the main thread; `done` is called once, on the main thread, with
   * { ok, outcome, sawRefresh, pages, path, title, ms, error }.
   * outcome: «rinnovata» the refresh page moved on · «non_serviva» the page loaded with no refresh ·
   * «scaduta» Vinted closed the session (its refresh failed) · «tempo» nothing within the time · «rete» the page did
   * not load · «occupato» another renewal is running · «errore» no browser could be made.
   */
  @SuppressLint("SetJavaScriptEnabled")
  fun run(context: Context, url: String, timeoutMs: Long, done: (Map<String, Any?>) -> Unit) {
    val started = SystemClock.elapsedRealtime()
    if (running) {
      done(mapOf("ok" to false, "outcome" to "occupato", "ms" to 0))
      return
    }
    running = true
    val handler = Handler(Looper.getMainLooper())
    var finished = false
    var sawRefresh = false
    var pages = 0
    var lastUrl: String? = null
    var lastTitle: String? = null
    var web: WebView? = null

    fun finish(ok: Boolean, outcome: String, error: String? = null) {
      if (finished) return
      finished = true
      handler.removeCallbacksAndMessages(null)
      val result = mapOf(
        "ok" to ok, "outcome" to outcome, "sawRefresh" to sawRefresh, "pages" to pages, "path" to pathOf(lastUrl),
        "title" to lastTitle?.take(60), "ms" to (SystemClock.elapsedRealtime() - started).toInt(), "error" to error,
      )
      val closing = web
      web = null
      // Not from inside the browser's own callback: on the next turn of the main thread.
      handler.post {
        try { CookieManager.getInstance().flush() } catch (e: Throwable) { /* the cookies are in memory all the same */ }
        try {
          closing?.stopLoading()
          closing?.setWebViewClient(WebViewClient())
          closing?.destroy()
        } catch (e: Throwable) { /* nothing more to close */ }
        running = false
        done(result)
      }
    }

    try {
      val view = WebView(context.applicationContext)
      web = view
      view.settings.javaScriptEnabled = true
      view.settings.domStorageEnabled = true
      CookieManager.getInstance().setAcceptCookie(true)
      view.resumeTimers()
      view.setWebViewClient(object : WebViewClient() {
        override fun onPageStarted(v: WebView, startedUrl: String, favicon: Bitmap?) {
          if (finished) return
          pages += 1
          lastUrl = startedUrl
          if (startedUrl.contains(EXPIRE_PATH)) finish(false, "scaduta")
          else if (startedUrl.contains(REFRESH_PATH)) sawRefresh = true
          // The refresh page has gone on to the page asked for: the session is renewed, the rest is not needed.
          else if (sawRefresh) finish(true, "rinnovata")
        }

        override fun onPageFinished(v: WebView, finishedUrl: String) {
          if (finished) return
          lastUrl = finishedUrl
          if (finishedUrl.contains(REFRESH_PATH)) {
            sawRefresh = true
            return
          }
          v.evaluateJavascript("document.title") { raw ->
            if (finished) return@evaluateJavascript
            lastTitle = textOf(raw)
            if ((lastTitle ?: "").trim().lowercase() == REFRESH_TITLE) sawRefresh = true
            else finish(true, if (sawRefresh) "rinnovata" else "non_serviva")
          }
        }

        override fun onReceivedError(v: WebView, request: WebResourceRequest, error: WebResourceError) {
          if (!finished && request.isForMainFrame) finish(false, "rete", error.description?.toString()?.take(80))
        }
      })
      handler.postDelayed({ finish(false, "tempo", "timeout") }, timeoutMs)
      view.loadUrl(url)
    } catch (e: Throwable) {
      finish(false, "errore", (e.message ?: e.javaClass.simpleName).take(120))
    }
  }
}
