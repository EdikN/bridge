package com.playgama.yandexads

// playgama-ads-manager-revision: 3
// ^ android-setup.js (bridge) overwrites a plugin copy whose revision is lower
//   than its template's. Bump it on every change to this file.

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.DisplayMetrics
import android.view.Gravity
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.appcompat.app.AppCompatActivity
import com.getcapacitor.JSObject
import io.appmetrica.analytics.AdRevenue
import io.appmetrica.analytics.AdType
import io.appmetrica.analytics.AppMetrica
import io.appmetrica.analytics.AppMetricaConfig
import com.yandex.mobile.ads.banner.BannerAdEventListener
import com.yandex.mobile.ads.banner.BannerAdSize
import com.yandex.mobile.ads.banner.BannerAdView
import com.yandex.mobile.ads.common.AdError
import com.yandex.mobile.ads.common.AdRequest
import com.yandex.mobile.ads.common.AdRequestError
import com.yandex.mobile.ads.common.ImpressionData
import com.yandex.mobile.ads.common.YandexAds
import com.yandex.mobile.ads.interstitial.InterstitialAd
import com.yandex.mobile.ads.interstitial.InterstitialAdEventListener
import com.yandex.mobile.ads.interstitial.InterstitialAdLoadListener
import com.yandex.mobile.ads.interstitial.InterstitialAdLoader
import com.yandex.mobile.ads.rewarded.Reward
import com.yandex.mobile.ads.rewarded.RewardedAd
import com.yandex.mobile.ads.rewarded.RewardedAdEventListener
import com.yandex.mobile.ads.rewarded.RewardedAdLoadListener
import com.yandex.mobile.ads.rewarded.RewardedAdLoader
import org.json.JSONObject
import java.math.BigDecimal
import java.util.Currency

class YandexMobileAdsManager(
    private val activity: AppCompatActivity,
    private val plugin: YandexMobileAdsPlugin,
) {
    private companion object {
        // A failed load is never retried sooner than this.
        const val MIN_RETRY_MS = 30_000L
        // Upper bound of the exponential back-off (30s, 60s, 120s, 240s, 480s).
        const val MAX_RETRY_MS = 480_000L
        // Automatic retries stop after this many failures in a row; the next
        // explicit preload/show (once the back-off has passed) starts again.
        const val MAX_AUTO_ATTEMPTS = 5
        // A cached ad older than this is dropped and loaded again — the SDK's
        // creatives are not guaranteed to stay valid for long.
        const val AD_TTL_MS = 50 * 60_000L
        // How long show() waits for an ad that is still loading before giving
        // up; an interstitial popping up long after the pause is worse than none.
        const val SHOW_WAIT_MS = 8_000L
    }

    private val mainHandler = Handler(Looper.getMainLooper())

    private val bannerViews = mutableMapOf<String, BannerAdView>()

    // Set while a banner is on screen — see applyBannerLayout.
    private var bannerLayoutListener: android.view.View.OnLayoutChangeListener? = null

    // Which edge the strip sits on, remembered so the WebView gives up its space
    // on the same side the ad is actually drawn.
    private var bannerGravity: Int = Gravity.BOTTOM

    // The ad unit whose banner has actually FILLED, as opposed to merely being
    // requested — a repeat request may only report "shown" for the first.
    private var loadedBannerUnitId: String? = null

    private var appMetricaActive = false

    // AppMetrica is optional: without a key in playgama-bridge-config.json the
    // ads still work, there is simply no analytics. Activation goes first
    // because the ads SDK reports through AppMetrica when it is present.
    fun initialize(appMetricaKey: String?) {
        if (!appMetricaKey.isNullOrBlank()) {
            try {
                val config = AppMetricaConfig.newConfigBuilder(appMetricaKey).build()
                AppMetrica.activate(activity.applicationContext, config)
                // Sessions are counted from activity transitions; without this
                // every launch looks like one endless session.
                AppMetrica.enableActivityAutoTracking(activity.application)
                appMetricaActive = true
            } catch (e: Throwable) {
                // Analytics must never be the reason a game fails to start.
            }
        }
        YandexAds.initialize(activity) {}
    }

    // ─── Analytics ───────────────────────────────────────────────────────

    private fun reportEvent(name: String, format: String, adUnitId: String?, extra: Map<String, Any?> = emptyMap()) {
        if (!appMetricaActive) return
        try {
            val params = HashMap<String, Any>()
            params["format"] = format
            if (adUnitId != null) params["ad_unit_id"] = adUnitId
            extra.forEach { (k, v) -> if (v != null) params[k] = v }
            AppMetrica.reportEvent(name, params)
        } catch (e: Throwable) {}
    }

    // Yandex Mobile Ads is a "manual setup" network for AppMetrica Ad Revenue:
    // the impression-level revenue (ILRD) JSON from ImpressionData.rawData is
    // turned into an AdRevenue and reported with AppMetrica.reportAdRevenue.
    // Fields: revenue, currency, revenueUSD, precision, ad_unit_id, network.name.
    private fun reportAdRevenue(data: ImpressionData?, format: String, adType: AdType, adUnitId: String?) {
        if (!appMetricaActive) return
        val raw = data?.rawData ?: return
        try {
            val json = JSONObject(raw)
            var amount = json.opt("revenue")?.toString()?.toBigDecimalOrNull()
            var currency = try {
                Currency.getInstance(json.optString("currency"))
            } catch (e: Throwable) {
                null
            }
            if (amount == null || currency == null) {
                amount = json.opt("revenueUSD")?.toString()?.toBigDecimalOrNull()
                currency = Currency.getInstance("USD")
            }
            if (amount == null || amount < BigDecimal.ZERO) return

            val builder = AdRevenue.newBuilder(amount, currency!!)
                .withAdType(adType)
                .withAdUnitId(json.optString("ad_unit_id").ifBlank { adUnitId })
                .withAdNetwork(json.optJSONObject("network")?.optString("name")?.ifBlank { null } ?: "Yandex")
                .withPayload(mapOf("format" to format, "source" to "yandex_mobile_ads"))
            json.optString("precision").takeIf { it.isNotBlank() }?.let { builder.withPrecision(it) }
            AppMetrica.reportAdRevenue(builder.build())
        } catch (e: Throwable) {}
    }

    // ─── Full-screen ads: cache + single loader + back-off ───────────────
    //
    // Before revision 3 preload loaded an ad and threw it away, and show loaded
    // another one from scratch — every impression cost two or more ad requests,
    // which the network reads as a poor fill rate. Now each format keeps at
    // most one loaded ad: show takes it from the cache (or waits for the load
    // in flight), and the next one is loaded as soon as the shown one is gone.

    private abstract inner class FullscreenSlot<T : Any>(
        val format: String,
        val adType: AdType,
    ) {
        var adUnitId: String? = null
        private var ad: T? = null
        private var loadedAt = 0L
        private var isLoading = false
        private var failures = 0
        private var cooldownUntil = 0L
        private var retryRunnable: Runnable? = null
        private var pendingShow: ((String?) -> Unit)? = null
        private var pendingTimeout: Runnable? = null
        private var generation = 0

        abstract fun load(adUnitId: String, onLoaded: (T) -> Unit, onFailed: (AdRequestError) -> Unit)
        abstract fun present(ad: T, adUnitId: String, callback: (String?) -> Unit)
        abstract fun emitFailed(error: String)

        private fun now() = SystemClock.elapsedRealtime()

        // A different ad unit invalidates everything cached for the old one.
        private fun bind(unit: String) {
            if (adUnitId == unit) return
            adUnitId = unit
            ad = null
            isLoading = false
            failures = 0
            cooldownUntil = 0L
            retryRunnable?.let { mainHandler.removeCallbacks(it) }
            retryRunnable = null
            generation++
        }

        private fun takeFresh(): T? {
            val cached = ad ?: return null
            ad = null
            return if (now() - loadedAt < AD_TTL_MS) cached else null
        }

        // Main thread only.
        fun preload(unit: String) {
            bind(unit)
            ensureLoading()
        }

        private fun ensureLoading() {
            val unit = adUnitId ?: return
            if (isLoading) return
            if (ad != null && now() - loadedAt < AD_TTL_MS) return
            ad = null
            if (now() < cooldownUntil) return   // the scheduled retry (if any) will come
            retryRunnable?.let { mainHandler.removeCallbacks(it) }
            retryRunnable = null

            isLoading = true
            val gen = generation
            reportEvent("ad_request", format, unit)
            load(unit, { loaded ->
                if (gen != generation) return@load
                isLoading = false
                failures = 0
                cooldownUntil = 0L
                ad = loaded
                loadedAt = now()
                reportEvent("ad_loaded", format, unit)
                deliverPending()
            }, { error ->
                if (gen != generation) return@load
                isLoading = false
                failures++
                val backoff = (MIN_RETRY_MS shl (failures - 1).coerceAtMost(4)).coerceAtMost(MAX_RETRY_MS)
                cooldownUntil = now() + backoff
                reportEvent("ad_failed", format, unit, mapOf(
                    "stage" to "load", "code" to error.code, "error" to error.description,
                    "attempt" to failures,
                ))
                failPending(error.description)
                if (failures < MAX_AUTO_ATTEMPTS) {
                    val retry = Runnable { retryRunnable = null; ensureLoading() }
                    retryRunnable = retry
                    mainHandler.postDelayed(retry, backoff)
                }
            })
        }

        // Main thread only.
        fun show(unit: String, callback: (String?) -> Unit) {
            bind(unit)
            if (pendingShow != null) {
                callback("Ad show already in progress")
                return
            }
            val cached = takeFresh()
            if (cached != null) {
                present(cached, unit, once(callback))
                return
            }
            if (!isLoading && now() < cooldownUntil) {
                // Last load failed a moment ago: don't hammer the network with
                // another request, report no-fill straight away.
                val msg = "No ad available (retry scheduled)"
                emitFailed(msg)
                reportEvent("ad_failed", format, unit, mapOf("stage" to "show", "error" to msg))
                callback(msg)
                return
            }
            pendingShow = once(callback)
            val timeout = Runnable {
                pendingTimeout = null
                failPending("Ad load timeout")
            }
            pendingTimeout = timeout
            mainHandler.postDelayed(timeout, SHOW_WAIT_MS)
            ensureLoading()
        }

        private fun clearPending(): ((String?) -> Unit)? {
            val cb = pendingShow
            pendingShow = null
            pendingTimeout?.let { mainHandler.removeCallbacks(it) }
            pendingTimeout = null
            return cb
        }

        private fun deliverPending() {
            val cb = clearPending() ?: return
            val unit = adUnitId ?: return
            val loaded = takeFresh() ?: run { cb("Ad expired"); return }
            present(loaded, unit, cb)
        }

        private fun failPending(error: String) {
            val cb = clearPending() ?: return
            emitFailed(error)
            reportEvent("ad_failed", format, adUnitId, mapOf("stage" to "show", "error" to error))
            cb(error)
        }

        // Called once the shown ad is gone (dismissed or failed to show).
        fun preloadNext() {
            ensureLoading()
        }
    }

    // A PluginCall must be answered exactly once; show paths can report both a
    // synchronous result and a later onAdFailedToShow.
    private fun once(callback: (String?) -> Unit): (String?) -> Unit {
        var done = false
        return { error -> if (!done) { done = true; callback(error) } }
    }

    private val interstitial = object : FullscreenSlot<InterstitialAd>("interstitial", AdType.INTERSTITIAL) {
        override fun load(adUnitId: String, onLoaded: (InterstitialAd) -> Unit, onFailed: (AdRequestError) -> Unit) {
            InterstitialAdLoader(activity).loadAd(AdRequest.Builder(adUnitId).build(), object : InterstitialAdLoadListener {
                override fun onAdLoaded(ad: InterstitialAd) = onLoaded(ad)
                override fun onAdFailedToLoad(error: AdRequestError) = onFailed(error)
            })
        }

        override fun present(ad: InterstitialAd, adUnitId: String, callback: (String?) -> Unit) {
            ad.setAdEventListener(object : InterstitialAdEventListener {
                override fun onAdShown() {
                    plugin.emit("interstitialOpened")
                    reportEvent("ad_shown", format, adUnitId)
                }
                override fun onAdFailedToShow(adError: AdError) {
                    plugin.emit("interstitialFailed", JSObject().put("error", adError.description))
                    reportEvent("ad_failed", format, adUnitId, mapOf("stage" to "show", "error" to adError.description))
                    ad.setAdEventListener(null)
                    callback(adError.description)
                    preloadNext()
                }
                override fun onAdDismissed() {
                    plugin.emit("interstitialClosed")
                    ad.setAdEventListener(null)
                    preloadNext()
                }
                override fun onAdClicked() {
                    reportEvent("ad_clicked", format, adUnitId)
                }
                override fun onAdImpression(data: ImpressionData?) {
                    reportAdRevenue(data, format, adType, adUnitId)
                }
            })
            ad.show(activity)
            callback(null)
        }

        override fun emitFailed(error: String) {
            plugin.emit("interstitialFailed", JSObject().put("error", error))
        }
    }

    private val rewarded = object : FullscreenSlot<RewardedAd>("rewarded", AdType.REWARDED) {
        override fun load(adUnitId: String, onLoaded: (RewardedAd) -> Unit, onFailed: (AdRequestError) -> Unit) {
            RewardedAdLoader(activity).loadAd(AdRequest.Builder(adUnitId).build(), object : RewardedAdLoadListener {
                override fun onAdLoaded(ad: RewardedAd) = onLoaded(ad)
                override fun onAdFailedToLoad(error: AdRequestError) = onFailed(error)
            })
        }

        override fun present(ad: RewardedAd, adUnitId: String, callback: (String?) -> Unit) {
            ad.setAdEventListener(object : RewardedAdEventListener {
                override fun onAdShown() {
                    plugin.emit("rewardedOpened")
                    reportEvent("ad_shown", format, adUnitId)
                }
                override fun onAdFailedToShow(adError: AdError) {
                    plugin.emit("rewardedFailed", JSObject().put("error", adError.description))
                    reportEvent("ad_failed", format, adUnitId, mapOf("stage" to "show", "error" to adError.description))
                    ad.setAdEventListener(null)
                    callback(adError.description)
                    preloadNext()
                }
                override fun onAdDismissed() {
                    plugin.emit("rewardedClosed")
                    ad.setAdEventListener(null)
                    preloadNext()
                }
                override fun onRewarded(reward: Reward) {
                    plugin.emit("userEarned", JSObject().put("type", reward.type).put("amount", reward.amount))
                    reportEvent("ad_rewarded", format, adUnitId)
                }
                override fun onAdClicked() {
                    reportEvent("ad_clicked", format, adUnitId)
                }
                override fun onAdImpression(data: ImpressionData?) {
                    reportAdRevenue(data, format, adType, adUnitId)
                }
            })
            ad.show(activity)
            callback(null)
        }

        override fun emitFailed(error: String) {
            plugin.emit("rewardedFailed", JSObject().put("error", error))
        }
    }

    fun showInterstitial(adUnitId: String, callback: (String?) -> Unit) {
        activity.runOnUiThread { interstitial.show(adUnitId, callback) }
    }

    fun preloadInterstitial(adUnitId: String) {
        activity.runOnUiThread { interstitial.preload(adUnitId) }
    }

    fun showRewarded(adUnitId: String, callback: (String?) -> Unit) {
        activity.runOnUiThread { rewarded.show(adUnitId, callback) }
    }

    fun preloadRewarded(adUnitId: String) {
        activity.runOnUiThread { rewarded.preload(adUnitId) }
    }

    // Measure the container the banner is actually placed in, not the display.
    // getMetrics() reports the screen MINUS the system bars, while a fullscreen
    // activity's content view spans the whole panel — so sizing the WebView by
    // the former left a strip of bare activity background between the game and
    // the banner, exactly as tall as the navigation bar that isn't there.
    private fun contentView(): ViewGroup =
        activity.window.decorView.findViewById(android.R.id.content)

    // The window height as the banner layout sees it, measured fresh on every
    // call — the display metrics are only the fallback for the first pass, while
    // the content view has no height yet.
    private fun contentHeightPx(): Int {
        val rootView = contentView()
        if (rootView.height > 0) return rootView.height
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        activity.windowManager.defaultDisplay.getMetrics(metrics)
        return metrics.heightPixels
    }

    // How much of the window the banner is taking. The banner view sizes itself
    // (WRAP_CONTENT) from the ad size the SDK picked, so its measured height is
    // the only honest answer: forcing the slot to a share of the screen made the
    // creative render clipped against the bottom edge whenever the sticky size
    // came out taller than that share — which on a short landscape window is
    // most of the time, since sticky starts at 50dp and 10% of a 1080px-tall
    // window is under 40dp. The 10% is only the guess covering the gap before
    // the first layout pass; the cap keeps a runaway creative from swallowing
    // the game.
    private fun bannerHeightPx(bannerAdView: BannerAdView): Int {
        val screenHeightPx = contentHeightPx()
        val measured = bannerAdView.height
        val height = if (measured > 0) measured else (screenHeightPx * 0.10).toInt()
        return height.coerceAtMost((screenHeightPx * 0.25).toInt())
    }

    // Keep the WebView clear of the banner. The space is given up as a MARGIN on
    // a WebView that stays MATCH_PARENT, not as a pixel height: a height is a
    // snapshot of one window geometry and goes stale the moment the window
    // changes size — after a rotation the portrait-sized WebView kept its old
    // value in a landscape window, its bottom rows (the exit buttons among them)
    // falling past the visible area with the banner drawn over them. A margin is
    // re-resolved against the parent on every layout pass, so the split follows
    // the window on its own and the listener below is left with only the
    // banner's own height to watch. It also puts the reserve on the right SIDE:
    // a top banner used to shorten the WebView from the bottom and then cover
    // its first rows anyway.
    private fun applyBannerLayout(bannerAdView: BannerAdView) {
        val webView = plugin.bridge.webView
        val webViewParams = webView.layoutParams
        val bannerHeight = bannerHeightPx(bannerAdView)
        val topReserve = if (bannerGravity == Gravity.TOP) bannerHeight else 0
        val bottomReserve = if (bannerGravity == Gravity.TOP) 0 else bannerHeight

        // Only touch layoutParams when something really changed: this runs from
        // a layout listener, and an unconditional requestLayout would loop.
        if (webViewParams is ViewGroup.MarginLayoutParams) {
            val stale = webViewParams.topMargin != topReserve ||
                webViewParams.bottomMargin != bottomReserve ||
                webViewParams.height != ViewGroup.LayoutParams.MATCH_PARENT
            if (stale) {
                webViewParams.topMargin = topReserve
                webViewParams.bottomMargin = bottomReserve
                webViewParams.height = ViewGroup.LayoutParams.MATCH_PARENT
                webView.layoutParams = webViewParams
            }
            return
        }

        // A parent whose layout params carry no margins: fall back to splitting
        // the window in pixels, re-measured on every call.
        val webViewHeightPx = contentHeightPx() - bannerHeight
        if (webViewParams.height != webViewHeightPx) {
            webViewParams.height = webViewHeightPx
            webView.layoutParams = webViewParams
        }
    }

    private fun restoreWebViewBounds() {
        val webView = plugin.bridge.webView
        val webViewParams = webView.layoutParams
        if (webViewParams is ViewGroup.MarginLayoutParams) {
            webViewParams.topMargin = 0
            webViewParams.bottomMargin = 0
        }
        webViewParams.height = ViewGroup.LayoutParams.MATCH_PARENT
        webView.layoutParams = webViewParams
    }

    private fun stopWatchingLayout() {
        bannerLayoutListener?.let { listener ->
            contentView().removeOnLayoutChangeListener(listener)
            bannerViews.values.forEach { it.removeOnLayoutChangeListener(listener) }
        }
        bannerLayoutListener = null
    }

    // Take every banner off the screen and hand the whole window back to the
    // WebView. Everything that removes a banner goes through here: the map used
    // to be trimmed in one place and the views detached in another, and a view
    // that fell between the two stayed drawn over a game that had just been
    // given its full height back. Returns whether anything was actually up.
    private fun removeAllBanners(): Boolean {
        stopWatchingLayout()
        loadedBannerUnitId = null
        val had = bannerViews.isNotEmpty()
        bannerViews.values.forEach { view ->
            (view.parent as? ViewGroup)?.removeView(view)
            view.destroy()
        }
        bannerViews.clear()
        restoreWebViewBounds()
        return had
    }

    fun showBanner(adUnitId: String, position: String, callback: (String?) -> Unit) {
        activity.runOnUiThread {
            try {
                bannerGravity = if (position == "top") Gravity.TOP else Gravity.BOTTOM

                // The game asks for the banner again on every screen change it
                // counts as idle. Each request used to build a NEW BannerAdView
                // and overwrite the map entry, so hideBanner could only ever take
                // the last one down: every earlier ad stayed on screen — over a
                // WebView that had just been handed its full height back — and
                // covered the game and the buttons under it for the rest of the
                // session. A banner that is already up is re-reported instead.
                bannerViews[adUnitId]?.let { existing ->
                    existing.post { applyBannerLayout(existing) }
                    // Only a banner that has already filled may be reported as
                    // shown; one still loading reports itself when it lands, and
                    // saying "shown" for it would tell the game an ad is on
                    // screen while the strip is still empty. The call itself is
                    // answered either way — an unanswered one leaves a promise
                    // hanging on the JS side.
                    if (loadedBannerUnitId == adUnitId) plugin.emit("bannerShown")
                    callback(null)
                    return@runOnUiThread
                }

                // One strip at a time: a request for a different ad unit replaces
                // whatever is up rather than stacking on top of it.
                removeAllBanners()

                val metrics = DisplayMetrics()
                @Suppress("DEPRECATION")
                activity.windowManager.defaultDisplay.getMetrics(metrics)

                val rootView = contentView()
                val widthDp = (metrics.widthPixels / metrics.density).toInt()
                val bannerAdView = BannerAdView(activity)
                // The ad rarely fills its slot to the pixel; a black backing
                // keeps whatever is left over reading as part of the frame
                // rather than as a grey seam.
                bannerAdView.setBackgroundColor(android.graphics.Color.BLACK)
                // WRAP_CONTENT, so the view is exactly as tall as the ad size
                // the SDK settled on — see bannerHeightPx.
                bannerAdView.setAdSize(BannerAdSize.sticky(activity, widthDp))
                val answer = once(callback)
                bannerAdView.setBannerAdEventListener(object : BannerAdEventListener {
                    override fun onAdLoaded() {
                        val first = loadedBannerUnitId != adUnitId
                        loadedBannerUnitId = adUnitId
                        if (first) reportEvent("ad_loaded", "banner", adUnitId)
                        // The view may not be measured yet; the layout listener
                        // below picks up the real height when it is.
                        bannerAdView.post { applyBannerLayout(bannerAdView) }
                        plugin.emit("bannerShown")
                        answer(null)
                    }
                    override fun onAdFailedToLoad(error: AdRequestError) {
                        reportEvent("ad_failed", "banner", adUnitId, mapOf(
                            "stage" to (if (loadedBannerUnitId == adUnitId) "refresh" else "load"),
                            "code" to error.code, "error" to error.description,
                        ))
                        // A sticky banner that already filled and then fails an
                        // automatic REFRESH still shows its previous creative and
                        // the SDK keeps refreshing on its own. Tearing it down
                        // here used to lose the banner for the rest of the
                        // session (the game never re-requests a banner that was
                        // shown once), so a filled strip is left alone.
                        if (loadedBannerUnitId == adUnitId && bannerViews[adUnitId] === bannerAdView) return
                        // Never filled: drop the dead view, don't just give the
                        // WebView its height back — left in place it would make
                        // the next request believe a banner was already up.
                        removeAllBanners()
                        plugin.emit("bannerFailed", JSObject().put("error", error.description))
                        answer(error.description)
                    }
                    override fun onAdClicked() {
                        reportEvent("ad_clicked", "banner", adUnitId)
                    }
                    override fun onImpression(data: ImpressionData?) {
                        reportEvent("ad_shown", "banner", adUnitId)
                        reportAdRevenue(data, "banner", AdType.BANNER, adUnitId)
                    }
                })

                val params = FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.WRAP_CONTENT,
                    bannerGravity,
                )
                rootView.addView(bannerAdView, params)
                // In the map before the request goes out: loading is async, but
                // a failure arriving early has to find the view it must clean up.
                bannerViews[adUnitId] = bannerAdView

                // Two things invalidate the split, and both are watched: the
                // window changing height (rotation, a resumed activity, an
                // immersive-mode re-layout) and the banner arriving at — or
                // changing — its own height. Posted rather than applied inline:
                // a requestLayout from inside a layout pass is discarded.
                val layoutListener = android.view.View.OnLayoutChangeListener {
                    view, _, _, _, _, _, _, _, _ ->
                    view.post { applyBannerLayout(bannerAdView) }
                }
                rootView.addOnLayoutChangeListener(layoutListener)
                bannerAdView.addOnLayoutChangeListener(layoutListener)
                bannerLayoutListener = layoutListener

                // Since SDK 8 the ad unit travels in the request rather than on
                // the view — setAdUnitId no longer exists.
                bannerAdView.loadAd(AdRequest.Builder(adUnitId).build())
            } catch (e: Exception) {
                callback(e.message)
            }
        }
    }

    // The ad unit is accepted for symmetry with showBanner, but everything on
    // screen comes down: the game runs a single strip, and a view that outlived
    // its map entry is exactly what used to be left sitting over the game.
    fun hideBanner(adUnitId: String) {
        activity.runOnUiThread {
            if (removeAllBanners()) plugin.emit("bannerHidden")
        }
    }
}
