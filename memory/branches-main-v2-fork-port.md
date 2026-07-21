---
name: branches-main-v2-fork-port
description: Состояние веток main/upgrade-v2/update/upstream-1.31 и что нужно портировать из форка на v2
metadata:
  type: project
---

Ветки (форк EdikN/bridge от Playgama/bridge):
- `main` переведён на `origin/upgrade-v2` (fast-forward, 2026-07-21). Старый main сохранён в теге `backup/main-before-v2` (был `499d167`). Не запушено.
- `upgrade-v2` = upstream v2.0.1, полный **TypeScript**-рерайт (`.js → .ts`). Это новая база.
- `update/upstream-1.31` = старая **JS**-база форка (upstream v1.31 + кастомизации). Её upstream-содержимое перекрыто более новым v2.

Порт форка на v2 (`53cb9cf`) делался с состояния форка ДО коммитов Fix1/Fix2/«1», поэтому в v2 НЕ хватает:
- VK community membership: кэш `#communityMembership`, `_prefetchCommunityMembership()`, переписанный `joinCommunity` (синхронное открытие для уже-членов), `isMemberOfCommunity`, `_resolveCommunityGroupId`, `_getCommunityUrl`, `_openCommunityPage` (Fix1+Fix2, коммиты 4523297/57a77ed).
- OK: `paymentsPurchase` через `VKWebAppShowOrderBox` (коммит c4106ab), дефолтный groupId 70000048656390, `_getCommunityUrl` → ok.ru/group.
- Social passthrough `isMemberOfCommunity` в SocialModule + base reject.
- Вибрация (`isVibrationSupported`/`vibrate()`, `ACTION_NAME.VIBRATE`) — но в 1.31 она НЕ выведена в публичный API (ни один модуль её не вызывает), полу-заготовка.
- webpack: dynamic `publicPath: 'auto'` (коммит a868531). `bridge-deploy.config.json` — личные локальные пути, в репо не нужны.

Файлы v2 для правки: src/platform-bridges/VkPlatformBridge.ts, OkPlatformBridge.ts, PlatformBridgeBase.ts; src/modules/social/SocialModule.ts; src/constants/actionName.ts; webpack.config.ts.

Порт закоммичен пользователем как `ef58677 Fork-Port`.

Деплой в локальные игры (кастомизация форка): `bridge-deploy.config.json` (targets с путями) + `scripts/deploy.js` копирует `dist/playgama-bridge.js` и `dist/platform-bridges/` в каждую папку. Команда `npm run build:deploy` = `build:dynamic && node scripts/deploy.js` — восстановлена в package.json (терялась при миграции на v2). Использовать ИМЕННО её, а не `npm run build` (bundled — один файл, без чанков и без копирования). Скилл /add-bridge-target добавляет папки в этот конфиг. Caveat: deploy.js не чистит устаревшие файлы в target (напр. absolutegames/bitquest из v1 остаются).

CRLF/сборка: добавлен `.gitattributes` (`* text=auto eol=lf`) + `core.autocrlf false` — иначе Windows-checkout ломает eslint `linebreak-style` на всех файлах.
