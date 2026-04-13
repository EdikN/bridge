# Upgrading Over Upstream (Merge Skill)

When updating the bridge library from the official upstream (`Playgama/bridge`), strictly adhere to the following steps to preserve our custom features:

## 1. Fetch & Merge Upstream
```bash
git fetch upstream
git merge upstream/main --no-ff
```

## 2. Conflict Resolution Rules

### `src/common/utils.js`
**DO NOT** replace our `customLoader` with the default Playgama SVG logo. 
- Ensure `createProgressLogo` remains as:
  ```javascript
  export function createProgressLogo() { 
      customLoader.init() 
  }
  ```
- Ensure `import customLoader from './CustomLoader'` is preserved.

### Custom Platforms
Never remove or overwrite our exclusive integrations:
- **VK** (`VkPlatformBridge`, specific payment catalog hooks)
- **OK** (`OkPlatformBridge`, disabled payments constraint)
- **GameMonetize** (`GameMonetizePlatformBridge`, added explicitly by us)

### Detection Logic
Ensure detection logic in `src/PlaygamaBridge.js` retains:
- `PLATFORM_ID.OK`
- `PLATFORM_ID.VK`
- `PLATFORM_ID.GAME_MONETIZE`

## 3. Post-Merge QA
1. **Install dependencies**: `npm install` (in case `package.json` changed).
2. **Fix line endings**: `npm run lint:fix` (solves standard CRLF/LF issues pushed by upstream).
3. **Verify**: Run `npm test` and `npm run build` to ensure tests pass and the bundle builds successfully before committing.
