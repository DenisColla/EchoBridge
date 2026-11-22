package it.posaviva.app;

import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.provider.MediaStore;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Display;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Base64;
import java.util.Date;
import java.util.Locale;

/**
 * Exposed to the page as {@code window.AndroidBridge}.
 *
 * All {@link JavascriptInterface} methods run on WebView's "JavaBridge" binder
 * thread (never the UI thread), so blocking I/O here does not stall rendering;
 * only the calling JS waits for the return value. UI work is posted to the UI thread.
 */
final class AndroidBridge {
    private static final String TAG = "PosaViva";
    private static final String FOLDER = "PosaViva";

    private final MainActivity activity;
    private final Context app;
    private final SpeechBridge speech;

    AndroidBridge(MainActivity activity, SpeechBridge speech) {
        this.activity = activity;
        this.app = activity.getApplicationContext();
        this.speech = speech;
    }

    // ---------------------------------------------------------------------------------
    // Voice commands (window.__onSpeech receives {state|partial|final|level|error})

    /** Starts speech recognition (asks for RECORD_AUDIO first if needed). "ok" or "error:&lt;code&gt;". */
    @JavascriptInterface
    public String startListening(String lang) {
        return speech.start(lang);
    }

    /** Stops listening and delivers the final result. */
    @JavascriptInterface
    public void stopListening() {
        speech.stop();
    }

    /** Stops listening without a result. */
    @JavascriptInterface
    public void cancelListening() {
        speech.cancel();
    }

    /** "true" if a speech recognition service is available on the device. */
    @JavascriptInterface
    public boolean speechAvailable() {
        return speech.available();
    }

    // ---------------------------------------------------------------------------------
    // Images

    /**
     * Saves a PNG (base64, with or without a "data:image/png;base64," prefix) to
     * Pictures/PosaViva via MediaStore. No storage permission needed (API 29+).
     *
     * @return "ok:&lt;content uri&gt;" or "error:&lt;message&gt;"
     */
    @JavascriptInterface
    public String saveImage(String base64Png, String displayName) {
        try {
            byte[] bytes = decodeBase64(base64Png);
            String mime = sniffImageMime(bytes);
            String name = fileName(displayName, imageExtension(mime), true);

            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/" + FOLDER);
            v.put(MediaStore.Images.Media.DATE_TAKEN, System.currentTimeMillis());
            Uri uri = insert(MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), v, bytes);
            return "ok:" + uri;
        } catch (Throwable t) {
            Log.e(TAG, "saveImage failed", t);
            return "error:" + message(t);
        }
    }

    /**
     * Writes the image to the app cache and opens the Android share sheet
     * (FileProvider content:// URI, read permission granted to the target app).
     */
    @JavascriptInterface
    public void shareImage(String base64Png, String displayName) {
        try {
            byte[] bytes = decodeBase64(base64Png);
            String mime = sniffImageMime(bytes);
            String name = fileName(displayName, imageExtension(mime), true);

            File dir = new File(app.getCacheDir(), "shared");
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("cannot create " + dir);
            pruneOldShares(dir);
            File file = new File(dir, name);
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(bytes);
            }

            Uri uri = FileProvider.getUriForFile(app, app.getPackageName() + ".fileprovider", file);
            Intent send = new Intent(Intent.ACTION_SEND)
                    .setType(mime)
                    .putExtra(Intent.EXTRA_STREAM, uri)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            send.setClipData(ClipData.newRawUri(name, uri)); // thumbnail preview in the share sheet
            Intent chooser = Intent.createChooser(send, activity.getString(R.string.share_image_title));
            activity.runOnUiThread(() -> {
                try {
                    activity.startActivity(chooser);
                } catch (ActivityNotFoundException e) {
                    Toast.makeText(activity, R.string.no_app_to_share, Toast.LENGTH_SHORT).show();
                }
            });
        } catch (Throwable t) {
            Log.e(TAG, "shareImage failed", t);
            activity.runOnUiThread(() ->
                    Toast.makeText(activity, R.string.share_failed, Toast.LENGTH_SHORT).show());
        }
    }

    // ---------------------------------------------------------------------------------
    // Text files (scenes, poses as JSON)

    /**
     * Saves text to Download/PosaViva via MediaStore.Downloads (no permission needed).
     * If displayName has an extension it decides the stored MIME type (so Android never
     * renames "scena.json" to "scena.json.txt"); mimeType is used when it has none.
     *
     * @return "ok:&lt;content uri&gt;" or "error:&lt;message&gt;"
     */
    @JavascriptInterface
    public String saveTextFile(String content, String displayName, String mimeType) {
        try {
            String name = fileName(displayName, null, false);
            String mime = textMime(name, mimeType);
            if (name.indexOf('.') < 0) {
                String ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime);
                if (ext != null) name = name + "." + ext;
            }

            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + FOLDER);
            byte[] bytes = (content == null ? "" : content).getBytes(StandardCharsets.UTF_8);
            Uri uri = insert(MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), v, bytes);
            return "ok:" + uri;
        } catch (Throwable t) {
            Log.e(TAG, "saveTextFile failed", t);
            return "error:" + message(t);
        }
    }

    // ---------------------------------------------------------------------------------
    // Haptics and device info

    /** Short haptic feedback. 1..1000 ms; very short values use the device-tuned tick/click. */
    @JavascriptInterface
    public void vibrate(int ms) {
        if (ms <= 0) return;
        try {
            Vibrator vibrator;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                VibratorManager vm = app.getSystemService(VibratorManager.class);
                vibrator = vm != null ? vm.getDefaultVibrator() : null;
            } else {
                vibrator = app.getSystemService(Vibrator.class);
            }
            if (vibrator == null || !vibrator.hasVibrator()) return;
            VibrationEffect effect;
            if (ms <= 15) {
                effect = VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK);
            } else if (ms <= 30) {
                effect = VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK);
            } else {
                effect = VibrationEffect.createOneShot(Math.min(ms, 1000), VibrationEffect.DEFAULT_AMPLITUDE);
            }
            vibrator.vibrate(effect);
        } catch (Throwable t) {
            Log.w(TAG, "vibrate failed", t);
        }
    }

    /**
     * JSON: {model, manufacturer, sdkInt, release, density, refreshRate, maxRefreshRate,
     * widthPx, heightPx, appVersion, appVersionCode}.
     */
    @JavascriptInterface
    public String getDeviceInfo() {
        JSONObject o = new JSONObject();
        try {
            o.put("model", Build.MODEL);
            o.put("manufacturer", Build.MANUFACTURER);
            o.put("sdkInt", Build.VERSION.SDK_INT);
            o.put("release", Build.VERSION.RELEASE);
            DisplayMetrics dm = app.getResources().getDisplayMetrics();
            o.put("density", round2(dm.density));
            Display display = activity.getDisplay();
            if (display != null) {
                o.put("refreshRate", round2(display.getRefreshRate()));
                float max = 0f;
                for (Display.Mode m : display.getSupportedModes()) max = Math.max(max, m.getRefreshRate());
                o.put("maxRefreshRate", round2(max));
            }
            Rect bounds = activity.getWindowManager().getCurrentWindowMetrics().getBounds();
            o.put("widthPx", bounds.width());
            o.put("heightPx", bounds.height());
            PackageInfo pi = app.getPackageManager().getPackageInfo(app.getPackageName(), 0);
            o.put("appVersion", pi.versionName);
            o.put("appVersionCode", pi.getLongVersionCode());
        } catch (Throwable t) {
            Log.w(TAG, "getDeviceInfo incomplete", t);
        }
        return o.toString();
    }

    // ---------------------------------------------------------------------------------
    // Helpers

    /** Inserts a pending MediaStore row, writes the bytes, then publishes it. */
    private Uri insert(Uri collection, ContentValues values, byte[] bytes) throws IOException {
        ContentResolver resolver = app.getContentResolver();
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri uri = resolver.insert(collection, values);
        if (uri == null) throw new IOException("MediaStore insert failed");
        try {
            try (OutputStream out = resolver.openOutputStream(uri, "w")) {
                if (out == null) throw new IOException("cannot open " + uri);
                out.write(bytes);
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.MediaColumns.IS_PENDING, 0);
            resolver.update(uri, done, null, null);
            return uri;
        } catch (IOException | RuntimeException e) {
            try {
                resolver.delete(uri, null, null);
            } catch (RuntimeException ignored) {
                // best effort cleanup
            }
            throw e;
        }
    }

    /** Accepts plain base64 or a data: URL; ignores whitespace/line breaks. */
    static byte[] decodeBase64(String data) {
        if (data == null) throw new IllegalArgumentException("no data");
        String s = data;
        if (s.regionMatches(true, 0, "data:", 0, 5)) {
            int comma = s.indexOf(',');
            if (comma < 0) throw new IllegalArgumentException("malformed data URL");
            s = s.substring(comma + 1);
        }
        byte[] bytes = Base64.getMimeDecoder().decode(s);
        if (bytes.length == 0) throw new IllegalArgumentException("empty image");
        return bytes;
    }

    static String sniffImageMime(byte[] b) {
        if (b.length >= 3 && (b[0] & 0xFF) == 0xFF && (b[1] & 0xFF) == 0xD8 && (b[2] & 0xFF) == 0xFF) {
            return "image/jpeg";
        }
        if (b.length >= 12 && b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F'
                && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P') {
            return "image/webp";
        }
        return "image/png";
    }

    private static String imageExtension(String mime) {
        switch (mime) {
            case "image/jpeg": return "jpg";
            case "image/webp": return "webp";
            default: return "png";
        }
    }

    /**
     * Sanitises a user/JS supplied file name. Falls back to "PosaViva_yyyyMMdd_HHmmss".
     * With forceExt, any image extension is replaced by the real one.
     */
    static String fileName(String requested, String ext, boolean forceExt) {
        String name = requested == null ? "" : requested.trim();
        name = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").replaceAll("^\\.+", "");
        if (name.length() > 120) name = name.substring(0, 120);
        if (name.isEmpty()) {
            name = "PosaViva_" + new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date());
        }
        if (ext != null) {
            if (forceExt) name = name.replaceAll("(?i)\\.(png|jpe?g|webp)$", "");
            if (!name.toLowerCase(Locale.ROOT).endsWith("." + ext)) name = name + "." + ext;
        }
        return name;
    }

    private static String textMime(String name, String requested) {
        int dot = name.lastIndexOf('.');
        if (dot > 0 && dot < name.length() - 1) {
            String fromExt = MimeTypeMap.getSingleton()
                    .getMimeTypeFromExtension(name.substring(dot + 1).toLowerCase(Locale.ROOT));
            // Unknown extension: octet-stream makes MediaStore keep the name untouched.
            return fromExt != null ? fromExt : "application/octet-stream";
        }
        if (requested != null && requested.contains("/")) return requested.trim().toLowerCase(Locale.ROOT);
        return "text/plain";
    }

    private static void pruneOldShares(File dir) {
        File[] files = dir.listFiles();
        if (files == null) return;
        long cutoff = System.currentTimeMillis() - 30L * 60L * 1000L; // keep last 30 min
        for (File f : files) {
            if (f.lastModified() < cutoff && !f.delete()) Log.w(TAG, "cannot delete " + f);
        }
    }

    private static double round2(float v) {
        return Math.round(v * 100.0) / 100.0;
    }

    private static String message(Throwable t) {
        String m = t.getMessage();
        return t.getClass().getSimpleName() + (m != null ? ": " + m : "");
    }
}
