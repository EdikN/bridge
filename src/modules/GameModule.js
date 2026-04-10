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

import EventLite from 'event-lite'
import ModuleBase from './ModuleBase'
import { EVENT_NAME, PLATFORM_ID } from '../constants'
import { createProgressLogo, applySafeAreaStyles } from '../common/utils'
import customLoader from '../common/CustomLoader'

class GameModule extends ModuleBase {
    get visibilityState() {
        return this._platformBridge.visibilityState
    }

    _currentLoadingProgress = null

    _loadingProcessCompleted = false

    constructor(platformBridge) {
        super(platformBridge)

        this._platformBridge.on(
            EVENT_NAME.VISIBILITY_STATE_CHANGED,
            (state) => this.emit(EVENT_NAME.VISIBILITY_STATE_CHANGED, state),
        )

        if (!this._platformBridge.options.disableLoadingLogo) {
            const showFullLogo = this._platformBridge.platformId === PLATFORM_ID.YANDEX
                || this._platformBridge.platformId === PLATFORM_ID.Y8
                ? false
                : this._platformBridge.options.showFullLoadingLogo
            createProgressLogo(showFullLogo)
        }

        if (this._platformBridge.options?.game?.adaptToSafeArea) {
            applySafeAreaStyles()
        }
    }

    setLoadingProgress(percent, isFallback = false) {
        if (this._loadingProcessCompleted) {
            return
        }

        if (isFallback && this._currentLoadingProgress !== null) {
            return
        }

        this._currentLoadingProgress = percent
        customLoader.setProgress(percent)

        if (percent === 100) {
            this._loadingProcessCompleted = true
        }
    }
}

EventLite.mixin(GameModule.prototype)
export default GameModule
