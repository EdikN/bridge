import {
    afterEach, describe, expect, it,
} from 'vitest'
import { PLATFORM_ID } from '../../src/modules/platform/constants'
import { detectPlatformId } from '../../src/platformDetectors'

// Регрессия форка: детектор gamesweb (стоит первым) не должен перехватывать
// запуски из VK/OK — там нет ни gw=1, ни window.GWHost.
const VK_LAUNCH = '?vk_access_token_settings=&vk_app_id=51234567&vk_are_notifications_enabled=0'
    + '&vk_is_app_user=1&vk_is_favorite=0&vk_language=ru&vk_platform=desktop_web&vk_ref=other'
    + '&vk_ts=1759230000&vk_user_id=1&sign=abc'
const VK_LEGACY_LAUNCH = '?api_url=https://api.vk.com/api.php&api_id=51234567&api_settings=0'
    + '&viewer_id=1&viewer_type=0&auth_key=deadbeef&language=0&is_app_user=1'

function setSearch(search: string) {
    window.history.replaceState({}, '', `/${search}`)
}

describe('platform detection: VK is not affected by the gamesweb detector', () => {
    afterEach(() => {
        setSearch('')
        delete (window as unknown as Record<string, unknown>).GWHost
    })

    it('modern VK launch params → vk', () => {
        setSearch(VK_LAUNCH)
        expect(detectPlatformId()).toBe(PLATFORM_ID.VK)
    })

    it('legacy VK launch params → vk', () => {
        setSearch(VK_LEGACY_LAUNCH)
        expect(detectPlatformId()).toBe(PLATFORM_ID.VK)
    })

    it('platform_id=vk still wins', () => {
        setSearch('?platform_id=vk&vk_app_id=1')
        expect(detectPlatformId()).toBe(PLATFORM_ID.VK)
    })

    it('gw=0 does not switch to gamesweb', () => {
        setSearch(`${VK_LAUNCH}&gw=0`)
        expect(detectPlatformId()).toBe(PLATFORM_ID.VK)
    })

    it('only an explicit portal launch switches to gamesweb', () => {
        setSearch('?gw=1')
        expect(detectPlatformId()).toBe(PLATFORM_ID.GAMESWEB)
    })
})
