import {
    describe, test, expect, vi, beforeEach, afterEach,
} from 'vitest'
import PikabuGamesPlatformBridge from '../../../src/platform-bridges/PikabuGamesPlatformBridge'
import StorageModule from '../../../src/modules/storage/StorageModule'
import type { StorageBridgeContract } from '../../../src/modules/storage/types'
import { EVENT_NAME } from '../../../src/constants'
import { PLATFORM_ID } from '../../../src/modules/platform/constants'

vi.stubGlobal('PLUGIN_VERSION', 'test-version')

// jsdom cannot load https://games.pikabu.ru/sdk/sdk.js: pretend it loaded, window.PkbSDK is set by the test.
vi.mock('../../../src/utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../src/utils')>()),
    addJavaScript: vi.fn(() => Promise.resolve()),
}))

type Listener = (...args: unknown[]) => void

interface FakePurchase {
    productId: string
    purchaseId: string
    isConsumable: boolean
    developerPayload?: string
    getSignedData: () => Promise<string>
}

function createAd<R>(result: R, { isSupported = true, canShow = true } = {}) {
    return {
        isSupported,
        canShow: vi.fn(async () => canShow),
        show: vi.fn(async () => result),
    }
}

function createPurchase(productId: string, purchaseId: string, isConsumable = true): FakePurchase {
    return {
        productId,
        purchaseId,
        isConsumable,
        getSignedData: vi.fn(async () => `signed-${purchaseId}`),
    }
}

function createFakeSdk() {
    const listeners: Record<string, Listener[]> = {}
    const saved: Record<string, unknown> = {}

    const sdk = {
        player: {
            id: 'p1',
            name: 'Guest',
            avatar: '',
            isAuthorized: false,
            getSignedData: vi.fn(async () => 'player-signed'),
        },
        auth: {
            openAuthDialog: vi.fn(async () => {}),
        },
        ads: {
            preloader: createAd<Record<string, unknown>>({ rendered: true }),
            fullscreen: createAd<Record<string, unknown>>({ rendered: true }),
            rewarded: createAd<Record<string, unknown>>({ rendered: true, reward: true }),
        },
        storage: {
            get: vi.fn((key: string) => saved[key]),
            set: vi.fn((key: string, value: unknown) => { saved[key] = value }),
            remove: vi.fn((key: string) => { delete saved[key] }),
            getAll: vi.fn(() => ({ ...saved })),
            flush: vi.fn(async () => ({ success: true })),
        },
        store: {
            purchase: vi.fn(async (_options: { productId: string, developerPayload?: string }) => (
                { success: true, purchase: createPurchase('pkb_coins', 'tx-1') } as Record<string, unknown>
            )),
            consumePurchase: vi.fn(async (_purchaseId: string) => ({ success: true })),
            getProducts: vi.fn(async () => [] as Record<string, unknown>[]),
            getPurchases: vi.fn(async () => [] as FakePurchase[]),
        },
        gameStarted: vi.fn(),
        on: vi.fn((event: string, listener: Listener) => {
            (listeners[event] ??= []).push(listener)
            return () => {}
        }),
        once: vi.fn(() => () => {}),
        off: vi.fn(),
    }

    return {
        sdk,
        saved,
        emit: (event: string, ...args: unknown[]) => (listeners[event] ?? []).forEach((l) => l(...args)),
    }
}

const PAYMENTS = [
    { id: 'coins', pikabu_games: { id: 'pkb_coins' } },
    { id: 'no_ads' },
    { id: 'missing', pikabu_games: { id: 'pkb_missing' } },
]

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0) })

const originalParent = window.parent

function setParent(value: unknown) {
    Object.defineProperty(window, 'parent', { value, configurable: true, writable: true })
}

let fake: ReturnType<typeof createFakeSdk>

function setOptions(bridge: PikabuGamesPlatformBridge, options: Record<string, unknown>) {
    Object.assign(bridge, { _options: options })
}

async function createBridge(options: Record<string, unknown> = { payments: PAYMENTS }) {
    const bridge = new PikabuGamesPlatformBridge()
    setOptions(bridge, options)
    await bridge.initialize()
    return bridge
}

function recordStates(bridge: PikabuGamesPlatformBridge, eventName: string): unknown[] {
    const states: unknown[] = []
    bridge.on(eventName, (state: unknown) => states.push(state))
    return states
}

describe('PikabuGamesPlatformBridge', () => {
    beforeEach(() => {
        fake = createFakeSdk()
        window.PkbSDK = { init: vi.fn(async () => fake.sdk) } as unknown as typeof window.PkbSDK
        setParent({})
    })

    afterEach(() => {
        vi.useRealTimers()
        setParent(originalParent)
        delete window.PkbSDK
    })

    describe('initialization', () => {
        test('success fills the player and turns platform storage on', async () => {
            fake.sdk.player.isAuthorized = true
            fake.sdk.player.id = 'u42'
            fake.sdk.player.name = 'Eduard'
            fake.sdk.player.avatar = 'https://x/a.png'
            const bridge = await createBridge()

            expect(window.PkbSDK!.init).toHaveBeenCalledTimes(1)
            expect(bridge.platformId).toBe('pikabu_games')
            expect(bridge.platformLanguage).toBe('ru')
            expect(bridge.isPlayerAuthorizationSupported).toBe(true)
            expect(bridge.isPlayerAuthorized).toBe(true)
            expect(bridge.playerId).toBe('u42')
            expect(bridge.playerName).toBe('Eduard')
            expect(bridge.playerPhotos).toEqual(['https://x/a.png'])
            expect(bridge.isPlatformStorageAvailable).toBe(true)
            expect(bridge.isInterstitialSupported).toBe(true)
            expect(bridge.isRewardedSupported).toBe(true)
            expect(bridge.isPaymentsSupported).toBe(true)

            // a second initialize is a no-op
            await bridge.initialize()
            expect(window.PkbSDK!.init).toHaveBeenCalledTimes(1)
        })

        test('guest player has no photos; unsupported ads are reported', async () => {
            fake.sdk.ads.fullscreen.isSupported = false
            fake.sdk.ads.rewarded.isSupported = false
            const bridge = await createBridge()

            expect(bridge.isPlayerAuthorized).toBe(false)
            expect(bridge.playerId).toBe('p1')
            expect(bridge.playerPhotos).toEqual([])
            expect(bridge.isPlatformStorageAvailable).toBe(true)
            expect(bridge.isInterstitialSupported).toBe(false)
            expect(bridge.isRewardedSupported).toBe(false)
        })

        test('rejects in a top-level window without calling PkbSDK.init', async () => {
            setParent(window)
            const bridge = new PikabuGamesPlatformBridge()

            await expect(bridge.initialize()).rejects.toThrow('only inside the Pikabu Games iframe')
            expect(window.PkbSDK!.init).not.toHaveBeenCalled()
            expect(bridge.isPlatformStorageAvailable).toBe(false)
        })

        test('rejects when PkbSDK is missing', async () => {
            delete window.PkbSDK
            const bridge = new PikabuGamesPlatformBridge()

            await expect(bridge.initialize()).rejects.toThrow('PkbSDK is not loaded')
        })

        test('rejects when PkbSDK.init never settles (15 s timeout)', async () => {
            vi.useFakeTimers()
            window.PkbSDK = { init: vi.fn(() => new Promise(() => {})) } as unknown as typeof window.PkbSDK
            const bridge = new PikabuGamesPlatformBridge()
            let error: unknown
            bridge.initialize().catch((e) => { error = e })

            await vi.advanceTimersByTimeAsync(14900)
            expect(error).toBeUndefined()
            await vi.advanceTimersByTimeAsync(200)
            expect(error).toBeInstanceOf(Error)
            expect((error as Error).message).toContain('timed out')
        })

        test('rejects when PkbSDK.init rejects', async () => {
            window.PkbSDK = {
                init: vi.fn(async () => { throw new Error('handshake') }),
            } as unknown as typeof window.PkbSDK
            const bridge = new PikabuGamesPlatformBridge()

            await expect(bridge.initialize()).rejects.toThrow('handshake')
        })
    })

    describe('game_ready and preloader ad', () => {
        test('game_ready calls gameStarted exactly once', async () => {
            const bridge = await createBridge()

            await bridge.sendMessage('game_ready')
            await bridge.sendMessage('game_ready')
            await flush()

            expect(fake.sdk.gameStarted).toHaveBeenCalledTimes(1)
            expect(fake.sdk.ads.preloader.canShow).not.toHaveBeenCalled()
        })

        test('preloaderAd: gameStarted waits for the preloader ad to close; audio is off meanwhile', async () => {
            let finishPreloader!: (value: Record<string, unknown>) => void
            fake.sdk.ads.preloader.show.mockImplementation(() => new Promise((resolve) => {
                finishPreloader = resolve
            }))
            const bridge = new PikabuGamesPlatformBridge()
            setOptions(bridge, { preloaderAd: true })
            const audio = recordStates(bridge, EVENT_NAME.AUDIO_STATE_CHANGED)
            await bridge.initialize()
            await flush()

            expect(fake.sdk.ads.preloader.show).toHaveBeenCalledTimes(1)
            expect(audio).toEqual([false])

            await bridge.sendMessage('game_ready')
            await flush()
            expect(fake.sdk.gameStarted).not.toHaveBeenCalled()

            finishPreloader({ rendered: true })
            await flush()
            expect(fake.sdk.gameStarted).toHaveBeenCalledTimes(1)
            expect(audio).toEqual([false, true])

            await bridge.sendMessage('game_ready')
            await flush()
            expect(fake.sdk.gameStarted).toHaveBeenCalledTimes(1)
        })

        test('preloaderAd: a preloader that cannot show does not block gameStarted', async () => {
            fake.sdk.ads.preloader.canShow.mockResolvedValue(false)
            const bridge = await createBridge({ preloaderAd: true })

            await bridge.sendMessage('game_ready')
            await flush()

            expect(fake.sdk.ads.preloader.show).not.toHaveBeenCalled()
            expect(fake.sdk.gameStarted).toHaveBeenCalledTimes(1)
        })

        test('preloaderAd: a failing preloader does not block gameStarted', async () => {
            fake.sdk.ads.preloader.show.mockRejectedValue(new Error('boom'))
            const bridge = await createBridge({ preloaderAd: true })

            await bridge.sendMessage('game_ready')
            await flush()

            expect(fake.sdk.gameStarted).toHaveBeenCalledTimes(1)
        })
    })

    describe('advertisement', () => {
        test('interstitial: canShow false → failed, show not called', async () => {
            fake.sdk.ads.fullscreen.canShow.mockResolvedValue(false)
            const bridge = await createBridge()
            const states = recordStates(bridge, EVENT_NAME.INTERSTITIAL_STATE_CHANGED)

            bridge.showInterstitial()
            await flush()

            expect(fake.sdk.ads.fullscreen.show).not.toHaveBeenCalled()
            expect(states).toEqual(['failed'])
        })

        test('interstitial: rendered → opened → closed', async () => {
            const bridge = await createBridge()
            const states = recordStates(bridge, EVENT_NAME.INTERSTITIAL_STATE_CHANGED)
            const pauses = recordStates(bridge, EVENT_NAME.PAUSE_STATE_CHANGED)

            bridge.showInterstitial()
            await flush()

            expect(states).toEqual(['opened', 'closed'])
            expect(pauses).toEqual([true, false])
        })

        test('interstitial: not rendered → opened → failed', async () => {
            fake.sdk.ads.fullscreen.show.mockResolvedValue({ rendered: false, reason: 'COOLDOWN_ACTIVE' })
            const bridge = await createBridge()
            const states = recordStates(bridge, EVENT_NAME.INTERSTITIAL_STATE_CHANGED)

            bridge.showInterstitial()
            await flush()

            expect(states).toEqual(['opened', 'failed'])
            expect(bridge.isPlatformPaused).toBe(false)
        })

        test('interstitial: show error → failed', async () => {
            fake.sdk.ads.fullscreen.show.mockRejectedValue(new Error('boom'))
            const bridge = await createBridge()
            const states = recordStates(bridge, EVENT_NAME.INTERSTITIAL_STATE_CHANGED)

            bridge.showInterstitial()
            await flush()

            expect(states).toEqual(['opened', 'failed'])
        })

        test('rewarded: reward → opened, rewarded, closed', async () => {
            const bridge = await createBridge()
            const states = recordStates(bridge, EVENT_NAME.REWARDED_STATE_CHANGED)

            bridge.showRewarded()
            await flush()

            expect(states).toEqual(['opened', 'rewarded', 'closed'])
        })

        test('rewarded: no reward → opened, closed', async () => {
            fake.sdk.ads.rewarded.show.mockResolvedValue({ rendered: true, reward: false })
            const bridge = await createBridge()
            const states = recordStates(bridge, EVENT_NAME.REWARDED_STATE_CHANGED)

            bridge.showRewarded()
            await flush()

            expect(states).toEqual(['opened', 'closed'])
        })

        test('rewarded: canShow false → failed; not rendered → opened, failed', async () => {
            fake.sdk.ads.rewarded.canShow.mockResolvedValueOnce(false)
            fake.sdk.ads.rewarded.show.mockResolvedValue({ rendered: false, reason: 'UI_BUSY', reward: false })
            const bridge = await createBridge()
            const states = recordStates(bridge, EVENT_NAME.REWARDED_STATE_CHANGED)

            bridge.showRewarded()
            await flush()
            expect(states).toEqual(['failed'])
            expect(fake.sdk.ads.rewarded.show).not.toHaveBeenCalled()

            bridge.showRewarded()
            await flush()
            expect(states).toEqual(['failed', 'opened', 'failed'])
        })
    })

    describe('storage', () => {
        test('get returns only existing keys; set / delete go to sdk.storage', async () => {
            fake.saved.coins = 10
            fake.saved.progress = { level: 2 }
            fake.saved.empty = ''
            const bridge = await createBridge()

            await expect(bridge.getDataFromStorage(['coins', 'empty', 'level'])).resolves.toEqual({
                coins: 10, empty: '',
            })

            await bridge.setDataToStorage({ coins: '11', skin: 'red' })
            expect(fake.sdk.storage.set).toHaveBeenCalledWith('coins', '11')
            expect(fake.sdk.storage.set).toHaveBeenCalledWith('skin', 'red')
            expect(fake.sdk.storage.flush).not.toHaveBeenCalled()

            await bridge.deleteDataFromStorage(['skin', 'progress'])
            expect(fake.sdk.storage.remove).toHaveBeenCalledWith('skin')
            expect(fake.sdk.storage.remove).toHaveBeenCalledWith('progress')
            await expect(bridge.getDataFromStorage(['skin', 'progress', 'coins'])).resolves.toEqual({ coins: '11' })
        })

        test('StorageModule round-trips values through the platform storage', async () => {
            const bridge = await createBridge()
            const storage = new StorageModule().initialize(bridge as unknown as StorageBridgeContract)

            await storage.set('progress', { level: 3 })
            await expect(storage.get('progress')).resolves.toEqual({ level: 3 })
            expect(fake.sdk.storage.set).toHaveBeenCalled()

            await storage.delete('progress')
            await expect(storage.get('progress')).resolves.toBeNull()
        })

        test('storage calls reject before initialization', async () => {
            const bridge = new PikabuGamesPlatformBridge()

            await expect(bridge.getDataFromStorage(['a'])).rejects.toThrow('not initialized')
            await expect(bridge.setDataToStorage({ a: 1 })).rejects.toThrow('not initialized')
            await expect(bridge.deleteDataFromStorage(['a'])).rejects.toThrow('not initialized')
        })
    })

    describe('player', () => {
        test('authorize: already authorized resolves without a dialog', async () => {
            fake.sdk.player.isAuthorized = true
            const bridge = await createBridge()

            await expect(bridge.authorizePlayer()).resolves.toBeUndefined()
            expect(fake.sdk.auth.openAuthDialog).not.toHaveBeenCalled()
        })

        test('authorize: the dialog logs in → resolves, game paused and muted meanwhile', async () => {
            fake.sdk.auth.openAuthDialog.mockImplementation(async () => {
                fake.sdk.player.isAuthorized = true
                fake.sdk.player.id = 'u42'
                fake.sdk.player.name = 'Eduard'
            })
            const bridge = await createBridge()
            const pauses = recordStates(bridge, EVENT_NAME.PAUSE_STATE_CHANGED)
            const audio = recordStates(bridge, EVENT_NAME.AUDIO_STATE_CHANGED)

            await bridge.authorizePlayer()
            // pause / audio are restored in .finally(), a tick after the promise resolves
            await flush()

            expect(fake.sdk.auth.openAuthDialog).toHaveBeenCalledTimes(1)
            expect(bridge.isPlayerAuthorized).toBe(true)
            expect(bridge.playerId).toBe('u42')
            expect(bridge.playerName).toBe('Eduard')
            expect(pauses).toEqual([true, false])
            expect(audio).toEqual([false, true])
        })

        test('authorize: the dialog closed without login → rejects', async () => {
            const bridge = await createBridge()

            await expect(bridge.authorizePlayer()).rejects.toBeUndefined()
            expect(bridge.isPlayerAuthorized).toBe(false)
            expect(bridge.isPlatformPaused).toBe(false)
        })

        test('authorize: a dialog error rejects with it', async () => {
            fake.sdk.auth.openAuthDialog.mockRejectedValue(new Error('dialog'))
            const bridge = await createBridge()

            await expect(bridge.authorizePlayer()).rejects.toThrow('dialog')
        })

        test('authorize before initialization rejects', async () => {
            const bridge = new PikabuGamesPlatformBridge()

            await expect(bridge.authorizePlayer()).rejects.toBeUndefined()
        })

        test('userAuthorized event updates the player', async () => {
            const bridge = await createBridge()
            expect(bridge.isPlayerAuthorized).toBe(false)

            fake.sdk.player.isAuthorized = true
            fake.sdk.player.id = 'u7'
            fake.sdk.player.name = 'Ann'
            fake.sdk.player.avatar = 'https://x/ann.png'
            fake.emit('userAuthorized')

            expect(bridge.isPlayerAuthorized).toBe(true)
            expect(bridge.playerId).toBe('u7')
            expect(bridge.playerName).toBe('Ann')
            expect(bridge.playerPhotos).toEqual(['https://x/ann.png'])
        })
    })

    describe('payments', () => {
        test('purchase maps the platform product id and stores the purchase', async () => {
            const bridge = await createBridge()
            const pauses = recordStates(bridge, EVENT_NAME.PAUSE_STATE_CHANGED)

            const purchase = await bridge.paymentsPurchase('coins', { developerPayload: 'order-1' }) as Record<string, unknown>
            await flush()

            expect(fake.sdk.store.purchase).toHaveBeenCalledWith({ productId: 'pkb_coins', developerPayload: 'order-1' })
            expect(purchase).toMatchObject({ id: 'coins', purchaseId: 'tx-1', isConsumable: true })
            await expect((purchase.getSignedData as () => Promise<string>)()).resolves.toBe('signed-tx-1')
            expect((bridge as unknown as { _paymentsPurchases: unknown[] })._paymentsPurchases).toEqual([purchase])
            expect(pauses).toEqual([true, false])
        })

        test('purchase without a platform block uses the bridge id and no developerPayload', async () => {
            fake.sdk.store.purchase.mockResolvedValue({ success: true, purchase: createPurchase('no_ads', 'tx-2', false) })
            const bridge = await createBridge()

            const purchase = await bridge.paymentsPurchase('no_ads')

            expect(fake.sdk.store.purchase).toHaveBeenCalledWith({ productId: 'no_ads' })
            expect(purchase).toMatchObject({ id: 'no_ads', purchaseId: 'tx-2', isConsumable: false })
        })

        test('purchase failure rejects with the reason and stores nothing', async () => {
            fake.sdk.store.purchase.mockResolvedValue({ success: false, reason: 'CANCELLED' })
            const bridge = await createBridge()

            await expect(bridge.paymentsPurchase('coins')).rejects.toBe('CANCELLED')
            expect((bridge as unknown as { _paymentsPurchases: unknown[] })._paymentsPurchases).toEqual([])
            expect(bridge.isPlatformPaused).toBe(false)
        })

        test('consume calls consumePurchase with the purchaseId and removes the purchase', async () => {
            const bridge = await createBridge()
            await bridge.paymentsPurchase('coins')

            await expect(bridge.paymentsConsumePurchase('coins')).resolves.toEqual({ id: 'coins' })

            expect(fake.sdk.store.consumePurchase).toHaveBeenCalledWith('tx-1')
            expect((bridge as unknown as { _paymentsPurchases: unknown[] })._paymentsPurchases).toEqual([])
            await expect(bridge.paymentsConsumePurchase('coins')).rejects.toBeUndefined()
        })

        test('consume failure rejects and keeps the purchase', async () => {
            fake.sdk.store.consumePurchase.mockResolvedValue({ success: false })
            const bridge = await createBridge()
            await bridge.paymentsPurchase('coins')

            await expect(bridge.paymentsConsumePurchase('coins')).rejects.toBeUndefined()
            expect((bridge as unknown as { _paymentsPurchases: unknown[] })._paymentsPurchases).toHaveLength(1)
        })

        test('getCatalog maps name / formattedPrice / kopecks and skips unknown products', async () => {
            fake.sdk.store.getProducts.mockResolvedValue([
                {
                    id: 'pkb_coins', name: '100 монет', price: 9900, currencyCode: 'RUB', formattedPrice: '99 ₽',
                },
                {
                    id: 'no_ads', name: 'Без рекламы', price: 14950, currencyCode: 'RUB', formattedPrice: '149,50 ₽',
                },
                {
                    id: 'pkb_other', name: 'Other', price: 100, currencyCode: 'RUB', formattedPrice: '1 ₽',
                },
            ])
            const bridge = await createBridge()

            await expect(bridge.paymentsGetCatalog()).resolves.toEqual([
                {
                    id: 'coins', title: '100 монет', price: '99 ₽', priceCurrencyCode: 'RUB', priceValue: 99,
                },
                {
                    id: 'no_ads', title: 'Без рекламы', price: '149,50 ₽', priceCurrencyCode: 'RUB', priceValue: 149.5,
                },
            ])
        })

        test('getPurchases maps platform product ids back to bridge ids', async () => {
            fake.sdk.store.getPurchases.mockResolvedValue([
                createPurchase('pkb_coins', 'tx-1'),
                createPurchase('no_ads', 'tx-2', false),
                createPurchase('unknown_sku', 'tx-3'),
            ])
            const bridge = await createBridge()

            const purchases = await bridge.paymentsGetPurchases() as Record<string, unknown>[]

            expect(purchases.map((p) => [p.id, p.purchaseId, p.isConsumable])).toEqual([
                ['coins', 'tx-1', true],
                ['no_ads', 'tx-2', false],
                ['unknown_sku', 'tx-3', true],
            ])

            // restored purchases can be consumed by their bridge id
            await bridge.paymentsConsumePurchase('coins')
            expect(fake.sdk.store.consumePurchase).toHaveBeenCalledWith('tx-1')
        })

        test('payments reject before initialization', async () => {
            const bridge = new PikabuGamesPlatformBridge()
            setOptions(bridge, { payments: PAYMENTS })

            await expect(bridge.paymentsPurchase('coins')).rejects.toBeUndefined()
            await expect(bridge.paymentsConsumePurchase('coins')).rejects.toBeUndefined()
            await expect(bridge.paymentsGetCatalog()).rejects.toBeUndefined()
            await expect(bridge.paymentsGetPurchases()).rejects.toBeUndefined()
        })
    })

    test('platform id constant', () => {
        expect(PLATFORM_ID.PIKABU_GAMES).toBe('pikabu_games')
    })
})
