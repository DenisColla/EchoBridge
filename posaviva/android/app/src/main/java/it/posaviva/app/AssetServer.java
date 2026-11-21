package it.posaviva.app;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceResponse;

import androidx.webkit.WebViewAssetLoader;

import java.io.ByteArrayInputStream;
import java.util.HashMap;
import java.util.Locale;

/**
 * Serves the bundled web app (APK assets/www, copied from posaviva/web/dist) on the
 * secure origin https://appassets.androidplatform.net via androidx.webkit's
 * WebViewAssetLoader + AssetsPathHandler, so ES modules, fetch() of binary files,
 * localStorage/IndexedDB and WebGL all behave like on a normal https site.
 *
 * URL mapping:
 *   /assets/&lt;path&gt;  -> assets/&lt;path&gt;      (start page: /assets/www/index.html)
 *   /&lt;path&gt;         -> assets/www/&lt;path&gt;  (fallback for root-absolute URLs, e.g. a Vite
 *                                           build with the default base "/")
 *   anything else on this host -> 404
 */
final class AssetServer {
    static final String DOMAIN = WebViewAssetLoader.DEFAULT_DOMAIN; // appassets.androidplatform.net
    static final String ORIGIN = "https://" + DOMAIN;
    static final String START_URL = ORIGIN + "/assets/www/index.html";

    private final WebViewAssetLoader loader;

    AssetServer(Context context) {
        final WebViewAssetLoader.AssetsPathHandler assets =
                new WebViewAssetLoader.AssetsPathHandler(context.getApplicationContext());
        loader = new WebViewAssetLoader.Builder()
                .setDomain(DOMAIN)
                .addPathHandler("/assets/", path -> serve(assets, path))
                .addPathHandler("/", path -> serve(assets, "www/" + path))
                .build();
    }

    /** True for URLs served by this class (the app's own origin). */
    static boolean isAppUrl(Uri url) {
        return url != null && "https".equals(url.getScheme()) && DOMAIN.equals(url.getHost());
    }

    /** Called from WebViewClient.shouldInterceptRequest (on a WebView worker thread). */
    WebResourceResponse intercept(Uri url) {
        if (url == null || !DOMAIN.equals(url.getHost())) return null; // not ours: default handling
        WebResourceResponse response = isAppUrl(url) ? loader.shouldInterceptRequest(url) : null;
        return response != null ? response : notFound();
    }

    private static WebResourceResponse serve(WebViewAssetLoader.AssetsPathHandler assets, String path) {
        if (path.isEmpty() || path.endsWith("/")) path += "index.html";
        WebResourceResponse r = assets.handle(path);
        // AssetsPathHandler answers a missing file with a null body: return null instead,
        // so the next path handler (the www/ fallback) gets a chance.
        if (r == null || r.getData() == null) return null;
        String mime = MimeTypes.forPath(path);
        if (mime != null) r.setMimeType(mime);
        if (MimeTypes.isText(r.getMimeType())) r.setEncoding("utf-8");
        return r;
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }

    /** Explicit MIME table: the platform guess is wrong or missing for several web formats. */
    static final class MimeTypes {
        private static final HashMap<String, String> MAP = new HashMap<>();

        static {
            String[][] table = {
                    {"html", "text/html"}, {"htm", "text/html"},
                    {"js", "text/javascript"}, {"mjs", "text/javascript"}, {"cjs", "text/javascript"},
                    {"css", "text/css"},
                    {"json", "application/json"}, {"map", "application/json"},
                    {"webmanifest", "application/manifest+json"},
                    {"wasm", "application/wasm"},
                    {"bin", "application/octet-stream"}, {"dat", "application/octet-stream"},
                    {"basis", "application/octet-stream"}, {"drc", "application/octet-stream"},
                    {"glb", "model/gltf-binary"}, {"gltf", "model/gltf+json"},
                    {"obj", "text/plain"}, {"mtl", "text/plain"}, {"txt", "text/plain"},
                    {"xml", "application/xml"}, {"svg", "image/svg+xml"},
                    {"png", "image/png"}, {"jpg", "image/jpeg"}, {"jpeg", "image/jpeg"},
                    {"webp", "image/webp"}, {"gif", "image/gif"}, {"avif", "image/avif"},
                    {"ico", "image/x-icon"}, {"ktx2", "image/ktx2"},
                    {"hdr", "application/octet-stream"}, {"exr", "image/x-exr"},
                    {"woff", "font/woff"}, {"woff2", "font/woff2"}, {"ttf", "font/ttf"}, {"otf", "font/otf"},
                    {"mp3", "audio/mpeg"}, {"ogg", "audio/ogg"}, {"wav", "audio/wav"},
                    {"mp4", "video/mp4"}, {"webm", "video/webm"},
            };
            for (String[] row : table) MAP.put(row[0], row[1]);
        }

        static String forPath(String path) {
            int slash = path.lastIndexOf('/');
            int dot = path.lastIndexOf('.');
            if (dot <= slash || dot == path.length() - 1) return null;
            return MAP.get(path.substring(dot + 1).toLowerCase(Locale.ROOT));
        }

        static boolean isText(String mime) {
            if (mime == null) return false;
            return mime.startsWith("text/") || mime.equals("application/json")
                    || mime.endsWith("+json") || mime.endsWith("+xml")
                    || mime.equals("application/xml") || mime.equals("application/javascript");
        }

        private MimeTypes() {}
    }
}
