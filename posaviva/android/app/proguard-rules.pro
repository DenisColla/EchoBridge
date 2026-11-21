# PosaViva shell - R8 rules (on top of proguard-android-optimize.txt).

# window.AndroidBridge: WebView looks the methods up by name at runtime, only those
# annotated with @JavascriptInterface are callable. Keep their names and signatures
# (the default file already does this for every class; stated here so the bridge never
# depends on which default file is used).
-keepclassmembers class it.posaviva.app.AndroidBridge {
    @android.webkit.JavascriptInterface public <methods>;
}
-keepattributes RuntimeVisibleAnnotations

# Activity / FileProvider are referenced from the manifest (aapt2 generates their keep
# rules). Nothing in the app uses reflection, serialization or JNI.

# Stack traces in logcat stay readable enough without shipping a mapping file.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute PosaViva
