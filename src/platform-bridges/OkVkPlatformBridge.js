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

import VkPlatformBridge from './VkPlatformBridge'
import { PLATFORM_ID, LEADERBOARD_TYPE, ACTION_NAME } from '../constants'

class OkVkPlatformBridge extends VkPlatformBridge {
    // platform
    get platformId() {
        return PLATFORM_ID.OK
    }

    // leaderboards — not supported by OK.ru
    get leaderboardsType() {
        return LEADERBOARD_TYPE.NOT_AVAILABLE
    }

    // social
    get isShareSupported() {
        return true
    }

    get isAddToFavoritesSupported() {
        return false
    }

    joinCommunity(options) {
        // Read groupId from config first — allows calling without arguments
        const configGroupId = this._options?.social?.joinCommunity?.ok
        let groupId = configGroupId ?? options?.groupId

        if (!groupId) {
            return Promise.reject()
        }

        if (typeof groupId === 'string') {
            groupId = parseInt(groupId, 10)
            if (Number.isNaN(groupId)) {
                return Promise.reject()
            }
        }

        return this._sendRequestToVKBridge(ACTION_NAME.JOIN_COMMUNITY, 'VKWebAppJoinGroup', { group_id: groupId })
            .then(() => {
                window.open(`https://ok.ru/group/${groupId}`)
            })
    }
}

export default OkVkPlatformBridge
