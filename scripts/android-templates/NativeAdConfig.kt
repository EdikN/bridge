package com.playgama.yandexads

import android.content.Context
import android.util.Base64
import org.json.JSONObject

// Ad unit ids and the AppMetrica key compiled into the app (yandex-ads-config.gradle,
// "yandex-ads.properties"), so they no longer sit as plain text in the bridge
// config under assets/, where APK scrapers pick them up. The resource is the
// JSON XOR'd with a 16-byte key that precedes it, base64'd.
internal object NativeAdConfig {
    const val INTERSTITIAL = "interstitial"
    const val REWARDED = "rewarded"
    const val BANNER = "banner"
    const val APP_METRICA_KEY = "appMetricaKey"

    private const val KEY_SIZE = 16

    @Volatile
    private var values: Map<String, String>? = null

    fun get(context: Context, key: String): String? =
        load(context)[key]?.takeIf { it.isNotBlank() }

    fun has(context: Context, key: String): Boolean = get(context, key) != null

    private fun load(context: Context): Map<String, String> {
        values?.let { return it }
        val decoded = try {
            decode(context.getString(R.string.pg_yma_cfg))
        } catch (e: Throwable) {
            // A broken resource must not take the ads down with it: the ids
            // passed from JS still work.
            emptyMap()
        }
        values = decoded
        return decoded
    }

    private fun decode(blob: String): Map<String, String> {
        if (blob.isBlank()) return emptyMap()
        val raw = Base64.decode(blob, Base64.DEFAULT)
        if (raw.size <= KEY_SIZE) return emptyMap()
        val data = ByteArray(raw.size - KEY_SIZE) { i ->
            (raw[KEY_SIZE + i].toInt() xor raw[i % KEY_SIZE].toInt()).toByte()
        }
        val json = JSONObject(String(data, Charsets.UTF_8))
        val result = HashMap<String, String>()
        json.keys().forEach { key -> result[key] = json.optString(key) }
        return result
    }
}
