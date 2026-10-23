import {
    describe, test, expect, vi, afterEach,
} from 'vitest'
import AndroidPlatformBridge from '../../../src/platform-bridges/AndroidPlatformBridge'
import bridgeConfig from '../../../src/lib/bridge-config'

const ANALYTICS_METHODS = ['reportEvent', 'reportUserProfile']

function createPlugin(initializeResult: unknown) {
    return {
        initialize: vi.fn().mockResolvedValue(initializeResult),
        addListener: vi.fn(),
        showInterstitial: vi.fn().mockResolvedValue(undefined),
        preloadInterstitial: vi.fn().mockResolvedValue(undefined),
        showRewarded: vi.fn().mockResolvedValue(undefined),
        preloadRewarded: vi.fn().mockResolvedValue(undefined),
        showBanner: vi.fn().mockResolvedValue(undefined),
        hideBanner: vi.fn().mockResolvedValue(undefined),
        reportEvent: vi.fn().mockResolvedValue(undefined),
        reportUserProfile: vi.fn().mockResolvedValue(undefined),
    }
}

async function createBridge(config: Record<string, unknown>, initializeResult: unknown) {
    global.fetch = vi.fn().mockResolvedValue({
        ok: false, status: 404, statusText: 'Not Found', text: () => Promise.resolve(''),
    })
    await bridgeConfig.load(undefined, config)
    bridgeConfig.initialize('android')

    const plugin = createPlugin(initializeResult)
    window.Capacitor = {
        Plugins: { YandexMobileAds: plugin },
        PluginHeaders: [{ name: 'YandexMobileAds', methods: ANALYTICS_METHODS.map((name) => ({ name })) }],
    }

    const bridge = new AndroidPlatformBridge();
    (bridge as unknown as { _options: unknown })._options = bridgeConfig.getValues()
    await bridge.initialize()
    return { bridge, plugin }
}

const NATIVE = {
    adUnits: { interstitial: true, rewarded: true, banner: true },
    appMetrica: true,
}

describe('AndroidPlatformBridge ad units compiled into the app', () => {
    afterEach(() => {
        vi.restoreAllMocks()
        delete window.Capacitor
    })

    test('a config without ids still shows ads the plugin has compiled in', async () => {
        const { bridge, plugin } = await createBridge({}, NATIVE)

        expect(plugin.preloadInterstitial).toHaveBeenCalledWith({})
        expect(plugin.preloadRewarded).toHaveBeenCalledWith({})

        bridge.showInterstitial()
        bridge.showRewarded()
        bridge.showBanner('bottom')
        bridge.hideBanner()

        expect(plugin.showInterstitial).toHaveBeenCalledWith({})
        expect(plugin.showRewarded).toHaveBeenCalledWith({})
        expect(plugin.showBanner).toHaveBeenCalledWith({ position: 'bottom' })
        expect(plugin.hideBanner).toHaveBeenCalledWith({})
    })

    test('analytics works with the AppMetrica key compiled in and none in the config', async () => {
        const { bridge, plugin } = await createBridge({}, NATIVE)

        bridge.sendPlatformAnalyticsEvent('fight_end', { result: 'win' })

        expect(plugin.reportEvent).toHaveBeenCalledWith({ name: 'fight_end', params: { result: 'win' } })
    })

    test('an older plugin keeps using the ids from the config', async () => {
        const { bridge, plugin } = await createBridge({
            appMetricaKey: 'key',
            advertisement: {
                interstitial: { adUnitId: 'R-M-1-2' },
                rewarded: { adUnitId: 'R-M-1-3' },
                banner: { adUnitId: 'R-M-1-1' },
            },
        }, undefined)

        bridge.showInterstitial()
        bridge.showBanner('top')

        expect(plugin.initialize).toHaveBeenCalledWith({ appMetricaKey: 'key' })
        expect(plugin.preloadRewarded).toHaveBeenCalledWith({ adUnitId: 'R-M-1-3' })
        expect(plugin.showInterstitial).toHaveBeenCalledWith({ adUnitId: 'R-M-1-2' })
        expect(plugin.showBanner).toHaveBeenCalledWith({ adUnitId: 'R-M-1-1', position: 'top' })
    })

    test('with ids neither in the config nor in the app nothing is requested', async () => {
        const { bridge, plugin } = await createBridge({}, undefined)

        bridge.showBanner('bottom')
        bridge.sendPlatformAnalyticsEvent('fight_end', {})

        expect(plugin.preloadInterstitial).not.toHaveBeenCalled()
        expect(plugin.preloadRewarded).not.toHaveBeenCalled()
        expect(plugin.showBanner).not.toHaveBeenCalled()
        expect(plugin.reportEvent).not.toHaveBeenCalled()
    })
})
