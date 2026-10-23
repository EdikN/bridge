/*
 * This file is part of Playgama Bridge.
 *
 * Playgama Bridge is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * Playgama Bridge is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Playgama Bridge. If not, see <https://www.gnu.org/licenses/>.
 */

import PlatformBridgeBase from './PlatformBridgeBase'
import { ACTION_NAME, ERROR } from '../constants'
import { PLATFORM_ID, type PlatformId } from '../modules/platform/constants'
import {
    INTERSTITIAL_STATE,
    REWARDED_STATE,
    BANNER_STATE,
} from '../modules/advertisement/constants'
import type { AnyRecord } from '../utils'
import type { ScheduledNotification, NotificationSettings } from '../modules/notifications/types'
import { localize, notificationFromConfig } from '../modules/notifications/utils'

interface YandexMobileAdsPlugin {
    initialize(options: AnyRecord): Promise<unknown>
    addListener(event: string, callback: () => void): unknown
    showInterstitial(options: AnyRecord): Promise<unknown>
    preloadInterstitial(options: AnyRecord): Promise<unknown>
    showRewarded(options: AnyRecord): Promise<unknown>
    preloadRewarded(options: AnyRecord): Promise<unknown>
    showBanner(options: AnyRecord): Promise<unknown>
    hideBanner(options: AnyRecord): Promise<unknown>
    scheduleNotification?(options: AnyRecord): Promise<unknown>
    cancelNotification?(options: AnyRecord): Promise<unknown>
    cancelAllNotifications?(): Promise<unknown>
    requestNotificationPermission?(): Promise<unknown>
    getLaunchNotification?(): Promise<{ id?: string, payload?: string }>
    reportEvent?(options: AnyRecord): Promise<unknown>
    reportUserProfile?(options: AnyRecord): Promise<unknown>
}

const NOTIFICATION_METHODS = ['scheduleNotification', 'cancelNotification', 'cancelAllNotifications']

const ANALYTICS_METHODS = ['reportEvent', 'reportUserProfile']

interface AdUnitOptions {
    adUnitId?: string
}

interface AndroidAdvertisementOptions {
    interstitial?: AdUnitOptions
    rewarded?: AdUnitOptions
    banner?: AdUnitOptions
}

type AdFormat = 'interstitial' | 'rewarded' | 'banner'

// What the plugin (≥ 1.2.0) reports from initialize: which formats have an ad
// unit compiled into the app (android/yandex-ads.properties) and whether
// AppMetrica got a key. Flags only — the ids stay in the native code, out of
// the bridge config that ships as plain JSON in the APK. Older plugins resolve
// with nothing, and the ids from the config are used as before.
interface PluginInitializeResult {
    adUnits?: Partial<Record<AdFormat, boolean>>
    appMetrica?: boolean
}

class AndroidPlatformBridge extends PlatformBridgeBase {
    // platform
    get platformId(): PlatformId {
        return PLATFORM_ID.ANDROID
    }

    // advertisement
    get isInterstitialSupported(): boolean {
        return true
    }

    get isRewardedSupported(): boolean {
        return true
    }

    get isBannerSupported(): boolean {
        return true
    }

    get isMinimumDelayBetweenInterstitialEnabled(): boolean {
        return false
    }

    // notifications
    get isNotificationsSupported(): boolean {
        return this.#isNotificationsSupported
    }

    // When the game is launched from a notification, its payload is delivered
    // as the regular platform payload.
    get platformPayload(): string | null {
        return this.#launchNotificationPayload ?? super.platformPayload
    }

    #yandexMobileAds: YandexMobileAdsPlugin | null = null

    #isNotificationsSupported = false

    #isAnalyticsSupported = false

    #isNotificationPermissionRequested = false

    #launchNotificationPayload: string | null = null

    #interstitialAdUnitId: string | null = null

    #rewardedAdUnitId: string | null = null

    #bannerAdUnitId: string | null = null

    #nativeAdUnits: Partial<Record<AdFormat, boolean>> = {}

    initialize(): Promise<unknown> {
        if (this._isInitialized) {
            return Promise.resolve()
        }

        let promiseDecorator = this._getPromiseDecorator(ACTION_NAME.INITIALIZE)
        if (!promiseDecorator) {
            promiseDecorator = this._createPromiseDecorator(ACTION_NAME.INITIALIZE)
            this.#initializeInternal()
        }

        return promiseDecorator.promise
    }

    showInterstitial(): void {
        if (!this.#yandexMobileAds || !this.#hasAdUnit('interstitial')) {
            this._showAdFailurePopup(false)
            return
        }

        this._setInterstitialState(INTERSTITIAL_STATE.LOADING)
        this.#yandexMobileAds.showInterstitial(this.#adUnitOptions(this.#interstitialAdUnitId))
            .catch(() => {
                this._showAdFailurePopup(false)
            })
    }

    preloadInterstitial(): void {
        if (!this.#yandexMobileAds || !this.#hasAdUnit('interstitial')) {
            return
        }

        this.#yandexMobileAds.preloadInterstitial(this.#adUnitOptions(this.#interstitialAdUnitId))
            .catch(() => {})
    }

    showRewarded(): void {
        if (!this.#yandexMobileAds || !this.#hasAdUnit('rewarded')) {
            this._showAdFailurePopup(true)
            return
        }

        this._setRewardedState(REWARDED_STATE.LOADING)
        this.#yandexMobileAds.showRewarded(this.#adUnitOptions(this.#rewardedAdUnitId))
            .catch(() => {
                this._showAdFailurePopup(true)
            })
    }

    preloadRewarded(): void {
        if (!this.#yandexMobileAds || !this.#hasAdUnit('rewarded')) {
            return
        }

        this.#yandexMobileAds.preloadRewarded(this.#adUnitOptions(this.#rewardedAdUnitId))
            .catch(() => {})
    }

    showBanner(position?: unknown): void {
        if (!this.#yandexMobileAds || !this.#hasAdUnit('banner')) {
            this._setBannerState(BANNER_STATE.FAILED)
            return
        }

        this._setBannerState(BANNER_STATE.LOADING)
        this.#yandexMobileAds.showBanner({
            ...this.#adUnitOptions(this.#bannerAdUnitId),
            position: position ?? 'bottom',
        })
            .catch(() => {
                this._setBannerState(BANNER_STATE.FAILED)
            })
    }

    hideBanner(): void {
        if (!this.#yandexMobileAds || !this.#hasAdUnit('banner')) {
            return
        }

        this.#yandexMobileAds.hideBanner(this.#adUnitOptions(this.#bannerAdUnitId))
            .catch(() => {})
    }

    notificationsSchedule(notification: ScheduledNotification): Promise<unknown> {
        if (!this.#isNotificationsSupported) {
            return super.notificationsSchedule(notification)
        }

        const settings = this.#notificationSettings
        if (settings.requestPermission !== 'never') {
            this.#requestNotificationPermission()
        }

        const options: AnyRecord = {
            id: notification.id,
            title: notification.title,
            description: notification.description,
            delaySeconds: notification.delaySeconds ?? 0,
        }
        if (notification.image) options.image = notification.image
        if (notification.payload !== undefined) options.payload = notification.payload
        if (settings.smallIcon) options.smallIcon = settings.smallIcon
        if (settings.color) options.color = settings.color
        if (settings.channelId) options.channelId = settings.channelId
        const channelName = localize(settings.channelName, this.platformLanguage)
        if (channelName) options.channelName = channelName

        return (this.#yandexMobileAds as Required<YandexMobileAdsPlugin>).scheduleNotification(options)
    }

    notificationsCancel(id: string): Promise<void> {
        if (!this.#isNotificationsSupported) {
            return super.notificationsCancel(id)
        }

        return (this.#yandexMobileAds as Required<YandexMobileAdsPlugin>)
            .cancelNotification({ id })
            .then(() => undefined)
    }

    notificationsCancelAll(): Promise<void> {
        if (!this.#isNotificationsSupported) {
            return super.notificationsCancelAll()
        }

        return (this.#yandexMobileAds as Required<YandexMobileAdsPlugin>)
            .cancelAllNotifications()
            .then(() => undefined)
    }

    // analytics — custom events and user properties go to AppMetrica
    sendPlatformAnalyticsEvent(eventName: string, data: Record<string, unknown>): void {
        if (!this.#isAnalyticsSupported) {
            return
        }

        this.#yandexMobileAds?.reportEvent?.({ name: eventName, params: data }).catch(() => {})
    }

    setPlatformAnalyticsUserProperties(properties: Record<string, unknown>): void {
        if (!this.#isAnalyticsSupported) {
            return
        }

        this.#yandexMobileAds?.reportUserProfile?.({ attributes: properties }).catch(() => {})
    }

    // private methods
    // A format is available when the config names a unit for it (the old way)
    // or the plugin has one compiled in.
    #hasAdUnit(format: AdFormat): boolean {
        const fromConfig = {
            interstitial: this.#interstitialAdUnitId,
            rewarded: this.#rewardedAdUnitId,
            banner: this.#bannerAdUnitId,
        }[format]
        return Boolean(fromConfig) || this.#nativeAdUnits[format] === true
    }

    // Without an id from the config the plugin uses its compiled one; it also
    // prefers that one when both are present.
    #adUnitOptions(adUnitId: string | null): AnyRecord {
        return adUnitId ? { adUnitId } : {}
    }

    get #notificationSettings(): NotificationSettings {
        return this._options?.notificationSettings ?? {}
    }

    #requestNotificationPermission(): void {
        if (this.#isNotificationPermissionRequested) {
            return
        }

        this.#isNotificationPermissionRequested = true
        this.#yandexMobileAds?.requestNotificationPermission?.().catch(() => {})
    }

    // A plugin built before notifications existed has no such methods, and the
    // Capacitor proxy would still hand out a function for any name, so the
    // registered plugin headers are checked instead.
    #detectPluginMethods(required: string[]): boolean {
        const headers = window.Capacitor?.PluginHeaders
        if (Array.isArray(headers)) {
            const header = headers.find((h) => h.name === 'YandexMobileAds')
            const methods = header?.methods?.map((m) => m.name) ?? []
            return required.every((name) => methods.includes(name))
        }

        const plugin = this.#yandexMobileAds as unknown as AnyRecord
        return required.every((name) => typeof plugin[name] === 'function')
    }

    #detectNotificationsSupport(): boolean {
        return this.#detectPluginMethods(NOTIFICATION_METHODS)
    }

    async #initializeNotifications(): Promise<void> {
        this.#isNotificationsSupported = this.#detectNotificationsSupport()
        if (!this.#isNotificationsSupported) {
            return
        }

        try {
            const launch = await this.#yandexMobileAds?.getLaunchNotification?.()
            if (typeof launch?.payload === 'string' && launch.payload.length > 0) {
                this.#launchNotificationPayload = launch.payload
            }
        } catch {
            // no launch notification
        }

        if (this.#notificationSettings.requestPermission === 'onStart') {
            this.#requestNotificationPermission()
        }

        // "auto": true entries are re-armed on every launch, so a "come back"
        // reminder always counts from the last time the game was opened.
        const autoNotifications = (this._options?.notifications ?? []).filter((n) => n.auto === true)
        autoNotifications.forEach((entry) => {
            const notification = notificationFromConfig(entry, this.platformLanguage)
            if (!notification.title || !notification.description) {
                console.warn(`[Bridge] Notification "${entry.id}" has no title or description, skipped`)
                return
            }

            this.notificationsSchedule(notification).catch((error) => {
                console.warn(`[Bridge] Failed to schedule notification "${entry.id}"`, error)
            })
        })
    }

    async #initializeInternal(): Promise<void> {
        try {
            const plugins = window.Capacitor?.Plugins
            const yandexMobileAds = plugins?.YandexMobileAds as YandexMobileAdsPlugin | undefined
            if (!yandexMobileAds) {
                this._rejectPromiseDecorator(ACTION_NAME.INITIALIZE, ERROR.SDK_NOT_INITIALIZED)
                return
            }

            this.#yandexMobileAds = yandexMobileAds

            const adConfig = this._options?.advertisement as AndroidAdvertisementOptions | undefined
            this.#interstitialAdUnitId = adConfig?.interstitial?.adUnitId ?? null
            this.#rewardedAdUnitId = adConfig?.rewarded?.adUnitId ?? null
            this.#bannerAdUnitId = adConfig?.banner?.adUnitId ?? null

            const appMetricaKey = this._options?.appMetricaKey as string | undefined
            const initResult = await this.#yandexMobileAds.initialize(appMetricaKey ? { appMetricaKey } : {})
            const native = (initResult && typeof initResult === 'object' ? initResult : {}) as PluginInitializeResult
            this.#nativeAdUnits = native.adUnits ?? {}

            this.#isAnalyticsSupported = (Boolean(appMetricaKey) || native.appMetrica === true)
                && this.#detectPluginMethods(ANALYTICS_METHODS)
            this.#setupAdListeners()
            this.#setupLifecycleListeners()
            // Warm the native ad cache so the first interstitial/rewarded is
            // shown from a loaded ad instead of waiting on a fresh request. The
            // plugin keeps one ad per format and reloads it after each show.
            this.preloadInterstitial()
            this.preloadRewarded()
            await this.#initializeNotifications()

            this._setPlatformStorageAvailable(false)
            this._isInitialized = true
            this._resolvePromiseDecorator(ACTION_NAME.INITIALIZE)
        } catch (error) {
            this._rejectPromiseDecorator(ACTION_NAME.INITIALIZE, error)
        }
    }

    #setupAdListeners(): void {
        const ads = this.#yandexMobileAds as YandexMobileAdsPlugin

        ads.addListener('interstitialOpened', () => {
            this._setInterstitialState(INTERSTITIAL_STATE.OPENED)
        })
        ads.addListener('interstitialClosed', () => {
            this._setInterstitialState(INTERSTITIAL_STATE.CLOSED)
        })
        ads.addListener('interstitialFailed', () => {
            this._setInterstitialState(INTERSTITIAL_STATE.FAILED)
        })

        ads.addListener('rewardedOpened', () => {
            this._setRewardedState(REWARDED_STATE.OPENED)
        })
        ads.addListener('userEarned', () => {
            this._setRewardedState(REWARDED_STATE.REWARDED)
        })
        ads.addListener('rewardedClosed', () => {
            this._setRewardedState(REWARDED_STATE.CLOSED)
        })
        ads.addListener('rewardedFailed', () => {
            this._setRewardedState(REWARDED_STATE.FAILED)
        })

        ads.addListener('bannerShown', () => {
            this._setBannerState(BANNER_STATE.SHOWN)
        })
        ads.addListener('bannerHidden', () => {
            this._setBannerState(BANNER_STATE.HIDDEN)
        })
        ads.addListener('bannerFailed', () => {
            this._setBannerState(BANNER_STATE.FAILED)
        })
    }

    // The WebView is not paused with the app, so without this the game keeps
    // running and playing sound in the background. Older plugins never emit
    // these events, which leaves the behaviour as it was.
    #setupLifecycleListeners(): void {
        const ads = this.#yandexMobileAds as YandexMobileAdsPlugin

        ads.addListener('appPaused', () => {
            this._setPauseState(true)
        })
        ads.addListener('appResumed', () => {
            this._setPauseState(false)
        })
    }
}

export default AndroidPlatformBridge
