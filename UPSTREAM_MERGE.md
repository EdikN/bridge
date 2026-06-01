# Upgrading Over Upstream (Merge Skill)

When updating the bridge library from the official upstream (`Playgama/bridge`), strictly adhere to the
following steps to preserve our custom features.

> **Last synced:** upstream **v1.31.0** (merge-base `cd421e8`).
>
> ⚠️ **Source of truth is the git diff, not this document.** This file is a checklist, but it can fall
> behind the actual fork. Before resolving conflicts, always derive the real intent from:
> - `git diff <merge-base> main -- <file>` — what the fork changed
> - `git diff <merge-base> upstream/main -- <file>` — what upstream changed
>
> Find the previous merge-base with `git merge-base main upstream/main`.

## 1. Fetch & Merge Upstream
```bash
git fetch upstream
git show upstream/main:package.json   # confirm the new version
git switch -c update/upstream-<version>   # merge into a branch, keep main untouched
git merge upstream/main --no-ff
```

## 2. Conflict Resolution Rules

### Build lynchpin — `src/platformImports.js`
`scripts/platforms.js` auto-generates the `__INCLUDE_*__` webpack defines by scanning this file.
When merging, **keep the union of all `__INCLUDE_*__` blocks** — ours (`GAME_MONETIZE`, `ANDROID`) plus
any new upstream ones (e.g. `SAMSUNG`, `STANDALONE`). Dropping an entry silently disables that platform's build flag.

### `src/constants.js`
- `PLATFORM_ID`: keep the **union** of both enums — ours (`OK_VK`, `GAME_MONETIZE`, `ANDROID`) and upstream's new IDs.
- Keep `ACTION_NAME.VIBRATE` (ours) and take upstream additions (`MODULE_NAME.CROSS_PROMO`, `LAUNCH_SOURCE`, …).
- **Take upstream's URL values** (`SAAS_URL` / `TIMESTAMP_URL` → `api.playgama.com`).

### `src/common/utils.js`
**DO NOT** replace our `customLoader` with the default Playgama SVG logo.
- Keep `import customLoader from './CustomLoader'`.
- Keep `createProgressLogo()` as:
  ```javascript
  export function createProgressLogo() {
      customLoader.init()
  }
  ```
- Upstream additions here are usually additive (new helpers, error handling) — take them.

### `src/platform-bridges/PlatformBridgeBase.js`
Preserve our additions while taking upstream changes:
- Vibration API: `get isVibrationSupported()` and `vibrate()`.
- `OK_VK` option merge: when `platformId === PLATFORM_ID.OK`, merge in `getPlatformOptions(PLATFORM_ID.OK_VK)`.
- `showAdFailurePopup(this.platformId)` — we pass the platform id.

### `src/PlaygamaBridge.js` — detection logic
Keep our detection branches when merging the `if/else if` chain:
- `OK` / `OK_VK` (`vk_client=ok`, `vk_ok_app_id`, `platform_id=ok-vk`)
- `GAME_MONETIZE` (gamemonetize.com / gamemonetize.co / distributegames.com)
- `ANDROID` (`window.Capacitor?.isNativePlatform?.()`)
- the `console.info` "Platform detected" banner
…and also add any new upstream branches (e.g. `SAMSUNG`).

### `src/modules/ConfigFileModule.js`
Keep our fallback in `getPlatformOptions`: `this.options.platforms?.[platformId] ?? this.options[platformId]`.

### `webpack.config.js`
Keep our `CopyToUnityTemplatePlugin` (and its registration in `plugins`) while taking upstream's
`CDN_BASE_URL` / `publicPath` / dev-mode (`argv`) changes.

### `package.json`
Take upstream's `version` and `devDependencies`, but keep our scripts
(`android:setup` / `android:build` / `android:install`, `build:deploy`, `build:platform`) and `dependencies`.

### Custom platforms & files — never remove or overwrite
- **VK** (`VkPlatformBridge`, payment catalog hooks)
- **OK** (`OkPlatformBridge`, payments disabled) and the **OK_VK** variant
- **GameMonetize** (`GameMonetizePlatformBridge`)
- **Android** (`AndroidPlatformBridge`, `scripts/android-setup.js`, Capacitor setup)
- `src/common/CustomLoader.js`, `UnityTemplate/`, `scripts/deploy.js`, `bridge-deploy.config.json`

## 3. Post-Merge QA
1. **Install dependencies**: `npm install` (in case `package.json` changed).
2. **Fix line endings / style**: `npm run lint:fix` (solves standard CRLF/LF issues pushed by upstream).
3. **Verify**: `npm test` and `npm run build` must pass before committing.
4. Sanity-check the inventory survived the merge (`OK_VK`, `GAME_MONETIZE`, `ANDROID`, vibration,
   `CustomLoader`, `CopyToUnityTemplatePlugin`) and that `VkPlatformBridge` / `OkPlatformBridge` did not
   revert to upstream (`git diff main update/upstream-<version> -- <file>`).
