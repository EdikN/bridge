class CustomLoader {
    #isInitialized = false

    init() {
        if (this.#isInitialized || document.getElementById('cookie-splash')) {
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
        this.#isInitialized = true
    }

    setProgress(percent) {
        const progress = Math.max(0, Math.min(100, percent))
        const fill = document.getElementById('cs-fill')
        const num = document.getElementById('cs-num')

        if (fill) {
            fill.style.height = `${progress}%`
            fill.style.borderTop = progress > 0 ? '1px solid rgba(255,255,255,0.4)' : 'none'
        }

        if (num) {
            num.textContent = `${Math.round(progress)}%`
        }

        if (progress === 100) {
            this.hide()
        }
    }

    hide() {
        const loadingOverlay = document.getElementById('cookie-splash')
        if (loadingOverlay) {
            setTimeout(() => {
                loadingOverlay.style.opacity = '0'
                setTimeout(() => loadingOverlay.remove(), 850)
            }, 500)
        }
    }
}

export default new CustomLoader()
