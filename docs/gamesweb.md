# GamesWeb

Форк-платформа `gamesweb` — портал GamesWeb (`https://choclategames.ru`). Игра открывается в iframe
страницы портала и общается с ней по **GamesWeb Host Protocol v1** (GWHP). Бекенд GamesWeb (сессия,
CSRF) видит только страница портала, поэтому сама игра может лежать на любом origin — обычно
`https://storage.choclategames.ru/play/<slug>/`.

Код: `src/platform-bridges/GamesWebPlatformBridge.ts`, транспорт — `src/platform-bridges/gamesweb/GwHostClient.ts`,
тесты — `tests/src/platform-bridges/gamesWebPlatformBridge.spec.ts`.

## Как платформа выбирается

Портал запускает игру так:

```
https://storage.choclategames.ru/play/<slug>/index.html?gw=1&gw_mode=bridge&gw_origin=https%3A%2F%2Fchoclategames.ru&lang=ru&platform_id=gamesweb
```

- `platform_id=gamesweb` в URL (или `forciblySetPlatformId`) — как у всех платформ, имеет приоритет;
- иначе детектор в `src/platformDetectors.ts`: `gw=1` в URL **или** `window.GWHost` на странице.
  Он стоит первым в списке. Игры, которые портал запускает через эмулятор Яндекса
  (`gw_mode=yandex`), получают `platform_id=yandex` и уходят в Yandex-бридж — детектор их не трогает.

Отдельная сборка: `npm run build:platform -- gamesweb`. В динамической сборке чанк —
`dist/platform-bridges/gamesweb.js`.

## Транспорт

1. Если портал внедрил рантайм (`window.GWHost`, `gw-runtime.js`), бридж работает через него:
   `GWHost.ready` → `GWHost.isOnline` / `GWHost.info`, затем `GWHost.call()` / `GWHost.on()` / `GWHost.emit()`.
   Hello в этом случае шлёт сам рантайм.
2. Иначе бридж сам говорит по `postMessage` с `window.parent`:
   - `gw_origin` берётся из URL и должен совпасть с
     `^(https://(www\.)?choclategames\.ru|http://(localhost|127\.0\.0\.1)(:\d+)?)$` (localhost — с портом
     или без), плюс нужен `gw=1`
     и реальный родительский фрейм (`window.parent !== window`);
   - запросы уходят с `targetOrigin = gw_origin`;
   - `hello` переотправляется с тем же `id` каждые 500 мс, пока не придёт ответ или не истечёт
     таймаут 5 с: страница портала может повесить слушатель позже, чем iframe начал грузиться.
     С рантаймом (`window.GWHost`) это делает сам рантайм;
   - принимаются только сообщения с `event.source === window.parent`, `event.origin === gw_origin`
     и `gw: 1` (остальной трафик — Unity, VK и т.д. — молча игнорируется);
   - таймауты: `hello` 5 с, `ads.*` 180 с, `player.authorize` 300 с, остальное 15 с;
     просроченный запрос отклоняется с `{ code: 'timeout' }`.
3. Нет валидного `gw_origin`/родителя, hello не ответил за 5 с или рантайм офлайн → **офлайн-режим**.

`initialize()` никогда не отклоняется и не висит дольше таймаута hello.

## Возможности

| Функция | Онлайн | Офлайн |
|---|---|---|
| `platform.language` / `tld` / `payload` / `device.type` | из hello | браузер |
| `game_ready` | `platform.ready` | — |
| прочие `platform.sendMessage` | `platform.message` (только аналитика, ошибки не пробрасываются) | — |
| прогресс загрузки | `platform.progress` (последнее значение до hello досылается после него) | — |
| `getServerTime` | `platform.serverTime` (кэш смещения), api.playgama.com не используется | `Date.now()` |
| Внешние вызовы Playgama (аналитика) | выключены | выключены |
| Внешние ссылки | разрешены | разрешены |
| Авторизация | `player.authorize` (модалка логина портала) | не поддерживается |
| Хранилище | `storage.get/set/delete` | localStorage под префиксом `gw:<slug>:` |
| Interstitial / Rewarded / Banner | `ads.*` | не поддерживаются (`failed`) |
| Advanced banners | нет | нет |
| Лидерборды | `in_game`: `leaderboards.setScore/getEntries` | `not_available`, `getEntries` → `[]` |
| Share / invite / rate / favorites / community | `social.*` (по флагам `features` из hello) | нет |
| Create post, home screen, платежи | нет | нет |
| Remote config | `remoteConfig.get` → `config` | нет |
| Достижения | нативных нет, локальные достижения бриджа работают | то же |

Флаги поддержки берутся из `features` ответа hello: хост может выключить любую функцию.

### Хранилище

Хост хранит сейв и для гостей (в своём localStorage, отдельно для каждой игры), и для
авторизованных (на сервере). Поэтому `isPlatformStorageAvailable = true` всегда, когда хост
ответил на hello (`features.storage` = `'server'` | `'local'` | не задан), и не зависит от
авторизации. Смена игрока (событие `player`) доступность не переключает.

Почему так — чтобы прогресс не терялся:
- `StorageModule` при промахе в облаке берёт значение из localStorage игры (ключ `gw:<slug>:<key>`, см. ниже) и сразу переносит его
  на хост, после чего удаляет локальную копию. Прогресс, накопленный офлайн (игра открыта не с
  портала), при первом запуске с портала уезжает к хосту.
- Переключение доступности на лету (`true → false → true`) заставило бы `StorageModule` сбросить
  кэш и удалить локальные тени — при входе игрока в аккаунт посреди сессии это могло потерять
  значения, которых ещё нет в серверном сейве. Поэтому бридж его не делает.
- Если запрос к хосту падает, `StorageModule` пишет в localStorage и досылает позже.

Значения передаются строками: `StorageModule` уже сериализует их, а на случай прямого вызова
не-строки превращаются в JSON. Хост тоже отдаёт строки (не-строки он приводит `JSON.stringify`);
если старый хост/рантайм всё же вернёт не-строку, бридж приводит её так же — `storage.get` с
`tryParseJson` и без него ведёт себя одинаково для обоих случаев.

#### Локальный фолбэк: префикс игры

Все игры портала открываются с одного origin (`storage.choclategames.ru`), значит localStorage у
них общий, а ключи `StorageModule` по умолчанию без префикса. Без защиты перенос «локальное →
облако» мог бы прочитать чужой ключ (например `save` другой игры), отправить его в сейв этой игры и
удалить из localStorage. Поэтому **только на платформе `gamesweb`** бридж задаёт
`localStorageKeyPrefix = 'gw:<slug>:'`, и `StorageModule` хранит локальные значения под ним:

- `<slug>` — из пути `/play/<slug>/`; если путь другой — весь `location.pathname` (без
  завершающего `index.html`);
- локальные ключи без префикса на этой платформе не читаются, не переносятся на хост и не
  удаляются — даже если это прогресс самой игры, сохранённый старой сборкой на другой платформе;
- офлайн-режим и запись при недоступном хосте пишут в `gw:<slug>:<key>`, при следующем чтении
  онлайн эти ключи уезжают на хост, как описано выше.

Остальные платформы префикс не задают — поведение `StorageModule` для них не изменилось.

#### Совместимость с эмулятором Яндекса (GWHP §6a)

Игра, пересобранная со старого бриджа (эмулятор Яндекса, `gw_mode=yandex`) на нативный
`gamesweb`, не теряет сейв. Эмулятор хранит ключи `player.setData` как `ya:<key>` (значение —
`JSON.stringify` того, что игра/бридж передали в `setData`) плюс индекс `__ya_keys`.
`getDataFromStorage(keys)` запрашивает и `<key>`, и `ya:<key>`:

- есть `<key>` — берётся он;
- нет `<key>`, но есть `ya:<key>` — значение один раз раскодируется `JSON.parse` (как это делает
  `getData` эмулятора; строка, которую сериализовал `StorageModule` бриджа 2.x, при этом
  разворачивается из двойного кодирования) и пересохраняется хосту как `<key>`; `ya:<key>`
  остаётся на месте. Ошибка пересохранения не мешает вернуть значение — повторится при следующем
  чтении;
- `deleteDataFromStorage` удаляет и `ya:<key>`, иначе удалённое значение вернулось бы из фолбэка.

### Реклама

Итог показа определяет ответ на запрос, события `ads.state` дают своевременные промежуточные
состояния:

- interstitial: `opened` (событие) → `closed` (событие `closed` или ответ `{ shown: true }`);
  ответ `{ shown: true }` без событий даёт `opened → closed`; `{ shown: false }` или ошибка до
  `opened` → `failed` (через `_showAdFailurePopup`, как у других платформ); ошибка `cooldown` →
  `failed` без попапа; закрытие после `opened` без `shown` → `closed`;
- rewarded: `opened` → `rewarded` → `closed`; `{ rewarded: true }` без событий даёт всю цепочку;
  закрытие до награды → `opened → closed` без `rewarded`; ошибка до `opened` → `failed`;
- повторный `showInterstitial` / `showRewarded`, пока реклама этого типа ещё в полёте (двойной
  тап), к хосту не уходит: только этот вызов получает `failed` (без попапа и без снятия паузы /
  звука), а показ в полёте продолжает получать свои события и ответ — награда засчитывается,
  игра не снимается с паузы под рекламой. Через `bridge.advertisement` такой вызов обычно
  отсекается ещё модулем (`isInProgress`), проверка в бридже — страховка;
- banner: ответ `ads.banner.show` → `shown`/`failed`, `ads.banner.hide` → `hidden`; события
  `ads.state` с `type: 'banner'` (`shown`/`hidden`/`failed`) применяются всегда.

Пауза и звук во время рекламы ставятся базовым агрегатором бриджа, а события хоста `pause` /
`audio` идут в источник `platform` агрегатора. Минимальный интервал между interstitial и
`initialInterstitialDelay` работают как обычно; `initialInterstitialDelay` берётся из
`ads.initialInterstitialDelay` в hello (иначе 60 с), конфиг игры его перекрывает.

### Лидерборды

`setScore` требует авторизации: неавторизованный игрок получает отказ
(`{ code: 'not_authorized' }`) без запроса к хосту — предлагать логин игра решает сама через
`bridge.player.authorize()`. `getEntries` запрашивает топ-20 (и ±3 вокруг игрока, если он
авторизован) и нормализует записи в `{ id, name, score, rank, photo }`; запись игрока из
`player` добавляется в список, если её там нет.

### Прочее

- Видимость вкладки отправляется хосту событием `game.visibility { visible }`.
- `isMemberOfCommunity` не поддерживается протоколом — отклоняется.
- Опций в `playgama-bridge-config.json` нет: блок `"gamesweb": {}` можно оставить пустым;
  ID лидербордов и плейсментов мапятся обычным способом (`leaderboards[].gamesweb`, `placements`).

## Что ожидается от хоста

- Отвечать на каждый запрос (`res` с тем же `id`), в том числе на `ads.*` после закрытия рекламы,
  и слать `ads.state` `rewarded` **до** `closed`.
- Слать `pause` / `audio` вокруг рекламы и оверлеев.
- При входе игрока посреди сессии хост сам решает, как объединить гостевой сейв с серверным
  (бридж продолжит писать в хранилище хоста текущие значения игры), и шлёт событие `player`.
