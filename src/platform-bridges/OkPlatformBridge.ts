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

// Fork note: OK games are launched through the VK Bridge runtime (ok-vk), so this
// bridge extends VkPlatformBridge instead of using the legacy OK FAPI SDK.

import VkPlatformBridge from './VkPlatformBridge'
import { ACTION_NAME } from '../constants'
import { PLATFORM_ID, type PlatformId } from '../modules/platform/constants'
import { LEADERBOARD_TYPE, type LeaderboardType } from '../modules/leaderboards/constants'
import type { AnyRecord } from '../utils'

interface VkBridgeLike {
    send(method: string, params?: AnyRecord): Promise<AnyRecord>
}

class OkPlatformBridge extends VkPlatformBridge {
    // platform
    get platformId(): PlatformId {
        return PLATFORM_ID.OK
    }

    // leaderboards — not supported by OK.ru
    get leaderboardsType(): LeaderboardType {
        return LEADERBOARD_TYPE.NOT_AVAILABLE
    }

    // social
    get isShareSupported(): boolean {
        return true
    }

    get isAddToFavoritesSupported(): boolean {
        return false
    }

    get isJoinCommunitySupported(): boolean {
        return true
    }

    #okAppId: string | null = null

    initialize(): Promise<unknown> {
        return super.initialize().then(() => {
            const url = new URL(window.location.href)
            const urlAppId = url.searchParams.get('vk_ok_app_id')
                || url.searchParams.get('vk_app_id')
                || url.searchParams.get('api_id')

            if (urlAppId) {
                this.#okAppId = urlAppId
                return Promise.resolve()
            }

            return (this._platformSdk as VkBridgeLike).send('VKWebAppGetLaunchParams')
                .then((data) => {
                    if (data && data.vk_app_id) {
                        this.#okAppId = String(data.vk_app_id)
                    }
                })
                .catch(() => {})
        })
    }

    paymentsGetCatalog(): Promise<unknown> {
        let promiseDecorator = this._getPromiseDecorator(ACTION_NAME.GET_CATALOG)
        if (!promiseDecorator) {
            promiseDecorator = this._createPromiseDecorator(ACTION_NAME.GET_CATALOG)

            const appId = this.#okAppId

            if (appId) {
                this._fetchExternalCatalog('ok', appId)
                    .then((products) => {
                        this._resolvePromiseDecorator(ACTION_NAME.GET_CATALOG, products)
                    })
                    .catch(() => {
                        this._resolvePromiseDecorator(ACTION_NAME.GET_CATALOG, this._paymentsGetProductsPlatformData())
                    })
            } else {
                this._resolvePromiseDecorator(ACTION_NAME.GET_CATALOG, this._paymentsGetProductsPlatformData())
            }
        }

        return promiseDecorator.promise
    }

    joinCommunity(options?: AnyRecord & { groupId?: string | number }): Promise<unknown> {
        // groupId comes from runtime options or the merged social config block; keep the
        // fork's hardcoded fallback so the call works without arguments.
        const configGroupId = (this._options?.social as AnyRecord | undefined)
            ?.joinCommunity as AnyRecord | undefined
        let groupId = options?.groupId
            ?? configGroupId?.[this.platformId] as string | number | undefined
            ?? 70000048656390

        if (typeof groupId === 'string') {
            groupId = parseInt(groupId, 10)
            if (Number.isNaN(groupId)) {
                return Promise.reject()
            }
        }

        // OK supports the native subscribe dialog via VK Bridge (VKWebAppJoinGroup) on
        // Android/iOS/web — show it instead of navigating to ok.ru/group, which loads a guest
        // page inside the game frame.
        return this._sendRequestToVKBridge(ACTION_NAME.JOIN_COMMUNITY, 'VKWebAppJoinGroup', { group_id: groupId })
    }

    share(options?: AnyRecord & { url?: string, link?: string }): Promise<unknown> {
        let link = options?.url ?? options?.link

        // Если ссылка не передана явно, нужно обязательно передать ссылку на игру,
        // иначе при вызове VKWebAppShare встроенный парсер Одноклассников (web-grabber)
        // не сможет получить метаданные по текущему URL фрейма (что и вызовет ошибку).
        if (!link) {
            const url = new URL(window.location.href)
            if (url.searchParams.has('vk_ok_app_id')) {
                link = `https://ok.ru/game/${url.searchParams.get('vk_ok_app_id')}`
            } else if (url.searchParams.has('vk_app_id')) {
                link = `https://ok.ru/game/${url.searchParams.get('vk_app_id')}`
            }
        }

        if (link) {
            return this._sendRequestToVKBridge(ACTION_NAME.SHARE, 'VKWebAppShare', { link }, 'type')
                .catch(() => this._sendRequestToVKBridge(ACTION_NAME.SHARE, 'VKWebAppShowWallPostBox', { message: link }, 'type'))
        }

        // Если сформировать ссылку не удалось, просто предлагаем поделиться через WallPost
        return this._sendRequestToVKBridge(ACTION_NAME.SHARE, 'VKWebAppShowWallPostBox', { message: '' }, 'type')
    }
}

export default OkPlatformBridge
