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

export interface ScheduledNotification {
    id: string
    title: string
    description: string
    delaySeconds?: number
    image?: string
    callToAction?: string
    payload?: string
}

// Text in one language, or per language: { "ru": "...", "en": "..." }
export type LocalizedText = string | Record<string, string>

// Entry of "notifications" in playgama-bridge-config.json. Besides platform ids
// mapped to platform values ({ "msn": 3 }), an entry can hold the notification
// itself: schedule({ id }) then takes the missing fields from here, and
// "auto": true makes platforms that support it schedule it on every launch.
export interface NotificationMapping {
    id: string
    title?: LocalizedText
    description?: LocalizedText
    callToAction?: LocalizedText
    delaySeconds?: number
    image?: string
    payload?: string
    auto?: boolean
    [platform: string]: unknown
}

// "notificationSettings" in playgama-bridge-config.json (Android).
export interface NotificationSettings {
    // drawable/mipmap resource name of the status bar icon; app icon by default
    smallIcon?: string
    // accent color, e.g. "#FF8800"
    color?: string
    channelId?: string
    channelName?: LocalizedText
    // when to ask for POST_NOTIFICATIONS (Android 13+); default "onSchedule"
    requestPermission?: 'onStart' | 'onSchedule' | 'never'
}
