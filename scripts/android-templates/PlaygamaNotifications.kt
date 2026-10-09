package com.playgama.yandexads

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.os.Build
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

// Local notifications scheduled by the game through bridge.notifications.
// Everything a notification shows (texts, icon, image, channel) arrives from
// playgama-bridge-config.json via the bridge, so a game needs no native code.
//
// Scheduled notifications are persisted, because AlarmManager forgets alarms
// on reboot: NotificationReceiver re-arms them on BOOT_COMPLETED.
object PlaygamaNotifications {
    const val EXTRA_PAYLOAD = "playgama_notification_payload"
    const val EXTRA_ID = "playgama_notification_id"
    const val ACTION_FIRE = "com.playgama.yandexads.NOTIFICATION_FIRE"

    private const val PREFS = "playgama_notifications"
    private const val KEY_SCHEDULED = "scheduled"
    private const val DEFAULT_CHANNEL_ID = "playgama_default"
    private const val DEFAULT_CHANNEL_NAME = "Notifications"
    private const val IMAGE_TIMEOUT_MS = 5000

    // notification JSON: id, title, description, fireAt (epoch ms), image?, payload?,
    // smallIcon?, color?, channelId?, channelName?
    fun schedule(context: Context, notification: JSONObject) {
        val id = notification.getString("id")
        val scheduled = load(context)
        scheduled.put(id, notification)
        save(context, scheduled)
        arm(context, notification)
    }

    fun cancel(context: Context, id: String) {
        val scheduled = load(context)
        scheduled.remove(id)
        save(context, scheduled)
        alarmManager(context).cancel(firePendingIntent(context, id))
        NotificationManagerCompat.from(context).cancel(id.hashCode())
    }

    fun cancelAll(context: Context) {
        val scheduled = load(context)
        scheduled.keys().forEach { id ->
            alarmManager(context).cancel(firePendingIntent(context, id))
        }
        save(context, JSONObject())
        NotificationManagerCompat.from(context).cancelAll()
    }

    fun rearmAll(context: Context) {
        val scheduled = load(context)
        scheduled.keys().forEach { id -> arm(context, scheduled.getJSONObject(id)) }
    }

    fun take(context: Context, id: String): JSONObject? {
        val scheduled = load(context)
        val notification = scheduled.optJSONObject(id) ?: return null
        scheduled.remove(id)
        save(context, scheduled)
        return notification
    }

    // Runs off the main thread: the image may come from the network.
    fun show(context: Context, notification: JSONObject) {
        val id = notification.getString("id")
        val channelId = notification.optString("channelId").ifEmpty { DEFAULT_CHANNEL_ID }
        ensureChannel(context, channelId, notification.optString("channelName").ifEmpty { DEFAULT_CHANNEL_NAME })

        val builder = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(resolveSmallIcon(context, notification.optString("smallIcon")))
            .setContentTitle(notification.optString("title"))
            .setContentText(notification.optString("description"))
            .setStyle(NotificationCompat.BigTextStyle().bigText(notification.optString("description")))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(openPendingIntent(context, id, notification.optString("payload")))

        val color = notification.optString("color")
        if (color.isNotEmpty()) {
            try { builder.setColor(Color.parseColor(color)) } catch (e: IllegalArgumentException) {}
        }

        val image = notification.optString("image")
        if (image.isNotEmpty()) {
            loadImage(context, image)?.let { bitmap ->
                builder.setLargeIcon(bitmap)
                builder.setStyle(NotificationCompat.BigPictureStyle()
                    .bigPicture(bitmap)
                    .setSummaryText(notification.optString("description")))
            }
        }

        try {
            NotificationManagerCompat.from(context).notify(id.hashCode(), builder.build())
        } catch (e: SecurityException) {
            // POST_NOTIFICATIONS was not granted: nothing to show.
        }
    }

    private fun arm(context: Context, notification: JSONObject) {
        val id = notification.getString("id")
        val delayMs = (notification.optLong("fireAt") - System.currentTimeMillis()).coerceAtLeast(0)
        // Inexact alarm: needs no SCHEDULE_EXACT_ALARM permission, and minutes
        // of drift do not matter for a "come back" reminder.
        alarmManager(context).setAndAllowWhileIdle(
            AlarmManager.ELAPSED_REALTIME_WAKEUP,
            SystemClock.elapsedRealtime() + delayMs,
            firePendingIntent(context, id),
        )
    }

    private fun firePendingIntent(context: Context, id: String): PendingIntent {
        val intent = Intent(context, NotificationReceiver::class.java)
            .setAction(ACTION_FIRE)
            .putExtra(EXTRA_ID, id)
        return PendingIntent.getBroadcast(
            context, id.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun openPendingIntent(context: Context, id: String, payload: String): PendingIntent? {
        val intent = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
        intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        intent.putExtra(EXTRA_ID, id)
        intent.putExtra(EXTRA_PAYLOAD, payload)
        return PendingIntent.getActivity(
            context, id.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun ensureChannel(context: Context, channelId: String, channelName: String) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        // Re-creating an existing channel only updates its name, which is what we want.
        manager.createNotificationChannel(
            NotificationChannel(channelId, channelName, NotificationManager.IMPORTANCE_DEFAULT),
        )
    }

    // smallIcon is a drawable/mipmap resource name (e.g. "ic_stat_notify").
    // Without one the app icon is used; Android renders it as a silhouette.
    private fun resolveSmallIcon(context: Context, name: String): Int {
        if (name.isNotEmpty()) {
            val res = context.resources
            for (type in arrayOf("drawable", "mipmap")) {
                val resId = res.getIdentifier(name, type, context.packageName)
                if (resId != 0) return resId
            }
        }
        val appIcon = context.applicationInfo.icon
        return if (appIcon != 0) appIcon else android.R.drawable.ic_dialog_info
    }

    // image is an http(s) URL or a path inside the web build (public/), e.g. "images/push.png".
    private fun loadImage(context: Context, image: String): Bitmap? = try {
        if (image.startsWith("http://") || image.startsWith("https://")) {
            val connection = URL(image).openConnection() as HttpURLConnection
            connection.connectTimeout = IMAGE_TIMEOUT_MS
            connection.readTimeout = IMAGE_TIMEOUT_MS
            connection.inputStream.use { BitmapFactory.decodeStream(it) }
        } else {
            context.assets.open("public/" + image.trimStart('/').removePrefix("./"))
                .use { BitmapFactory.decodeStream(it) }
        }
    } catch (e: Exception) {
        null
    }

    private fun alarmManager(context: Context) =
        context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

    private fun load(context: Context): JSONObject {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_SCHEDULED, null)
        return try { if (raw != null) JSONObject(raw) else JSONObject() } catch (e: Exception) { JSONObject() }
    }

    private fun save(context: Context, scheduled: JSONObject) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY_SCHEDULED, scheduled.toString()).apply()
    }
}

class NotificationReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val appContext = context.applicationContext
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED -> PlaygamaNotifications.rearmAll(appContext)

            PlaygamaNotifications.ACTION_FIRE -> {
                val id = intent.getStringExtra(PlaygamaNotifications.EXTRA_ID) ?: return
                val notification = PlaygamaNotifications.take(appContext, id) ?: return
                val pending = goAsync()
                Thread {
                    try {
                        PlaygamaNotifications.show(appContext, notification)
                    } finally {
                        pending.finish()
                    }
                }.start()
            }
        }
    }
}
