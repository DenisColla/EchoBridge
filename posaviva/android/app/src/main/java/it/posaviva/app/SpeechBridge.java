package it.posaviva.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;

/**
 * Native speech recognition for the voice commands (Android System WebView has no
 * Web Speech API). Wraps {@link SpeechRecognizer}: on-device recognition when the
 * device offers it (API 31+), otherwise the default recognizer with
 * EXTRA_PREFER_OFFLINE. Results are streamed to the page as
 * {@code window.__onSpeech({state|partial|final|level|error, message})}.
 *
 * SpeechRecognizer must be created and used on the main thread: every public method
 * posts to it. RECORD_AUDIO is requested at runtime on the first use; a denial is
 * reported as {error: "permission", message: <Italian explanation>}.
 */
final class SpeechBridge {
    private static final String TAG = "PosaViva";
    static final int REQUEST_RECORD_AUDIO = 1002;
    /** Language-pack errors of the on-device recognizer (API 31+): retry with the default one. */
    private static final int ERROR_LANGUAGE_NOT_SUPPORTED = 12;
    private static final int ERROR_LANGUAGE_UNAVAILABLE = 13;
    private static final int ERROR_SERVER_DISCONNECTED = 11;
    private static final int ERROR_TOO_MANY_REQUESTS = 10;

    interface Emitter { void emit(String json); }

    private final MainActivity activity;
    private final Emitter emitter;
    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private boolean onDevice;
    private boolean onDeviceFailed;
    private String pendingLang;
    /** The runtime permission dialog pauses the activity: keep the pending start across it. */
    private boolean askingPermission;
    private String lang = "it-IT";
    private long lastLevelMs;
    private boolean active;

    SpeechBridge(MainActivity activity, Emitter emitter) {
        this.activity = activity;
        this.emitter = emitter;
    }

    /** True if some speech recognition service is installed. */
    boolean available() {
        return SpeechRecognizer.isRecognitionAvailable(activity)
                || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && SpeechRecognizer.isOnDeviceRecognitionAvailable(activity));
    }

    /** Called from the JS bridge thread. Returns "ok" or "error:&lt;code&gt;". */
    String start(String language) {
        if (!available()) return "error:unavailable";
        final String l = language == null || language.trim().isEmpty() ? "it-IT" : language.trim();
        main.post(() -> {
            if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                pendingLang = l;
                askingPermission = true;
                emit(state("starting"));
                activity.requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQUEST_RECORD_AUDIO);
                return;
            }
            begin(l);
        });
        return "ok";
    }

    void stop() { main.post(() -> { if (recognizer != null && active) recognizer.stopListening(); }); }

    void cancel() {
        main.post(() -> {
            pendingLang = null;
            if (recognizer != null) recognizer.cancel();
            if (active) { active = false; emit(state("idle")); }
        });
    }

    /** MainActivity forwards the permission answer here. */
    void onPermissionResult(boolean granted) {
        askingPermission = false;
        String l = pendingLang;
        pendingLang = null;
        if (l == null) return;
        if (granted) { begin(l); return; }
        boolean canAskAgain = activity.shouldShowRequestPermissionRationale(Manifest.permission.RECORD_AUDIO);
        emitError("permission", activity.getString(canAskAgain ? R.string.mic_permission_denied : R.string.mic_permission_blocked));
    }

    /** Activity paused / destroyed: free the microphone. */
    void release() {
        main.post(() -> {
            if (!askingPermission) pendingLang = null;
            if (recognizer != null) {
                try { recognizer.cancel(); recognizer.destroy(); } catch (RuntimeException e) { Log.w(TAG, "speech release", e); }
                recognizer = null;
            }
            if (active) { active = false; emit(state("idle")); }
        });
    }

    // ---------------------------------------------------------------------------------

    private void begin(String language) {
        lang = language;
        try {
            ensureRecognizer();
            Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, language)
                    .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                    .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
                    .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                    .putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1400L)
                    .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, activity.getPackageName());
            active = true;
            emit(state("starting"));
            recognizer.startListening(i);
        } catch (RuntimeException e) {
            Log.e(TAG, "speech start failed", e);
            active = false;
            emitError("unavailable", null);
        }
    }

    private void ensureRecognizer() {
        boolean wantOnDevice = !onDeviceFailed && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                && SpeechRecognizer.isOnDeviceRecognitionAvailable(activity);
        if (recognizer != null && onDevice == wantOnDevice) return;
        if (recognizer != null) recognizer.destroy();
        if (wantOnDevice) {
            recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(activity);
            onDevice = true;
        } else {
            recognizer = SpeechRecognizer.createSpeechRecognizer(activity);
            onDevice = false;
        }
        recognizer.setRecognitionListener(new Listener());
    }

    private final class Listener implements RecognitionListener {
        @Override public void onReadyForSpeech(Bundle params) { emit(state("listening")); }
        @Override public void onBeginningOfSpeech() { }
        @Override public void onRmsChanged(float rmsdB) {
            long now = SystemClock.uptimeMillis();
            if (now - lastLevelMs < 66) return; // ~15 updates per second are enough for the meter
            lastLevelMs = now;
            float v = Math.max(0f, Math.min(1f, (rmsdB + 2f) / 12f));
            emit("{\"level\":" + Math.round(v * 100) / 100.0 + "}");
        }
        @Override public void onBufferReceived(byte[] buffer) { }
        @Override public void onEndOfSpeech() { emit(state("processing")); }

        @Override public void onError(int error) {
            if (onDevice && (error == ERROR_LANGUAGE_NOT_SUPPORTED || error == ERROR_LANGUAGE_UNAVAILABLE || error == ERROR_SERVER_DISCONNECTED)) {
                // no Italian model on the device: the default recognizer (prefers offline when it can)
                Log.w(TAG, "on-device recognizer error " + error + ", falling back");
                onDeviceFailed = true;
                begin(lang);
                return;
            }
            active = false;
            emitError(code(error), null);
        }

        @Override public void onResults(Bundle results) {
            active = false;
            emit(json("final", first(results)));
        }

        @Override public void onPartialResults(Bundle partial) {
            String t = first(partial);
            if (!t.isEmpty()) emit(json("partial", t));
        }

        @Override public void onEvent(int eventType, Bundle params) { }
    }

    private static String first(Bundle b) {
        if (b == null) return "";
        ArrayList<String> list = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return list != null && !list.isEmpty() && list.get(0) != null ? list.get(0) : "";
    }

    private static String code(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_NO_MATCH: return "no-match";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "no-speech";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "permission";
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
            case SpeechRecognizer.ERROR_SERVER: return "network";
            case SpeechRecognizer.ERROR_AUDIO: return "audio-capture";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
            case ERROR_TOO_MANY_REQUESTS: return "busy";
            case SpeechRecognizer.ERROR_CLIENT: return "client";
            case ERROR_LANGUAGE_NOT_SUPPORTED:
            case ERROR_LANGUAGE_UNAVAILABLE: return "unavailable";
            default: return "unavailable";
        }
    }

    private void emitError(String code, String message) {
        JSONObject o = new JSONObject();
        try {
            o.put("error", code);
            if (message != null) o.put("message", message);
        } catch (JSONException ignored) {
            // static keys
        }
        emit(o.toString());
    }

    private static String state(String s) { return "{\"state\":\"" + s + "\"}"; }

    private static String json(String key, String value) {
        JSONObject o = new JSONObject();
        try { o.put(key, value); } catch (JSONException ignored) { /* static key */ }
        return o.toString();
    }

    private void emit(String json) { emitter.emit(json); }
}
