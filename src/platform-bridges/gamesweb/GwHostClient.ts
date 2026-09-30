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

/* eslint-disable max-classes-per-file */

// Client side of the GamesWeb Host Protocol v1 (docs/gamesweb.md).
// The game talks to the GamesWeb portal page that hosts it in an iframe. When
// the portal injected its runtime (window.GWHost) the bridge goes through it;
// otherwise it speaks the postMessage transport itself.

export const GW_ERROR_CODE = {
    NOT_SUPPORTED: 'not_supported',
    NOT_AUTHORIZED: 'not_authorized',
    CANCELLED: 'cancelled',
    FAILED: 'failed',
    TIMEOUT: 'timeout',
    BAD_REQUEST: 'bad_request',
    COOLDOWN: 'cooldown',
} as const

export const GW_PROTOCOL_VERSION = 1

// The portal origins a game may trust: the production portal, and a local dev server.
const ALLOWED_ORIGIN_REGEX = /^(https:\/\/(www\.)?choclategames\.ru|http:\/\/(localhost|127\.0\.0\.1):\d+)$/

const HELLO_TIMEOUT = 5000
const DEFAULT_TIMEOUT = 15000
const ADS_TIMEOUT = 180000
const AUTHORIZE_TIMEOUT = 300000
// The injected runtime falls back to offline on its own; this only guards a broken runtime.
const RUNTIME_READY_TIMEOUT = 10000

export interface GwPlayer {
    isAuthorized?: boolean
    id?: string | number | null
    name?: string | null
    photos?: unknown[]
    mode?: string
}

export interface GwFeatures {
    interstitial?: boolean
    rewarded?: boolean
    banner?: boolean
    leaderboards?: boolean
    storage?: 'server' | 'local' | false | string
    authorization?: boolean
    payments?: boolean
    share?: boolean
    rate?: boolean
    favorites?: boolean
    joinCommunity?: boolean
    inviteFriends?: boolean
    homeScreen?: boolean
    achievements?: boolean
    remoteConfig?: boolean
}

export interface GwHelloResult {
    protocol?: number
    game?: { slug?: string, title?: string, id?: number | string }
    platform?: {
        language?: string
        tld?: string | null
        deviceType?: string
        payload?: string | null
        origin?: string
        serverTime?: number
    }
    player?: GwPlayer
    features?: GwFeatures
    ads?: { interstitialCooldown?: number, initialInterstitialDelay?: number }
    audio?: { enabled?: boolean }
    pause?: { paused?: boolean }
}

export interface GwHelloParams {
    sdk: string
    sdkVersion: string
    runtime: number
}

export type GwEventHandler = (data: unknown) => void

export class GwError extends Error {
    code: string

    constructor(code: string, message?: string) {
        super(message || code)
        this.name = 'GwError'
        this.code = code
    }
}

export function toGwError(error: unknown): GwError {
    if (error instanceof GwError) {
        return error
    }

    const record = (error && typeof error === 'object') ? error as { code?: unknown, message?: unknown } : null
    const code = typeof record?.code === 'string' ? record.code : GW_ERROR_CODE.FAILED
    const message = typeof record?.message === 'string' ? record.message : String(error ?? code)
    return new GwError(code, message)
}

export function isAllowedGwOrigin(origin: string | null | undefined): boolean {
    return typeof origin === 'string' && ALLOWED_ORIGIN_REGEX.test(origin)
}

export function getGwTimeout(method: string): number {
    if (method === 'hello') {
        return HELLO_TIMEOUT
    }

    if (method === 'player.authorize') {
        return AUTHORIZE_TIMEOUT
    }

    if (method.startsWith('ads.')) {
        return ADS_TIMEOUT
    }

    return DEFAULT_TIMEOUT
}

// What the platform bridge needs from a transport.
export interface GwClient {
    readonly isOnline: boolean
    // Resolves with the hello result, or null when the host is unreachable (offline mode).
    // Never rejects and never hangs.
    connect(params: GwHelloParams): Promise<GwHelloResult | null>
    call(method: string, params?: Record<string, unknown>): Promise<unknown>
    on(event: string, handler: GwEventHandler): void
    emit(event: string, data?: unknown): void
}

function withTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new GwError(GW_ERROR_CODE.TIMEOUT)), timeout)
        promise.then(
            (value) => {
                clearTimeout(timer)
                resolve(value)
            },
            (error) => {
                clearTimeout(timer)
                reject(error)
            },
        )
    })
}

// Goes through the runtime the portal injected into the game page (window.GWHost).
export class GwRuntimeClient implements GwClient {
    get isOnline(): boolean {
        return this.#isOnline
    }

    #host: GWHostApi

    #isOnline = false

    constructor(host: GWHostApi) {
        this.#host = host
    }

    connect(): Promise<GwHelloResult | null> {
        return withTimeout(Promise.resolve(this.#host.ready), RUNTIME_READY_TIMEOUT)
            .then((result) => {
                if (!this.#host.isOnline) {
                    return null
                }

                const info = (this.#host.info ?? result) as GwHelloResult | null | undefined
                if (!info || typeof info !== 'object') {
                    return null
                }

                this.#isOnline = true
                return info
            })
            .catch(() => null)
    }

    call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
        try {
            return Promise.resolve(this.#host.call(method, params)).catch((error) => {
                throw toGwError(error)
            })
        } catch (error) {
            return Promise.reject(toGwError(error))
        }
    }

    on(event: string, handler: GwEventHandler): void {
        this.#host.on(event, handler)
    }

    emit(event: string, data?: unknown): void {
        try {
            this.#host.emit(event, data)
        } catch {
            // fire-and-forget
        }
    }
}

interface PendingRequest {
    resolve: (value: unknown) => void
    reject: (error: GwError) => void
    timer: ReturnType<typeof setTimeout>
}

interface GwMessage {
    gw?: unknown
    kind?: unknown
    id?: unknown
    ok?: unknown
    result?: unknown
    error?: unknown
    event?: unknown
    data?: unknown
}

// Speaks the postMessage transport to window.parent directly, for a bridge build
// that runs without the injected runtime.
export class GwPostMessageClient implements GwClient {
    get isOnline(): boolean {
        return this.#isOnline
    }

    #win: Window

    #origin: string | null = null

    #isOnline = false

    #isListening = false

    #nextId = 1

    #pending = new Map<number, PendingRequest>()

    #handlers = new Map<string, GwEventHandler[]>()

    constructor(win: Window) {
        this.#win = win
    }

    connect(params: GwHelloParams): Promise<GwHelloResult | null> {
        const origin = this.#resolveOrigin()
        if (!origin) {
            return Promise.resolve(null)
        }

        this.#origin = origin
        this.#listen()

        return this.#request('hello', { ...params })
            .then((result) => {
                if (!result || typeof result !== 'object') {
                    return null
                }

                this.#isOnline = true
                return result as GwHelloResult
            })
            .catch(() => null)
    }

    call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
        if (!this.#isOnline) {
            return Promise.reject(new GwError(GW_ERROR_CODE.NOT_SUPPORTED, 'GamesWeb host is offline'))
        }

        return this.#request(method, params)
    }

    on(event: string, handler: GwEventHandler): void {
        const handlers = this.#handlers.get(event) ?? []
        handlers.push(handler)
        this.#handlers.set(event, handlers)
    }

    emit(event: string, data?: unknown): void {
        if (!this.#isOnline) {
            return
        }

        this.#post({
            gw: 1, kind: 'evt', event, data,
        })
    }

    // The launch URL carries gw=1 and gw_origin; without a trusted origin and a real
    // parent frame there is nobody to talk to.
    #resolveOrigin(): string | null {
        let searchParams: URLSearchParams
        try {
            searchParams = new URL(this.#win.location.href).searchParams
        } catch {
            return null
        }

        if (searchParams.get('gw') !== '1') {
            return null
        }

        const origin = searchParams.get('gw_origin')
        if (!isAllowedGwOrigin(origin)) {
            return null
        }

        const { parent } = this.#win
        if (!parent || parent === this.#win) {
            return null
        }

        return origin
    }

    #listen(): void {
        if (this.#isListening) {
            return
        }

        this.#isListening = true
        this.#win.addEventListener('message', (event: MessageEvent) => this.#onMessage(event))
    }

    #onMessage(event: MessageEvent): void {
        if (event.source !== this.#win.parent || event.origin !== this.#origin) {
            return
        }

        const message = event.data as GwMessage | null
        if (!message || typeof message !== 'object' || message.gw !== 1) {
            return
        }

        if (message.kind === 'res') {
            const id = Number(message.id)
            const pending = this.#pending.get(id)
            if (!pending) {
                return
            }

            this.#pending.delete(id)
            clearTimeout(pending.timer)
            if (message.ok) {
                pending.resolve(message.result)
            } else {
                pending.reject(toGwError(message.error))
            }
            return
        }

        if (message.kind === 'evt' && typeof message.event === 'string') {
            const handlers = this.#handlers.get(message.event)
            if (!handlers) {
                return
            }

            handlers.slice().forEach((handler) => {
                try {
                    handler(message.data)
                } catch {
                    // a failing handler must not break the others
                }
            })
        }
    }

    #request(method: string, params: Record<string, unknown>): Promise<unknown> {
        const id = this.#nextId
        this.#nextId += 1

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.#pending.delete(id)
                reject(new GwError(GW_ERROR_CODE.TIMEOUT, `${method} timed out`))
            }, getGwTimeout(method))

            this.#pending.set(id, { resolve, reject, timer })

            const isPosted = this.#post({
                gw: 1, kind: 'req', id, method, params,
            })

            if (!isPosted) {
                clearTimeout(timer)
                this.#pending.delete(id)
                reject(new GwError(GW_ERROR_CODE.FAILED, 'postMessage failed'))
            }
        })
    }

    #post(message: Record<string, unknown>): boolean {
        try {
            this.#win.parent.postMessage(message, this.#origin as string)
            return true
        } catch {
            return false
        }
    }
}

export function createGwClient(win: Window): GwClient {
    if (win.GWHost && typeof win.GWHost.call === 'function') {
        return new GwRuntimeClient(win.GWHost)
    }

    return new GwPostMessageClient(win)
}
