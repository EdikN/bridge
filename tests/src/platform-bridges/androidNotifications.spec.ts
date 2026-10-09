import {
    describe, test, expect, vi, beforeEach, afterEach,
} from 'vitest'
import AndroidPlatformBridge from '../../../src/platform-bridges/AndroidPlatformBridge'
import NotificationsModule from '../../../src/modules/notifications/NotificationsModule'
import type { NotificationsBridgeContract } from '../../../src/modules/notifications/NotificationsModule'
import bridgeConfig from '../../../src/lib/bridge-config'
import { ERROR_CODE } from '../../../src/constants'

const NOTIFICATION_METHODS = ['scheduleNotification', 'cancelNotification', 'cancelAllNotifications']

function createPlugin(withNotifications = true) {
    const plugin: Record<string, ReturnType<typeof vi.fn>> = {
        initialize: vi.fn().mockResolvedValue(undefined),
        addListener: vi.fn(),
    }
    if (withNotifications) {
        plugin.scheduleNotification = vi.fn().mockResolvedValue(undefined)
        plugin.cancelNotification = vi.fn().mockResolvedValue(undefined)
        plugin.cancelAllNotifications = vi.fn().mockResolvedValue(undefined)
        plugin.requestNotificationPermission = vi.fn().mockResolvedValue({ granted: true })
        plugin.getLaunchNotification = vi.fn().mockResolvedValue({ id: 'daily', payload: 'gift=1' })
    }
    return plugin
}

async function createBridge(config: Record<string, unknown>, withNotifications = true) {
    global.fetch = vi.fn().mockResolvedValue({
        ok: false, status: 404, statusText: 'Not Found', text: () => Promise.resolve(''),
    })
    await bridgeConfig.load(undefined, config)
    bridgeConfig.initialize('android')

    const plugin = createPlugin(withNotifications)
    window.Capacitor = {
        Plugins: { YandexMobileAds: plugin },
        PluginHeaders: [{
            name: 'YandexMobileAds',
            methods: (withNotifications ? NOTIFICATION_METHODS : []).map((name) => ({ name })),
        }],
    }

    const bridge = new AndroidPlatformBridge();
    (bridge as unknown as { _options: unknown })._options = bridgeConfig.getValues()
    await bridge.initialize()
    return { bridge, plugin }
}

const NOTIFICATIONS = [
    {
        id: 'comeback',
        auto: true,
        delaySeconds: 86400,
        title: { ru: 'Возвращайся!', en: 'Come back!' },
        description: { ru: 'Тебя ждут награды', en: 'Rewards are waiting' },
        image: 'images/push.png',
    },
    { id: 'daily', title: 'Daily gift', description: 'Take it' },
]

describe('AndroidPlatformBridge notifications', () => {
    beforeEach(() => {
        vi.spyOn(navigator, 'language', 'get').mockReturnValue('ru-RU')
    })

    afterEach(() => {
        vi.restoreAllMocks()
        delete window.Capacitor
    })

    test('schedules auto notifications from config with settings on start', async () => {
        const { bridge, plugin } = await createBridge({
            notifications: NOTIFICATIONS,
            notificationSettings: {
                smallIcon: 'ic_stat_notify', color: '#FF8800', channelName: { ru: 'Напоминания' },
            },
        })

        expect(bridge.isNotificationsSupported).toBe(true)
        expect(plugin.scheduleNotification).toHaveBeenCalledTimes(1)
        expect(plugin.scheduleNotification).toHaveBeenCalledWith({
            id: 'comeback',
            title: 'Возвращайся!',
            description: 'Тебя ждут награды',
            delaySeconds: 86400,
            image: 'images/push.png',
            smallIcon: 'ic_stat_notify',
            color: '#FF8800',
            channelName: 'Напоминания',
        })
        expect(plugin.requestNotificationPermission).toHaveBeenCalledTimes(1)
    })

    test('requests permission on start only when configured', async () => {
        const { plugin } = await createBridge({ notificationSettings: { requestPermission: 'onStart' } })
        expect(plugin.requestNotificationPermission).toHaveBeenCalledTimes(1)
        expect(plugin.scheduleNotification).not.toHaveBeenCalled()
    })

    test('schedule({ id }) takes texts from config', async () => {
        const { bridge, plugin } = await createBridge({ notifications: NOTIFICATIONS })
        const module = new NotificationsModule().initialize(bridge as unknown as NotificationsBridgeContract)

        await module.schedule({ id: 'daily', delaySeconds: 60 } as never)

        expect(plugin.scheduleNotification).toHaveBeenCalledWith({
            id: 'daily', title: 'Daily gift', description: 'Take it', delaySeconds: 60,
        })
    })

    test('cancel and cancelAll go to the plugin', async () => {
        const { bridge, plugin } = await createBridge({})
        await bridge.notificationsCancel('daily')
        await bridge.notificationsCancelAll()
        expect(plugin.cancelNotification).toHaveBeenCalledWith({ id: 'daily' })
        expect(plugin.cancelAllNotifications).toHaveBeenCalled()
    })

    test('launch notification payload becomes the platform payload', async () => {
        const { bridge } = await createBridge({})
        expect(bridge.platformPayload).toBe('gift=1')
    })

    test('old plugin without notification methods: not supported', async () => {
        const { bridge } = await createBridge({ notifications: NOTIFICATIONS }, false)
        expect(bridge.isNotificationsSupported).toBe(false)
        await expect(bridge.notificationsSchedule(NOTIFICATIONS[1] as never))
            .rejects.toMatchObject({ code: ERROR_CODE.NOTIFICATIONS_NOT_SUPPORTED })
    })
})
