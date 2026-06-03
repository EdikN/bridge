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
import { addJavaScript, waitFor } from '../common/utils'
import {
    PLATFORM_ID,
    ACTION_NAME,
    INTERSTITIAL_STATE,
    REWARDED_STATE,
    STORAGE_TYPE,
    DEVICE_TYPE,
    BANNER_STATE,
} from '../constants'

const SDK_URL = 'https://unpkg.com/@vkontakte/vk-bridge/dist/browser.min.js'

class VkPlatformBridge extends PlatformBridgeBase {
    // platform
    get platformId() {
        return PLATFORM_ID.VK
    }

    get platformLanguage() {
        const url = new URL(window.location.href)
        if (url.searchParams.has('language')) {
            const languageString = url.searchParams.get('language')
            let languageCode = 0
            try { languageCode = parseInt(languageString, 10) } catch (e) {
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

    get platformPayload() {
        const url = new URL(window.location.href)
        if (url.searchParams.has('hash')) {
            return url.searchParams.get('hash')
        }

        return super.platformPayload
    }

    // advertisement
    get isInterstitialSupported() {
        return true
    }

    get initialInterstitialDelay() {
        return 30
    }

    get isRewardedSupported() {
        return true
    }

    // device
    get deviceType() {
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
    get isPlayerAuthorizationSupported() {
        return true
    }

    get isPlayerAuthorized() {
        return this._isPlayerAuthorized !== false
    }

    // social
    get isInviteFriendsSupported() {
        return true
    }

    get isJoinCommunitySupported() {
        return true
    }

    get isShareSupported() {
        return true
    }

    get isAddToHomeScreenSupported() {
        return this.#platform === 'html5_android'
    }

    get isAddToFavoritesSupported() {
        return true
    }

    get isVibrationSupported() {
        return true
    }

    get isPaymentsSupported() {
        return true
    }

    _isBannerSupported = true

    #platform

    // Кэш членства в сообществах (groupId → boolean). Прогревается при инициализации,
    // чтобы при клике открыть страницу сообщества СИНХРОННО (мобильный WebView блокирует
    // открытие после await).
    #communityMembership = new Map()

    initialize() {
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
                    this._platformSdk = window.vkBridge
                    this._platformSdk
                        .send('VKWebAppInit')
                        .then(() => {
                            const appIdRaw = url.searchParams.get('vk_app_id') || url.searchParams.get('api_id')
                            const appId = appIdRaw ? parseInt(appIdRaw, 10) : null

                            const userInfoPromise = this._platformSdk.send('VKWebAppGetUserInfo')
                                .then((data) => {
                                    if (data) {
                                        this._playerId = data.id
                                        this._playerName = `${data.first_name} ${data.last_name}`

                                        if (data.photo_100) {
                                            this._playerPhotos.push(data.photo_100)
                                        }

                                        if (data.photo_200) {
                                            this._playerPhotos.push(data.photo_200)
                                        }

                                        if (data.photo_max_orig) {
                                            this._playerPhotos.push(data.photo_max_orig)
                                        }
                                    }
                                })

                            const authPromise = appId
                                ? this._platformSdk.send('VKWebAppGetAuthToken', { app_id: appId, scope: '' })
                                    .then((data) => {
                                        // eslint-disable-next-line no-console
                                        console.log('[VK][Auth] token OK, user_id=', data && data.user_id, 'scope=', data && data.scope)
                                        this._isPlayerAuthorized = true
                                    })
                                    .catch((err) => {
                                        // eslint-disable-next-line no-console
                                        console.error(
                                            '[VK][Auth] FAILED:',
                                            err,
                                            'json:',
                                            JSON.stringify(err, Object.getOwnPropertyNames(err || {})),
                                        )
                                        this._isPlayerAuthorized = false
                                    })
                                : Promise.resolve().then(() => {
                                    // eslint-disable-next-line no-console
                                    console.warn('[VK][Auth] no vk_app_id / api_id in URL — skipping VKWebAppGetAuthToken')
                                    this._isPlayerAuthorized = false
                                })

                            Promise.allSettled([userInfoPromise, authPromise])
                                .finally(() => {
                                    this._isInitialized = true
                                    this._defaultStorageType = STORAGE_TYPE.PLATFORM_INTERNAL
                                    this._prefetchCommunityMembership()
                                    this._resolvePromiseDecorator(ACTION_NAME.INITIALIZE)
                                })
                        })
                })
            })
        }

        return promiseDecorator.promise
    }

    // player
    authorizePlayer() {
        return this._reAuth()
    }

    // Re-runs VKWebAppGetAuthToken. Used when a storage call fails — sometimes VK
    // session needs to be re-validated (esp. for vk_is_app_user=0 contexts, or
    // storage
    isStorageSupported(storageType) {
        if (storageType === STORAGE_TYPE.PLATFORM_INTERNAL) {
            return true
        }

        return super.isStorageSupported(storageType)
    }

    isStorageAvailable(storageType) {
        if (storageType === STORAGE_TYPE.PLATFORM_INTERNAL) {
            return true
        }

        return super.isStorageAvailable(storageType)
    }

    getDataFromStorage(key, storageType, tryParseJson) {
        if (storageType === STORAGE_TYPE.PLATFORM_INTERNAL) {
            return this._storageWithAuthRetry('GET', () => this._vkStorageGetOnce(key, tryParseJson))
        }

        return super.getDataFromStorage(key, storageType, tryParseJson)
    }

    setDataToStorage(key, value, storageType) {
        if (storageType === STORAGE_TYPE.PLATFORM_INTERNAL) {
            return this._storageWithAuthRetry('SET', () => this._vkStorageSetOnce(key, value))
        }

        return super.setDataToStorage(key, value, storageType)
    }

    deleteDataFromStorage(key, storageType) {
        if (storageType === STORAGE_TYPE.PLATFORM_INTERNAL) {
            if (Array.isArray(key)) {
                const promises = []

                for (let i = 0; i < key.length; i++) {
                    promises.push(this.setDataToStorage(key[i], '', storageType))
                }

                return Promise.all(promises)
            }
            return this.setDataToStorage(key, '', storageType)
        }

        return super.deleteDataFromStorage(key, storageType)
    }

    // advertisement
    showBanner(position) {
        this._platformSdk
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

    hideBanner() {
        this._platformSdk
            .send('VKWebAppHideBannerAd')
            .then((data) => {
                if (data.result) {
                    this._setBannerState(BANNER_STATE.HIDDEN)
                }
            })
    }

    showInterstitial() {
        this._platformSdk
            .send('VKWebAppCheckNativeAds', { ad_format: 'interstitial' })
            .then((data) => {
                if (data.result) {
                    this._setInterstitialState(INTERSTITIAL_STATE.OPENED)
                }
            })
            .finally(() => {
                this._platformSdk
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

    showRewarded() {
        this._platformSdk
            .send('VKWebAppCheckNativeAds', { ad_format: 'reward', use_waterfall: true })
            .then((data) => {
                if (data.result) {
                    this._setRewardedState(REWARDED_STATE.OPENED)
                }
            })
            .finally(() => {
                this._platformSdk
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
    inviteFriends() {
        return this._sendRequestToVKBridge(ACTION_NAME.INVITE_FRIENDS, 'VKWebAppShowInviteBox', {}, 'success')
    }

    joinCommunity(options) {
        // VKWebAppJoinGroup требует именно integer (иначе client_error code 5
        // "Param group_id should be a number")
        const groupId = this._resolveCommunityGroupId(options)
        if (!groupId) {
            return Promise.reject(new Error('joinCommunity: invalid groupId'))
        }

        // Если заранее (из прогретого кэша) знаем, что пользователь уже в группе — диалог
        // вступления ничего не покажет, поэтому открываем страницу сообщества. Делаем это
        // СИНХРОННО, в рамках клика: мобильный WebView блокирует открытие после await.
        if (this.#communityMembership.get(groupId) === true) {
            this._openCommunityPage(groupId)
            return Promise.resolve({ result: true, alreadyMember: true })
        }

        // Членство неизвестно или пользователь не в группе — показываем нативный диалог.
        // VKWebAppJoinGroup при уже-членстве просто резолвится без диалога.
        return this._platformSdk
            .send('VKWebAppJoinGroup', { group_id: groupId })
            .then((data) => {
                this.#communityMembership.set(groupId, true)
                return data
            })
    }

    isMemberOfCommunity(options) {
        const groupId = this._resolveCommunityGroupId(options)
        if (!groupId) {
            return Promise.reject(new Error('isMemberOfCommunity: invalid groupId'))
        }

        // VKWebAppGetGroupInfo отдаёт is_member: 1 — состоит, 0 — нет.
        // Поле отсутствует у закрытых сообществ → трактуем как false.
        return this._platformSdk
            .send('VKWebAppGetGroupInfo', { group_id: groupId })
            .then((data) => {
                const isMember = data?.is_member === 1
                this.#communityMembership.set(groupId, isMember)
                return isMember
            })
    }

    share(options) {
        const parameters = {}
        if (options && options.link) {
            parameters.link = options.link
        }

        return this._sendRequestToVKBridge(ACTION_NAME.SHARE, 'VKWebAppShare', parameters, 'type')
    }

    addToHomeScreen() {
        if (!this.isAddToHomeScreenSupported) {
            return Promise.reject()
        }

        return this._sendRequestToVKBridge(ACTION_NAME.ADD_TO_HOME_SCREEN, 'VKWebAppAddToHomeScreen')
    }

    addToFavorites() {
        return this._sendRequestToVKBridge(ACTION_NAME.ADD_TO_FAVORITES, 'VKWebAppAddToFavorites')
    }

    // clipboard
    clipboardWrite(text) {
        return this._sendRequestToVKBridge(ACTION_NAME.CLIPBOARD_WRITE, 'VKWebAppCopyText', { text })
    }

    // payments
    paymentsPurchase(id) {
        const product = this._paymentsGetProductPlatformData(id)
        let platformProductId = product ? product.id : id

        if (typeof platformProductId === 'number') {
            platformProductId = platformProductId.toString()
        }

        return this._sendRequestToVKBridge(
            ACTION_NAME.PURCHASE,
            'VKWebAppShowOrderBox',
            { type: 'item', item: platformProductId },
            'order_id',
        ).then((data) => {
            const purchase = { id, ...data }
            this._paymentsPurchases.push(purchase)
            return purchase
        })
    }

    paymentsGetPurchases() {
        return Promise.resolve(this._paymentsPurchases)
    }

    paymentsGetCatalog() {
        let promiseDecorator = this._getPromiseDecorator(ACTION_NAME.GET_CATALOG)
        if (!promiseDecorator) {
            promiseDecorator = this._createPromiseDecorator(ACTION_NAME.GET_CATALOG)

            const url = new URL(window.location.href)
            const appId = url.searchParams.get('vk_app_id') || url.searchParams.get('api_id')

            if (appId) {
                fetch(`https://storage.choclategames.ru/api/items/vk/${appId}/`)
                    .then((response) => response.json())
                    .then((data) => {
                        const items = data && Array.isArray(data.items) ? data.items : []
                        const products = items.map((item) => ({
                            id: item.item_id,
                            title: item.title,
                            price: item.price,
                            description: '',
                            imageURI: '',
                            priceCurrencyCode: '',
                            priceValue: parseInt(item.price, 10) || 0,
                        }))

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

    get _defaultJoinCommunityGroupId() {
        return 213542253
    }

    _resolveCommunityGroupId(options) {
        // Достаём числовой ID из любой обёртки: число, строка, { groupId } или
        // { vk } / { ok } — на любой глубине вложенности.
        const extractGroupId = (value) => {
            if (value === null || value === undefined) {
                return null
            }
            if (typeof value === 'object') {
                return extractGroupId(value.groupId ?? value[this.platformId])
            }
            return value
        }

        // ID берётся из конфига (если задан), иначе — из аргумента, иначе хардкод-дефолт.
        // Конфиг прописывать НЕ обязательно — дефолта достаточно.
        // || (не ??): пустая строка из конфига и null проваливаются на дефолт,
        // а валидный group id всегда положительный (0/'' невозможны).
        const rawGroupId = extractGroupId(this._options?.social?.joinCommunity?.[this.platformId])
            || extractGroupId(options)
            || this._defaultJoinCommunityGroupId

        const groupId = Number(rawGroupId)
        return Number.isFinite(groupId) && groupId > 0 ? groupId : null
    }

    _prefetchCommunityMembership() {
        const groupId = this._resolveCommunityGroupId()
        if (!groupId || !this._platformSdk) {
            return
        }

        this._platformSdk
            .send('VKWebAppGetGroupInfo', { group_id: groupId })
            .then((data) => {
                this.#communityMembership.set(groupId, data?.is_member === 1)
            })
            .catch(() => {})
    }

    _getCommunityUrl(groupId) {
        return `https://vk.com/club${groupId}`
    }

    _openCommunityPage(groupId) {
        // Открываем через клик по временному <a target="_blank">, а не window.open:
        // в Android-приложении VK голый window.open навигирует фрейм самой игры.
        const link = document.createElement('a')
        link.href = this._getCommunityUrl(groupId)
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        document.body.appendChild(link)
        link.click()
        link.remove()
    }

    _reAuth() {
        if (!this._platformSdk) {
            return Promise.resolve(false)
        }
        const url = new URL(window.location.href)
        const appIdRaw = url.searchParams.get('vk_app_id') || url.searchParams.get('api_id')
        const appId = appIdRaw ? parseInt(appIdRaw, 10) : null
        if (!appId) {
            return Promise.resolve(false)
        }
        return this._platformSdk.send('VKWebAppGetAuthToken', { app_id: appId, scope: '' })
            .then((data) => {
                const ok = !!(data && data.user_id)
                // eslint-disable-next-line no-console
                console.log('[VK][Auth][reAuth] result user_id=', data && data.user_id, 'scope=', data && data.scope, 'ok=', ok)
                this._isPlayerAuthorized = ok
                return ok
            })
            .catch((err) => {
                // eslint-disable-next-line no-console
                console.error(
                    '[VK][Auth][reAuth] FAILED:',
                    err,
                    'json:',
                    JSON.stringify(err, Object.getOwnPropertyNames(err || {})),
                )
                this._isPlayerAuthorized = false
                return false
            })
    }

    // Wraps a storage operation: on first failure, re-runs auth and retries once.
    _storageWithAuthRetry(label, operation) {
        return operation().catch((firstError) => {
            // eslint-disable-next-line no-console
            console.warn(
                `[VK][Storage][${label}] first attempt failed, re-authing and retrying once...`,
                firstError,
            )
            return this._reAuth().then(() => operation())
        })
    }

    _vkStorageGetOnce(key, tryParseJson) {
        return new Promise((resolve, reject) => {
            const keys = Array.isArray(key) ? key : [key]

            // eslint-disable-next-line no-console
            console.log('[VK][Storage] GET keys:', keys, 'count:', keys.length, 'sample:', keys[0])

            this._platformSdk
                .send('VKWebAppStorageGet', { keys })
                .then((data) => {
                    if (Array.isArray(key)) {
                        const values = []

                        keys.forEach((item) => {
                            const valueIndex = data.keys.findIndex((d) => d.key === item)
                            if (valueIndex < 0) {
                                values.push(null)
                                return
                            }

                            if (data.keys[valueIndex].value === '') {
                                values.push(null)
                                return
                            }

                            let { value } = data.keys[valueIndex]
                            if (tryParseJson) {
                                try {
                                    value = JSON.parse(data.keys[valueIndex].value)
                                } catch (e) {
                                    // keep value as it is
                                }
                            }

                            values.push(value)
                        })

                        resolve(values)
                        return
                    }

                    if (data.keys[0].value === '') {
                        resolve(null)
                        return
                    }

                    let { value } = data.keys[0]
                    if (tryParseJson) {
                        try {
                            value = JSON.parse(data.keys[0].value)
                        } catch (e) {
                            // keep value as it is
                        }
                    }

                    resolve(value)
                })
                .catch((error) => {
                    try {
                        // eslint-disable-next-line no-console
                        console.error(
                            '[VK][Storage][GET] raw VK error:',
                            error,
                            'json:',
                            JSON.stringify(error, Object.getOwnPropertyNames(error || {})),
                        )
                    } catch (e) { /* ignore */ }
                    reject(error || { error_type: '(empty VK rejection)' })
                })
        })
    }

    _vkStorageSetOnce(key, value) {
        // eslint-disable-next-line no-console
        console.log('[VK][Storage] SET keys:', Array.isArray(key) ? key : [key], 'firstKey:', Array.isArray(key) ? key[0] : key)

        if (Array.isArray(key)) {
            const promises = []

            for (let i = 0; i < key.length; i++) {
                const data = { key: key[i], value: value[i] }

                if (typeof value[i] !== 'string') {
                    data.value = JSON.stringify(value[i])
                }

                promises.push(this._platformSdk.send('VKWebAppStorageSet', data))
            }

            return Promise.all(promises).catch((error) => {
                try {
                    // eslint-disable-next-line no-console
                    console.error(
                        '[VK][Storage][SET][bulk] raw VK error:',
                        error,
                        'json:',
                        JSON.stringify(error, Object.getOwnPropertyNames(error || {})),
                    )
                } catch (e) { /* ignore */ }
                throw error || { error_type: '(empty VK rejection)' }
            })
        }

        const data = { key, value }

        if (typeof value !== 'string') {
            data.value = JSON.stringify(value)
        }

        return new Promise((resolve, reject) => {
            this._platformSdk
                .send('VKWebAppStorageSet', data)
                .then(() => {
                    resolve()
                })
                .catch((error) => {
                    try {
                        // eslint-disable-next-line no-console
                        console.error(
                            '[VK][Storage][SET] raw VK error:',
                            error,
                            'json:',
                            JSON.stringify(error, Object.getOwnPropertyNames(error || {})),
                        )
                    } catch (e) { /* ignore */ }
                    reject(error || { error_type: '(empty VK rejection)' })
                })
        })
    }

    _sendRequestToVKBridge(actionName, vkMethodName, parameters = {}, responseSuccessKey = 'result') {
        let promiseDecorator = this._getPromiseDecorator(actionName)
        if (!promiseDecorator) {
            promiseDecorator = this._createPromiseDecorator(actionName)

            this._platformSdk
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
