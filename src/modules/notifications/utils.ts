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

import bridgeConfig from '../../lib/bridge-config'
import type { LocalizedText, NotificationMapping, ScheduledNotification } from './types'

export function localize(text: unknown, language: string): string | undefined {
    if (typeof text === 'string') {
        return text
    }

    if (!text || typeof text !== 'object') {
        return undefined
    }

    const translations = text as Record<string, unknown>
    const value = translations[language] ?? translations.en ?? Object.values(translations)[0]
    return typeof value === 'string' ? value : undefined
}

export function getNotificationConfig(id: string): NotificationMapping | undefined {
    return bridgeConfig.getValues().notifications?.find((n) => n.id === id)
}

export function notificationFromConfig(entry: NotificationMapping, language: string): ScheduledNotification {
    const notification: ScheduledNotification = {
        id: entry.id,
        title: localize(entry.title, language) as string,
        description: localize(entry.description, language) as string,
    }

    const callToAction = localize(entry.callToAction as LocalizedText | undefined, language)
    if (callToAction !== undefined) notification.callToAction = callToAction
    if (entry.delaySeconds !== undefined) notification.delaySeconds = entry.delaySeconds
    if (entry.image !== undefined) notification.image = entry.image
    if (entry.payload !== undefined) notification.payload = entry.payload

    return notification
}

export function fillNotificationFromConfig(
    notification: ScheduledNotification,
    language: string,
): ScheduledNotification {
    const entry = getNotificationConfig(notification.id)
    if (!entry) {
        return notification
    }

    const fromConfig = notificationFromConfig(entry, language) as unknown as Record<string, unknown>
    const result: Record<string, unknown> = { ...notification }
    Object.keys(fromConfig).forEach((key) => {
        if (result[key] === undefined && fromConfig[key] !== undefined) {
            result[key] = fromConfig[key]
        }
    })

    return result as unknown as ScheduledNotification
}
