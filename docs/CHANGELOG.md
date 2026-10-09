# Changelog

## [Unreleased]

### Добавлено
- **Android:** локальные уведомления (`bridge.notifications`). Тексты (можно по языкам), картинка,
  иконка и канал задаются в конфиге (`notifications[]`, `notificationSettings`); записи с
  `"auto": true` ставятся при каждом запуске, `schedule({ id })` берёт недостающие поля из конфига,
  `payload` уведомления приходит в `bridge.platform.payload`. Нативная часть есть в плагине
  `capacitor-plugin-yandex-mobile-ads`, а в старую версию плагина её встраивает `android-setup.js`.
  См. `docs/android-setup.md`.

## [2.2.0-fork.2] - 2026-09-30

### Добавлено
- **GamesWeb Platform:** новая платформа `gamesweb` — портал GamesWeb (`choclategames.ru`) по
  GamesWeb Host Protocol v1 (`docs/gamesweb.md`).
  - Работает через внедрённый порталом рантайм `window.GWHost`, а без него — по собственному
    postMessage-транспорту с проверкой `gw_origin` / `event.source` / `event.origin` и таймаутами.
  - Вне портала (нет `gw=1`/доверенного `gw_origin`, hello не ответил за 5 с) — офлайн-режим:
    localStorage, реклама `failed`, лидерборды недоступны, гость. Инициализация никогда не висит.
  - Хранилище хоста (для гостей и авторизованных), interstitial / rewarded / banner, авторизация,
    лидерборды `in_game`, share / invite / rate / favorites / community, remote config, серверное
    время хоста, пауза и звук от хоста.
  - Автоопределение по `gw=1` или `window.GWHost`; `platform_id` в URL по-прежнему приоритетнее.

### Исправлено
- **GamesWeb:** повторный показ interstitial / rewarded, пока предыдущий ещё в полёте, больше не
  сбрасывает его: второй вызов получает `failed` (без попапа), первый досылает свои
  `rewarded` / `closed` — награда не теряется, игра не снимается с паузы под рекламой.
- **GamesWeb:** совместимость сейвов с эмулятором Яндекса (GWHP §6a): нет `<key>` — читается
  `ya:<key>` (раскодируется как в `getData` эмулятора) и пересохраняется как `<key>`, `ya:` остаётся;
  удаление ключа удаляет и `ya:<key>`.
- **GamesWeb:** локальный фолбэк хранилища живёт под префиксом `gw:<slug>:` — игры портала делят
  один origin, и перенос «локальное → облако» больше не может забрать и удалить чужой ключ
  (например `save`). Новое необязательное поле контракта `localStorageKeyPrefix`; другие платформы
  его не задают, их поведение не изменилось.
- **GamesWeb:** `hello` переотправляется с тем же `id` каждые 500 мс до ответа или таймаута 5 с
  (хост мог повесить слушатель позже); `gw_origin` `http://localhost` / `http://127.0.0.1`
  принимается и без порта; не-строковые значения `storage.get` приводятся к JSON-строке.

## [Unreleased]

### Изменено
- **Синхронизация с upstream v2.1.0** (версия форка `2.1.0-fork.1`). Из upstream пришли: модуль
  `notifications`, loading sound (`loadingSound` в опциях инициализации), анонимные облачные
  сохранения Playgama, события daily rewards / tasks / cross-promo на глобальной шине, типы
  `LeaderboardEntry` / `CatalogProduct` / `Purchase` в npm-пакете, правки Samsung и MSN; платформа
  PlayDeck удалена upstream. Все форк-фичи (VK/OK через VK Bridge, cookie-splash загрузчик,
  Android, GameMonetize, интервал interstitial 80 с, конфиг-фолбэки) сохранены.
- **Загрузчик:** cookie-splash получил `setHideGate()` — при включённом loading sound экран держится
  на 100 % до конца звука (не дольше 3 с), как и стоковый загрузчик upstream.
- **npm-пакет:** сборка ESM/UMD/constants и d.ts теперь целиком upstream-овая; `src/constantsEntry.ts`
  удалён. Upstream-воркфлоу `release.yml` не используется — `npm-release.yml` кладёт в релиз и
  тарбол, и `dist/playgama-bridge.js`.

### Добавлено
- **Android Platform:** Новая платформа `android` для сборки APK-файлов HTML5-игр через Capacitor.
  - Автоматическое определение среды Capacitor (`window.Capacitor.isNativePlatform()`)
  - Интеграция с Yandex Mobile Ads через отдельный Capacitor-плагин `capacitor-plugin-yandex-mobile-ads`
  - Поддержка interstitial, rewarded и banner рекламы
  - Ad Unit ID настраиваются через `playgama-bridge-config.json`
- **capacitor-plugin-yandex-mobile-ads:** Новый Capacitor-плагин (Kotlin) для нативной рекламы Яндекса на Android.

## [1.30.0] - 2026-04-16

### Изменено
- **VK Platform:** Интегрирован API `choclategames.ru` в метод `paymentsGetCatalog()`. Теперь магазин в ВК автоматически запрашивает динамический список товаров для конкретной игры по `vk_app_id` / `api_id`, вместо использования статического конфига. При покупке идентификатор товара передается корректно.
- **Сборка:** Обновлены бандлы (папка `dist/`), так что в консоли при инициализации вновь отображается актуальная версия SDK (1.30.0, а не 1.29).
