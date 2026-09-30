# Project: Playgama Bridge

Playgama Bridge is a unified cross-platform SDK for publishing HTML5 games to many gaming platforms. It provides a single API interface that abstracts platform-specific differences, enabling developers to integrate their games once and deploy across multiple platforms (Playgama, Crazy Games, Facebook, Telegram, Discord, Poki, etc.).

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

## Fork-only features

- **GamesWeb** (`GamesWebPlatformBridge.ts` + `src/platform-bridges/gamesweb/GwHostClient.ts`) — portal `choclategames.ru`, GamesWeb Host Protocol v1 over `window.GWHost` or its own postMessage transport (trusted `gw_origin` only), offline mode outside the portal; detector `gw=1` / `window.GWHost` goes first; platform storage is on whenever the host answers (guests too). See `docs/gamesweb.md`

The full list of fork-only features is in `CLAUDE.md` and `UPSTREAM_MERGE.md`.

## Build Commands

```bash
npm run build          # Production build (bundled - single file)
npm run build:dynamic  # Production build with code splitting (separate chunk per platform)
npm run dev            # Dev server on port 3535
npm run develop        # Development build (non-minified)
npm run lint           # Check code style
npm run lint:fix       # Auto-fix linting issues
npm test               # Run tests once
npm run test:watch     # Run tests in watch mode
npx vitest tests/path/to/test.spec.ts  # Run single test file
```

## Architecture

### Initialization Flow

`src/index.js` → creates `PlaygamaBridge` → `initialize()`:
1. Loads config from `playgama-bridge-config.json` via `ConfigFileModule`
2. Detects platform via URL patterns/parameters (lines 266-307 in `PlaygamaBridge.js`)
3. Dynamically imports platform bridge via `platformImports.js`
4. Creates all feature modules with platform bridge reference
5. Calls `platformBridge.initialize()`

### Key Components

- **PlaygamaBridge** (`src/PlaygamaBridge.js`) - Main class, exposed as `window.bridge`
- **PlatformBridgeBase** (`src/platform-bridges/PlatformBridgeBase.js`) - Base class for all platform implementations
- **ModuleBase** (`src/modules/ModuleBase.js`) - Base class for feature modules
- **ConfigFileModule** - Singleton that loads/parses `playgama-bridge-config.json`
- **constants.js** - All enums (`PLATFORM_ID`, `EVENT_NAME`, `INTERSTITIAL_STATE`, etc.)

### Configuration Reference

See `docs/playgama-bridge-config.md` for complete configuration options including:
- Advertisement settings (interstitial, rewarded, banner)
- Game and device configuration
- Leaderboards and payments mappings
- SaaS configuration
- Platform-specific options (Yandex, VK, CrazyGames, Discord, Telegram, TikTok, etc.)

### Design Patterns

**Bridge Pattern**: Each platform extends `PlatformBridgeBase`, overriding getters like `platformId`, `isPaymentsSupported`, and methods like `showInterstitial()`.

**Event Mixin**: Both `PlatformBridgeBase` and modules use `EventLite.mixin(Class.prototype)` for event emission/subscription.

**State Aggregation**: `StateAggregator` in `PlatformBridgeBase` combines multiple pause/audio sources (interstitial, rewarded, visibility, platform) into single `PAUSE_STATE_CHANGED`/`AUDIO_STATE_CHANGED` events.

**Dynamic Imports**: `platformImports.js` maps `PLATFORM_ID` to lazy imports, enabling Webpack code splitting.

**SaaS Modules**: Some features (e.g., leaderboards) can use Playgama SaaS backend instead of native platform APIs. Check `#isSaas()` in `PlaygamaBridge.js`.

### Platform Detection Priority

1. `forciblySetPlatformId` in config
2. `platform_id` URL parameter
3. URL hostname/hash patterns (crazygames., tgWebAppData, etc.)
4. Global object detection (`window.TTMinis` for TikTok)
5. Falls back to `PLATFORM_ID.MOCK`

## Code Conventions

- 4-space indentation
- Single quotes for strings
- No semicolons (ESLint enforced)
- Max line length: 120 characters
- Protected properties: `_name`
- Private properties: `#name`
- Class member order: getters → protected props → private props → constructor → public methods → protected methods → private methods

## Adding a New Platform

1. Create `src/platform-bridges/NewPlatformBridge.js` extending `PlatformBridgeBase`
2. Override `get platformId()` returning value from `PLATFORM_ID`
3. Add platform ID to `PLATFORM_ID` enum in `constants.js`
4. Add import mapping in `platformImports.js`
5. Add detection logic in `PlaygamaBridge.js#createPlatformBridge()`

## Deploy Build

Run `npm run build:deploy` to build in dynamic mode and copy the output to all configured targets.

Targets are listed in `bridge-deploy.config.json` at the project root:

```json
{
    "targets": [
        { "path": "/absolute/path/to/game/public", "description": "my-game" }
    ]
}
```

- Copies `dist/playgama-bridge.js` and `dist/platform-bridges/` to each target's `path`.
- If a path does not exist on disk the target is skipped (`[SKIP]` in output).
- Add new targets directly to `bridge-deploy.config.json`; no code changes needed.