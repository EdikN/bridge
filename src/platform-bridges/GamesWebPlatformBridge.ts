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

// Fork-only platform: the GamesWeb portal (choclategames.ru). The game runs in an
// iframe of the portal page and talks to it over the GamesWeb Host Protocol v1
// (docs/gamesweb.md). Outside the portal the bridge stays in offline mode: local
// storage, no ads, no leaderboards, guest player — and never hangs.

import PlatformBridgeBase from './PlatformBridgeBase'
import ServerTimeCache from '../lib/ServerTimeCache'
import {
    ACTION_NAME,
    BridgeError,
    ERROR_CODE,
} from '../constants'
import {
    PLATFORM_ID,
    PLATFORM_MESSAGE,
    VISIBILITY_STATE,
    type PlatformId,
    type VisibilityState,
} from '../modules/platform/constants'
import { DEVICE_TYPE, type DeviceType } from '../modules/device/constants'
import {
    INTERSTITIAL_STATE,
    REWARDED_STATE,
    BANNER_STATE,
} from '../modules/advertisement/constants'
import { LEADERBOARD_TYPE, type LeaderboardType } from '../modules/leaderboards/constants'
import type { LeaderboardEntry } from '../modules/leaderboards/types'
import type { AnyRecord } from '../utils'
import {
    GW_ERROR_CODE,
    GW_PROTOCOL_VERSION,
    GwError,
    createGwClient,
    type GwClient,
    type GwFeatures,
    type GwHelloResult,
    type GwPlayer,
} from './gamesweb/GwHostClient'

// Where an ad request is: nothing in flight, asked the host, the ad is on screen, the reward was granted.
type AdPhase = 'idle' | 'requested' | 'opened' | 'rewarded'

const LEADERBOARD_TOP = 20
const LEADERBOARD_AROUND = 3

class GamesWebPlatformBridge extends PlatformBridgeBase {
    // platform
    get platformId(): PlatformId {
        return PLATFORM_ID.GAMESWEB
    }

    get platformLanguage(): string {
        const language = this.#info?.platform?.language
        if (typeof language === 'string' && language) {
            return language.substring(0, 2).toLowerCase()
        }

        return super.platformLanguage
    }

    get platformTld(): string | null {
        const tld = this.#info?.platform?.tld
        return typeof tld === 'string' && tld ? tld.toLowerCase() : super.platformTld
    }

    get platformPayload(): string | null {
        const payload = this.#info?.platform?.payload
        return typeof payload === 'string' ? payload : super.platformPayload
    }

    // The portal does its own analytics; nothing is sent to Playgama.
    get isPlatformExternalCallsSupported(): boolean {
        return false
    }

    get isOnline(): boolean {
        return this.#isOnline
    }

    // player
    get isPlayerAuthorizationSupported(): boolean {
        return this.#isOnline && this.#features.authorization !== false
    }

    // advertisement
    get isInterstitialSupported(): boolean {
        return this.#isOnline && this.#features.interstitial === true
    }

    get isRewardedSupported(): boolean {
        return this.#isOnline && this.#features.rewarded === true
    }

    get initialInterstitialDelay(): number {
        const delay = this.#info?.ads?.initialInterstitialDelay
        if (typeof delay === 'number' && Number.isFinite(delay) && delay >= 0) {
            return delay
        }

        return super.initialInterstitialDelay
    }

    // social
    get isShareSupported(): boolean {
        return this.#isOnline && this.#features.share === true
    }

    get isInviteFriendsSupported(): boolean {
        return this.#isOnline && this.#features.inviteFriends === true
    }

    get isRateSupported(): boolean {
        return this.#isOnline && this.#features.rate === true
    }

    get isAddToFavoritesSupported(): boolean {
        return this.#isOnline && this.#features.favorites === true
    }

    get isJoinCommunitySupported(): boolean {
        return this.#isOnline && this.#features.joinCommunity === true
    }

    // device
    get deviceType(): DeviceType {
        switch (this.#info?.platform?.deviceType) {
            case DEVICE_TYPE.DESKTOP: {
                return DEVICE_TYPE.DESKTOP
            }
            case DEVICE_TYPE.MOBILE: {
                return DEVICE_TYPE.MOBILE
            }
            case DEVICE_TYPE.TABLET: {
                return DEVICE_TYPE.TABLET
            }
            case DEVICE_TYPE.TV: {
                return DEVICE_TYPE.TV
            }
            default: {
                return super.deviceType
            }
        }
    }

    // leaderboards
    get leaderboardsType(): LeaderboardType {
        return this.#isOnline && this.#features.leaderboards === true
            ? LEADERBOARD_TYPE.IN_GAME
            : LEADERBOARD_TYPE.NOT_AVAILABLE
    }

    // config
    get isRemoteConfigSupported(): boolean {
        return this.#isOnline && this.#features.remoteConfig === true
    }

    #client: GwClient | null = null

    #isOnline = false

    #info: GwHelloResult | null = null

    #features: GwFeatures = {}

    #lastLoadingProgress: number | null = null

    #interstitialPhase: AdPhase = 'idle'

    #interstitialRequest = 0

    #rewardedPhase: AdPhase = 'idle'

    #rewardedRequest = 0

    #serverTimeCache = new ServerTimeCache(() => this.#fetchServerTime())

    initialize(): Promise<unknown> {
        if (this._isInitialized) {
            return Promise.resolve()
        }

        let promiseDecorator = this._getPromiseDecorator(ACTION_NAME.INITIALIZE)
        if (!promiseDecorator) {
            promiseDecorator = this._createPromiseDecorator(ACTION_NAME.INITIALIZE)

            const client = createGwClient(window)
            this.#client = client

            client.connect({ sdk: 'bridge', sdkVersion: PLUGIN_VERSION, runtime: GW_PROTOCOL_VERSION })
                .then((info) => {
                    if (info) {
                        this.#applyHello(info)
                    }
                })
                .catch(() => {
                    // connect() never rejects; stay offline if it somehow does
                })
                .finally(() => {
                    this._isInitialized = true
                    this._resolvePromiseDecorator(ACTION_NAME.INITIALIZE)
                })
        }

        return promiseDecorator.promise
    }

    // platform
    sendMessage(message?: unknown, options?: unknown): Promise<unknown> {
        if (!this.#isOnline) {
            return Promise.resolve()
        }

        const request = message === PLATFORM_MESSAGE.GAME_READY
            ? this.#call('platform.ready')
            : this.#call('platform.message', { message, ...(options ? { options } : {}) })

        // Analytics only: a lost message must not break the game.
        return request.then(() => undefined, () => undefined)
    }

    setLoadingProgress(percent: number): void {
        this.#lastLoadingProgress = percent
        if (!this.#isOnline) {
            return
        }

        this.#call('platform.progress', { percent }).catch(() => {})
    }

    // Offline there is no trusted clock; Playgama's time API is never used on this platform.
    getServerTime(): Promise<number> {
        if (!this.#isOnline) {
            return Promise.resolve(Date.now())
        }

        return this.#serverTimeCache.getServerTime()
    }

    // player
    authorizePlayer(): Promise<unknown> {
        if (!this.isPlayerAuthorizationSupported) {
            return Promise.reject()
        }

        if (this._isPlayerAuthorized) {
            return Promise.resolve()
        }

        let promiseDecorator = this._getPromiseDecorator(ACTION_NAME.AUTHORIZE_PLAYER)
        if (!promiseDecorator) {
            promiseDecorator = this._createPromiseDecorator(ACTION_NAME.AUTHORIZE_PLAYER)

            this.#call('player.authorize')
                .then((player) => {
                    this.#applyPlayer(player as GwPlayer)
                    if (this._isPlayerAuthorized) {
                        this._resolvePromiseDecorator(ACTION_NAME.AUTHORIZE_PLAYER)
                    } else {
                        this._rejectPromiseDecorator(
                            ACTION_NAME.AUTHORIZE_PLAYER,
                            new GwError(GW_ERROR_CODE.CANCELLED),
                        )
                    }
                })
                .catch((error) => {
                    this._rejectPromiseDecorator(ACTION_NAME.AUTHORIZE_PLAYER, error)
                })
        }

        return promiseDecorator.promise
    }

    // storage — the host keeps one save per player and game; values travel as strings.
    getDataFromStorage(keys: string[]): Promise<Record<string, unknown>> {
        if (!this.#isOnline) {
            return Promise.reject(new BridgeError(ERROR_CODE.STORAGE_NOT_AVAILABLE))
        }

        return this.#call('storage.get', { keys }).then((result) => {
            const data = ((result as AnyRecord | null)?.data ?? {}) as AnyRecord
            const values: Record<string, unknown> = {}
            keys.forEach((key) => {
                const value = data[key]
                if (value !== undefined && value !== null && value !== '') {
                    values[key] = value
                }
            })
            return values
        })
    }

    setDataToStorage(data: Record<string, unknown>): Promise<void> {
        if (!this.#isOnline) {
            return Promise.reject(new BridgeError(ERROR_CODE.STORAGE_NOT_AVAILABLE))
        }

        const values: Record<string, string> = {}
        Object.keys(data).forEach((key) => {
            const value = data[key]
            values[key] = typeof value === 'string' ? value : JSON.stringify(value)
        })

        return this.#call('storage.set', { data: values }).then(() => undefined)
    }

    deleteDataFromStorage(keys: string[]): Promise<void> {
        if (!this.#isOnline) {
            return Promise.reject(new BridgeError(ERROR_CODE.STORAGE_NOT_AVAILABLE))
        }

        return this.#call('storage.delete', { keys }).then(() => undefined)
    }

    // advertisement
    showBanner(position?: unknown, placement?: unknown): void {
        if (!this.#isOnline || !this._isBannerSupported) {
            this._setBannerState(BANNER_STATE.FAILED)
            return
        }

        this.#call('ads.banner.show', {
            position: position === 'top' ? 'top' : 'bottom',
            ...(placement ? { placement } : {}),
        })
            .then((result) => {
                const isShown = (result as AnyRecord | null)?.shown === true
                this._setBannerState(isShown ? BANNER_STATE.SHOWN : BANNER_STATE.FAILED)
            })
            .catch(() => {
                this._setBannerState(BANNER_STATE.FAILED)
            })
    }

    hideBanner(): void {
        if (!this.#isOnline) {
            this._setBannerState(BANNER_STATE.HIDDEN)
            return
        }

        this.#call('ads.banner.hide')
            .then(() => {
                this._setBannerState(BANNER_STATE.HIDDEN)
            })
            .catch(() => {})
    }

    showInterstitial(placement?: unknown): void {
        if (!this.isInterstitialSupported) {
            this._showAdFailurePopup(false)
            return
        }

        this.#interstitialRequest += 1
        const request = this.#interstitialRequest
        this.#interstitialPhase = 'requested'

        this.#call('ads.interstitial', placement ? { placement } : {})
            .then((result) => {
                if (request === this.#interstitialRequest) {
                    this.#finishInterstitial((result as AnyRecord | null)?.shown === true)
                }
            })
            .catch((error) => {
                if (request === this.#interstitialRequest) {
                    this.#finishInterstitial(false, error)
                }
            })
    }

    showRewarded(placement?: unknown): void {
        if (!this.isRewardedSupported) {
            this._showAdFailurePopup(true)
            return
        }

        this.#rewardedRequest += 1
        const request = this.#rewardedRequest
        this.#rewardedPhase = 'requested'

        this.#call('ads.rewarded', placement ? { placement } : {})
            .then((result) => {
                if (request === this.#rewardedRequest) {
                    this.#finishRewarded((result as AnyRecord | null)?.rewarded === true)
                }
            })
            .catch((error) => {
                if (request === this.#rewardedRequest) {
                    this.#finishRewarded(false, error)
                }
            })
    }

    // The ads are shown by the portal page, not inside the game frame.
    checkAdBlock(): Promise<boolean> {
        return Promise.resolve(false)
    }

    // social
    share(options?: AnyRecord): Promise<unknown> {
        const params: AnyRecord = {}
        const source = options ?? {}
        if (typeof source.text === 'string') {
            params.text = source.text
        }
        if (typeof source.url === 'string') {
            params.url = source.url
        }
        if (typeof source.image === 'string') {
            params.image = source.image
        }

        return this.#socialCall(this.isShareSupported, ACTION_NAME.SHARE, 'social.share', params)
    }

    inviteFriends(options?: AnyRecord): Promise<unknown> {
        const text = options?.text
        const params = typeof text === 'string' ? { text } : {}
        return this.#socialCall(
            this.isInviteFriendsSupported,
            ACTION_NAME.INVITE_FRIENDS,
            'social.inviteFriends',
            params,
        )
    }

    joinCommunity(): Promise<unknown> {
        return this.#socialCall(this.isJoinCommunitySupported, ACTION_NAME.JOIN_COMMUNITY, 'social.joinCommunity')
    }

    // The protocol has no membership check.
    isMemberOfCommunity(): Promise<boolean> {
        return Promise.reject()
    }

    rate(): Promise<unknown> {
        return this.#socialCall(this.isRateSupported, ACTION_NAME.RATE, 'social.rate')
    }

    addToFavorites(): Promise<unknown> {
        if (!this.isAddToFavoritesSupported) {
            return Promise.reject()
        }

        let promiseDecorator = this._getPromiseDecorator(ACTION_NAME.ADD_TO_FAVORITES)
        if (!promiseDecorator) {
            promiseDecorator = this._createPromiseDecorator(ACTION_NAME.ADD_TO_FAVORITES)

            this.#call('social.addToFavorites')
                .then((result) => {
                    if ((result as AnyRecord | null)?.added === false) {
                        this._rejectPromiseDecorator(ACTION_NAME.ADD_TO_FAVORITES)
                    } else {
                        this._resolvePromiseDecorator(ACTION_NAME.ADD_TO_FAVORITES)
                    }
                })
                .catch((error) => {
                    this._rejectPromiseDecorator(ACTION_NAME.ADD_TO_FAVORITES, error)
                })
        }

        return promiseDecorator.promise
    }

    // leaderboards
    leaderboardsSetScore(id: string | null | undefined, score: number): Promise<unknown> {
        if (this.leaderboardsType === LEADERBOARD_TYPE.NOT_AVAILABLE || !id) {
            return Promise.reject()
        }

        // The host keeps scores of signed-in players only; asking for a login in the
        // middle of a game is up to the game (player.authorize()).
        if (!this._isPlayerAuthorized) {
            return Promise.reject(new GwError(GW_ERROR_CODE.NOT_AUTHORIZED))
        }

        let promiseDecorator = this._getPromiseDecorator(ACTION_NAME.LEADERBOARDS_SET_SCORE)
        if (!promiseDecorator) {
            promiseDecorator = this._createPromiseDecorator(ACTION_NAME.LEADERBOARDS_SET_SCORE)

            this.#call('leaderboards.setScore', { id, score: Number(score) })
                .then(() => {
                    this._resolvePromiseDecorator(ACTION_NAME.LEADERBOARDS_SET_SCORE)
                })
                .catch((error) => {
                    this._rejectPromiseDecorator(ACTION_NAME.LEADERBOARDS_SET_SCORE, error)
                })
        }

        return promiseDecorator.promise
    }

    leaderboardsGetEntries(id: string | null | undefined): Promise<unknown> {
        if (this.leaderboardsType === LEADERBOARD_TYPE.NOT_AVAILABLE) {
            return Promise.resolve([])
        }

        if (!id) {
            return Promise.reject()
        }

        let promiseDecorator = this._getPromiseDecorator(ACTION_NAME.LEADERBOARDS_GET_ENTRIES)
        if (!promiseDecorator) {
            promiseDecorator = this._createPromiseDecorator(ACTION_NAME.LEADERBOARDS_GET_ENTRIES)

            this.#call('leaderboards.getEntries', {
                id,
                top: LEADERBOARD_TOP,
                around: this._isPlayerAuthorized ? LEADERBOARD_AROUND : 0,
            })
                .then((result) => {
                    this._resolvePromiseDecorator(
                        ACTION_NAME.LEADERBOARDS_GET_ENTRIES,
                        this.#normalizeEntries(result),
                    )
                })
                .catch((error) => {
                    this._rejectPromiseDecorator(ACTION_NAME.LEADERBOARDS_GET_ENTRIES, error)
                })
        }

        return promiseDecorator.promise
    }

    leaderboardsShowNativePopup(): Promise<unknown> {
        return Promise.reject()
    }

    // config
    getRemoteConfig(context?: AnyRecord): Promise<unknown> {
        if (!this.isRemoteConfigSupported) {
            return Promise.reject()
        }

        let promiseDecorator = this._getPromiseDecorator(ACTION_NAME.GET_REMOTE_CONFIG)
        if (!promiseDecorator) {
            promiseDecorator = this._createPromiseDecorator(ACTION_NAME.GET_REMOTE_CONFIG)

            this.#call('remoteConfig.get', context && Object.keys(context).length > 0 ? { context } : {})
                .then((result) => {
                    const config = (result as AnyRecord | null)?.config
                    this._resolvePromiseDecorator(
                        ACTION_NAME.GET_REMOTE_CONFIG,
                        config && typeof config === 'object' ? config : {},
                    )
                })
                .catch((error) => {
                    this._rejectPromiseDecorator(ACTION_NAME.GET_REMOTE_CONFIG, error)
                })
        }

        return promiseDecorator.promise
    }

    // Also tells the portal, so it can stop the playtime clock while the game is hidden.
    protected _setVisibilityState(state: VisibilityState): void {
        const isChanged = this._visibilityState !== state
        super._setVisibilityState(state)
        if (isChanged && this.#isOnline) {
            this.#client?.emit('game.visibility', { visible: state === VISIBILITY_STATE.VISIBLE })
        }
    }

    #applyHello(info: GwHelloResult): void {
        this.#info = info
        this.#features = info.features ?? {}
        this.#isOnline = true

        this.#applyPlayer(info.player)
        this._isBannerSupported = this.#features.banner === true

        if (info.audio && typeof info.audio.enabled === 'boolean') {
            this._setAudioState(info.audio.enabled)
        }
        if (info.pause && typeof info.pause.paused === 'boolean') {
            this._setPauseState(info.pause.paused)
        }

        const client = this.#client as GwClient
        client.on('ads.state', (data) => this.#onAdState(data as AnyRecord | null))
        client.on('audio', (data) => {
            this._setAudioState((data as AnyRecord | null)?.enabled !== false)
        })
        client.on('pause', (data) => {
            this._setPauseState((data as AnyRecord | null)?.paused === true)
        })
        client.on('player', (data) => {
            this.#applyPlayer(data as GwPlayer)
        })

        // The host keeps a save for guests too (in its own storage) and for signed-in players on
        // the server, so the platform storage is used whenever the host is reachable. What the game
        // saved locally before (e.g. offline) is moved up by StorageModule on the first read.
        this._setPlatformStorageAvailable(this.#isStorageFeatureOn())

        if (this.#lastLoadingProgress !== null) {
            this.setLoadingProgress(this.#lastLoadingProgress)
        }
    }

    #isStorageFeatureOn(): boolean {
        const { storage } = this.#features
        return storage === undefined || storage === 'server' || storage === 'local'
    }

    #applyPlayer(player: GwPlayer | null | undefined): void {
        if (!player || typeof player !== 'object') {
            return
        }

        const isAuthorized = player.isAuthorized === true
        this._isPlayerAuthorized = isAuthorized

        if (isAuthorized) {
            this._playerId = player.id === null || player.id === undefined ? null : String(player.id)
            this._playerName = typeof player.name === 'string' ? player.name : ''
            this._playerPhotos = Array.isArray(player.photos)
                ? player.photos.filter((photo): photo is string => typeof photo === 'string' && photo !== '')
                : []
        } else {
            this._playerApplyGuestData()
            this._playerPhotos = []
        }

        this._playerExtra = typeof player.mode === 'string' ? { mode: player.mode } : {}
    }

    #onAdState(data: AnyRecord | null): void {
        const type = data?.type
        const state = data?.state

        if (type === 'banner') {
            if (state === 'shown') {
                this._setBannerState(BANNER_STATE.SHOWN)
            } else if (state === 'hidden') {
                this._setBannerState(BANNER_STATE.HIDDEN)
            } else if (state === 'failed') {
                this._setBannerState(BANNER_STATE.FAILED)
            }
            return
        }

        if (type === 'interstitial') {
            if (state === 'opened' && this.#interstitialPhase === 'requested') {
                this.#interstitialPhase = 'opened'
                this._setInterstitialState(INTERSTITIAL_STATE.OPENED)
            } else if (state === 'closed' && this.#interstitialPhase === 'opened') {
                this.#invalidateInterstitial()
                this.#finishInterstitial(true)
            } else if (state === 'failed' && this.#interstitialPhase === 'requested') {
                this.#invalidateInterstitial()
                this.#finishInterstitial(false)
            }
            return
        }

        if (type === 'rewarded') {
            if (state === 'opened' && this.#rewardedPhase === 'requested') {
                this.#rewardedPhase = 'opened'
                this._setRewardedState(REWARDED_STATE.OPENED)
            } else if (state === 'rewarded'
                && (this.#rewardedPhase === 'requested' || this.#rewardedPhase === 'opened')) {
                if (this.#rewardedPhase === 'requested') {
                    this._setRewardedState(REWARDED_STATE.OPENED)
                }
                this.#rewardedPhase = 'rewarded'
                this._setRewardedState(REWARDED_STATE.REWARDED)
            } else if (state === 'closed' && this.#rewardedPhase === 'rewarded') {
                // Closed without the reward is settled by the response, which says whether it was earned.
                this.#invalidateRewarded()
                this.#finishRewarded(true)
            } else if (state === 'failed' && this.#rewardedPhase === 'requested') {
                this.#invalidateRewarded()
                this.#finishRewarded(false)
            }
        }
    }

    // A later response of the request an event already settled is ignored.
    #invalidateInterstitial(): void {
        this.#interstitialRequest += 1
    }

    #invalidateRewarded(): void {
        this.#rewardedRequest += 1
    }

    #finishInterstitial(isShown: boolean, error?: unknown): void {
        const phase = this.#interstitialPhase
        this.#interstitialPhase = 'idle'

        if (phase === 'idle') {
            return
        }

        if (isShown || phase === 'opened') {
            if (phase !== 'opened') {
                this._setInterstitialState(INTERSTITIAL_STATE.OPENED)
            }
            this._setInterstitialState(INTERSTITIAL_STATE.CLOSED)
            return
        }

        this.#failAd(false, error)
    }

    #finishRewarded(isRewarded: boolean, error?: unknown): void {
        const phase = this.#rewardedPhase
        this.#rewardedPhase = 'idle'

        if (phase === 'idle') {
            return
        }

        if (isRewarded || phase === 'rewarded') {
            if (phase === 'requested') {
                this._setRewardedState(REWARDED_STATE.OPENED)
            }
            if (phase !== 'rewarded') {
                this._setRewardedState(REWARDED_STATE.REWARDED)
            }
            this._setRewardedState(REWARDED_STATE.CLOSED)
            return
        }

        if (phase === 'opened') {
            // Watched in part and closed: no reward.
            this._setRewardedState(REWARDED_STATE.CLOSED)
            return
        }

        this.#failAd(true, error)
    }

    // The host refusing because of its own interval is not an ad failure worth a popup.
    #failAd(isRewarded: boolean, error?: unknown): void {
        if (error instanceof GwError && error.code === GW_ERROR_CODE.COOLDOWN) {
            if (isRewarded) {
                this._setRewardedState(REWARDED_STATE.FAILED)
            } else {
                this._setInterstitialState(INTERSTITIAL_STATE.FAILED)
            }
            return
        }

        this._showAdFailurePopup(isRewarded)
    }

    #normalizeEntries(result: unknown): LeaderboardEntry[] {
        const record = (result ?? {}) as AnyRecord
        const list = Array.isArray(record.entries) ? record.entries as AnyRecord[] : []
        const entries = list.map((entry) => this.#normalizeEntry(entry))

        const player = record.player as AnyRecord | null | undefined
        if (player && typeof player === 'object') {
            const playerEntry = this.#normalizeEntry(player)
            if (!entries.some((entry) => entry.id === playerEntry.id)) {
                entries.push(playerEntry)
                entries.sort((a, b) => a.rank - b.rank)
            }
        }

        return entries
    }

    #normalizeEntry(entry: AnyRecord): LeaderboardEntry {
        const photo = entry?.photo
        return {
            id: entry?.id === null || entry?.id === undefined ? '' : String(entry.id),
            name: typeof entry?.name === 'string' ? entry.name : '',
            score: Number(entry?.score ?? 0) || 0,
            rank: Number(entry?.rank ?? 0) || 0,
            photo: typeof photo === 'string' && photo !== '' ? photo : null,
        }
    }

    #socialCall(isSupported: boolean, action: string, method: string, params: AnyRecord = {}): Promise<unknown> {
        if (!isSupported) {
            return Promise.reject()
        }

        let promiseDecorator = this._getPromiseDecorator(action)
        if (!promiseDecorator) {
            promiseDecorator = this._createPromiseDecorator(action)

            this.#call(method, params)
                .then(() => {
                    this._resolvePromiseDecorator(action)
                })
                .catch((error) => {
                    this._rejectPromiseDecorator(action, error)
                })
        }

        return promiseDecorator.promise
    }

    #fetchServerTime(): Promise<number> {
        return this.#call('platform.serverTime').then((result) => {
            const time = Number((result as AnyRecord | null)?.time)
            if (!Number.isFinite(time) || time <= 0) {
                throw new Error('Invalid server time')
            }
            return time
        })
    }

    #call(method: string, params: AnyRecord = {}): Promise<unknown> {
        if (!this.#client || !this.#isOnline) {
            return Promise.reject(new GwError(GW_ERROR_CODE.NOT_SUPPORTED, 'GamesWeb host is offline'))
        }

        return this.#client.call(method, params)
    }
}

export default GamesWebPlatformBridge
