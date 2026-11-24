package it.posaviva.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.ActivityManager;
import android.app.AlertDialog;
import android.content.pm.PackageInfo;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.ClipData;
import android.content.ComponentCallbacks2;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ApplicationInfo;
import android.content.res.Configuration;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.util.Log;
import android.view.Display;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.MimeTypeMap;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import androidx.webkit.ScriptHandler;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * PosaViva shell: one full-screen, immersive WebView running the bundled Three.js app.
 *
 * JS contract:
 *   window.AndroidBridge.{saveImage, saveTextFile, shareImage, vibrate, getDeviceInfo,
 *                         startListening, stopListening, cancelListening, speechAvailable}
 *   window.__onSpeech({state|partial|final|level|error, message}) -> voice commands
 *   window.__onAndroidBack()  -> return true if the page consumed the back gesture
 *   window.__onInsets({top,right,bottom,left,gestureLeft,gestureRight})
 *     + CSS vars --safe-top/right/bottom/left and --gesture-left/right
 *     (gesture* = width of the system back-gesture zones at the screen edges, 0 with
 *      3-button navigation: a horizontal drag that starts there is taken by the system)
 *   window.__onTrimMemory(level)  -> onTrimMemory / onLowMemory: the page drops caches
 *   window.__onDeviceState({thermal, powerSave}) -> heat / battery saver: lower fps, resolution
 *   AndroidBridge.setPreferredFrameRate(fps) <- the page's quality preset (0 = fastest panel rate)
 */
public class MainActivity extends Activity {
    private static final String TAG = "PosaViva";
    private static final int REQUEST_FILE_CHOOSER = 1001;
    private static final int BACKGROUND = 0xFF0E0F13;   // = web --bg / theme-color

    /** Sets the CSS variables, remembers the insets and notifies the page. Argument: {top,right,bottom,left,gestureLeft,gestureRight} in CSS px. */
    private static final String INSETS_JS =
            "(function(i){"
            + "window.__androidInsets=i;"
            + "function apply(){var d=document.documentElement;if(!d)return false;var s=d.style;"
            + "s.setProperty('--safe-top',i.top+'px');s.setProperty('--safe-right',i.right+'px');"
            + "s.setProperty('--safe-bottom',i.bottom+'px');s.setProperty('--safe-left',i.left+'px');"
            + "s.setProperty('--gesture-left',(i.gestureLeft||0)+'px');s.setProperty('--gesture-right',(i.gestureRight||0)+'px');return true;}"
            + "if(!apply()){var mo=new MutationObserver(function(){if(apply())mo.disconnect();});"
            + "mo.observe(document,{childList:true});}"
            + "try{window.__onInsets&&window.__onInsets(i);}catch(e){console.error(e);}"
            + "})";

    private static final String BACK_JS =
            "(window.__onAndroidBack && window.__onAndroidBack()) ? 'handled' : 'no'";

    private FrameLayout root;
    private WebView webView;
    private AssetServer assetServer;
    private SpeechBridge speech;
    private ScriptHandler insetsStartScript;
    private OnBackInvokedCallback backCallback;
    private ValueCallback<Uri[]> pendingFileCallback;
    private String insetsJson = "{\"top\":0,\"right\":0,\"bottom\":0,\"left\":0,\"gestureLeft\":0,\"gestureRight\":0}";
    private int imePaddingPx = -1;
    private static final String PREFS = "posaviva.shell";
    /**
     * Oldest WebView (Chromium major) that runs the web app: the bundled three.js r187 uses
     * class static blocks (Chrome 94). Older WebViews would fail on the first script and
     * leave the splash on screen, so the user is sent to the Play Store instead.
     */
    static final int MIN_WEBVIEW_MAJOR = 94;
    /** frame rate asked by the page (0 = fastest), remembered so the next start uses it at once */
    private float preferredFps = 0f;
    /** total RAM (MB): decides how hard the WebView renderer holds on to memory */
    private long ramMB = 0;
    private PowerManager powerManager;
    private PowerManager.OnThermalStatusChangedListener thermalListener;
    private BroadcastReceiver powerSaveReceiver;

    // ---------------------------------------------------------------------------------
    // Lifecycle

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        preferredFps = getSharedPreferences(PREFS, MODE_PRIVATE).getFloat("fps", 0f);
        ActivityManager am = getSystemService(ActivityManager.class);
        if (am != null) {
            ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
            am.getMemoryInfo(mi);
            ramMB = mi.totalMem / (1024L * 1024L);
        }

        Window window = getWindow();
        enableEdgeToEdge(window);
        WindowManager.LayoutParams lp = window.getAttributes();
        lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
        applyRefreshRate(lp);                               // 120 Hz on the S25 Ultra / Tab S9, 60 on mid tier
        window.setAttributes(lp);

        root = new FrameLayout(this);
        root.setBackgroundColor(BACKGROUND);
        root.setOnApplyWindowInsetsListener(this::onApplyInsets);
        setContentView(root);
        enterImmersive();

        WebView.setWebContentsDebuggingEnabled(
                (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        assetServer = new AssetServer(this);
        speech = new SpeechBridge(this, this::emitSpeech);
        createWebView();
        if (checkWebViewVersion()) webView.loadUrl(AssetServer.START_URL);
        watchDeviceState();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            backCallback = this::handleBack;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
            webView.getSettings().setOffscreenPreRaster(preRasterWanted());
        }
        enterImmersive();
    }

    @Override
    protected void onPause() {
        if (speech != null) speech.release();      // never keep the microphone in the background
        if (webView != null) webView.onPause();   // page gets visibilitychange -> hidden
        super.onPause();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == SpeechBridge.REQUEST_RECORD_AUDIO) {
            speech.onPermissionResult(grantResults.length > 0 && grantResults[0] == android.content.pm.PackageManager.PERMISSION_GRANTED);
            return;
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }

    /** Speech events -> window.__onSpeech(json) (UI thread). */
    private void emitSpeech(String json) {
        runOnUiThread(() -> {
            if (webView != null) webView.evaluateJavascript("window.__onSpeech&&window.__onSpeech(" + json + ")", null);
        });
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) enterImmersive();            // e.g. after the share sheet or a picker
    }

    @Override
    protected void onDestroy() {
        if (backCallback != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
        }
        if (pendingFileCallback != null) {
            pendingFileCallback.onReceiveValue(null);
            pendingFileCallback = null;
        }
        if (speech != null) speech.release();
        unwatchDeviceState();
        destroyWebView();
        super.onDestroy();
    }

    // ---------------------------------------------------------------------------------
    // Memory, heat, battery

    /**
     * Memory pressure: the page drops caches (screen render targets, materials of styles not
     * shown, thumbnails); in the background it also releases its big GPU buffers, which lowers
     * the chance that Android kills the WebView renderer (the scene is autosaved anyway).
     */
    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) notifyTrim(level);
        if (webView != null && (level >= ComponentCallbacks2.TRIM_MEMORY_BACKGROUND
                || level == ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL)) {
            webView.getSettings().setOffscreenPreRaster(false);   // restored in onResume
        }
    }

    @Override
    public void onLowMemory() {
        super.onLowMemory();
        notifyTrim(ComponentCallbacks2.TRIM_MEMORY_COMPLETE);
    }

    private void notifyTrim(int level) {
        if (webView != null) webView.evaluateJavascript("window.__onTrimMemory&&window.__onTrimMemory(" + level + ")", null);
    }

    /**
     * True when the installed WebView can run the app. Otherwise shows a dialog that opens
     * the Play Store page of Android System WebView ("Prova comunque" loads the app anyway).
     */
    private boolean checkWebViewVersion() {
        String version = null;
        int major = Integer.MAX_VALUE;
        try {
            PackageInfo pi = WebViewCompat.getCurrentWebViewPackage(this);
            if (pi != null && pi.versionName != null) {
                version = pi.versionName;
                major = Integer.parseInt(version.split("\\.")[0].trim());
            }
        } catch (RuntimeException e) {
            Log.w(TAG, "Cannot read the WebView version", e);
        }
        if (major >= MIN_WEBVIEW_MAJOR) return true;
        Log.w(TAG, "WebView too old: " + version);
        final String pkg = WebViewCompat.getCurrentWebViewPackage(this) != null
                ? WebViewCompat.getCurrentWebViewPackage(this).packageName : "com.google.android.webview";
        new AlertDialog.Builder(this)
                .setTitle(R.string.webview_old_title)
                .setMessage(getString(R.string.webview_old_text, version, MIN_WEBVIEW_MAJOR))
                .setCancelable(false)
                .setPositiveButton(R.string.webview_old_update, (d, w) -> {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + pkg)));
                    } catch (ActivityNotFoundException e) {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + pkg)));
                    }
                    finish();
                })
                .setNegativeButton(R.string.webview_old_try, (d, w) -> {
                    if (webView != null) webView.loadUrl(AssetServer.START_URL);
                })
                .show();
        return false;
    }

    /** Thermal status (API 29+) and battery saver -> window.__onDeviceState. */
    private void watchDeviceState() {
        powerManager = getSystemService(PowerManager.class);
        if (powerManager == null) return;
        thermalListener = status -> pushDeviceState();
        try {
            powerManager.addThermalStatusListener(getMainExecutor(), thermalListener);
        } catch (RuntimeException e) {
            thermalListener = null;
        }
        powerSaveReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                pushDeviceState();
            }
        };
        IntentFilter filter = new IntentFilter(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(powerSaveReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(powerSaveReceiver, filter);
        }
    }

    private void unwatchDeviceState() {
        if (powerManager != null && thermalListener != null) {
            try {
                powerManager.removeThermalStatusListener(thermalListener);
            } catch (RuntimeException ignored) {
                // already gone
            }
        }
        thermalListener = null;
        if (powerSaveReceiver != null) {
            try {
                unregisterReceiver(powerSaveReceiver);
            } catch (RuntimeException ignored) {
                // not registered
            }
            powerSaveReceiver = null;
        }
    }

    private void pushDeviceState() {
        if (webView == null || powerManager == null) return;
        String js = String.format(Locale.US, "window.__onDeviceState&&window.__onDeviceState({thermal:%d,powerSave:%b})",
                powerManager.getCurrentThermalStatus(), powerManager.isPowerSaveMode());
        webView.evaluateJavascript(js, null);
    }

    /**
     * Rasterise the (small) DOM layers while the WebView is off screen (recents, split screen
     * transitions): it comes back without a blank flash. Skipped on devices with little RAM.
     */
    private boolean preRasterWanted() {
        return ramMB == 0 || ramMB >= 5000;
    }

    // ---------------------------------------------------------------------------------
    // WebView

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    private void createWebView() {
        WebView wv = new WebView(this);
        wv.setBackgroundColor(BACKGROUND);
        wv.setOverScrollMode(View.OVER_SCROLL_NEVER);
        wv.setVerticalScrollBarEnabled(false);
        wv.setHorizontalScrollBarEnabled(false);
        // The renderer (WebGL scene) keeps an important priority while visible. With 8 GB of
        // RAM or more (S25 Ultra, Tab S9 / S9+, Nord 2 8-12 GB) it also keeps it in the
        // background, so switching to a drawing app and back does not reload the scene; on
        // smaller devices (Tab S6 6 GB) it is waived in the background, as Android advises.
        wv.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, ramMB > 0 && ramMB < 7000);

        WebSettings s = wv.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setGeolocationEnabled(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(s.getUserAgentString() + " PosaVivaAndroid/" + versionName());
        s.setOffscreenPreRaster(preRasterWanted());
        // Everything is served from the APK by AssetServer: no HTTP cache needed.
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        // GPU compositing is on (application hardwareAccelerated="true"). The WebView keeps the
        // default LAYER_TYPE_NONE: a hardware layer would add an extra full-screen copy per frame.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            // Never let the system "force dark" recolour the 3D app's UI.
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(s, false);
        }

        wv.addJavascriptInterface(new AndroidBridge(this, speech), "AndroidBridge");
        wv.setWebViewClient(new ShellWebViewClient());
        wv.setWebChromeClient(new ShellChromeClient());

        root.addView(wv, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webView = wv;
        insetsStartScript = null;
        updateInsetsStartScript();
    }

    private void destroyWebView() {
        if (webView == null) return;
        WebView wv = webView;
        webView = null;
        insetsStartScript = null;
        root.removeView(wv);
        wv.stopLoading();
        wv.setWebChromeClient(null);
        wv.destroy();
    }

    private final class ShellWebViewClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            return assetServer.intercept(request.getUrl());
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            String scheme = url.getScheme() == null ? "" : url.getScheme().toLowerCase(Locale.ROOT);
            if (AssetServer.isAppUrl(url) || !request.isForMainFrame()
                    || scheme.equals("blob") || scheme.equals("data") || scheme.equals("about")) {
                return false;                       // stays inside the app
            }
            // Any other link (https, mailto, ...) opens outside the app.
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, url)
                        .addCategory(Intent.CATEGORY_BROWSABLE)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } catch (ActivityNotFoundException e) {
                Log.w(TAG, "No app for " + url);
            }
            return true;
        }

        @Override
        public void onPageCommitVisible(WebView view, String url) {
            pushInsets();
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            pushInsets();
            pushDeviceState();
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // A WebGL-heavy page can get its renderer killed (e.g. low memory in background).
            // Recover with a fresh WebView instead of letting the whole app crash.
            Log.e(TAG, "WebView renderer gone (crashed=" + detail.didCrash() + "), reloading");
            if (view == webView) {
                destroyWebView();
                createWebView();
                webView.loadUrl(AssetServer.START_URL);
                root.requestApplyInsets();
            }
            return true;
        }
    }

    // ---------------------------------------------------------------------------------
    // <input type="file">

    private final class ShellChromeClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                         FileChooserParams params) {
            if (pendingFileCallback != null) pendingFileCallback.onReceiveValue(null);
            pendingFileCallback = callback;
            boolean multiple = params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE;
            List<String> mimes = acceptedMimeTypes(params.getAcceptTypes());
            try {
                startActivityForResult(pickerIntent(Intent.ACTION_OPEN_DOCUMENT, mimes, multiple),
                        REQUEST_FILE_CHOOSER);
                return true;
            } catch (ActivityNotFoundException e) {
                try {
                    Intent fallback = Intent.createChooser(
                            pickerIntent(Intent.ACTION_GET_CONTENT, mimes, multiple),
                            getString(R.string.file_chooser_title));
                    startActivityForResult(fallback, REQUEST_FILE_CHOOSER);
                    return true;
                } catch (ActivityNotFoundException e2) {
                    pendingFileCallback = null;
                    Toast.makeText(MainActivity.this, R.string.no_file_picker, Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        }
    }

    /**
     * Maps the page's accept list (".json", "application/json", "image/*", ...) to MIME types.
     * Only pure media filters (image/video/audio) are applied; anything else, including
     * JSON (often reported as text/plain or octet-stream by providers), shows all files.
     */
    private static List<String> acceptedMimeTypes(String[] accept) {
        List<String> out = new ArrayList<>();
        if (accept != null) {
            for (String raw : accept) {
                if (raw == null) continue;
                for (String part : raw.split(",")) {
                    String a = part.trim().toLowerCase(Locale.ROOT);
                    if (a.isEmpty()) continue;
                    String mime = a.startsWith(".")
                            ? MimeTypeMap.getSingleton().getMimeTypeFromExtension(a.substring(1))
                            : (a.contains("/") ? a : null);
                    if (mime == null) return Collections.emptyList();
                    if (!out.contains(mime)) out.add(mime);
                }
            }
        }
        for (String m : out) {
            if (!(m.startsWith("image/") || m.startsWith("video/") || m.startsWith("audio/"))) {
                return Collections.emptyList();   // e.g. application/json -> */*
            }
        }
        return out;
    }

    private static Intent pickerIntent(String action, List<String> mimes, boolean multiple) {
        Intent i = new Intent(action).addCategory(Intent.CATEGORY_OPENABLE);
        if (mimes.isEmpty()) {
            i.setType("*/*");
        } else {
            i.setType(mimes.size() == 1 ? mimes.get(0) : "*/*");
            i.putExtra(Intent.EXTRA_MIME_TYPES, mimes.toArray(new String[0]));
        }
        if (multiple) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        return i;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != REQUEST_FILE_CHOOSER) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        ValueCallback<Uri[]> callback = pendingFileCallback;
        pendingFileCallback = null;
        if (callback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null && clip.getItemCount() > 0) {
                result = new Uri[clip.getItemCount()];
                for (int i = 0; i < result.length; i++) result[i] = clip.getItemAt(i).getUri();
            } else if (data.getData() != null) {
                result = new Uri[]{data.getData()};
            }
        }
        callback.onReceiveValue(result);
    }

    // ---------------------------------------------------------------------------------
    // Back: ask the page first (close panel/menu/selection), otherwise leave the app.

    private void handleBack() {
        if (webView == null) {
            finish();
            return;
        }
        webView.evaluateJavascript(BACK_JS, result -> {
            if (!"\"handled\"".equals(result) && !"handled".equals(result)) finish();
        });
    }

    /**
     * Fallback for Android 11-12L (API 30-32) only. On 13+ the OnBackInvokedCallback
     * registered in onCreate handles back (manifest: enableOnBackInvokedCallback="true").
     */
    @Override
    @SuppressWarnings("deprecation")
    @SuppressLint("GestureBackNavigation")
    public void onBackPressed() {
        handleBack();
    }

    // ---------------------------------------------------------------------------------
    // Immersive mode, insets, refresh rate

    /** Edge-to-edge is enforced from API 35 when targeting 35+; older releases need the opt-in. */
    @SuppressWarnings("deprecation")
    private static void enableEdgeToEdge(Window window) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            window.setDecorFitsSystemWindows(false);
        }
    }

    private void enterImmersive() {
        WindowInsetsController c = getWindow().getInsetsController();
        if (c == null) return;
        c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        c.hide(WindowInsets.Type.systemBars());
    }

    /**
     * Safe area = visible system bars + display cutout (the punch-hole), in CSS px.
     * While the bars are hidden only the cutout counts; transient (swiped-in) bars overlay
     * the page without changing the insets. The keyboard (IME) shrinks the WebView instead.
     * gestureLeft/Right: the side back-gesture zones of gesture navigation (they stay active
     * in immersive mode), so the page can keep horizontal sliders out of them.
     */
    private WindowInsets onApplyInsets(View v, WindowInsets insets) {
        Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
        Insets ime = insets.getInsets(WindowInsets.Type.ime());
        // the edge swipes keep working while the bars are hidden: ignore the bars' visibility
        Insets gestures = insets.getInsetsIgnoringVisibility(WindowInsets.Type.systemGestures());

        if (ime.bottom != imePaddingPx) {
            imePaddingPx = ime.bottom;
            v.setPadding(0, 0, 0, ime.bottom);
        }

        float density = getResources().getDisplayMetrics().density;
        int bottom = Math.max(0, safe.bottom - ime.bottom);
        String json = String.format(Locale.US,
                "{\"top\":%d,\"right\":%d,\"bottom\":%d,\"left\":%d,\"gestureLeft\":%d,\"gestureRight\":%d}",
                cssPx(safe.top, density), cssPx(safe.right, density),
                cssPx(bottom, density), cssPx(safe.left, density),
                cssPx(gestures.left, density), cssPx(gestures.right, density));
        if (!json.equals(insetsJson)) {
            insetsJson = json;
            updateInsetsStartScript();
        }
        pushInsets();

        // The WebView below is already resized for the keyboard: don't let it see the IME inset too.
        return new WindowInsets.Builder(insets).setInsets(WindowInsets.Type.ime(), Insets.NONE).build();
    }

    private static int cssPx(int px, float density) {
        return px <= 0 ? 0 : (int) Math.ceil(px / density - 0.01f);
    }

    private void pushInsets() {
        if (webView != null) webView.evaluateJavascript(INSETS_JS + "(" + insetsJson + ");", null);
    }

    /**
     * Also injects the current insets as a document-start script, so the CSS variables
     * exist before the page's own scripts run (no layout jump on first frame).
     */
    private void updateInsetsStartScript() {
        if (webView == null || !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return;
        if (insetsStartScript != null) insetsStartScript.remove();
        insetsStartScript = WebViewCompat.addDocumentStartJavaScript(
                webView, INSETS_JS + "(" + insetsJson + ");", Collections.singleton(AssetServer.ORIGIN));
    }

    /**
     * Asks for the refresh rate wanted by the page at the current resolution: the fastest
     * the panel offers (120 Hz on the S25 Ultra / Tab S9 / S9+) when preferredFps is 0,
     * otherwise the slowest supported rate >= preferredFps (60 Hz on mid-tier devices such
     * as the Nord 2, whose 90 Hz panel would only spend battery and heat). Only the rate is
     * requested, never a display mode id: a mode id also pins the resolution, so after the
     * user switches FHD+/QHD+ in Settings (the activity is kept, see configChanges) the
     * window would force the old resolution back. Returns true when the attributes changed.
     */
    private boolean applyRefreshRate(WindowManager.LayoutParams lp) {
        try {
            Display display = getDisplay();
            if (display == null) return false;
            Display.Mode current = display.getMode();
            float best = 0f, fit = Float.MAX_VALUE;
            for (Display.Mode m : display.getSupportedModes()) {
                if (m.getPhysicalWidth() != current.getPhysicalWidth()
                        || m.getPhysicalHeight() != current.getPhysicalHeight()) continue;
                float r = m.getRefreshRate();
                best = Math.max(best, r);
                if (preferredFps > 0 && r >= preferredFps - 0.5f) fit = Math.min(fit, r);
            }
            if (best <= 0) best = current.getRefreshRate();
            float rate = preferredFps > 0 ? (fit < Float.MAX_VALUE ? fit : best) : best;
            if (lp.preferredDisplayModeId == 0 && Math.abs(lp.preferredRefreshRate - rate) < 0.01f) return false;
            lp.preferredDisplayModeId = 0;
            lp.preferredRefreshRate = rate;
            return true;
        } catch (RuntimeException e) {
            Log.w(TAG, "Cannot select refresh rate", e);
            return false;
        }
    }

    /** Called by AndroidBridge.setPreferredFrameRate on the UI thread. */
    void setPreferredFrameRate(float fps) {
        float f = Float.isNaN(fps) || fps < 0 ? 0f : fps;
        if (Math.abs(f - preferredFps) < 0.01f) return;
        preferredFps = f;
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putFloat("fps", f).apply();
        WindowManager.LayoutParams lp = getWindow().getAttributes();
        if (applyRefreshRate(lp)) getWindow().setAttributes(lp);
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // Resolution, density or display changes keep this activity (configChanges):
        // re-pick the refresh rate for the new mode list.
        WindowManager.LayoutParams lp = getWindow().getAttributes();
        if (applyRefreshRate(lp)) getWindow().setAttributes(lp);
    }

    private String versionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "0";
        }
    }
}
