# Consumer R8/ProGuard rules of capacitor-plugin-yandex-mobile-ads.
# Applied to the APP that depends on the plugin (consumerProguardFiles), so a
# release build with minifyEnabled + -repackageclasses '' keeps the ad and
# analytics SDKs intact. Both SDKs ship their own consumer rules as well
# (mobileads: -keepnames com.yandex.mobile.ads.**; AppMetrica:
# -keep io.appmetrica.analytics.**) — these are the belt to those braces.

# Yandex Mobile Ads SDK (incl. mediation adapters and the obfuscated core).
-keep class com.yandex.mobile.ads.** { *; }
-keep interface com.yandex.mobile.ads.** { *; }
-dontwarn com.yandex.mobile.ads.**
-keep class com.monetization.ads.** { *; }
-dontwarn com.monetization.ads.**
-keepnames class yads.** { *; }
-dontwarn yads.**

# AppMetrica SDK and its modules (ad revenue, billing, identifiers...).
-keep class io.appmetrica.analytics.** { *; }
-keep interface io.appmetrica.analytics.** { *; }
-dontwarn io.appmetrica.analytics.**
-dontwarn com.yandex.metrica.**

# The plugin itself: Capacitor looks the plugin class up by annotation and
# calls @PluginMethod methods reflectively.
-keep class com.playgama.yandexads.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * {
    @com.getcapacitor.PluginMethod public <methods>;
}

-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod
