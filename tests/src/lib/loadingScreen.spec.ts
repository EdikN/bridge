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

import { describe, test, expect, beforeEach } from 'vitest'
import LoadingScreen from '../../../src/lib/loading-screen/LoadingScreen'
import {
    LOADING_SCREEN_TYPE,
    LOADING_SCREEN_LOGO_ID,
    LOADING_SCREEN_COOKIE_DEFAULT_PLATFORMS,
} from '../../../src/lib/loading-screen/constants'

function clearDom(): void {
    document.body.innerHTML = ''
    document.head.innerHTML = ''
}

describe('LoadingScreen', () => {
    beforeEach(clearDom)

    test('type cookie renders the fork cookie splash', () => {
        new LoadingScreen().show({ type: LOADING_SCREEN_TYPE.COOKIE })
        expect(document.getElementById('cookie-splash')).not.toBeNull()
        expect(document.getElementById('loading-overlay')).toBeNull()
    })

    test('type cookie tracks progress through fill and percent', () => {
        const screen = new LoadingScreen()
        screen.show({ type: LOADING_SCREEN_TYPE.COOKIE })
        screen.setProgress(50)
        expect((document.getElementById('cs-fill') as HTMLElement).style.height).toBe('50%')
        expect(document.getElementById('cs-num').textContent).toBe('50%')
    })

    test('upstream types are untouched: logo renders the preset svg, ring its own spinner', () => {
        new LoadingScreen().show({ type: LOADING_SCREEN_TYPE.LOGO })
        expect(document.getElementById('loading-overlay')).not.toBeNull()
        expect(document.getElementById(LOADING_SCREEN_LOGO_ID)).not.toBeNull()
        expect(document.getElementById('cookie-splash')).toBeNull()

        clearDom()

        new LoadingScreen().show({ type: LOADING_SCREEN_TYPE.RING })
        expect(document.querySelector('.ring-loading-ring')).not.toBeNull()
        expect(document.getElementById('cookie-splash')).toBeNull()
    })

    test('upstream legacy default without options is the logo, not the cookie', () => {
        new LoadingScreen().show()
        expect(document.getElementById('loading-overlay')).not.toBeNull()
        expect(document.getElementById('cookie-splash')).toBeNull()
    })

    test('cookie default platforms cover the studio portals', () => {
        expect(LOADING_SCREEN_COOKIE_DEFAULT_PLATFORMS.join(',')).toBe(
            ['yandex', 'vk', 'ok', 'gamesweb', 'pikabu_games', 'android'].join(','),
        )
    })
})
