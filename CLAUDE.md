# Project: Playgama Bridge (fork, v2 / TypeScript)

Playgama Bridge is a unified cross-platform SDK for publishing HTML5 games to many gaming platforms. It provides a single API interface that abstracts platform-specific differences, enabling developers to integrate their games once and deploy across multiple platforms (Playgama, Crazy Games, Facebook, Telegram, Discord, Poki, etc.).

This is EdikN's fork of `Playgama/bridge`, synced with upstream v2 (full TypeScript rewrite). Fork-only features are listed below — never remove them when merging upstream (see `UPSTREAM_MERGE.md`).

## Git remotes: push to EdikN/bridge only

This repository is **EdikN's fork**. Every push, branch, PR, issue and release goes to
**`EdikN/bridge`** (remote `origin`). **Never** push to, or open PRs/issues against,
**`Playgama/bridge`** (remote `upstream`) — it is someone else's public repository, and
anything opened there is visible to Playgama.

- `upstream` is read-only for us: only `git fetch upstream` when syncing (see `UPSTREAM_MERGE.md`).
- Push with an explicit remote: `git push origin <branch>`.
- **`gh` defaults to the parent repo of a fork**, i.e. `Playgama/bridge`. Always pass
  `-R EdikN/bridge` (`gh pr create -R EdikN/bridge --base main ...`, `gh pr merge -R EdikN/bridge ...`,
  `gh release ... -R EdikN/bridge`), or run `gh repo set-default EdikN/bridge` once in the clone.
- PRs target `main` of `EdikN/bridge`. A PR that was opened against `Playgama/bridge` by
  mistake must be closed immediately and reported to the user (it happened once: #253).

## Build Commands

```bash
npm run build          # Production build (bundled - single file)
npm run build:dynamic  # Production build with code splitting (separate chunk per platform)
npm run build:package  # Fork-only: npm package (script bundle + ESM/UMD + d.ts) for release
npm run dev            # Dev server on port 3535
npm run develop        # Development build (non-minified)
npm run lint           # Check code style (ESLint over .ts)
npm run lint:fix       # Auto-fix linting issues (also fixes CRLF/LF)
npm test               # Run tests once (vitest)
npm run test:watch     # Run tests in watch mode
npx vitest tests/path/to/test.spec.ts  # Run single test file
```

Builds also mirror `dist/` into `UnityTemplate/` (fork-only `CopyToUnityTemplatePlugin` in `webpack.config.ts`).

Local projects listed in `bridge-deploy.config.json` get the bridge two ways:
- `npm run build:deploy` — copies the current local dynamic build (manual, for testing unreleased changes);
- `npm run sync:release` (`scripts/sync-release.js`) — downloads `playgama-bridge.js` from the latest GitHub release and copies it into every project still on an older release. State lives in `.deploy-state.json`, log in `.deploy-sync.log` (both gitignored). `npm run sync:release:task` registers a Windows scheduled task running it at logon and every 30 minutes, so a new release reaches all projects without manual steps.

## Architecture (v2)

### Initialization Flow

`src/index.ts` → creates `PlaygamaBridge` → `initialize()`:
1. Loads config from `playgama-bridge-config.json` via `src/lib/bridge-config` (`BridgeConfig`)
2. Detects platform via `src/platformDetectors.ts` (ordered detector list, first match wins)
3. Dynamically imports platform bridge via `src/platformImports.ts`
4. Registers feature modules (`src/modules/*/`) with the platform bridge
5. Calls `platformBridge.initialize()`

### Key Components

- **PlaygamaBridge** (`src/PlaygamaBridge.ts`) - Main class, exposed as `window.bridge`
- **PlatformBridgeBase** (`src/platform-bridges/PlatformBridgeBase.ts`) - Base class for all platform implementations
- **Modules** (`src/modules/<feature>/`) - one directory per feature (advertisement, storage, social, payments, leaderboards, achievements, tasks, daily-rewards, cross-promo, ...)
- **Constants** (`src/constants/`) - ACTION_NAME, EVENT_NAME, ERROR/ERROR_CODE, MODULE_NAME; PLATFORM_ID lives in `src/modules/platform/constants.ts`
- **Loading screen** (`src/lib/loading-screen/`) - fork replaces the stock logo screen with the custom "cookie splash" loader

### Platform Detection Priority

1. `forciblySetPlatformId` in config
2. `platform_id` URL parameter (`ok-vk` is normalized to `ok`)
3. Detector list in `platformDetectors.ts` (hostname/params/globals)
4. Falls back to `PLATFORM_ID.MOCK`

## Fork-only features (must survive upstream merges)

- **GameMonetize** (`GameMonetizePlatformBridge.ts`) — reward granted only on ad COMPLETE; launch interstitial 500ms after `AD_SDK_MANAGER_READY`
- **GamesWeb** (`GamesWebPlatformBridge.ts` + `src/platform-bridges/gamesweb/GwHostClient.ts`) — portal `choclategames.ru`, GamesWeb Host Protocol v1 over `window.GWHost` or its own postMessage transport (trusted `gw_origin` only), offline mode outside the portal; detector `gw=1` / `window.GWHost` goes first; platform storage is on whenever the host answers (guests too). See `docs/gamesweb.md`
- **Android** (`AndroidPlatformBridge.ts`) — Capacitor + YandexMobileAds plugin (interstitial/rewarded/banner)
- **VK customizations** (`VkPlatformBridge.ts`) — real auth check via `VKWebAppGetAuthToken`, storage retry-after-reauth, payments via `VKWebAppShowOrderBox` + external catalog (`storage.choclategames.ru`), joinCommunity from config without `window.open`, `initialInterstitialDelay = 30`
- **OK via VK Bridge** (`OkPlatformBridge.ts` extends `VkPlatformBridge`) — `ok-vk` launch params, OK catalog, share with `ok.ru/game/<id>` fallback link, no leaderboards
- **CustomLoader** — cookie-splash loading screen in `src/lib/loading-screen/LoadingScreen.ts`
- **Config fallbacks** (`BridgeConfig.initialize`) — top-level `<platformId>` block fallback + `ok-vk` overrides merged for OK
- **Ad failure popup** OK styling (`src/modules/advertisement/dom.ts`)
- **Interstitial interval** — `DEFAULT_MINIMUM_DELAY_BETWEEN_INTERSTITIAL = 80` seconds (upstream: 60)
- **Detection log** — `console.info('[Bridge] Platform detected: ...')` in `PlaygamaBridge.ts`
- **npm package** — the fork is consumable as `@playgama/bridge` from a GitHub Release tarball:
  `src/npm.ts` / `src/publicConstants.ts` / `src/global.ts`,
  `tsconfig.types.json`, webpack `--env npm`, `.github/workflows/npm-release.yml`.
  `PLUGIN_NAME` stays `'playgama-bridge'` even though the package is scoped — it is what
  Yandex records as the plugin, not a packaging detail. See `docs/npm-package.md`
- **Typed module getters** — `bridge.storage`, `bridge.advertisement` and friends return their
  module type instead of `unknown` (`src/PlaygamaBridge.ts`)
- **UnityTemplate/**, `scripts/android-setup.js`, `scripts/deploy.js`, `bridge-deploy.config.json`, fork docs in `docs/`

## Code Conventions

- 4-space indentation, single quotes, no semicolons (ESLint enforced), LF line endings
- Max line length: 120 characters
- Protected properties: `_name`; private properties/methods: `#name`
- TypeScript: `as const` enums with derived types (`type PlatformId = typeof PLATFORM_ID[...]`)

## Adding a New Platform

1. Create `src/platform-bridges/NewPlatformBridge.ts` extending `PlatformBridgeBase`
2. Override `get platformId()` returning value from `PLATFORM_ID`
3. Add platform ID to `PLATFORM_ID` in `src/modules/platform/constants.ts`
4. Add import mapping in `src/platformImports.ts` (with `__INCLUDE_<NAME>__` flag) and declare the flag in `src/globals.d.ts`
5. Add a detector in `src/platformDetectors.ts` if the platform is auto-detectable
