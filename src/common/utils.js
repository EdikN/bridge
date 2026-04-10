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

import {
    BANNER_CONTAINER_ID,
    BANNER_POSITION,
    ORIENTATION_OVERLAY_ID,
    PLATFORM_ID,
} from '../constants'

const POST_METHOD = ['post', 'Message'].join('')

export const addJavaScript = function addJavaScript(src, options = {}) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script')
        script.src = src

        for (let i = 0; i < Object.keys(options).length; i++) {
            const key = Object.keys(options)[i]
            const value = options[key]
            script.setAttribute(key, value)
        }

        script.addEventListener('load', resolve)
        script.addEventListener('error', () => reject(new Error(`Failed to load: ${src}`)))
        document.head.appendChild(script)
    })
}

export const addAdsByGoogle = ({
    adSenseId,
    channelId,
    hostId,
    interstitialPlacementId,
    rewardedPlacementId,
    adFrequencyHint = '180s',
    testMode = false,
}, config = {}) => new Promise((resolve) => {
    const script = document.createElement('script')
    script.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js'

    script.setAttribute('data-ad-client', adSenseId)

    if (channelId) {
        script.setAttribute('data-ad-channel', channelId)
    } else if (hostId) {
        script.setAttribute('data-ad-host', hostId)
    }

    if (interstitialPlacementId) {
        script.setAttribute('data-admob-interstitial-slot', interstitialPlacementId)
    }

    if (rewardedPlacementId) {
        script.setAttribute('data-admob-rewarded-slot', rewardedPlacementId)
    }

    if (testMode) {
        script.setAttribute('data-adbreak-test', 'on')
    }

    script.setAttribute('data-ad-frequency-hint', adFrequencyHint)
    script.setAttribute('crossorigin', 'anonymous')

    script.addEventListener('load', () => {
        window.adsbygoogle = window.adsbygoogle || []
        window.adsbygoogle.push({
            preloadAdBreaks: 'on',
            sound: 'on',
            onReady: () => {},
            ...config,
        })

        resolve((adOptions) => window.adsbygoogle.push(adOptions))
    })
    document.head.appendChild(script)
})

export function createAdvertisementBannerContainer(position) {
    const container = document.createElement('div')
    container.id = BANNER_CONTAINER_ID
    container.style.position = 'absolute'
    document.body.appendChild(container)

    switch (position) {
        case BANNER_POSITION.TOP:
            container.style.top = '0px'
            container.style.height = '90px'
            container.style.width = '100%'
            break
        case BANNER_POSITION.BOTTOM:
        default:
            container.style.bottom = '0px'
            container.style.height = '90px'
            container.style.width = '100%'
            break
    }

    return container
}

export function createLoadingOverlay() {
    const overlay = document.createElement('div')
    overlay.style.position = 'fixed'
    overlay.style.top = '0'
    overlay.style.left = '0'
    overlay.style.width = '100vw'
    overlay.style.height = '100vh'
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)'
    overlay.style.display = 'flex'
    overlay.style.justifyContent = 'center'
    overlay.style.alignItems = 'center'
    overlay.style.zIndex = '9999'
    overlay.id = 'loading-overlay'

    const loading = document.createElement('div')
    loading.style.fontSize = '24px'
    loading.style.color = '#fff'
    loading.innerText = 'Loading...'
    overlay.appendChild(loading)

    return overlay
}

export function createAdContainer(containerId) {
    const container = document.createElement('div')
    container.id = containerId
    container.style.position = 'fixed'
    container.style.inset = '0'
    container.style.zIndex = '9999999'
    document.body.appendChild(container)

    return container
}

export function createOrientationOverlay() {
    if (!document.getElementById('bridge-orientation-overlay-styles')) {
        const style = document.createElement('style')
        style.id = 'bridge-orientation-overlay-styles'
        style.textContent = `
            #${ORIENTATION_OVERLAY_ID} {
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background-color: rgba(0, 0, 0, 0.95);
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                z-index: 9999999;
            }

            #bridge-orientation-icon {
                width: 80px;
                height: 80px;
                animation: bridge-rotate-phone 1.5s ease-in-out infinite;
            }

            #bridge-orientation-message {
                color: #fff;
                font-size: 18px;
                font-family: Arial, sans-serif;
                margin-top: 20px;
                text-align: center;
            }

            @keyframes bridge-rotate-phone {
                0%, 100% { transform: rotate(0deg); }
                50% { transform: rotate(90deg); }
            }
        `
        document.head.appendChild(style)
    }

    const overlay = document.createElement('div')
    overlay.id = ORIENTATION_OVERLAY_ID

    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    icon.setAttribute('id', 'bridge-orientation-icon')
    icon.setAttribute('viewBox', '0 0 24 24')
    icon.setAttribute('fill', 'none')
    icon.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    icon.innerHTML = `
        <rect x="5" y="2" width="14" height="20" rx="2" stroke="white" stroke-width="2"/>
        <line x1="12" y1="18" x2="12" y2="18" stroke="white" stroke-width="2" stroke-linecap="round"/>
    `

    const message = document.createElement('div')
    message.id = 'bridge-orientation-message'
    message.innerText = 'Please rotate your device'

    overlay.appendChild(icon)
    overlay.appendChild(message)

    return overlay
}

export function showInfoPopup(message) {
    if (!document.getElementById('bridge-info-popup-styles')) {
        const style = document.createElement('style')
        style.id = 'bridge-info-popup-styles'
        style.textContent = `
            #bridge-info-popup-overlay {
                position: fixed;
                inset: 0;
                display: none;
                align-items: center;
                justify-content: center;
                padding: 18px;
                background: rgba(0, 0, 0, 0.24);
                z-index: 9999;
            }

            #bridge-info-popup {
                width: min(92vw, 320px);
                padding: 24px 20px 20px;
                border-radius: 26px;
                background: #ffffff;
                color: #24304d;
                text-align: center;
                box-shadow: 0 18px 50px rgba(0, 0, 0, 0.22);
                font-family: Inter, Arial, sans-serif;
            }

            #bridge-info-popup-emoji {
                font-size: 42px;
                margin-bottom: 10px;
                line-height: 1;
            }

            #bridge-info-popup-title {
                margin: 0 0 10px;
                font-size: 24px;
                line-height: 1.1;
            }

            #bridge-info-popup-message {
                margin: 0 0 18px;
                font-size: 15px;
                line-height: 1.45;
                color: #66708b;
            }

            #bridge-info-popup-button {
                min-width: 140px;
                height: 46px;
                padding: 0 24px;
                border: 0;
                border-radius: 999px;
                font-weight: 700;
                font-size: 15px;
                color: #ffffff;
                background: linear-gradient(180deg, #5f8cff, #4c71e6);
                box-shadow: 0 8px 20px rgba(76, 113, 230, 0.32);
                cursor: pointer;
                font-family: Inter, Arial, sans-serif;
            }

            #bridge-info-popup-button:active {
                transform: translateY(1px);
            }`

        document.head.appendChild(style)
    }

    let overlay = document.getElementById('bridge-info-popup-overlay')
    if (!overlay) {
        overlay = document.createElement('div')
        overlay.id = 'bridge-info-popup-overlay'
        document.body.appendChild(overlay)
    }

    let popup = document.getElementById('bridge-info-popup')
    if (!popup) {
        popup = document.createElement('div')
        popup.id = 'bridge-info-popup'
        overlay.appendChild(popup)
    }

    popup.innerHTML = ''

    const emoji = document.createElement('div')
    emoji.id = 'bridge-info-popup-emoji'
    emoji.textContent = '\uD83C\uDFAC'
    popup.appendChild(emoji)

    const title = document.createElement('h3')
    title.id = 'bridge-info-popup-title'
    title.textContent = message
    popup.appendChild(title)

    const button = document.createElement('button')
    button.id = 'bridge-info-popup-button'
    button.textContent = 'Continue'
    popup.appendChild(button)

    return new Promise((resolve) => {
        button.onclick = () => {
            overlay.style.display = 'none'
            resolve()
        }

        overlay.style.display = 'flex'
    })
}

export function showAdFailurePopup(platformId) {
    if (!document.getElementById('bridge-ad-failure-popup-fonts')) {
        const preconnect1 = document.createElement('link')
        preconnect1.rel = 'preconnect'
        preconnect1.href = 'https://fonts.googleapis.com'
        document.head.appendChild(preconnect1)

        const preconnect2 = document.createElement('link')
        preconnect2.rel = 'preconnect'
        preconnect2.href = 'https://fonts.gstatic.com'
        preconnect2.crossOrigin = 'anonymous'
        document.head.appendChild(preconnect2)

        const fontLink = document.createElement('link')
        fontLink.id = 'bridge-ad-failure-popup-fonts'
        fontLink.rel = 'stylesheet'
        fontLink.href = 'https://fonts.googleapis.com/css2?family=Cal+Sans&display=swap'
        document.head.appendChild(fontLink)
    }

    if (!document.getElementById('bridge-ad-failure-popup-styles')) {
        const style = document.createElement('style')
        style.id = 'bridge-ad-failure-popup-styles'
        style.textContent = `
            #bridge-ad-failure-popup {
                position: fixed;
                top: 0;
                left: 0;
                height: 100%;
                width: 100%;
                box-sizing: border-box;
                padding: 24px 16px;
                background: #682eb2;
                display: none;
                grid-template-columns: 1fr 1fr;
                grid-template-rows: 32px 1fr;
                z-index: 9999999;
                font-family: 'Cal Sans', -apple-system, BlinkMacSystemFont, sans-serif;
                color: #fff;
                cursor: pointer;
            }

            #bridge-ad-failure-popup-logo {
                height: 32px;
                display: ${platformId === PLATFORM_ID.OK ? 'none' : 'block'};
            }

            #bridge-ad-failure-popup-close {
                all: unset;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 32px;
                height: 32px;
                background: #fff;
                border-radius: 50%;
                justify-self: end;
            }

            #bridge-ad-failure-popup-text {
                grid-column: span 2;
                font-size: 21px;
                font-style: normal;
                font-weight: 400;
                line-height: 110%;
                align-self: end;
                margin: 0;
                font-size: ${platformId === PLATFORM_ID.OK ? '18px' : '21px'};
            }

            @media (min-width: 320px) {
                #bridge-ad-failure-popup {
                    padding: 24px;
                    grid-template-rows: 40px 1fr;
                }

                #bridge-ad-failure-popup-logo {
                    height: 40px;
                }

                #bridge-ad-failure-popup-close {
                    width: 40px;
                    height: 40px;
                }

                #bridge-ad-failure-popup-text {
                    font-size: ${platformId === PLATFORM_ID.OK ? '22px' : '25px'};
                    align-self: center;
                }
            }

            @media (orientation: landscape) {
                #bridge-ad-failure-popup {
                    gap: 40px;
                }

                #bridge-ad-failure-popup-text {
                    width: 60%;
                    align-self: start;
                }
            }

            @media (orientation: landscape) and (min-width: 800px) {
                #bridge-ad-failure-popup {
                    gap: 80px;
                }

                #bridge-ad-failure-popup-text {
                    width: 50%;
                    font-size: ${platformId === PLATFORM_ID.OK ? '28px' : '33px'};
                }
            }
        `
        document.head.appendChild(style)
    }

    let popup = document.getElementById('bridge-ad-failure-popup')
    if (!popup) {
        popup = document.createElement('div')
        popup.id = 'bridge-ad-failure-popup'

        const logo = document.createElement('div')
        logo.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 120 32" id="bridge-ad-failure-popup-logo">
                <rect width="120" height="32" fill="#fff" rx="16"/>
                <path fill="#682EB2" d="M12.378 23.772V9.844h5.356c2.957 0 5.356 2.39 5.356 5.339 0 2.948-2.398 5.34-5.356 5.34h-1.863v3.25zm5.007-10.678H15.87v4.178h1.514c1.257 0 2.096-.928 2.096-2.089 0-1.16-.839-2.09-2.096-2.09M28.267 20.522h-3.632V6.594h3.632zM40.518 20.522h-5.356c-2.958 0-5.357-2.39-5.357-5.339 0-2.948 2.4-5.34 5.357-5.34h5.356zm-5.007-3.25h1.514v-4.178H35.51c-1.258 0-2.096.928-2.096 2.089 0 1.16.838 2.09 2.096 2.09M47.465 26.094H42.62v-3.25h4.611c1.234 0 2.142-.906 2.142-2.136v-.186h-6.753V9.844h3.493v7.428h3.26V9.844h3.493V20.94c0 2.972-2.282 5.154-5.402 5.154M59.813 9.844h5.821V20.73c0 3.111-2.258 5.363-5.379 5.363h-4.634v-3.482h4.61c1.095 0 1.91-.813 1.91-1.904v-.186h-2.328c-2.958 0-5.357-2.39-5.357-5.339 0-2.948 2.399-5.34 5.356-5.34m-1.747 5.339c0 1.16.838 2.09 2.096 2.09h1.98v-4.18h-1.98c-1.258 0-2.096.93-2.096 2.09M77.834 20.522h-5.357c-2.957 0-5.356-2.39-5.356-5.339 0-2.948 2.399-5.34 5.356-5.34h5.356zm-5.007-3.25h1.513v-4.178h-1.513c-1.258 0-2.096.928-2.096 2.089 0 1.16.838 2.09 2.096 2.09M83.43 20.522h-3.493V9.844h10.829c2.631 0 4.773 2.136 4.773 4.759v5.92h-3.493V14.37a1.29 1.29 0 0 0-1.28-1.277h-1.281v7.428h-3.493v-7.428H83.43zM107.623 20.522h-5.356c-2.958 0-5.356-2.39-5.356-5.339 0-2.948 2.398-5.34 5.356-5.34h5.356zm-5.007-3.25h1.514v-4.178h-1.514c-1.257 0-2.096.928-2.096 2.089 0 1.16.839 2.09 2.096 2.09"/>
            </svg>
        `
        popup.appendChild(logo)

        const closeButton = document.createElement('button')
        closeButton.id = 'bridge-ad-failure-popup-close'
        closeButton.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
                <path fill="#682EB2" d="M17.886 7.886a1.252 1.252 0 0 0-1.77-1.77l-4.113 4.117L7.886 6.12a1.252 1.252 0 0 0-1.77 1.77l4.117 4.113L6.12 16.12a1.252 1.252 0 0 0 1.77 1.77l4.113-4.117 4.117 4.113a1.252 1.252 0 0 0 1.77-1.77l-4.117-4.113z"/>
            </svg>
        `
        popup.appendChild(closeButton)

        const text = document.createElement('p')
        text.id = 'bridge-ad-failure-popup-text'
        popup.appendChild(text)

        document.body.appendChild(popup)
    }

    const closeButton = document.getElementById('bridge-ad-failure-popup-close')

    return new Promise((resolve) => {
        const closePopup = () => {
            popup.style.display = 'none'
            resolve()
        }

        closeButton.onclick = closePopup
        popup.onclick = closePopup

        const messages = [
            'If you see this message, no Ad was returned for the Ad request.<br><br>Please ask the developer to check the Ad setup.',
            'This is placeholder for the Ad. Playgama helps games reach players worldwide.',
        ]
        const textElement = document.getElementById('bridge-ad-failure-popup-text')
        textElement.innerHTML = messages[Math.floor(Math.random() * messages.length)]

        popup.style.display = 'grid'
    })
}

export function createProgressLogo() {
    if (document.getElementById('cookie-splash')) {
        return
    }

    const style = document.createElement('style')
    style.id = 'cookie-splash-styles'
    style.textContent = `
        #cookie-splash {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: #050505; color: white; z-index: 999999;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
            transition: opacity 0.8s ease-in-out;
            user-select: none;
        }

        .cs-cookie-container {
            position: relative; width: 180px; height: 180px; margin-bottom: 24px;
            border-radius: 50%;
            animation: cs-float 3s ease-in-out infinite;
            filter: drop-shadow(0 20px 40px rgba(210,105,30,0.2));
        }

        @keyframes cs-float {
            0%, 100% { transform: translateY(0); filter: drop-shadow(0 20px 40px rgba(210,105,30,0.2)); }
            50% { transform: translateY(-8px); filter: drop-shadow(0 20px 60px rgba(210,105,30,0.35)); }
        }

        .cs-cookie-bg {
            position: absolute; inset: 0;
            background: #1A0F08; border-radius: 50%;
            box-shadow: inset 0 0 20px rgba(0,0,0,0.9);
            border: 3px dashed rgba(62,36,19,0.5);
            overflow: hidden;
            display: flex; align-items: flex-end; justify-content: center;
        }

        .cs-cookie-fill {
            position: absolute; bottom: 0; left: 0; right: 0;
            background: radial-gradient(circle at 30% 30%, #E6AB73, #D48E53, #A66332);
            height: 0%;
            overflow: hidden;
            transition: height 0.3s cubic-bezier(0.1, 0.7, 0.1, 1);
            border-top: 1px solid rgba(255,255,255,0.3);
            box-shadow: inset 0 -10px 20px rgba(0,0,0,0.3);
        }

        .cs-cookie-texture {
            position: absolute; inset: 0; opacity: 0.15;
            background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
            mix-blend-mode: multiply;
        }

        .cs-cookie-chips-wrapper {
            position: absolute; bottom: 0; left: 0; width: 180px; height: 180px;
        }

        .cs-chip {
            position: absolute;
            background: #2D1606;
            border-radius: 40% 60% 70% 30% / 40% 50% 60% 50%;
            box-shadow: inset -2px -2px 4px rgba(0,0,0,0.8), inset 1px 1px 3px rgba(255,255,255,0.15), 2px 2px 5px rgba(0,0,0,0.4);
        }

        .cs-chip:nth-child(1) { width: 22px; height: 18px; top: 18%; left: 22%; transform: rotate(15deg); }
        .cs-chip:nth-child(2) { width: 16px; height: 16px; top: 25%; left: 68%; transform: rotate(-35deg); border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%; }
        .cs-chip:nth-child(3) { width: 26px; height: 22px; top: 52%; left: 42%; transform: rotate(75deg); }
        .cs-chip:nth-child(4) { width: 18px; height: 20px; top: 48%; left: 12%; transform: rotate(-15deg); border-radius: 50%; }
        .cs-chip:nth-child(5) { width: 17px; height: 17px; top: 78%; left: 28%; transform: rotate(45deg); }
        .cs-chip:nth-child(6) { width: 24px; height: 20px; top: 68%; left: 68%; transform: rotate(-10deg); border-radius: 30% 70% 70% 30% / 30% 30% 70% 70%; }

        .cs-percent {
            font-size: 32px; font-weight: 900; font-style: italic; letter-spacing: -1px;
            color: #E6AB73; margin-top: 8px;
            text-shadow: 0 4px 10px rgba(210,105,30,0.2);
        }
    `
    document.head.appendChild(style)

    const overlay = document.createElement('div')
    overlay.id = 'cookie-splash'

    overlay.innerHTML = `
        <div class="cs-cookie-container">
            <div class="cs-cookie-bg">
                <div id="cs-fill" class="cs-cookie-fill">
                    <div class="cs-cookie-chips-wrapper">
                        <div class="cs-chip"></div>
                        <div class="cs-chip"></div>
                        <div class="cs-chip"></div>
                        <div class="cs-chip"></div>
                        <div class="cs-chip"></div>
                        <div class="cs-chip"></div>
                    </div>
                </div>
            </div>
        </div>
        <div id="cs-num" class="cs-percent">0%</div>
    `
    document.body.appendChild(overlay)
}

export const waitFor = function waitFor(...args) {
    if (args.length <= 0) {
        return Promise.resolve()
    }

    return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
            let parent = window

            for (let i = 0; i < args.length; i++) {
                const currentObject = parent[args[i]]
                if (!currentObject) {
                    return
                }

                parent = currentObject
            }

            resolve()
            clearInterval(checkInterval)
        }, 100)
    })
}

export const isBase64Image = function isBase64Image(str) {
    const base64ImageRegex = /^data:image\/(png|jpeg|jpg|gif|bmp|webp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/
    return base64ImageRegex.test(str)
}

export const getKeyOrNull = (obj, key) => (obj[key] === undefined ? null : obj[key])

export function getKeysFromObject(keys, data, tryParseJson = false) {
    if (Array.isArray(keys)) {
        return keys.reduce((res, key, i) => {
            res[i] = getKeyOrNull(data, key)
            if (tryParseJson) {
                try {
                    res[i] = JSON.parse(res[i])
                } catch (e) {
                    // keep value as is
                }
            }
            return res
        }, new Array(keys.length))
    }

    let value = getKeyOrNull(data, keys)
    if (tryParseJson && typeof value === 'string') {
        try {
            value = JSON.parse(value)
        } catch (e) {
            // keep value as is
        }
    }
    return value
}

export function deepMerge(firstObject, secondObject) {
    const result = { ...firstObject }
    const keys = Object.keys(secondObject)

    for (let i = 0; i < keys.length; i++) {
        const key = keys[i]
        if (
            key in firstObject
            && secondObject[key] instanceof Object
            && firstObject[key] instanceof Object
        ) {
            result[key] = deepMerge(firstObject[key], secondObject[key])
        } else {
            result[key] = secondObject[key]
        }
    }

    return result
}

export function deformatPrice(priceStr) {
    const cleaned = priceStr.replace(/[^\d.,-]/g, '')

    if (cleaned.includes('.') && cleaned.includes(',') && cleaned.indexOf(',') < cleaned.indexOf('.')) {
        return parseFloat(cleaned.replace(/,/g, ''))
    }

    if (cleaned.includes('.') && cleaned.includes(',') && cleaned.indexOf(',') > cleaned.indexOf('.')) {
        return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'))
    }

    if (cleaned.includes(',')
        && cleaned.lastIndexOf(',') !== -1
        && cleaned.lastIndexOf(',') === cleaned.length - 4) {
        return parseInt(cleaned.replace(/,/, ''), 10)
    }

    if (cleaned.includes(',')
        && cleaned.lastIndexOf(',') !== -1
        && cleaned.lastIndexOf(',') !== cleaned.length - 3) {
        return parseFloat(cleaned.replace(',', '.'))
    }

    if (cleaned.includes('.')
        && cleaned.lastIndexOf('.') !== -1
        && cleaned.lastIndexOf('.') === cleaned.length - 4) {
        return parseInt(cleaned.replace(/\./, ''), 10)
    }

    if (cleaned.includes('.')) {
        return parseFloat(cleaned)
    }

    return parseInt(cleaned, 10)
}

export function generateRandomId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    const randomPart = Array.from({ length: 8 }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('')
    const timestampPart = Date.now().toString(36)
    return `${randomPart}${timestampPart}`
}

export function getGuestUser() {
    const localStorageKey = 'bridge_player_guest_id'
    let id

    try {
        id = localStorage.getItem(localStorageKey)
    } catch (_) {
        // ignore
    }

    if (!id) {
        id = generateRandomId()

        try {
            localStorage.setItem(localStorageKey, id)
        } catch (_) {
            // ignore
        }
    }

    return {
        id,
        name: `Guest ${id}`,
    }
}

export function postToParent(message, targetOrigin = '*') {
    if (window.parent) {
        window.parent[POST_METHOD](message, targetOrigin)
    }
}

export function postToSystem(message) {
    if (window.system) {
        window.system[POST_METHOD](message)
    }
}

export function postToWebView(message) {
    if (window.chrome && window.chrome.webview && typeof window.chrome.webview.postMessage === 'function') {
        window.chrome.webview[POST_METHOD](message)
    }
}

export function getSafeArea() {
    const div = document.createElement('div')
    div.style.cssText = 'position:fixed;top:env(safe-area-inset-top);bottom:env(safe-area-inset-bottom);left:env(safe-area-inset-left);right:env(safe-area-inset-right);pointer-events:none;visibility:hidden;'
    document.body.appendChild(div)

    const rect = div.getBoundingClientRect()
    const result = {
        top: rect.top,
        bottom: window.innerHeight - rect.bottom,
        left: rect.left,
        right: window.innerWidth - rect.right,
    }

    div.remove()
    return result
}

export function applySafeAreaStyles() {
    const style = document.createElement('style')
    style.id = 'bridge-safe-area-styles'
    style.textContent = `
        html, body {
            height: calc(100% - env(safe-area-inset-top) - env(safe-area-inset-bottom));
            padding-top: env(safe-area-inset-top);
            padding-bottom: env(safe-area-inset-bottom);
            box-sizing: border-box;
        }
    `
    document.head.appendChild(style)
}
