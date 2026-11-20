package it.posaviva.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
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
 *   window.AndroidBridge.{saveImage, saveTextFile, shareImage, vibrate, getDeviceInfo}
 *   window.__onAndroidBack()  -> return true if the page consumed the back gesture
 *   window.__onInsets({top,right,bottom,left})  + CSS vars --safe-top/right/bottom/left
 */
public class MainActivity extends Activity {
    private static final String TAG = "PosaViva";
    private static final int REQUEST_FILE_CHOOSER = 1001;
    private static final int BACKGROUND = 0xFF121318;

    /** Sets the CSS variables, remembers the insets and notifies the page. Argument: {top,right,bottom,left} in CSS px. */
    private static final String INSETS_JS =
            "(function(i){"
            + "window.__androidInsets=i;"
            + "function apply(){var d=document.documentElement;if(!d)return false;var s=d.style;"
            + "s.setProperty('--safe-top',i.top+'px');s.setProperty('--safe-right',i.right+'px');"
            + "s.setProperty('--safe-bottom',i.bottom+'px');s.setProperty('--safe-left',i.left+'px');return true;}"
            + "if(!apply()){var mo=new MutationObserver(function(){if(apply())mo.disconnect();});"
            + "mo.observe(document,{childList:true});}"
            + "try{window.__onInsets&&window.__onInsets(i);}catch(e){console.error(e);}"
            + "})";

    private static final String BACK_JS =
            "(window.__onAndroidBack && window.__onAndroidBack()) ? 'handled' : 'no'";

    private FrameLayout root;
    private WebView webView;
    private AssetServer assetServer;
    private ScriptHandler insetsStartScript;
    private OnBackInvokedCallback backCallback;
    private ValueCallback<Uri[]> pendingFileCallback;
    private String insetsJson = "{\"top\":0,\"right\":0,\"bottom\":0,\"left\":0}";
    private int imePaddingPx = -1;

    // ---------------------------------------------------------------------------------
    // Lifecycle

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        enableEdgeToEdge(window);
        WindowManager.LayoutParams lp = window.getAttributes();
        lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
        applyHighestRefreshRate(lp);                        // 120 Hz on the S25 Ultra
        window.setAttributes(lp);

        root = new FrameLayout(this);
        root.setBackgroundColor(BACKGROUND);
        root.setOnApplyWindowInsetsListener(this::onApplyInsets);
        setContentView(root);
        enterImmersive();

        WebView.setWebContentsDebuggingEnabled(
                (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        assetServer = new AssetServer(this);
        createWebView();
        webView.loadUrl(AssetServer.START_URL);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            backCallback = this::handleBack;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
        enterImmersive();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();   // page gets visibilitychange -> hidden
        super.onPause();
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
        destroyWebView();
        super.onDestroy();
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
        wv.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, true);

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
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            // Never let the system "force dark" recolour the 3D app's UI.
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(s, false);
        }

        wv.addJavascriptInterface(new AndroidBridge(this), "AndroidBridge");
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
     */
    private WindowInsets onApplyInsets(View v, WindowInsets insets) {
        Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
        Insets ime = insets.getInsets(WindowInsets.Type.ime());

        if (ime.bottom != imePaddingPx) {
            imePaddingPx = ime.bottom;
            v.setPadding(0, 0, 0, ime.bottom);
        }

        float density = getResources().getDisplayMetrics().density;
        int bottom = Math.max(0, safe.bottom - ime.bottom);
        String json = String.format(Locale.US, "{\"top\":%d,\"right\":%d,\"bottom\":%d,\"left\":%d}",
                cssPx(safe.top, density), cssPx(safe.right, density),
                cssPx(bottom, density), cssPx(safe.left, density));
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

    /** Picks the fastest mode at the current resolution (e.g. 120 Hz) for this window. */
    private void applyHighestRefreshRate(WindowManager.LayoutParams lp) {
        try {
            Display display = getDisplay();
            if (display == null) return;
            Display.Mode current = display.getMode();
            Display.Mode best = current;
            for (Display.Mode m : display.getSupportedModes()) {
                if (m.getPhysicalWidth() == current.getPhysicalWidth()
                        && m.getPhysicalHeight() == current.getPhysicalHeight()
                        && m.getRefreshRate() > best.getRefreshRate() + 0.5f) {
                    best = m;
                }
            }
            lp.preferredDisplayModeId = best.getModeId();
            lp.preferredRefreshRate = best.getRefreshRate();
        } catch (RuntimeException e) {
            Log.w(TAG, "Cannot select refresh rate", e);
        }
    }

    private String versionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "0";
        }
    }
}
