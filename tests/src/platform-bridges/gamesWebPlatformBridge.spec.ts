import {
    describe, test, expect, vi, beforeEach, afterEach,
} from 'vitest'
import GamesWebPlatformBridge from '../../../src/platform-bridges/GamesWebPlatformBridge'
import StorageModule from '../../../src/modules/storage/StorageModule'
import type { StorageBridgeContract } from '../../../src/modules/storage/types'
import { isAllowedGwOrigin, getGwTimeout } from '../../../src/platform-bridges/gamesweb/GwHostClient'
import { detectPlatformId } from '../../../src/platformDetectors'
import { EVENT_NAME } from '../../../src/constants'
import { LEADERBOARD_TYPE } from '../../../src/modules/leaderboards/constants'
import { PLATFORM_ID } from '../../../src/modules/platform/constants'

vi.stubGlobal('PLUGIN_VERSION', 'test-version')

const HOST_ORIGIN = 'https://choclategames.ru'

type Handler = (params: Record<string, unknown>) => unknown

interface PostedMessage {
    message: Record<string, unknown>
    targetOrigin: string
}

class HostError {
    code: string

    constructor(code: string) {
        this.code = code
    }
}

const HELLO = {
    protocol: 1,
    game: { slug: 'aim', title: 'АИМ', id: 20 },
    platform: {
        language: 'ru',
        tld: 'ru',
        deviceType: 'mobile',
        payload: 'level-3',
        origin: HOST_ORIGIN,
        serverTime: 1759230000000,
    },
    player: {
        isAuthorized: false, id: null, name: '', photos: [], mode: 'lite',
    },
    features: {
        interstitial: true,
        rewarded: true,
        banner: true,
        leaderboards: true,
        storage: 'local',
        authorization: true,
        payments: false,
        share: true,
        rate: true,
        favorites: true,
        joinCommunity: true,
        inviteFriends: true,
        homeScreen: false,
        achievements: false,
        remoteConfig: true,
    },
    ads: { interstitialCooldown: 60, initialInterstitialDelay: 0 },
    audio: { enabled: true },
    pause: { paused: false },
}

const AUTHORIZED_PLAYER = {
    isAuthorized: true, id: 'u42', name: 'Eduard', photos: ['https://x/a.png'], mode: 'auth',
}

// Fake portal page: receives what the game posts to window.parent and answers
// through window 'message' events with the right source and origin.
class FakeHost {
    posted: PostedMessage[] = []

    handlers: Record<string, Handler> = {}

    autoRespond = true

    parent = {
        postMessage: (message: Record<string, unknown>, targetOrigin: string) => {
            this.posted.push({ message, targetOrigin })
            if (!this.autoRespond || message.kind !== 'req') {
                return
            }

            const handler = this.handlers[message.method as string]
            if (!handler) {
                return
            }

            Promise.resolve().then(() => {
                let response: Record<string, unknown>
                try {
                    const result = handler((message.params ?? {}) as Record<string, unknown>)
                    response = result instanceof HostError
                        ? { ok: false, error: { code: result.code, message: result.code } }
                        : { ok: true, result }
                } catch (error) {
                    response = { ok: false, error: { code: 'failed', message: String(error) } }
                }
                this.deliver({
                    gw: 1, kind: 'res', id: message.id, ...response,
                })
            })
        },
    }

    requests(method?: string): Record<string, unknown>[] {
        return this.posted
            .map((p) => p.message)
            .filter((m) => m.kind === 'req' && (!method || m.method === method))
    }

    deliver(data: unknown, { origin = HOST_ORIGIN, source = this.parent as unknown }: { origin?: string, source?: unknown } = {}) {
        const event = new Event('message')
        Object.defineProperties(event, {
            data: { value: data },
            origin: { value: origin },
            source: { value: source },
        })
        window.dispatchEvent(event)
    }

    event(name: string, data: unknown) {
        this.deliver({
            gw: 1, kind: 'evt', event: name, data,
        })
    }
}

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0) })

let host: FakeHost
const originalParent = window.parent

const GW_QUERY = `?gw=1&gw_mode=bridge&gw_origin=${encodeURIComponent(HOST_ORIGIN)}&lang=ru`

function setUrl(search: string, path = '/') {
    window.history.replaceState({}, '', `${path}${search}`)
}

// A save the fake host keeps like the portal does: one string map per game.
function useHostSave(hostSave: Record<string, string>) {
    host.handlers['storage.get'] = ({ keys }) => ({
        data: Object.fromEntries((keys as string[])
            .filter((key) => key in hostSave)
            .map((key) => [key, hostSave[key]])),
    })
    host.handlers['storage.set'] = ({ data }) => {
        Object.assign(hostSave, data)
        return {}
    }
    host.handlers['storage.delete'] = ({ keys }) => {
        (keys as string[]).forEach((key) => { delete hostSave[key] })
        return {}
    }
}

function setParent(value: unknown) {
    Object.defineProperty(window, 'parent', { value, configurable: true, writable: true })
}

async function createOnlineBridge(hello: Record<string, unknown> = HELLO) {
    host.handlers.hello = () => hello
    const bridge = new GamesWebPlatformBridge()
    await bridge.initialize()
    return bridge
}

function recordStates(bridge: GamesWebPlatformBridge, eventName: string): string[] {
    const states: string[] = []
    bridge.on(eventName, (state: unknown) => states.push(state as string))
    return states
}

describe('GamesWebPlatformBridge', () => {
    beforeEach(() => {
        host = new FakeHost()
        setParent(host.parent)
        setUrl(GW_QUERY)
        delete window.GWHost
        window.localStorage.clear()
    })

    afterEach(() => {
        vi.useRealTimers()
        setParent(originalParent)
        setUrl('')
        delete window.GWHost
    })

    describe('initialization', () => {
        test('online: hello fills platform, player, features and storage', async () => {
            const bridge = await createOnlineBridge()

            const [hello] = host.requests('hello')
            expect(hello.params).toEqual({ sdk: 'bridge', sdkVersion: 'test-version', runtime: 1 })
            expect(host.posted[0].targetOrigin).toBe(HOST_ORIGIN)
            expect(host.posted[0].message.gw).toBe(1)

            expect(bridge.platformId).toBe('gamesweb')
            expect(bridge.isOnline).toBe(true)
            expect(bridge.platformLanguage).toBe('ru')
            expect(bridge.platformTld).toBe('ru')
            expect(bridge.platformPayload).toBe('level-3')
            expect(bridge.deviceType).toBe('mobile')
            expect(bridge.isPlatformExternalCallsSupported).toBe(false)

            expect(bridge.isPlayerAuthorizationSupported).toBe(true)
            expect(bridge.isPlayerAuthorized).toBe(false)
            expect(bridge.playerPhotos).toEqual([])

            expect(bridge.isInterstitialSupported).toBe(true)
            expect(bridge.isRewardedSupported).toBe(true)
            expect(bridge.isBannerSupported).toBe(true)
            expect(bridge.isAdvancedBannersSupported).toBe(false)
            expect(bridge.initialInterstitialDelay).toBe(0)
            expect(bridge.leaderboardsType).toBe(LEADERBOARD_TYPE.IN_GAME)
            expect(bridge.isShareSupported).toBe(true)
            expect(bridge.isInviteFriendsSupported).toBe(true)
            expect(bridge.isRateSupported).toBe(true)
            expect(bridge.isAddToFavoritesSupported).toBe(true)
            expect(bridge.isJoinCommunitySupported).toBe(true)
            expect(bridge.isCreatePostSupported).toBe(false)
            expect(bridge.isAddToHomeScreenSupported).toBe(false)
            expect(bridge.isPaymentsSupported).toBe(false)
            expect(bridge.isRemoteConfigSupported).toBe(true)
            expect(bridge.isAchievementsSupported).toBe(false)

            // Host keeps a save for guests too, so storage is on whenever the host answers.
            expect(bridge.isPlatformStorageAvailable).toBe(true)
        })

        test('online: authorized player from hello', async () => {
            const bridge = await createOnlineBridge({ ...HELLO, player: AUTHORIZED_PLAYER })

            expect(bridge.isPlayerAuthorized).toBe(true)
            expect(bridge.playerId).toBe('u42')
            expect(bridge.playerName).toBe('Eduard')
            expect(bridge.playerPhotos).toEqual(['https://x/a.png'])
            expect(bridge.playerExtra).toEqual({ mode: 'auth' })
        })

        test('offline without gw params: nothing is posted, guest, local storage, no ads', async () => {
            setUrl('')
            const bridge = new GamesWebPlatformBridge()
            await bridge.initialize()

            expect(host.posted).toEqual([])
            expect(bridge.isOnline).toBe(false)
            expect(bridge.isPlatformStorageAvailable).toBe(false)
            expect(bridge.isPlayerAuthorized).toBe(false)
            expect(bridge.isPlayerAuthorizationSupported).toBe(false)
            expect(bridge.isInterstitialSupported).toBe(false)
            expect(bridge.isRewardedSupported).toBe(false)
            expect(bridge.isBannerSupported).toBe(false)
            expect(bridge.leaderboardsType).toBe(LEADERBOARD_TYPE.NOT_AVAILABLE)
            await expect(bridge.leaderboardsGetEntries('best')).resolves.toEqual([])
            await expect(bridge.getDataFromStorage(['a'])).rejects.toBeDefined()
            await expect(bridge.authorizePlayer()).rejects.toBeUndefined()

            const interstitial = recordStates(bridge, EVENT_NAME.INTERSTITIAL_STATE_CHANGED)
            const rewarded = recordStates(bridge, EVENT_NAME.REWARDED_STATE_CHANGED)
            bridge.showInterstitial()
            bridge.showRewarded()
            await flush()
            expect(interstitial).toEqual(['failed'])
            expect(rewarded).toEqual(['failed'])

            await expect(bridge.sendMessage('game_ready')).resolves.toBeUndefined()
            const now = Date.now()
            expect(await bridge.getServerTime()).toBeGreaterThanOrEqual(now)
        })

        test('offline with an untrusted gw_origin: nothing is posted', async () => {
            setUrl(`?gw=1&gw_origin=${encodeURIComponent('https://evil.example')}`)
            host.handlers.hello = () => HELLO
            const bridge = new GamesWebPlatformBridge()
            await bridge.initialize()

            expect(host.posted).toEqual([])
            expect(bridge.isOnline).toBe(false)
        })

        test('offline when the game is not in a frame', async () => {
            setParent(window)
            const bridge = new GamesWebPlatformBridge()
            await bridge.initialize()

            expect(bridge.isOnline).toBe(false)
        })

        test('offline when hello times out after 5 s', async () => {
            vi.useFakeTimers()
            host.autoRespond = false
            const bridge = new GamesWebPlatformBridge()
            let isResolved = false
            bridge.initialize().then(() => { isResolved = true })

            await vi.advanceTimersByTimeAsync(4900)
            expect(isResolved).toBe(false)
            await vi.advanceTimersByTimeAsync(200)
            expect(isResolved).toBe(true)
            expect(bridge.isOnline).toBe(false)
            expect(bridge.isPlatformStorageAvailable).toBe(false)
            // re-sent every 500 ms until the timeout, then no more
            const helloCount = host.requests('hello').length
            expect(helloCount).toBe(10)
            await vi.advanceTimersByTimeAsync(2000)
            expect(host.requests('hello')).toHaveLength(helloCount)
        })

        test('hello is re-sent with the same id until a late host answers', async () => {
            vi.useFakeTimers()
            host.autoRespond = false
            const bridge = new GamesWebPlatformBridge()
            let isResolved = false
            bridge.initialize().then(() => { isResolved = true })

            await vi.advanceTimersByTimeAsync(1600)
            const hellos = host.requests('hello')
            expect(hellos).toHaveLength(4)
            expect(new Set(hellos.map((hello) => hello.id)).size).toBe(1)
            expect(isResolved).toBe(false)

            // The host page attached its listener late and answers one of the copies.
            host.deliver({
                gw: 1, kind: 'res', id: hellos[0].id, ok: true, result: HELLO,
            })
            await vi.advanceTimersByTimeAsync(0)
            expect(isResolved).toBe(true)
            expect(bridge.isOnline).toBe(true)

            await vi.advanceTimersByTimeAsync(3000)
            expect(host.requests('hello')).toHaveLength(4)
        })
    })

    describe('transport security', () => {
        test('responses from a wrong origin, a wrong source or without gw:1 are ignored', async () => {
            host.autoRespond = false
            const bridge = new GamesWebPlatformBridge()
            let isResolved = false
            bridge.initialize().then(() => { isResolved = true })

            const [hello] = host.requests('hello')
            const response = {
                gw: 1, kind: 'res', id: hello.id, ok: true, result: HELLO,
            }

            host.deliver(response, { origin: 'https://evil.example' })
            host.deliver(response, { source: {} })
            host.deliver({ ...response, gw: undefined })
            host.deliver('unity-message')
            await flush()
            expect(isResolved).toBe(false)
            expect(bridge.isOnline).toBe(false)

            host.deliver(response)
            await flush()
            expect(isResolved).toBe(true)
            expect(bridge.isOnline).toBe(true)
        })

        test('events from a wrong origin are ignored', async () => {
            const bridge = await createOnlineBridge()
            const pauses = recordStates(bridge, EVENT_NAME.PAUSE_STATE_CHANGED)

            host.deliver({
                gw: 1, kind: 'evt', event: 'pause', data: { paused: true },
            }, { origin: 'http://localhost:9999' })
            expect(pauses).toEqual([])

            host.event('pause', { paused: true })
            expect(pauses).toEqual([true])
        })

        test('trusted origins and timeouts follow the protocol', () => {
            expect(isAllowedGwOrigin('https://choclategames.ru')).toBe(true)
            expect(isAllowedGwOrigin('https://www.choclategames.ru')).toBe(true)
            expect(isAllowedGwOrigin('http://localhost:8000')).toBe(true)
            expect(isAllowedGwOrigin('http://127.0.0.1:5173')).toBe(true)
            expect(isAllowedGwOrigin('http://choclategames.ru')).toBe(false)
            expect(isAllowedGwOrigin('https://choclategames.ru.evil.com')).toBe(false)
            expect(isAllowedGwOrigin('https://evilchoclategames.ru')).toBe(false)
            expect(isAllowedGwOrigin('http://localhost')).toBe(true)
            expect(isAllowedGwOrigin('http://127.0.0.1')).toBe(true)
            expect(isAllowedGwOrigin('http://localhost:')).toBe(false)
            expect(isAllowedGwOrigin('http://localhost.evil.com')).toBe(false)
            expect(isAllowedGwOrigin('https://localhost:8000')).toBe(false)
            expect(isAllowedGwOrigin(null)).toBe(false)

            expect(getGwTimeout('hello')).toBe(5000)
            expect(getGwTimeout('storage.get')).toBe(15000)
            expect(getGwTimeout('ads.rewarded')).toBe(180000)
            expect(getGwTimeout('ads.banner.show')).toBe(180000)
            expect(getGwTimeout('player.authorize')).toBe(300000)
        })

        test('a request without an answer rejects with timeout', async () => {
            const bridge = await createOnlineBridge()
            vi.useFakeTimers()

            const promise = bridge.getDataFromStorage(['a'])
            const assertion = expect(promise).rejects.toMatchObject({ code: 'timeout' })
            await vi.advanceTimersByTimeAsync(15001)
            await assertion
        })
    })

    describe('platform', () => {
        test('game_ready, other messages and loading progress', async () => {
            host.handlers['platform.ready'] = () => ({})
            host.handlers['platform.message'] = () => ({})
            host.handlers['platform.progress'] = () => ({})
            const bridge = await createOnlineBridge()

            await bridge.sendMessage('game_ready')
            await bridge.sendMessage('level_started', { level: 3 })
            bridge.setLoadingProgress(50)

            expect(host.requests('platform.ready')).toHaveLength(1)
            expect(host.requests('platform.message')[0].params).toEqual({
                message: 'level_started', options: { level: 3 },
            })
            expect(host.requests('platform.progress')[0].params).toEqual({ percent: 50 })
        })

        test('a failing analytics message does not reject', async () => {
            host.handlers['platform.message'] = () => new HostError('failed')
            const bridge = await createOnlineBridge()

            await expect(bridge.sendMessage('level_completed')).resolves.toBeUndefined()
        })

        test('server time comes from the host and is cached', async () => {
            host.handlers['platform.serverTime'] = () => ({ time: 1759230000000 })
            const bridge = await createOnlineBridge()

            const time = await bridge.getServerTime()
            expect(time).toBeGreaterThanOrEqual(1759230000000)
            await bridge.getServerTime()
            expect(host.requests('platform.serverTime')).toHaveLength(1)
        })

        test('visibility changes are reported to the host', async () => {
            const bridge = await createOnlineBridge()
            window.dispatchEvent(new Event('blur'))

            const events = host.posted.map((p) => p.message).filter((m) => m.kind === 'evt')
            expect(events).toContainEqual({
                gw: 1, kind: 'evt', event: 'game.visibility', data: { visible: false },
            })
            expect(bridge.isOnline).toBe(true)
        })
    })

    describe('storage', () => {
        test('get returns only existing, non-empty keys', async () => {
            host.handlers['storage.get'] = () => ({ data: { coins: '10', skin: '', extra: 'x' } })
            const bridge = await createOnlineBridge()

            const data = await bridge.getDataFromStorage(['coins', 'skin', 'level'])

            expect(host.requests('storage.get')[0].params).toEqual({
                keys: ['coins', 'skin', 'level', 'ya:coins', 'ya:skin', 'ya:level'],
            })
            expect(data).toEqual({ coins: '10' })
        })

        test('non-string values from the host are coerced to JSON strings', async () => {
            host.handlers['storage.get'] = () => ({
                data: {
                    coins: 10, progress: { level: 2 }, flag: false, text: 'hi',
                },
            })
            const bridge = await createOnlineBridge()
            const storage = new StorageModule().initialize(bridge as unknown as StorageBridgeContract)

            await expect(bridge.getDataFromStorage(['coins', 'progress', 'flag', 'text'])).resolves.toEqual({
                coins: '10', progress: '{"level":2}', flag: 'false', text: 'hi',
            })
            await expect(storage.get(['coins', 'progress', 'flag', 'text'])).resolves.toEqual([
                10, { level: 2 }, false, 'hi',
            ])
            await expect(storage.get(['coins', 'progress'], false)).resolves.toEqual(['10', '{"level":2}'])
        })

        test('set sends strings, delete sends keys', async () => {
            host.handlers['storage.set'] = () => ({})
            host.handlers['storage.delete'] = () => ({})
            const bridge = await createOnlineBridge()

            await bridge.setDataToStorage({ coins: '10', progress: { level: 2 } })
            await bridge.deleteDataFromStorage(['skin'])

            expect(host.requests('storage.set')[0].params).toEqual({
                data: { coins: '10', progress: '{"level":2}' },
            })
            expect(host.requests('storage.delete')[0].params).toEqual({ keys: ['skin', 'ya:skin'] })
        })

        test('a save of the Yandex emulator (ya:<key>) is read and re-saved as <key>', async () => {
            // As the emulator writes them: `ya:<key>` = JSON.stringify(value given to player.setData).
            const hostSave: Record<string, string> = {
                // bridge 1.x kept raw game values in the Yandex data object
                'ya:coins': JSON.stringify(7),
                'ya:progress': JSON.stringify({ level: 4 }),
                'ya:name': JSON.stringify('Bob'),
                // bridge 2.x kept the strings its StorageModule serialized — double-encoded here
                'ya:inventory': JSON.stringify(JSON.stringify({ items: [1, 2] })),
                'ya:skin': JSON.stringify('red'),
                skin: 'blue',
                __ya_keys: JSON.stringify(['coins', 'progress', 'name', 'inventory', 'skin']),
            }
            useHostSave(hostSave)
            const bridge = await createOnlineBridge()
            const storage = new StorageModule().initialize(bridge as unknown as StorageBridgeContract)

            await expect(storage.get(['coins', 'progress', 'name', 'inventory', 'skin', 'level'])).resolves.toEqual([
                7, { level: 4 }, 'Bob', { items: [1, 2] }, 'blue', null,
            ])
            await expect(storage.get('inventory', false)).resolves.toBe('{"items":[1,2]}')

            // One re-save of the migrated keys only; the native key wins, `ya:` stays in place.
            const sets = host.requests('storage.set')
            expect(sets).toHaveLength(1)
            expect(sets[0].params).toEqual({
                data: {
                    coins: '7', progress: '{"level":4}', name: 'Bob', inventory: '{"items":[1,2]}',
                },
            })
            expect(hostSave).toMatchObject({
                coins: '7',
                progress: '{"level":4}',
                name: 'Bob',
                inventory: '{"items":[1,2]}',
                skin: 'blue',
                'ya:coins': '7',
                'ya:progress': '{"level":4}',
                'ya:skin': '"red"',
            })

            // From now on the native key is used.
            await storage.set('coins', 8)
            const fresh = await createOnlineBridge()
            await expect(fresh.getDataFromStorage(['coins'])).resolves.toEqual({ coins: '8' })
            expect(host.requests('storage.set')).toHaveLength(2)

            // A delete removes the `ya:` copy too, so the value does not come back.
            await storage.delete('progress')
            expect(hostSave.progress).toBeUndefined()
            expect(hostSave['ya:progress']).toBeUndefined()
            await expect(fresh.getDataFromStorage(['progress'])).resolves.toEqual({})
        })

        test('a failed re-save of a ya: key still returns the value', async () => {
            const hostSave: Record<string, string> = { 'ya:coins': '7', 'ya:raw': 'not json' }
            useHostSave(hostSave)
            host.handlers['storage.set'] = () => new HostError('failed')
            const bridge = await createOnlineBridge()

            await expect(bridge.getDataFromStorage(['coins', 'raw'])).resolves.toEqual({ coins: '7', raw: 'not json' })
            expect(hostSave).toEqual({ 'ya:coins': '7', 'ya:raw': 'not json' })
        })

        test('local fallback keys carry a per-game prefix from the /play/<slug>/ path', () => {
            setUrl(GW_QUERY, '/play/aim/index.html')
            const bridge = new GamesWebPlatformBridge()
            expect(bridge.localStorageKeyPrefix).toBe('gw:aim:')

            setUrl(GW_QUERY, '/games/other/index.html')
            expect(bridge.localStorageKeyPrefix).toBe('gw:/games/other/:')
        })

        test('progress saved locally by this game (offline) moves up to the host on the first read', async () => {
            setUrl(GW_QUERY, '/play/aim/index.html')
            const hostSave: Record<string, string> = {}
            useHostSave(hostSave)
            window.localStorage.setItem('gw:aim:coins', '7')

            const bridge = await createOnlineBridge()
            const storage = new StorageModule().initialize(bridge as unknown as StorageBridgeContract)

            await expect(storage.get('coins')).resolves.toBe(7)
            expect(hostSave).toEqual({ coins: '7' })
            expect(window.localStorage.getItem('gw:aim:coins')).toBeNull()

            await storage.set('coins', 8)
            expect(hostSave).toEqual({ coins: '8' })
        })

        test('unprefixed local keys (other games on the same origin) are never imported or deleted', async () => {
            setUrl(GW_QUERY, '/play/aim/index.html')
            const hostSave: Record<string, string> = {}
            useHostSave(hostSave)
            window.localStorage.setItem('save', '{"otherGame":true}')
            window.localStorage.setItem('gw:tetris:save', '{"tetris":true}')

            const bridge = await createOnlineBridge()
            const storage = new StorageModule().initialize(bridge as unknown as StorageBridgeContract)

            await expect(storage.get('save')).resolves.toBeNull()
            await storage.delete('save')
            expect(host.requests('storage.set')).toHaveLength(0)
            expect(hostSave).toEqual({})
            expect(window.localStorage.getItem('save')).toBe('{"otherGame":true}')
            expect(window.localStorage.getItem('gw:tetris:save')).toBe('{"tetris":true}')
        })

        test('offline the local fallback reads and writes only prefixed keys', async () => {
            setUrl('', '/play/aim/index.html')
            window.localStorage.setItem('save', '{"otherGame":true}')
            const bridge = new GamesWebPlatformBridge()
            await bridge.initialize()
            const storage = new StorageModule().initialize(bridge as unknown as StorageBridgeContract)

            await expect(storage.get('save')).resolves.toBeNull()
            await storage.set('save', { level: 1 })
            expect(window.localStorage.getItem('gw:aim:save')).toBe('{"level":1}')
            expect(window.localStorage.getItem('save')).toBe('{"otherGame":true}')

            await storage.delete('save')
            expect(window.localStorage.getItem('gw:aim:save')).toBeNull()
            expect(window.localStorage.getItem('save')).toBe('{"otherGame":true}')
        })

        test('a platform without a prefix keeps plain local keys', async () => {
            const plainBridge = {
                isPlatformStorageAvailable: false,
                on: () => {},
                getDataFromStorage: () => Promise.resolve({}),
                setDataToStorage: () => Promise.resolve(),
                deleteDataFromStorage: () => Promise.resolve(),
            }
            window.localStorage.setItem('save', '"old"')
            const storage = new StorageModule().initialize(plainBridge as unknown as StorageBridgeContract)

            await expect(storage.get('save')).resolves.toBe('old')
            await storage.set('save', 'new')
            expect(window.localStorage.getItem('save')).toBe('new')
        })

        test('a host error rejects so StorageModule falls back to local storage', async () => {
            host.handlers['storage.set'] = () => new HostError('failed')
            const bridge = await createOnlineBridge()

            await expect(bridge.setDataToStorage({ a: '1' })).rejects.toMatchObject({ code: 'failed' })
        })
    })

    describe('advertisement', () => {
        test('interstitial: opened → closed', async () => {
            const bridge = await createOnlineBridge()
            host.autoRespond = false
            const states = recordStates(bridge, EVENT_NAME.INTERSTITIAL_STATE_CHANGED)
            const pauses = recordStates(bridge, EVENT_NAME.PAUSE_STATE_CHANGED)

            bridge.showInterstitial('level_end')
            const [request] = host.requests('ads.interstitial')
            expect(request.params).toEqual({ placement: 'level_end' })

            host.event('ads.state', { type: 'interstitial', state: 'loading' })
            host.event('ads.state', { type: 'interstitial', state: 'opened' })
            expect(states).toEqual(['opened'])
            expect(pauses).toEqual([true])

            host.event('ads.state', { type: 'interstitial', state: 'closed' })
            host.deliver({
                gw: 1, kind: 'res', id: request.id, ok: true, result: { shown: true },
            })
            await flush()

            expect(states).toEqual(['opened', 'closed'])
            expect(pauses).toEqual([true, false])
        })

        test('interstitial: shown without events still reports opened → closed', async () => {
            host.handlers['ads.interstitial'] = () => ({ shown: true })
            const bridge = await createOnlineBridge()
            const states = recordStates(bridge, EVENT_NAME.INTERSTITIAL_STATE_CHANGED)

            bridge.showInterstitial()
            await flush()

            expect(host.requests('ads.interstitial')[0].params).toEqual({})
            expect(states).toEqual(['opened', 'closed'])
        })

        test('interstitial: not shown → failed; cooldown → failed', async () => {
            host.handlers['ads.interstitial'] = () => ({ shown: false })
            const bridge = await createOnlineBridge()
            const states = recordStates(bridge, EVENT_NAME.INTERSTITIAL_STATE_CHANGED)

            bridge.showInterstitial()
            await flush()
            expect(states).toEqual(['failed'])

            host.handlers['ads.interstitial'] = () => new HostError('cooldown')
            bridge.showInterstitial()
            await flush()
            expect(states).toEqual(['failed', 'failed'])
        })

        test('interstitial: failed event settles the request; the late response is ignored', async () => {
            const bridge = await createOnlineBridge()
            host.autoRespond = false
            const states = recordStates(bridge, EVENT_NAME.INTERSTITIAL_STATE_CHANGED)

            bridge.showInterstitial()
            const [request] = host.requests('ads.interstitial')
            host.event('ads.state', { type: 'interstitial', state: 'failed' })
            host.deliver({
                gw: 1, kind: 'res', id: request.id, ok: true, result: { shown: false },
            })
            await flush()

            expect(states).toEqual(['failed'])
        })

        test('rewarded: opened → rewarded → closed', async () => {
            const bridge = await createOnlineBridge()
            host.autoRespond = false
            const states = recordStates(bridge, EVENT_NAME.REWARDED_STATE_CHANGED)
            const audio = recordStates(bridge, EVENT_NAME.AUDIO_STATE_CHANGED)

            bridge.showRewarded('shop')
            const [request] = host.requests('ads.rewarded')
            expect(request.params).toEqual({ placement: 'shop' })

            host.event('ads.state', { type: 'rewarded', state: 'opened' })
            host.event('ads.state', { type: 'rewarded', state: 'rewarded' })
            host.event('ads.state', { type: 'rewarded', state: 'closed' })
            host.deliver({
                gw: 1, kind: 'res', id: request.id, ok: true, result: { rewarded: true },
            })
            await flush()

            expect(states).toEqual(['opened', 'rewarded', 'closed'])
            expect(audio).toEqual([false, true])
        })

        test('rewarded: the response alone grants the reward', async () => {
            host.handlers['ads.rewarded'] = () => ({ rewarded: true })
            const bridge = await createOnlineBridge()
            const states = recordStates(bridge, EVENT_NAME.REWARDED_STATE_CHANGED)

            bridge.showRewarded()
            await flush()

            expect(states).toEqual(['opened', 'rewarded', 'closed'])
        })

        test('rewarded: closed early → closed without reward', async () => {
            const bridge = await createOnlineBridge()
            host.autoRespond = false
            const states = recordStates(bridge, EVENT_NAME.REWARDED_STATE_CHANGED)

            bridge.showRewarded()
            const [request] = host.requests('ads.rewarded')
            host.event('ads.state', { type: 'rewarded', state: 'opened' })
            host.event('ads.state', { type: 'rewarded', state: 'closed' })
            host.deliver({
                gw: 1, kind: 'res', id: request.id, ok: true, result: { rewarded: false },
            })
            await flush()

            expect(states).toEqual(['opened', 'closed'])
        })

        test('rewarded: request error → failed', async () => {
            host.handlers['ads.rewarded'] = () => new HostError('failed')
            const bridge = await createOnlineBridge()
            const states = recordStates(bridge, EVENT_NAME.REWARDED_STATE_CHANGED)

            bridge.showRewarded()
            await flush()

            expect(states).toEqual(['failed'])
        })

        test('rewarded: a second show while the first is in flight fails alone, the reward still comes', async () => {
            const bridge = await createOnlineBridge()
            host.autoRespond = false
            const states = recordStates(bridge, EVENT_NAME.REWARDED_STATE_CHANGED)
            const pauses = recordStates(bridge, EVENT_NAME.PAUSE_STATE_CHANGED)
            const popup = vi.spyOn(bridge as unknown as { _showAdFailurePopup: () => void }, '_showAdFailurePopup')

            bridge.showRewarded()
            const [request] = host.requests('ads.rewarded')
            host.event('ads.state', { type: 'rewarded', state: 'opened' })

            bridge.showRewarded()
            expect(host.requests('ads.rewarded')).toHaveLength(1)
            expect(popup).not.toHaveBeenCalled()
            expect(states).toEqual(['opened', 'failed'])
            expect(pauses).toEqual([true])

            host.event('ads.state', { type: 'rewarded', state: 'rewarded' })
            host.event('ads.state', { type: 'rewarded', state: 'closed' })
            host.deliver({
                gw: 1, kind: 'res', id: request.id, ok: true, result: { rewarded: true },
            })
            await flush()

            expect(states).toEqual(['opened', 'failed', 'rewarded', 'closed'])
            expect(pauses).toEqual([true, false])

            // Idle again: the next show goes to the host.
            bridge.showRewarded()
            expect(host.requests('ads.rewarded')).toHaveLength(2)
        })

        test('rewarded: a second show before the ad opened does not drop the response', async () => {
            const bridge = await createOnlineBridge()
            host.autoRespond = false
            const states = recordStates(bridge, EVENT_NAME.REWARDED_STATE_CHANGED)

            bridge.showRewarded()
            bridge.showRewarded()
            const requests = host.requests('ads.rewarded')
            expect(requests).toHaveLength(1)
            host.deliver({
                gw: 1, kind: 'res', id: requests[0].id, ok: true, result: { rewarded: true },
            })
            await flush()

            expect(states).toEqual(['failed', 'opened', 'rewarded', 'closed'])
        })

        test('interstitial: a second show while the first is on screen keeps the game paused', async () => {
            const bridge = await createOnlineBridge()
            host.autoRespond = false
            const states = recordStates(bridge, EVENT_NAME.INTERSTITIAL_STATE_CHANGED)
            const pauses = recordStates(bridge, EVENT_NAME.PAUSE_STATE_CHANGED)
            const popup = vi.spyOn(bridge as unknown as { _showAdFailurePopup: () => void }, '_showAdFailurePopup')

            bridge.showInterstitial()
            const [request] = host.requests('ads.interstitial')
            host.event('ads.state', { type: 'interstitial', state: 'opened' })

            bridge.showInterstitial()
            expect(host.requests('ads.interstitial')).toHaveLength(1)
            expect(popup).not.toHaveBeenCalled()
            expect(states).toEqual(['opened', 'failed'])
            expect(pauses).toEqual([true])
            expect(bridge.isPlatformPaused).toBe(true)

            host.event('ads.state', { type: 'interstitial', state: 'closed' })
            host.deliver({
                gw: 1, kind: 'res', id: request.id, ok: true, result: { shown: true },
            })
            await flush()

            expect(states).toEqual(['opened', 'failed', 'closed'])
            expect(pauses).toEqual([true, false])
        })

        test('banner show / hide and host-side banner events', async () => {
            host.handlers['ads.banner.show'] = () => ({ shown: true })
            host.handlers['ads.banner.hide'] = () => ({})
            const bridge = await createOnlineBridge()
            const states = recordStates(bridge, EVENT_NAME.BANNER_STATE_CHANGED)

            bridge.showBanner('top', 'main')
            await flush()
            expect(host.requests('ads.banner.show')[0].params).toEqual({ position: 'top', placement: 'main' })
            bridge.hideBanner()
            await flush()
            host.event('ads.state', { type: 'banner', state: 'shown' })

            expect(states).toEqual(['shown', 'hidden', 'shown'])
        })
    })

    describe('pause, audio and player events', () => {
        test('pause and audio events drive the aggregated state', async () => {
            const bridge = await createOnlineBridge()
            const pauses = recordStates(bridge, EVENT_NAME.PAUSE_STATE_CHANGED)
            const audio = recordStates(bridge, EVENT_NAME.AUDIO_STATE_CHANGED)

            host.event('pause', { paused: true })
            host.event('audio', { enabled: false })
            expect(bridge.isPlatformPaused).toBe(true)
            expect(bridge.isPlatformAudioEnabled).toBe(false)

            host.event('pause', { paused: false })
            host.event('audio', { enabled: true })

            expect(pauses).toEqual([true, false])
            expect(audio).toEqual([false, true])
        })

        test('hello can start muted and paused', async () => {
            const bridge = await createOnlineBridge({ ...HELLO, audio: { enabled: false }, pause: { paused: true } })

            expect(bridge.isPlatformAudioEnabled).toBe(false)
            expect(bridge.isPlatformPaused).toBe(true)
        })

        test('player event updates the player and keeps storage on', async () => {
            const bridge = await createOnlineBridge()

            host.event('player', AUTHORIZED_PLAYER)
            expect(bridge.isPlayerAuthorized).toBe(true)
            expect(bridge.playerId).toBe('u42')
            expect(bridge.isPlatformStorageAvailable).toBe(true)

            host.event('player', { isAuthorized: false, id: null, name: '', photos: [] })
            expect(bridge.isPlayerAuthorized).toBe(false)
            expect(bridge.playerPhotos).toEqual([])
            expect(bridge.isPlatformStorageAvailable).toBe(true)
        })
    })

    describe('player', () => {
        test('authorize opens the portal login and applies the player', async () => {
            host.handlers['player.authorize'] = () => AUTHORIZED_PLAYER
            const bridge = await createOnlineBridge()

            await bridge.authorizePlayer()

            expect(host.requests('player.authorize')).toHaveLength(1)
            expect(bridge.isPlayerAuthorized).toBe(true)
            expect(bridge.playerName).toBe('Eduard')

            await bridge.authorizePlayer()
            expect(host.requests('player.authorize')).toHaveLength(1)
        })

        test('a cancelled login rejects', async () => {
            host.handlers['player.authorize'] = () => new HostError('cancelled')
            const bridge = await createOnlineBridge()

            await expect(bridge.authorizePlayer()).rejects.toMatchObject({ code: 'cancelled' })
            expect(bridge.isPlayerAuthorized).toBe(false)
        })
    })

    describe('leaderboards', () => {
        test('setScore needs an authorized player', async () => {
            host.handlers['leaderboards.setScore'] = () => ({ score: 10 })
            const bridge = await createOnlineBridge()

            await expect(bridge.leaderboardsSetScore('best', 10)).rejects.toMatchObject({ code: 'not_authorized' })
            expect(host.requests('leaderboards.setScore')).toHaveLength(0)
        })

        test('setScore sends id and score', async () => {
            host.handlers['leaderboards.setScore'] = () => ({ score: 10 })
            const bridge = await createOnlineBridge({ ...HELLO, player: AUTHORIZED_PLAYER })

            await bridge.leaderboardsSetScore('best', 10)

            expect(host.requests('leaderboards.setScore')[0].params).toEqual({ id: 'best', score: 10 })
        })

        test('getEntries normalizes entries and adds the player entry', async () => {
            host.handlers['leaderboards.getEntries'] = () => ({
                entries: [
                    {
                        rank: 1, score: 300, id: 7, name: 'Ann', photo: null, isPlayer: false,
                    },
                    {
                        rank: 2, score: '200', id: 'u9', name: null, photo: 'https://x/p.png', isPlayer: false,
                    },
                ],
                player: {
                    rank: 40, score: 5, id: 'u42', name: 'Eduard', photo: null, isPlayer: true,
                },
            })
            const bridge = await createOnlineBridge({ ...HELLO, player: AUTHORIZED_PLAYER })

            const entries = await bridge.leaderboardsGetEntries('best')

            expect(host.requests('leaderboards.getEntries')[0].params).toEqual({ id: 'best', top: 20, around: 3 })
            expect(entries).toEqual([
                {
                    id: '7', name: 'Ann', score: 300, rank: 1, photo: null,
                },
                {
                    id: 'u9', name: '', score: 200, rank: 2, photo: 'https://x/p.png',
                },
                {
                    id: 'u42', name: 'Eduard', score: 5, rank: 40, photo: null,
                },
            ])
        })

        test('leaderboards are unavailable when the host turns them off', async () => {
            const bridge = await createOnlineBridge({ ...HELLO, features: { ...HELLO.features, leaderboards: false } })

            expect(bridge.leaderboardsType).toBe(LEADERBOARD_TYPE.NOT_AVAILABLE)
        })
    })

    describe('social and remote config', () => {
        test('social methods call the host', async () => {
            host.handlers['social.share'] = () => ({})
            host.handlers['social.inviteFriends'] = () => ({})
            host.handlers['social.rate'] = () => ({})
            host.handlers['social.joinCommunity'] = () => ({})
            host.handlers['social.addToFavorites'] = () => ({ added: true })
            const bridge = await createOnlineBridge()

            await bridge.share({ text: 'hi', url: 'https://choclategames.ru/game/aim/', extra: 1 })
            await bridge.inviteFriends({ text: 'come' })
            await bridge.rate()
            await bridge.joinCommunity()
            await bridge.addToFavorites()

            expect(host.requests('social.share')[0].params).toEqual({
                text: 'hi', url: 'https://choclategames.ru/game/aim/',
            })
            expect(host.requests('social.inviteFriends')[0].params).toEqual({ text: 'come' })
            expect(host.requests('social.rate')).toHaveLength(1)
            expect(host.requests('social.joinCommunity')).toHaveLength(1)
            await expect(bridge.isMemberOfCommunity()).rejects.toBeUndefined()
        })

        test('addToFavorites rejects when nothing was added', async () => {
            host.handlers['social.addToFavorites'] = () => ({ added: false })
            const bridge = await createOnlineBridge()

            await expect(bridge.addToFavorites()).rejects.toBeUndefined()
        })

        test('remote config returns the per-game config', async () => {
            host.handlers['remoteConfig.get'] = () => ({ config: { speed: 2 } })
            const bridge = await createOnlineBridge()

            await expect(bridge.getRemoteConfig({ level: 3 })).resolves.toEqual({ speed: 2 })
            expect(host.requests('remoteConfig.get')[0].params).toEqual({ context: { level: 3 } })
        })
    })

    describe('injected runtime (window.GWHost)', () => {
        test('uses GWHost instead of postMessage', async () => {
            const listeners: Record<string, (data: unknown) => void> = {}
            const call = vi.fn((method: string) => {
                if (method === 'storage.get') {
                    return Promise.resolve({ data: { coins: '5' } })
                }
                return Promise.resolve({})
            })
            window.GWHost = {
                ready: Promise.resolve(HELLO),
                isOnline: true,
                info: HELLO,
                call,
                on: (event: string, fn: (data: unknown) => void) => { listeners[event] = fn },
                off: () => {},
                emit: vi.fn(),
            }

            const bridge = new GamesWebPlatformBridge()
            await bridge.initialize()

            expect(host.posted).toEqual([])
            expect(bridge.isOnline).toBe(true)
            expect(bridge.isPlatformStorageAvailable).toBe(true)
            await expect(bridge.getDataFromStorage(['coins'])).resolves.toEqual({ coins: '5' })
            expect(call).toHaveBeenCalledWith('storage.get', { keys: ['coins', 'ya:coins'] })

            const pauses = recordStates(bridge, EVENT_NAME.PAUSE_STATE_CHANGED)
            listeners.pause({ paused: true })
            expect(pauses).toEqual([true])
        })

        test('an offline runtime keeps the bridge offline', async () => {
            window.GWHost = {
                ready: Promise.resolve(null),
                isOnline: false,
                call: vi.fn(() => Promise.resolve({})),
                on: vi.fn(),
                emit: vi.fn(),
            }

            const bridge = new GamesWebPlatformBridge()
            await bridge.initialize()

            expect(bridge.isOnline).toBe(false)
            expect(bridge.isPlatformStorageAvailable).toBe(false)
        })

        test('runtime rejections carry the protocol error code', async () => {
            window.GWHost = {
                ready: Promise.resolve(HELLO),
                isOnline: true,
                info: HELLO,
                call: vi.fn(() => Promise.reject(new HostError('cooldown'))),
                on: vi.fn(),
                emit: vi.fn(),
            }

            const bridge = new GamesWebPlatformBridge()
            await bridge.initialize()
            const states = recordStates(bridge, EVENT_NAME.INTERSTITIAL_STATE_CHANGED)
            bridge.showInterstitial()
            await flush()

            expect(states).toEqual(['failed'])
        })
    })

    describe('detection', () => {
        test('gw=1 selects gamesweb, platform_id still wins', () => {
            expect(detectPlatformId()).toBe(PLATFORM_ID.GAMESWEB)

            setUrl('?gw=1&platform_id=yandex')
            expect(detectPlatformId()).toBe(PLATFORM_ID.YANDEX)

            setUrl('')
            expect(detectPlatformId()).toBe(PLATFORM_ID.MOCK)

            window.GWHost = {
                ready: Promise.resolve(null), isOnline: false, call: vi.fn(), on: vi.fn(), emit: vi.fn(),
            }
            expect(detectPlatformId()).toBe(PLATFORM_ID.GAMESWEB)
        })
    })
})
