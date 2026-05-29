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
import { addJavaScript } from '../common/utils'
import {
    PLATFORM_ID,
    ACTION_NAME,
    INTERSTITIAL_STATE,
    REWARDED_STATE,
    STORAGE_TYPE,
    ERROR,
} from '../constants'

const SDK_URL = 'https://api.gamemonetize.com/sdk.js'

// Small delay after AD_SDK_MANAGER_READY before showing the launch interstitial,
// so the game has time to finish initializing before the ad is requested.
const INITIAL_INTERSTITIAL_DELAY = 500

class GameMonetizePlatformBridge extends PlatformBridgeBase {
    // platform
    get platformId() {
        return PLATFORM_ID.GAME_MONETIZE
    }

    // advertisement
    get isInterstitialSupported() {
        return true
    }

    get isRewardedSupported() {
        return true
    }

    get isMinimumDelayBetweenInterstitialEnabled() {
        return false
    }

    // private
    #currentAdvertisementIsRewarded = false

    // Whether the currently playing rewarded ad has been watched to completion.
    // The reward is granted only if the ad fires COMPLETE before the game resumes.
    #rewardedAdCompleted = false

    initialize() {
        if (this._isInitialized) {
            return Promise.resolve()
        }

        let promiseDecorator = this._getPromiseDecorator(ACTION_NAME.INITIALIZE)
        if (!promiseDecorator) {
            promiseDecorator = this._createPromiseDecorator(ACTION_NAME.INITIALIZE)

            if (!this._options || typeof this._options.gameId !== 'string') {
                this._rejectPromiseDecorator(ACTION_NAME.INITIALIZE, ERROR.GAME_PARAMS_NOT_FOUND)
            } else {
                const self = this
                window.SDK_OPTIONS = {
                    gameId: this._options.gameId,
                    onEvent(event) {
                        switch (event.name) {
                            case 'SDK_READY': {
                                self._platformSdk = window.sdk
                                self._isInitialized = true

                                // Show the launch interstitial after the ad manager is ready, with a
                                // small delay so the game has time to finish initializing.
                                window.addEventListener('AD_SDK_MANAGER_READY', () => {
                                    setTimeout(() => self.showInterstitial(), INITIAL_INTERSTITIAL_DELAY)
                                }, { once: true })

                                self._resolvePromiseDecorator(ACTION_NAME.INITIALIZE)
                                break
                            }
                            case 'SDK_GAME_PAUSE':
                                if (self.#currentAdvertisementIsRewarded) {
                                    self._setRewardedState(REWARDED_STATE.OPENED)
                                } else {
                                    self._setInterstitialState(INTERSTITIAL_STATE.OPENED)
                                }
                                break
                            case 'COMPLETE':
                                // The ad was watched to the end. Remember it so the reward
                                // can be granted once the game resumes (SDK_GAME_START).
                                if (self.#currentAdvertisementIsRewarded) {
                                    self.#rewardedAdCompleted = true
                                }
                                break
                            case 'SDK_GAME_START':
                                if (self.#currentAdvertisementIsRewarded) {
                                    // Grant the reward only if the ad actually played to completion.
                                    // Skipped or interrupted ads must not be rewarded.
                                    if (self.#rewardedAdCompleted) {
                                        self._setRewardedState(REWARDED_STATE.REWARDED)
                                    }
                                    self._setRewardedState(REWARDED_STATE.CLOSED)
                                } else {
                                    self._setInterstitialState(INTERSTITIAL_STATE.CLOSED)
                                }
                                self.#rewardedAdCompleted = false
                                break
                            case 'SDK_ERROR':
                            case 'AD_ERROR':
                                if (self.#currentAdvertisementIsRewarded) {
                                    self._setRewardedState(REWARDED_STATE.FAILED)
                                } else {
                                    self._setInterstitialState(INTERSTITIAL_STATE.FAILED)
                                }
                                self.#rewardedAdCompleted = false
                                break
                            default:
                                break
                        }
                    },
                }

                this._defaultStorageType = STORAGE_TYPE.LOCAL_STORAGE
                addJavaScript(SDK_URL)
            }
        }

        return promiseDecorator.promise
    }

    // advertisement
    showInterstitial() {
        this.#currentAdvertisementIsRewarded = false
        this.#showAd(false)
    }

    showRewarded() {
        this.#currentAdvertisementIsRewarded = true
        this.#rewardedAdCompleted = false
        this.#showAd(true)
    }

    // private methods
    #showAd(isRewarded) {
        if (this._platformSdk && typeof this._platformSdk.showBanner === 'function') {
            this._platformSdk.showBanner()
        } else {
            this._showAdFailurePopup(isRewarded)
        }
    }
}

export default GameMonetizePlatformBridge
