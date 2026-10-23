package com.playgama.yandexads

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "YandexMobileAds")
class YandexMobileAdsPlugin : Plugin() {
    private lateinit var implementation: YandexMobileAdsManager

    override fun load() {
        implementation = YandexMobileAdsManager(activity, this)
    }

    // Resolves with the formats configured natively (see NativeAdConfig), so a
    // bridge whose config carries no ad unit ids still knows ads are there.
    // Only flags — the ids themselves never travel back to JS.
    @PluginMethod
    fun initialize(call: PluginCall) {
        val appMetricaKey = NativeAdConfig.get(context, NativeAdConfig.APP_METRICA_KEY)
            ?: call.getString("appMetricaKey")?.takeIf { it.isNotBlank() }
        implementation.initialize(appMetricaKey)
        call.resolve(JSObject()
            .put("adUnits", JSObject()
                .put(NativeAdConfig.INTERSTITIAL, NativeAdConfig.has(context, NativeAdConfig.INTERSTITIAL))
                .put(NativeAdConfig.REWARDED, NativeAdConfig.has(context, NativeAdConfig.REWARDED))
                .put(NativeAdConfig.BANNER, NativeAdConfig.has(context, NativeAdConfig.BANNER)))
            .put("appMetrica", appMetricaKey != null))
    }

    // The id compiled into the app wins: it is the one the build was set up
    // with, while an id still sitting in an old bridge config may be a unit
    // that was retired after it leaked. An id from JS is the fallback for
    // games set up the old way.
    private fun adUnitId(call: PluginCall, format: String): String? =
        NativeAdConfig.get(context, format) ?: call.getString("adUnitId")?.takeIf { it.isNotBlank() }

    @PluginMethod
    fun showInterstitial(call: PluginCall) {
        val adUnitId = adUnitId(call, NativeAdConfig.INTERSTITIAL) ?: run {
            call.reject("No interstitial ad unit configured")
            return
        }
        implementation.showInterstitial(adUnitId) { error ->
            if (error != null) call.reject(error) else call.resolve()
        }
    }

    @PluginMethod
    fun preloadInterstitial(call: PluginCall) {
        val adUnitId = adUnitId(call, NativeAdConfig.INTERSTITIAL) ?: run {
            call.reject("No interstitial ad unit configured")
            return
        }
        implementation.preloadInterstitial(adUnitId)
        call.resolve()
    }

    @PluginMethod
    fun showRewarded(call: PluginCall) {
        val adUnitId = adUnitId(call, NativeAdConfig.REWARDED) ?: run {
            call.reject("No rewarded ad unit configured")
            return
        }
        implementation.showRewarded(adUnitId) { error ->
            if (error != null) call.reject(error) else call.resolve()
        }
    }

    @PluginMethod
    fun preloadRewarded(call: PluginCall) {
        val adUnitId = adUnitId(call, NativeAdConfig.REWARDED) ?: run {
            call.reject("No rewarded ad unit configured")
            return
        }
        implementation.preloadRewarded(adUnitId)
        call.resolve()
    }

    @PluginMethod
    fun showBanner(call: PluginCall) {
        val adUnitId = adUnitId(call, NativeAdConfig.BANNER) ?: run {
            call.reject("No banner ad unit configured")
            return
        }
        val position = call.getString("position") ?: "bottom"
        implementation.showBanner(adUnitId, position) { error ->
            if (error != null) call.reject(error) else call.resolve()
        }
    }

    // Takes every banner down whatever the unit (see YandexMobileAdsManager),
    // so a missing id is no reason to leave one on screen.
    @PluginMethod
    fun hideBanner(call: PluginCall) {
        implementation.hideBanner(adUnitId(call, NativeAdConfig.BANNER) ?: "")
        call.resolve()
    }

    // analytics — AppMetrica, active only when initialize got an appMetricaKey
    @PluginMethod
    fun reportEvent(call: PluginCall) {
        val name = call.getString("name")
        if (name.isNullOrEmpty()) {
            call.reject("Missing name")
            return
        }
        implementation.reportGameEvent(name, call.getObject("params"))
        call.resolve()
    }

    @PluginMethod
    fun reportUserProfile(call: PluginCall) {
        implementation.reportUserProfile(call.getObject("attributes") ?: JSObject())
        call.resolve()
    }

    @PluginMethod
    fun sendEventsBuffer(call: PluginCall) {
        implementation.sendEventsBuffer()
        call.resolve()
    }

    // The WebView keeps running while the app is in the background, so the game
    // is told explicitly to pause. Fullscreen ads pause the activity too, which
    // is harmless: the game is paused for them anyway.
    override fun handleOnPause() {
        super.handleOnPause()
        implementation.sendEventsBuffer()
        emit("appPaused")
    }

    override fun handleOnResume() {
        super.handleOnResume()
        emit("appResumed")
    }

    // notifications — see PlaygamaNotifications
    @PluginMethod
    fun scheduleNotification(call: PluginCall) {
        val id = call.getString("id")
        val title = call.getString("title")
        val description = call.getString("description")
        if (id.isNullOrEmpty() || title.isNullOrEmpty() || description.isNullOrEmpty()) {
            call.reject("Missing id, title or description")
            return
        }
        val delaySeconds = (call.getInt("delaySeconds") ?: 0).coerceAtLeast(0)
        val notification = call.data
        notification.put("fireAt", System.currentTimeMillis() + delaySeconds * 1000L)
        PlaygamaNotifications.schedule(context, notification)
        call.resolve()
    }

    @PluginMethod
    fun cancelNotification(call: PluginCall) {
        val id = call.getString("id") ?: run {
            call.reject("Missing id")
            return
        }
        PlaygamaNotifications.cancel(context, id)
        call.resolve()
    }

    @PluginMethod
    fun cancelAllNotifications(call: PluginCall) {
        PlaygamaNotifications.cancelAll(context)
        call.resolve()
    }

    // Android 13+ asks the user once; the answer is not awaited, notifications
    // scheduled meanwhile are shown as soon as permission is granted.
    @PluginMethod
    fun requestNotificationPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 0x504E)
        }
        call.resolve(JSObject().put("granted", NotificationManagerCompat.from(context).areNotificationsEnabled()))
    }

    // Payload of the notification the app was opened from, if any.
    @PluginMethod
    fun getLaunchNotification(call: PluginCall) {
        val result = JSObject()
        activity?.intent?.let { intent ->
            if (intent.hasExtra(PlaygamaNotifications.EXTRA_ID)) {
                result.put("id", intent.getStringExtra(PlaygamaNotifications.EXTRA_ID))
                result.put("payload", intent.getStringExtra(PlaygamaNotifications.EXTRA_PAYLOAD))
            }
        }
        call.resolve(result)
    }

    override fun handleOnNewIntent(intent: Intent) {
        super.handleOnNewIntent(intent)
        if (intent.hasExtra(PlaygamaNotifications.EXTRA_ID)) {
            emit("notificationOpened", JSObject()
                .put("id", intent.getStringExtra(PlaygamaNotifications.EXTRA_ID))
                .put("payload", intent.getStringExtra(PlaygamaNotifications.EXTRA_PAYLOAD)))
        }
    }

    fun emit(eventName: String, data: JSObject? = null) {
        notifyListeners(eventName, data ?: JSObject())
    }
}
