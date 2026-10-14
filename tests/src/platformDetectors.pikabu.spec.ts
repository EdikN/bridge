import {
    afterEach, describe, expect, it,
} from 'vitest'
import { PLATFORM_ID } from '../../src/modules/platform/constants'
import { detectPlatformId } from '../../src/platformDetectors'

// Pikabu Games frames a build hosted elsewhere: the game's own hostname says nothing,
// detection relies on launch params and the embedding page.
function setSearch(search: string) {
    window.history.replaceState({}, '', `/${search}`)
}

function setReferrer(referrer: string) {
    Object.defineProperty(document, 'referrer', { value: referrer, configurable: true })
}

describe('platform detection: Pikabu Games', () => {
    afterEach(() => {
        setSearch('')
        setReferrer('')
    })

    it('?pikabu=true → pikabu_games', () => {
        setSearch('?pikabu=true')
        expect(detectPlatformId()).toBe(PLATFORM_ID.PIKABU_GAMES)
    })

    it('?_platform-key=pikabu → pikabu_games', () => {
        setSearch('?_platform-key=pikabu')
        expect(detectPlatformId()).toBe(PLATFORM_ID.PIKABU_GAMES)
    })

    it('referrer games.pikabu.ru → pikabu_games', () => {
        setReferrer('https://games.pikabu.ru/game/123')
        expect(detectPlatformId()).toBe(PLATFORM_ID.PIKABU_GAMES)
    })

    it('platform_id still wins over the Pikabu markers', () => {
        setSearch('?pikabu=true&platform_id=yandex')
        expect(detectPlatformId()).toBe(PLATFORM_ID.YANDEX)
    })

    it('pikabu=false and other referrers do not match', () => {
        setSearch('?pikabu=false')
        setReferrer('https://pikabu.ru/story/1')
        expect(detectPlatformId()).toBe(PLATFORM_ID.MOCK)
    })

    it('nothing → mock', () => {
        expect(detectPlatformId()).toBe(PLATFORM_ID.MOCK)
    })
})
