# Upgrading Over Upstream (Merge Skill)

> **Status:** synced with upstream **v2.4.0** on 2026-11-05 (previous sync: v2.3.1 on 2026-10-08).
> The codebase is now TypeScript; all custom features below live in `.ts` files.

When updating the bridge library from the official upstream (`Playgama/bridge`), strictly adhere to the following steps to preserve our custom features:

## 1. Fetch & Merge Upstream
```bash
git fetch upstream
git merge upstream/main --no-ff
```

## 2. Conflict Resolution Rules

### Loading screen (`src/lib/loading-screen/`)
Since v2.4.0 upstream split the loading screen into views, and the fork rides on it:
`LoadingScreen.ts` is upstream-identical (controller: progress, fallback, hide gate)
**except** `show()` also maps the fork's `COOKIE` type to `CookieSplashView.ts`
(`logo`/`ring` render the stock upstream views). Fork additions in `constants.ts`:
`LOADING_SCREEN_TYPE.COOKIE` and `LOADING_SCREEN_COOKIE_DEFAULT_PLATFORMS`
(`yandex`, `vk`, `ok`, `gamesweb`, `pikabu_games`, `android`) — `PlaygamaBridge.ts`
resolves an unset `loadingScreenType` to `COOKIE` on those platforms, else upstream's
`logo`/legacy `none`. On conflict, take upstream's version of `LoadingScreen.ts`
wholesale and redo only the cookie branch; keep the two fork exports in
`constants.ts`. When upstream adds a method to its LoadingScreen/Views, apply it
here too: `PlaygamaBridge.ts` calls it unconditionally.

### Custom Platforms
Never remove or overwrite our exclusive integrations:
- **VK** (`VkPlatformBridge.ts`: `VKWebAppGetAuthToken` auth, storage retry-after-reauth, payments + external catalog `storage.choclategames.ru`, joinCommunity from config, `initialInterstitialDelay = 30`)
- **OK** (`OkPlatformBridge.ts` **extends VkPlatformBridge** — OK runs through VK Bridge; `ok-vk` params, no leaderboards, OK share fallback link)
- **GameMonetize** (`GameMonetizePlatformBridge.ts`, reward only on ad COMPLETE, launch interstitial after `AD_SDK_MANAGER_READY` + 500ms)
- **Android** (`AndroidPlatformBridge.ts`, Capacitor + YandexMobileAds)
- **GamesWeb** (`GamesWebPlatformBridge.ts` + `src/platform-bridges/gamesweb/GwHostClient.ts`, GamesWeb Host Protocol v1, `docs/gamesweb.md`; tests `tests/src/platform-bridges/gamesWebPlatformBridge.spec.ts`). Since v2.4.0 the base constructor calls `_setVisibilityState()` during `super()`, so GamesWeb's override must not touch private members there — online state is the protected `_isOnline` field (declared before `#client`).
- **Pikabu Games** (`PikabuGamesPlatformBridge.ts`, `PkbSDK` of `games.pikabu.ru`, `docs/pikabu-games.md`)

### Detection Logic
Ensure `src/platformDetectors.ts` retains:
- GamesWeb detector (`gw=1` / `window.GWHost`) **first** in the list
- OK detector (`vk_client=ok` / `vk_ok_app_id`) **before** the VK detector
- GameMonetize detector (gamemonetize.com/.co, distributegames.com)
- Pikabu Games detector (`pikabu=true` / `_platform-key=pikabu` / `games.pikabu.ru` in referrer or `ancestorOrigins`)
- Android detector (`window.Capacitor.isNativePlatform()`)
- `ok-vk` → `ok` normalization in `normalizePlatformId`

And `src/modules/platform/constants.ts` retains `OK_VK`, `GAME_MONETIZE`, `ANDROID`, `GAMESWEB`, `PIKABU_GAMES` in `PLATFORM_ID`,
`src/platformImports.ts` retains the GameMonetize/Android/GamesWeb/Pikabu Games imports, and `src/globals.d.ts` the
`__INCLUDE_GAME_MONETIZE__` / `__INCLUDE_ANDROID__` / `__INCLUDE_GAMESWEB__` / `__INCLUDE_PIKABU_GAMES__` flags and the `window.GWHost` type.

### Other fork points
- **Analytics module (`src/modules/analytics/`)** — two platform channels since v2.4.0:
  the fork's `sendPlatformAnalyticsEvent` + `setPlatformAnalyticsUserProperties`
  (Android AppMetrica, always on — not gated by `sendAnalyticsEvents`) and upstream's
  `sendAnalyticsEvent` (e.g. Y8, gated on the config switch). Keep both call sites
  and both contract entries in `types.ts`.

- `src/modules/advertisement/constants.ts` — `DEFAULT_MINIMUM_DELAY_BETWEEN_INTERSTITIAL = 80` (upstream: 60). Upstream's ad-frequency tests (`tests/src/platform-bridges/playgamaAdFrequency.spec.ts`) must stay value-agnostic: advance `DEFAULT_MINIMUM_DELAY_BETWEEN_INTERSTITIAL * 1000`, not a hardcoded `60_000`.
- `src/lib/bridge-config/BridgeConfig.ts` — top-level `<platformId>` config fallback + `ok-vk` merge for OK
- `src/modules/advertisement/dom.ts` — `showAdFailurePopup(platformId)` OK styling
- `src/PlaygamaBridge.ts` — `[Bridge] Platform detected` console.info
- `webpack.config.ts` — `CopyToUnityTemplatePlugin` (dist → UnityTemplate/)
- **npm package** — since the 2.1.0 sync `src/npm.ts`, `src/publicConstants.ts`, `src/global.ts`,
  `tsconfig.types.json` and the `--env npm` webpack configs are **upstream's** (take theirs on
  conflict). The fork keeps on top: `version` `<upstream>-fork.N`, the fork's `description` /
  `repository` / `bugs` / `homepage`, `build:package` that also runs `npm run build`
  (the release tarball ships `dist/playgama-bridge.js`), `build:deploy`, and in
  `webpack.config.ts` the npm bundles are built without `CopyToUnityTemplatePlugin`.
  `src/constantsEntry.ts` was removed (upstream uses `src/publicConstants.ts` as the entry).
  See `docs/npm-package.md`.
- **Release workflows** — upstream's `.github/workflows/release.yml` is deleted in the fork:
  `npm-release.yml` attaches both the npm tarball and `dist/playgama-bridge.js` to the release.
  Delete `release.yml` again if a merge brings it back.
- **Vite plugin** (`vite/index.cjs`, since 2.3.0) — default `mode` is `'local'` in the fork
  (upstream: `'cdn'`). The CDN serves upstream's runtime without the fork's platforms, so the
  game must get `dist/playgama-bridge.js` from the fork's tarball. Since 2.3.0 the npm entry
  (`src/npm.ts`) is a shim over `window.bridge` and no longer bundles the runtime.
- `src/PlaygamaBridge.ts` — module getters return their module type (`typeof storageModule`),
  not `unknown`. Without it the npm package cannot be used from TypeScript at all.

## 3. Post-Merge QA
1. **Install dependencies**: `npm install` (in case `package.json` changed).
2. **Fix line endings**: `npm run lint:fix` (solves standard CRLF/LF issues pushed by upstream).
3. **Verify**: Run `npm test` and `npm run build` to ensure tests pass and the bundle builds successfully before committing.
