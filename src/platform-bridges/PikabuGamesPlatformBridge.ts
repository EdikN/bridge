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

// Fork: Pikabu Games (games.pikabu.ru), PkbSDK. See docs/pikabu-games.md.

import PlatformBridgeBase from './PlatformBridgeBase'
import { addJavaScript, type AnyRecord } from '../utils'
import { ACTION_NAME } from '../constants'
import { PLATFORM_ID, PLATFORM_MESSAGE, type PlatformId } from '../modules/platform/constants'
import { INTERSTITIAL_STATE, REWARDED_STATE } from '../modules/advertisement/constants'
import logger from '../lib/logger'

const SDK_URL = 'https://games.pikabu.ru/sdk/sdk.js'
// Fork backend (VkStorage) that checks the signed purchase JWT with the game's Pikabu secret key.
const PURCHASE_VERIFY_BASE_URL = 'https://storage.choclategames.ru/payments/pikabu/'
// PkbSDK.init() has no timeout of its own: outside the portal it never settles.
const SDK_INIT_TIMEOUT = 15000

type PikabuAdError = 'NOT_SUPPORTED' | 'IN_PROGRESS' | 'UI_BUSY' | 'COOLDOWN_ACTIVE' | 'INVALID_GAME_STATE' | 'UNKNOWN'

type PikabuAdResult = { rendered: true } | { rendered: false, reason: PikabuAdError }

interface PikabuAdApi<R = PikabuAdResult> {
    isSupported: boolean
    canShow(): Promise<boolean>
    show(): Promise<R>
}

interface PikabuPurchase {
    productId: string
    purchaseId: string
    isConsumable: boolean
    developerPayload?: string
    getSignedData(): Promise<string>
}

interface PikabuProduct {
    id: string
    name: string
    price: number
    currencyCode: string
    formattedPrice: string
}

type PikabuPurchaseResult = { success: true, purchase: PikabuPurchase } | { success: false, reason: string }

type PikabuStorageSaveResult = { success: true } | { success: false, reason: string }

export interface PikabuSdk {
    player: {
        id: string
        name: string
        avatar: string
        isAuthorized: boolean
        getSignedData(): Promise<string>
    }
    auth: {
        openAuthDialog(): Promise<void>
    }
    ads: {
        preloader: PikabuAdApi
        fullscreen: PikabuAdApi
        rewarded: PikabuAdApi<PikabuAdResult & { reward: boolean }>
    }
    storage: {
        get(key: string): unknown
        set(key: string, value: unknown): void
        remove(key: string): void
        getAll(): Record<string, unknown>
        flush(): Promise<PikabuStorageSaveResult>
    }
    store: {
        purchase(options: { productId: string, developerPayload?: string }): Promise<PikabuPurchaseResult>
        consumePurchase(purchaseId: string): Promise<{ success: boolean }>
        getProducts(): Promise<PikabuProduct[]>
        getPurchases(): Promise<PikabuPurchase[]>
    }
    gameStarted(): void
    on(event: string, listener: (...args: unknown[]) => void): () => void
    once(event: string, listener: (...args: unknown[]) => void): () => void
    off(event: string, listener: (...args: unknown[]) => void): void
}

declare global {
    interface Window {
        PkbSDK?: {
            init(): Promise<PikabuSdk>
        }
    }
}

class PikabuGamesPlatformBridge extends PlatformBridgeBase {
    // platform
    get platformId(): PlatformId {
        return PLATFORM_ID.PIKABU_GAMES
    }

    // The portal is Russian-only and the SDK has no locale API; moderation requires a Russian UI by default.
    get platformLanguage(): string {
        return 'ru'
    }

    // player
    get isPlayerAuthorizationSupported(): boolean {
        return true
    }

    // advertisement
    get isInterstitialSupported(): boolean {
        return Boolean(this.#sdk?.ads.fullscreen.isSupported)
    }

    get isRewardedSupported(): boolean {
        return Boolean(this.#sdk?.ads.rewarded.isSupported)
    }

    // payments
    get isPaymentsSupported(): boolean {
        return true
    }

    #preloaderPromise: Promise<void> = Promise.resolve()

    #isGameStarted = false

    initialize(): Promise<unknown> {
        if (this._isInitialized) {
            return Promise.resolve()
        }

        let promiseDecorator = this._getPromiseDecorator(ACTION_NAME.INITIALIZE)
        if (!promiseDecorator) {
            promiseDecorator = this._createPromiseDecorator(ACTION_NAME.INITIALIZE)

            addJavaScript(SDK_URL)
                .then(() => this.#initSdk())
                .then((sdk) => {
                    this._platformSdk = sdk
                    this.#updatePlayer()

                    sdk.on('userAuthorized', () => {
                        this.#updatePlayer()
                    })
                    sdk.on('storageSaveError', (reason) => {
                        logger.warn('Pikabu storage save error:', reason)
                    })

                    // Cloud storage works for guests too; data is preloaded at init.
                    this._setPlatformStorageAvailable(true)

                    // platforms.pikabu_games.preloaderAd: show the mobile preloader ad while the game loads
                    if (this._options?.preloaderAd === true) {
                        this.#preloaderPromise = this.#showPreloader()
                    }

                    this._isInitialized = true
                    this._resolvePromiseDecorator(ACTION_NAME.INITIALIZE)
                })
                .catch((error) => {
                    this._rejectPromiseDecorator(ACTION_NAME.INITIALIZE, error)
                })
        }

        return promiseDecorator.promise
    }

    sendMessage(message?: unknown, options?: unknown): Promise<unknown> {
        switch (message) {
            case PLATFORM_MESSAGE.GAME_READY: {
                if (!this.#isGameStarted) {
                    this.#isGameStarted = true
                    // The preloader ad may only run before gameStarted(), so wait for it to close.
                    this.#preloaderPromise.then(() => {
                        this.#sdk?.gameStarted()
                    })
                }
                return Promise.resolve()
            }
            default: {
                return super.sendMessage(message, options)
            }
        }
    }

    // player
    authorizePlayer(): Promise<unknown> {
        let promiseDecorator = this._getPromiseDecorator(ACTION_NAME.AUTHORIZE_PLAYER)
        if (!promiseDecorator) {
            promiseDecorator = this._createPromiseDecorator(ACTION_NAME.AUTHORIZE_PLAYER)

            const sdk = this.#sdk
            if (!sdk) {
                this._rejectPromiseDecorator(ACTION_NAME.AUTHORIZE_PLAYER)
            } else if (sdk.player.isAuthorized) {
                this.#updatePlayer()
                this._resolvePromiseDecorator(ACTION_NAME.AUTHORIZE_PLAYER)
            } else {
                this.#setOverlayOpened(true)
                sdk.auth.openAuthDialog()
                    .then(() => {
                        this.#setOverlayOpened(false)
                        this.#updatePlayer()
                        if (sdk.player.isAuthorized) {
                            this._resolvePromiseDecorator(ACTION_NAME.AUTHORIZE_PLAYER)
                        } else {
                            this._rejectPromiseDecorator(ACTION_NAME.AUTHORIZE_PLAYER)
                        }
                    })
                    .catch((error) => {
                        this.#setOverlayOpened(false)
                        this._rejectPromiseDecorator(ACTION_NAME.AUTHORIZE_PLAYER, error)
                    })
            }
        }

        return promiseDecorator.promise
    }

    // storage: the SDK keeps a preloaded key/value map and autosaves changed keys itself.
    async getDataFromStorage(keys: string[]): Promise<Record<string, unknown>> {
        const sdk = this.#requireSdk()
        const all = sdk.storage.getAll()
        const result: Record<string, unknown> = {}
        keys.forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(all, key)) {
                result[key] = all[key]
            }
        })
        return result
    }

    async setDataToStorage(data: Record<string, unknown>): Promise<void> {
        const sdk = this.#requireSdk()
        Object.keys(data).forEach((key) => {
            sdk.storage.set(key, data[key])
        })
        // No flush here: the SDK autosaves changed keys with a short delay, and flush() is rate limited
        // (100 requests per 5 minutes), which frequent bridge saves would exhaust.
    }

    async deleteDataFromStorage(keys: string[]): Promise<void> {
        const sdk = this.#requireSdk()
        keys.forEach((key) => {
            sdk.storage.remove(key)
        })
    }

    // advertisement
    showInterstitial(): void {
        const ad = this.#sdk?.ads.fullscreen
        if (!ad) {
            this._showAdFailurePopup(false)
            return
        }

        ad.canShow()
            .then((canShow) => {
                if (!canShow) {
                    this._showAdFailurePopup(false)
                    return
                }

                this._setInterstitialState(INTERSTITIAL_STATE.OPENED)
                ad.show()
                    .then((result) => {
                        if (result.rendered) {
                            this._setInterstitialState(INTERSTITIAL_STATE.CLOSED)
                        } else {
                            logger.warn('Pikabu interstitial not shown:', result.reason)
                            this._showAdFailurePopup(false)
                        }
                    })
                    .catch((error) => {
                        logger.error('Pikabu interstitial error:', error)
                        this._showAdFailurePopup(false)
                    })
            })
            .catch(() => {
                this._showAdFailurePopup(false)
            })
    }

    showRewarded(): void {
        const ad = this.#sdk?.ads.rewarded
        if (!ad) {
            this._showAdFailurePopup(true)
            return
        }

        ad.canShow()
            .then((canShow) => {
                if (!canShow) {
                    this._showAdFailurePopup(true)
                    return
                }

                this._setRewardedState(REWARDED_STATE.OPENED)
                ad.show()
                    .then((result) => {
                        if (!result.rendered) {
                            logger.warn('Pikabu rewarded not shown:', result.reason)
                            this._showAdFailurePopup(true)
                            return
                        }

                        // reward is true only when the ad was watched to the end
                        if (result.reward) {
                            this._setRewardedState(REWARDED_STATE.REWARDED)
                        }
                        this._setRewardedState(REWARDED_STATE.CLOSED)
                    })
                    .catch((error) => {
                        logger.error('Pikabu rewarded error:', error)
                        this._showAdFailurePopup(true)
                    })
            })
            .catch(() => {
                this._showAdFailurePopup(true)
            })
    }

    // payments
    paymentsPurchase(id: string, options?: unknown): Promise<unknown> {
        const sdk = this.#sdk
        if (!sdk) {
            return Promise.reject()
        }

        const product = this._paymentsGetProductPlatformData(id)
        const productId = (product?.platformProductId ?? id) as string

        let promiseDecorator = this._getPromiseDecorator(ACTION_NAME.PURCHASE)
        if (!promiseDecorator) {
            promiseDecorator = this._createPromiseDecorator(ACTION_NAME.PURCHASE)

            const developerPayload = (options as AnyRecord | undefined)?.developerPayload

            // The payment form (and the auth dialog it may open) covers the game.
            this.#setOverlayOpened(true)
            sdk.store.purchase({
                productId,
                ...(typeof developerPayload === 'string' ? { developerPayload } : {}),
            })
                .then((result) => {
                    this.#setOverlayOpened(false)
                    this.#updatePlayer()
                    if (!result.success) {
                        this._rejectPromiseDecorator(ACTION_NAME.PURCHASE, result.reason)
                        return
                    }

                    const purchase = this.#toBridgePurchase(result.purchase)
                    // An unverified purchase stays unconsumed on Pikabu and comes back in getPurchases().
                    return this.#verifyPurchase(result.purchase)
                        .then(() => {
                            this._paymentsPurchases.push(purchase)
                            this._resolvePromiseDecorator(ACTION_NAME.PURCHASE, purchase)
                        })
                })
                .catch((error) => {
                    this.#setOverlayOpened(false)
                    this._rejectPromiseDecorator(ACTION_NAME.PURCHASE, error)
                })
        }

        return promiseDecorator.promise
    }

    paymentsConsumePurchase(id: string): Promise<unknown> {
        const sdk = this.#sdk
        if (!sdk) {
            return Promise.reject()
        }

        const purchaseIndex = this._paymentsPurchases.findIndex((p) => p.id === id)
        if (purchaseIndex < 0) {
            return Promise.reject()
        }

        let promiseDecorator = this._getPromiseDecorator(ACTION_NAME.CONSUME_PURCHASE)
        if (!promiseDecorator) {
            promiseDecorator = this._createPromiseDecorator(ACTION_NAME.CONSUME_PURCHASE)

            sdk.store.consumePurchase(this._paymentsPurchases[purchaseIndex].purchaseId as string)
                .then((result) => {
                    if (!result.success) {
                        this._rejectPromiseDecorator(ACTION_NAME.CONSUME_PURCHASE)
                        return
                    }

                    const index = this._paymentsPurchases.findIndex((p) => p.id === id)
                    if (index >= 0) {
                        this._paymentsPurchases.splice(index, 1)
                    }
                    this._resolvePromiseDecorator(ACTION_NAME.CONSUME_PURCHASE, { id })
                })
                .catch((error) => {
                    this._rejectPromiseDecorator(ACTION_NAME.CONSUME_PURCHASE, error)
                })
        }

        return promiseDecorator.promise
    }

    paymentsGetCatalog(): Promise<unknown> {
        const sdk = this.#sdk
        if (!sdk) {
            return Promise.reject()
        }

        let promiseDecorator = this._getPromiseDecorator(ACTION_NAME.GET_CATALOG)
        if (!promiseDecorator) {
            promiseDecorator = this._createPromiseDecorator(ACTION_NAME.GET_CATALOG)

            sdk.store.getProducts()
                .then((pikabuProducts) => {
                    const mergedProducts = this._paymentsGetProductsPlatformData()
                        .map((product) => {
                            const platformProductId = (product.platformProductId ?? product.id) as string
                            const pikabuProduct = pikabuProducts.find((p) => p.id === platformProductId)
                            if (!pikabuProduct) {
                                logger.warn(`Pikabu catalog has no product '${platformProductId}', skipped`)
                                return null
                            }

                            return {
                                id: product.id,
                                title: pikabuProduct.name,
                                price: pikabuProduct.formattedPrice,
                                priceCurrencyCode: pikabuProduct.currencyCode,
                                // Pikabu prices are in kopecks
                                priceValue: pikabuProduct.price / 100,
                            }
                        })
                        .filter((product) => product !== null)

                    this._resolvePromiseDecorator(ACTION_NAME.GET_CATALOG, mergedProducts)
                })
                .catch((error) => {
                    this._rejectPromiseDecorator(ACTION_NAME.GET_CATALOG, error)
                })
        }

        return promiseDecorator.promise
    }

    paymentsGetPurchases(): Promise<unknown> {
        const sdk = this.#sdk
        if (!sdk) {
            return Promise.reject()
        }

        let promiseDecorator = this._getPromiseDecorator(ACTION_NAME.GET_PURCHASES)
        if (!promiseDecorator) {
            promiseDecorator = this._createPromiseDecorator(ACTION_NAME.GET_PURCHASES)

            sdk.store.getPurchases()
                .then((purchases) => Promise.all(purchases.map((purchase) => this.#verifyPurchase(purchase)
                    .then(() => this.#toBridgePurchase(purchase))
                    .catch((error) => {
                        logger.warn(`Pikabu purchase '${purchase.purchaseId}' failed verification:`, error)
                        return null
                    }))))
                .then((purchases) => {
                    this._paymentsPurchases = purchases.filter((purchase) => purchase !== null)
                    this._resolvePromiseDecorator(ACTION_NAME.GET_PURCHASES, this._paymentsPurchases)
                })
                .catch((error) => {
                    this._rejectPromiseDecorator(ACTION_NAME.GET_PURCHASES, error)
                })
        }

        return promiseDecorator.promise
    }

    get #sdk(): PikabuSdk | null {
        return this._platformSdk as PikabuSdk | null
    }

    #initSdk(): Promise<PikabuSdk> {
        const pkb = window.PkbSDK
        if (!pkb) {
            return Promise.reject(new Error('PkbSDK is not loaded'))
        }

        // In a top-level window the SDK answers its own handshake forever; it only works in the portal iframe.
        if (window.parent === window) {
            return Promise.reject(new Error('PkbSDK works only inside the Pikabu Games iframe'))
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('PkbSDK.init() timed out'))
            }, SDK_INIT_TIMEOUT)

            pkb.init()
                .then(resolve, reject)
                .finally(() => clearTimeout(timeout))
        })
    }

    #showPreloader(): Promise<void> {
        const ad = this.#sdk?.ads.preloader
        if (!ad || !ad.isSupported) {
            return Promise.resolve()
        }

        return ad.canShow()
            .then((canShow) => {
                if (!canShow) {
                    return undefined
                }

                // Music must not play over the preloader ad.
                this._setAudioState(false)
                return ad.show()
                    .then((result) => {
                        if (!result.rendered) {
                            logger.warn('Pikabu preloader not shown:', result.reason)
                        }
                    })
                    .finally(() => {
                        this._setAudioState(true)
                    })
            })
            .catch((error) => {
                logger.warn('Pikabu preloader error:', error)
            })
    }

    // Pikabu sends no pause/mute signals: the game must stop itself while a platform dialog covers it.
    // Restored before the action settles, so the game is already unpaused when its promise resolves.
    #setOverlayOpened(isOpened: boolean): void {
        this._setPauseState(isOpened)
        this._setAudioState(!isOpened)
    }

    // platforms.pikabu_games: purchaseVerifyUrl (full URL), or verifyPurchases: true with gameSlug
    // (defaults to the /play/<slug>/ folder the game is served from on VkStorage). Off by default.
    #getPurchaseVerifyUrl(): string | null {
        const options = this._options ?? {}
        if (typeof options.purchaseVerifyUrl === 'string' && options.purchaseVerifyUrl) {
            return options.purchaseVerifyUrl
        }

        if (options.verifyPurchases !== true) {
            return null
        }

        const pathSlug = window.location.pathname.match(/\/play\/([^/]+)\//)?.[1]
        const slug = typeof options.gameSlug === 'string' && options.gameSlug
            ? options.gameSlug
            : pathSlug && decodeURIComponent(pathSlug)

        if (!slug) {
            logger.warn('Pikabu purchase verification is on, but gameSlug is not set')
            return null
        }

        return `${PURCHASE_VERIFY_BASE_URL}${encodeURIComponent(slug)}/`
    }

    async #verifyPurchase(purchase: PikabuPurchase): Promise<void> {
        const url = this.#getPurchaseVerifyUrl()
        if (!url) {
            return
        }

        const token = await purchase.getSignedData()
        // text/plain keeps the request "simple", so the browser sends no CORS preflight.
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ token }),
        })

        let body: AnyRecord | null = null
        try {
            body = await response.json() as AnyRecord
        } catch {
            body = null
        }

        // duplicate: the server already recorded this purchaseId, which is fine for a retry or a restore.
        if (!response.ok || !body || body.ok !== true) {
            throw new Error(`Pikabu purchase verification failed: ${body?.error ?? response.status}`)
        }
    }

    #updatePlayer(): void {
        const player = this.#sdk?.player
        if (!player) {
            return
        }

        this._isPlayerAuthorized = player.isAuthorized
        this._playerId = player.id || this._playerId
        this._playerName = player.name || this._playerName
        this._playerPhotos = player.avatar ? [player.avatar] : []
    }

    #requireSdk(): PikabuSdk {
        const sdk = this.#sdk
        if (!sdk) {
            throw new Error('Pikabu SDK is not initialized')
        }
        return sdk
    }

    #toBridgePurchase(purchase: PikabuPurchase): AnyRecord & { id: string } {
        const product = this._paymentsGetProductsPlatformData()
            .find((p) => (p.platformProductId ?? p.id) === purchase.productId)

        return {
            id: (product?.id ?? purchase.productId) as string,
            purchaseId: purchase.purchaseId,
            isConsumable: purchase.isConsumable,
            developerPayload: purchase.developerPayload,
            getSignedData: () => purchase.getSignedData(),
        }
    }
}

export default PikabuGamesPlatformBridge
