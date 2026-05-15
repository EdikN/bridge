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
import {
    PLATFORM_ID,
    ACTION_NAME,
    INTERSTITIAL_STATE,
    REWARDED_STATE,
    BANNER_STATE,
    STORAGE_TYPE,
    ERROR,
} from '../constants'

class AndroidPlatformBridge extends PlatformBridgeBase {
    // platform
    get platformId() {
        return PLATFORM_ID.ANDROID
    }

    // advertisement
    get isInterstitialSupported() {
        return true
    }

    get isRewardedSupported() {
        return true
    }

    get isBannerSupported() {
        return true
    }

    get isMinimumDelayBetweenInterstitialEnabled() {
        return false
    }

    // private
    #yandexMobileAds = null

    #interstitialAdUnitId = null

    #rewardedAdUnitId = null

    #bannerAdUnitId = null

    initialize() {
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

    showInterstitial() {
        if (!this.#yandexMobileAds || !this.#interstitialAdUnitId) {
            this._showAdFailurePopup(false)
            return
        }

        this._setInterstitialState(INTERSTITIAL_STATE.LOADING)
        this.#yandexMobileAds.showInterstitial({ adUnitId: this.#interstitialAdUnitId })
            .catch(() => {
                this._showAdFailurePopup(false)
            })
    }

    preloadInterstitial() {
        if (!this.#yandexMobileAds || !this.#interstitialAdUnitId) {
            return
        }

        this.#yandexMobileAds.preloadInterstitial({ adUnitId: this.#interstitialAdUnitId })
            .catch(() => {})
    }

    showRewarded() {
        if (!this.#yandexMobileAds || !this.#rewardedAdUnitId) {
            this._showAdFailurePopup(true)
            return
        }

        this._setRewardedState(REWARDED_STATE.LOADING)
        this.#yandexMobileAds.showRewarded({ adUnitId: this.#rewardedAdUnitId })
            .catch(() => {
                this._showAdFailurePopup(true)
            })
    }

    preloadRewarded() {
        if (!this.#yandexMobileAds || !this.#rewardedAdUnitId) {
            return
        }

        this.#yandexMobileAds.preloadRewarded({ adUnitId: this.#rewardedAdUnitId })
            .catch(() => {})
    }

    showBanner(options) {
        if (!this.#yandexMobileAds || !this.#bannerAdUnitId) {
            this._setBannerState(BANNER_STATE.FAILED)
            return
        }

        this._setBannerState(BANNER_STATE.LOADING)
        const position = options?.position || 'bottom'
        this.#yandexMobileAds.showBanner({ adUnitId: this.#bannerAdUnitId, position })
            .catch(() => {
                this._setBannerState(BANNER_STATE.FAILED)
            })
    }

    hideBanner() {
        if (!this.#yandexMobileAds || !this.#bannerAdUnitId) {
            return
        }

        this.#yandexMobileAds.hideBanner({ adUnitId: this.#bannerAdUnitId })
            .catch(() => {})
    }

    // private methods
    async #initializeInternal() {
        try {
            const plugins = window.Capacitor?.Plugins
            if (!plugins?.YandexMobileAds) {
                this._rejectPromiseDecorator(ACTION_NAME.INITIALIZE, ERROR.PLATFORM_NOT_FOUND)
                return
            }

            this.#yandexMobileAds = plugins.YandexMobileAds

            const adConfig = this._options?.advertisement
            this.#interstitialAdUnitId = adConfig?.interstitial?.adUnitId ?? null
            this.#rewardedAdUnitId = adConfig?.rewarded?.adUnitId ?? null
            this.#bannerAdUnitId = adConfig?.banner?.adUnitId ?? null

            const appMetricaKey = this._options?.appMetricaKey
            await this.#yandexMobileAds.initialize(appMetricaKey ? { appMetricaKey } : {})

            this.#setupAdListeners()

            this._defaultStorageType = STORAGE_TYPE.LOCAL_STORAGE
            this._isInitialized = true
            this._resolvePromiseDecorator(ACTION_NAME.INITIALIZE)
        } catch (error) {
            this._rejectPromiseDecorator(ACTION_NAME.INITIALIZE, error)
        }
    }

    #setupAdListeners() {
        this.#yandexMobileAds.addListener('interstitialOpened', () => {
            this._setInterstitialState(INTERSTITIAL_STATE.OPENED)
        })
        this.#yandexMobileAds.addListener('interstitialClosed', () => {
            this._setInterstitialState(INTERSTITIAL_STATE.CLOSED)
        })
        this.#yandexMobileAds.addListener('interstitialFailed', () => {
            this._setInterstitialState(INTERSTITIAL_STATE.FAILED)
        })

        this.#yandexMobileAds.addListener('rewardedOpened', () => {
            this._setRewardedState(REWARDED_STATE.OPENED)
        })
        this.#yandexMobileAds.addListener('userEarned', () => {
            this._setRewardedState(REWARDED_STATE.REWARDED)
        })
        this.#yandexMobileAds.addListener('rewardedClosed', () => {
            this._setRewardedState(REWARDED_STATE.CLOSED)
        })
        this.#yandexMobileAds.addListener('rewardedFailed', () => {
            this._setRewardedState(REWARDED_STATE.FAILED)
        })

        this.#yandexMobileAds.addListener('bannerShown', () => {
            this._setBannerState(BANNER_STATE.SHOWN)
        })
        this.#yandexMobileAds.addListener('bannerHidden', () => {
            this._setBannerState(BANNER_STATE.HIDDEN)
        })
        this.#yandexMobileAds.addListener('bannerFailed', () => {
            this._setBannerState(BANNER_STATE.FAILED)
        })
    }
}

export default AndroidPlatformBridge
