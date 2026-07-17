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
import { addJavaScript, waitFor } from '../utils'
import { ACTION_NAME } from '../constants'
import { PLATFORM_ID, type PlatformId } from '../modules/platform/constants'
import { DEVICE_TYPE, type DeviceType } from '../modules/device/constants'
import {
    INTERSTITIAL_STATE,
    REWARDED_STATE,
    BANNER_STATE,
} from '../modules/advertisement/constants'
import type { AnyRecord } from '../utils'

const SDK_URL = 'https://unpkg.com/@vkontakte/vk-bridge/dist/browser.min.js'

interface VkStorageGetResponse {
    keys: Array<{ key: string; value: string }>
}

interface VkBridge {
    send(method: string, params?: AnyRecord): Promise<AnyRecord>
}

declare global {
    interface Window {
        vkBridge?: VkBridge
    }
}

class VkPlatformBridge extends PlatformBridgeBase {
    // platform
    get platformId(): PlatformId {
        return PLATFORM_ID.VK
    }

    get platformLanguage(): string {
        const url = new URL(window.location.href)
        if (url.searchParams.has('language')) {
            const languageString = url.searchParams.get('language')
            let languageCode = 0
            try { languageCode = parseInt(languageString as string, 10) } catch (e) {
                languageCode = 0
            }

            switch (languageCode) {
                case 0: {
                    return 'ru'
                }
                case 1: {
                    return 'uk'
                }
                case 2: {
                    return 'be'
                }
                case 3: {
                    return 'en'
                }
                default: {
                    return 'ru'
                }
            }
        }

        return super.platformLanguage
    }

    get platformPayload(): string | null {
        const url = new URL(window.location.href)
        if (url.searchParams.has('hash')) {
            return url.searchParams.get('hash')
        }

        return super.platformPayload
    }

    // advertisement
    get isInterstitialSupported(): boolean {
        return true
    }

    get initialInterstitialDelay(): number {
        return 30
    }

    get isRewardedSupported(): boolean {
        return true
    }

    // device
    get deviceType(): DeviceType {
        switch (this.#platform) {
            case 'html5_ios':
            case 'html5_android':
            case 'html5_mobile': {
                return DEVICE_TYPE.MOBILE
            }
            case 'web': {
                return DEVICE_TYPE.DESKTOP
            }
            default: {
                return super.deviceType
            }
        }
    }

    // player
    get isPlayerAuthorizationSupported(): boolean {
        return true
    }

    get isPlayerAuthorized(): boolean {
        return this._isPlayerAuthorized
    }

    // social
    get isInviteFriendsSupported(): boolean {
        return true
    }

    get isJoinCommunitySupported(): boolean {
        return true
    }

    get isShareSupported(): boolean {
        return true
    }

    get isAddToHomeScreenSupported(): boolean {
        return this.#platform === 'html5_android'
    }

    get isAddToFavoritesSupported(): boolean {
        return true
    }

    // payments
    get isPaymentsSupported(): boolean {
        return true
    }

    protected _isBannerSupported = true

    #platform: string | null = null

    initialize(): Promise<unknown> {
        if (this._isInitialized) {
            return Promise.resolve()
        }

        let promiseDecorator = this._getPromiseDecorator(ACTION_NAME.INITIALIZE)
        if (!promiseDecorator) {
            promiseDecorator = this._createPromiseDecorator(ACTION_NAME.INITIALIZE)

            const url = new URL(window.location.href)
            if (url.searchParams.has('platform')) {
                this.#platform = url.searchParams.get('platform')
            }

            addJavaScript(SDK_URL).then(() => {
                waitFor('vkBridge').then(() => {
                    this._platformSdk = window.vkBridge as VkBridge;
                    (this._platformSdk as VkBridge)
                        .send('VKWebAppInit')
                        .then(() => {
                            const userInfoPromise = (this._platformSdk as VkBridge).send('VKWebAppGetUserInfo')
                                .then((data) => {
                                    if (data) {
                                        this._playerId = data.id as string
                                        this._playerName = `${data.first_name} ${data.last_name}`

                                        if (data.photo_100) {
                                            this._playerPhotos.push(data.photo_100 as string)
                                        }

                                        if (data.photo_200) {
                                            this._playerPhotos.push(data.photo_200 as string)
                                        }

                                        if (data.photo_max_orig) {
                                            this._playerPhotos.push(data.photo_max_orig as string)
                                        }
                                    }
                                })

                            // Explicitly validate the VK session via VKWebAppGetAuthToken —
                            // isPlayerAuthorized must reflect the real auth state, not assume true.
                            const authPromise = this._reAuth()

                            Promise.allSettled([userInfoPromise, authPromise])
                                .finally(() => {
                                    this._isInitialized = true
                                    this._setPlatformStorageAvailable(true)
                                    this._resolvePromiseDecorator(ACTION_NAME.INITIALIZE)
                                })
                        })
                })
            })
        }

        return promiseDecorator.promise
    }

    // player
    authorizePlayer(): Promise<unknown> {
        return this._reAuth()
    }

    // storage — VK stores values per key. Each operation retries once after a re-auth,
    // since a stale VK session sometimes rejects storage calls until it is re-validated.
    getDataFromStorage(keys: string[]): Promise<Record<string, unknown>> {
        return this._storageWithAuthRetry(async () => {
            const sdk = this._platformSdk as VkBridge
            const valuesResult = await sdk.send('VKWebAppStorageGet', { keys }) as unknown as VkStorageGetResponse
            const data: Record<string, unknown> = {}
            valuesResult.keys.forEach((entry) => {
                if (entry.value !== '') {
                    data[entry.key] = entry.value
                }
            })
            return data
        })
    }

    setDataToStorage(data: Record<string, unknown>): Promise<void> {
        return this._storageWithAuthRetry(() => {
            const sdk = this._platformSdk as VkBridge
            return Promise.all(
                Object.keys(data).map((key) => sdk.send('VKWebAppStorageSet', {
                    key,
                    value: data[key] as string,
                })),
            ).then(() => undefined)
        })
    }

    deleteDataFromStorage(keys: string[]): Promise<void> {
        return this._storageWithAuthRetry(() => {
            const sdk = this._platformSdk as VkBridge
            return Promise.all(
                keys.map((key) => sdk.send('VKWebAppStorageSet', {
                    key,
                    value: '',
                })),
            ).then(() => undefined)
        })
    }

    // advertisement
    showBanner(position?: unknown): void {
        (this._platformSdk as VkBridge)
            .send('VKWebAppShowBannerAd', { banner_location: position })
            .then((data) => {
                if (data.result) {
                    this._setBannerState(BANNER_STATE.SHOWN)
                } else {
                    this._setBannerState(BANNER_STATE.FAILED)
                }
            })
            .catch(() => {
                this._setBannerState(BANNER_STATE.FAILED)
            })
    }

    hideBanner(): void {
        (this._platformSdk as VkBridge)
            .send('VKWebAppHideBannerAd')
            .then((data) => {
                if (data.result) {
                    this._setBannerState(BANNER_STATE.HIDDEN)
                }
            })
    }

    showInterstitial(): void {
        (this._platformSdk as VkBridge)
            .send('VKWebAppCheckNativeAds', { ad_format: 'interstitial' })
            .then((data) => {
                if (data.result) {
                    this._setInterstitialState(INTERSTITIAL_STATE.OPENED)
                }
            })
            .finally(() => {
                (this._platformSdk as VkBridge)
                    .send('VKWebAppShowNativeAds', { ad_format: 'interstitial' })
                    .then((data) => {
                        if (data.result) {
                            this._setInterstitialState(INTERSTITIAL_STATE.CLOSED)
                        } else {
                            this._showAdFailurePopup(false)
                        }
                    })
                    .catch(() => {
                        this._showAdFailurePopup(false)
                    })
            })
    }

    showRewarded(): void {
        (this._platformSdk as VkBridge)
            .send('VKWebAppCheckNativeAds', { ad_format: 'reward', use_waterfall: true })
            .then((data) => {
                if (data.result) {
                    this._setRewardedState(REWARDED_STATE.OPENED)
                }
            })
            .finally(() => {
                (this._platformSdk as VkBridge)
                    .send('VKWebAppShowNativeAds', { ad_format: 'reward', use_waterfall: true })
                    .then((data) => {
                        if (data.result) {
                            this._setRewardedState(REWARDED_STATE.REWARDED)
                            this._setRewardedState(REWARDED_STATE.CLOSED)
                        } else {
                            this._showAdFailurePopup(true)
                        }
                    })
                    .catch(() => {
                        this._showAdFailurePopup(true)
                    })
            })
    }

    // social
    inviteFriends(): Promise<unknown> {
        return this._sendRequestToVKBridge(ACTION_NAME.INVITE_FRIENDS, 'VKWebAppShowInviteBox', { }, 'success')
    }

    joinCommunity(options?: AnyRecord & { groupId?: string | number }): Promise<unknown> {
        // groupId can come from runtime options or the merged social config block;
        // keep the fork's hardcoded fallback so the call works without arguments.
        const configGroupId = (this._options?.social as AnyRecord | undefined)
            ?.joinCommunity as AnyRecord | undefined
        let groupId = options?.groupId
            ?? configGroupId?.[this.platformId] as string | number | undefined
            ?? 213542253

        if (typeof groupId === 'string') {
            groupId = parseInt(groupId, 10)
            if (Number.isNaN(groupId)) {
                return Promise.reject()
            }
        }

        // Only the native VK join dialog — do not open the community page afterwards, as
        // window.open navigates the game's own frame inside the VK Android app.
        return this._sendRequestToVKBridge(ACTION_NAME.JOIN_COMMUNITY, 'VKWebAppJoinGroup', { group_id: groupId })
    }

    share(options?: AnyRecord & { url?: string, link?: string }): Promise<unknown> {
        const { url, link, ...rest } = options ?? {}
        const parameters: AnyRecord = { ...rest }
        if (url || link) {
            parameters.link = url ?? link
        }

        return this._sendRequestToVKBridge(ACTION_NAME.SHARE, 'VKWebAppShare', parameters, 'type')
    }

    addToHomeScreen(): Promise<unknown> {
        return this._sendRequestToVKBridge(ACTION_NAME.ADD_TO_HOME_SCREEN, 'VKWebAppAddToHomeScreen')
    }

    addToFavorites(): Promise<unknown> {
        return this._sendRequestToVKBridge(ACTION_NAME.ADD_TO_FAVORITES, 'VKWebAppAddToFavorites')
    }

    // clipboard
    clipboardWrite(text: string): Promise<void> {
        return this._sendRequestToVKBridge(ACTION_NAME.CLIPBOARD_WRITE, 'VKWebAppCopyText', { text })
            .then(() => undefined)
    }

    // payments — orders go through the native VK order box; the catalog is served
    // by the fork's external storage service keyed by the app id.
    paymentsPurchase(id: string): Promise<unknown> {
        const product = this._paymentsGetProductPlatformData(id)
        let platformProductId: string | number = (product?.id as string | number) ?? id

        if (typeof platformProductId === 'number') {
            platformProductId = platformProductId.toString()
        }

        return this._sendRequestToVKBridge(
            ACTION_NAME.PURCHASE,
            'VKWebAppShowOrderBox',
            { type: 'item', item: platformProductId },
            'order_id',
        ).then((data) => {
            const purchase = { id, ...(data as AnyRecord ?? {}) }
            this._paymentsPurchases.push(purchase)
            return purchase
        })
    }

    paymentsGetPurchases(): Promise<unknown> {
        return Promise.resolve(this._paymentsPurchases)
    }

    paymentsGetCatalog(): Promise<unknown> {
        let promiseDecorator = this._getPromiseDecorator(ACTION_NAME.GET_CATALOG)
        if (!promiseDecorator) {
            promiseDecorator = this._createPromiseDecorator(ACTION_NAME.GET_CATALOG)

            const url = new URL(window.location.href)
            const appId = url.searchParams.get('vk_app_id') || url.searchParams.get('api_id')

            if (appId) {
                this._fetchExternalCatalog('vk', appId)
                    .then((products) => {
                        this._resolvePromiseDecorator(ACTION_NAME.GET_CATALOG, products)
                    })
                    .catch(() => {
                        this._resolvePromiseDecorator(ACTION_NAME.GET_CATALOG, this._paymentsGetProductsPlatformData())
                    })
            } else {
                this._resolvePromiseDecorator(ACTION_NAME.GET_CATALOG, this._paymentsGetProductsPlatformData())
            }
        }

        return promiseDecorator.promise
    }

    // Re-runs VKWebAppGetAuthToken. Used on initialize and when a storage call fails —
    // sometimes the VK session needs to be re-validated (esp. vk_is_app_user=0 contexts).
    protected _reAuth(): Promise<boolean> {
        if (!this._platformSdk) {
            return Promise.resolve(false)
        }

        const url = new URL(window.location.href)
        const appIdRaw = url.searchParams.get('vk_app_id') || url.searchParams.get('api_id')
        const appId = appIdRaw ? parseInt(appIdRaw, 10) : null
        if (!appId) {
            this._isPlayerAuthorized = false
            return Promise.resolve(false)
        }

        return (this._platformSdk as VkBridge).send('VKWebAppGetAuthToken', { app_id: appId, scope: '' })
            .then((data) => {
                const ok = Boolean(data && data.user_id)
                this._isPlayerAuthorized = ok
                return ok
            })
            .catch(() => {
                this._isPlayerAuthorized = false
                return false
            })
    }

    // Wraps a storage operation: on first failure, re-runs auth and retries once.
    protected _storageWithAuthRetry<T>(operation: () => Promise<T>): Promise<T> {
        return operation().catch(() => this._reAuth().then(() => operation()))
    }

    protected _fetchExternalCatalog(platformKey: string, appId: string): Promise<AnyRecord[]> {
        return fetch(`https://storage.choclategames.ru/api/items/${platformKey}/${appId}/`)
            .then((response) => response.json())
            .then((data) => {
                const items = data && Array.isArray(data.items) ? data.items as AnyRecord[] : []
                return items.map((item) => ({
                    id: item.item_id,
                    title: item.title,
                    price: item.price,
                    description: '',
                    imageURI: '',
                    priceCurrencyCode: '',
                    priceValue: parseInt(item.price as string, 10) || 0,
                }))
            })
    }

    protected _sendRequestToVKBridge(actionName: string, vkMethodName: string, parameters: AnyRecord = { }, responseSuccessKey = 'result'): Promise<unknown> {
        let promiseDecorator = this._getPromiseDecorator(actionName)
        if (!promiseDecorator) {
            promiseDecorator = this._createPromiseDecorator(actionName);
            (this._platformSdk as VkBridge)
                .send(vkMethodName, parameters)
                .then((data) => {
                    if (data[responseSuccessKey]) {
                        this._resolvePromiseDecorator(actionName)
                        return
                    }

                    this._rejectPromiseDecorator(actionName)
                })
                .catch((error) => {
                    this._rejectPromiseDecorator(actionName, error)
                })
        }

        return promiseDecorator.promise
    }
}

export default VkPlatformBridge
