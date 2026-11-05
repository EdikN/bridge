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

// Fork note: the stock Playgama SVG-logo / ring loading screens are replaced
// with the fork's custom "cookie splash" loader. The class keeps upstream's
// public API (show / setProgress with fallback semantics / setHideGate — the
// loading-sound gate) so PlaygamaBridge is unchanged; on every conflict with
// upstream only the CookieSplashView import below must stay fork-specific.

import { LOADING_SCREEN_HIDE_GATE_TIMEOUT } from './constants'
import type { LoadingScreenType, LoadingLogoType } from './constants'
import type { LoadingScreenView } from './types'
import CookieSplashView from './CookieSplashView'

export interface LoadingScreenOptions {
    type?: LoadingScreenType
    logo?: LoadingLogoType
    showLoadingText?: boolean
}

class LoadingScreen {
    #view: LoadingScreenView | null = null

    #currentProgress: number | null = null

    #completed = false

    #hideGate: Promise<unknown> | null = null

    // Delays hiding the screen until the given promise settles. Used to keep the
    // loader at 100% while the branded loading sound is still playing.
    setHideGate(gate: Promise<unknown>): void {
        this.#hideGate = gate
    }

    show(_options: LoadingScreenOptions = {}): void {
        this.#view = new CookieSplashView()
        this.#view.show()
    }

    setProgress(percent: number, isFallback = false): void {
        if (this.#completed || !this.#view) {
            return
        }

        if (isFallback && this.#currentProgress !== null) {
            return
        }

        this.#currentProgress = percent

        const progress = Math.max(0, Math.min(100, percent))

        const view = this.#view
        view.setProgress(progress)

        if (progress === 100) {
            this.#completed = true

            if (this.#hideGate) {
                const timeout = new Promise((resolve) => {
                    setTimeout(resolve, LOADING_SCREEN_HIDE_GATE_TIMEOUT)
                })
                Promise.race([this.#hideGate.catch(() => {}), timeout]).then(() => view.hide())
            } else {
                view.hide()
            }
        }
    }
}

export default LoadingScreen
