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

    @PluginMethod
    fun initialize(call: PluginCall) {
        val appMetricaKey = call.getString("appMetricaKey")
        implementation.initialize(appMetricaKey)
        call.resolve()
    }

    @PluginMethod
    fun showInterstitial(call: PluginCall) {
        val adUnitId = call.getString("adUnitId") ?: run {
            call.reject("Missing adUnitId")
            return
        }
        implementation.showInterstitial(adUnitId) { error ->
            if (error != null) call.reject(error) else call.resolve()
        }
    }

    @PluginMethod
    fun preloadInterstitial(call: PluginCall) {
        val adUnitId = call.getString("adUnitId") ?: run {
            call.reject("Missing adUnitId")
            return
        }
        implementation.preloadInterstitial(adUnitId)
        call.resolve()
    }

    @PluginMethod
    fun showRewarded(call: PluginCall) {
        val adUnitId = call.getString("adUnitId") ?: run {
            call.reject("Missing adUnitId")
            return
        }
        implementation.showRewarded(adUnitId) { error ->
            if (error != null) call.reject(error) else call.resolve()
        }
    }

    @PluginMethod
    fun preloadRewarded(call: PluginCall) {
        val adUnitId = call.getString("adUnitId") ?: run {
            call.reject("Missing adUnitId")
            return
        }
        implementation.preloadRewarded(adUnitId)
        call.resolve()
    }

    @PluginMethod
    fun showBanner(call: PluginCall) {
        val adUnitId = call.getString("adUnitId") ?: run {
            call.reject("Missing adUnitId")
            return
        }
        val position = call.getString("position") ?: "bottom"
        implementation.showBanner(adUnitId, position) { error ->
            if (error != null) call.reject(error) else call.resolve()
        }
    }

    @PluginMethod
    fun hideBanner(call: PluginCall) {
        val adUnitId = call.getString("adUnitId") ?: run {
            call.reject("Missing adUnitId")
            return
        }
        implementation.hideBanner(adUnitId)
        call.resolve()
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
