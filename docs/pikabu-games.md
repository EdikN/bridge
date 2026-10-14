# Pikabu Games

Форк-платформа `pikabu_games` — портал [Пикабу Игры](https://games.pikabu.ru) и его SDK `PkbSDK`
(документация: <https://games.pikabu.ru/sdk/docs/>). Игра открывается в iframe страницы портала;
сборку разработчик хостит сам — в Студии указывается поле «Ссылка на игру».

Код: `src/platform-bridges/PikabuGamesPlatformBridge.ts`.

## Как платформа выбирается

- `platform_id=pikabu_games` в URL или `"forciblySetPlatformId": "pikabu_games"` в конфиге — как у всех
  платформ, имеет приоритет;
- иначе детектор в `src/platformDetectors.ts`. Хостнейм игры здесь ничего не говорит (сборка лежит у
  разработчика), поэтому детектор смотрит на параметры запуска и встраивающую страницу:
  - `pikabu=true` или `_platform-key=pikabu` в URL;
  - `document.referrer` содержит `games.pikabu.ru`;
  - `location.ancestorOrigins` содержит `games.pikabu.ru`.

При успешном определении в консоли появится `[Bridge] Platform detected: pikabu_games`.

Отдельная сборка: `npm run build:platform -- pikabu_games`. В динамической сборке чанк —
`dist/platform-bridges/pikabugames.js`.

## Инициализация

1. Бридж грузит `https://games.pikabu.ru/sdk/sdk.js` и вызывает `PkbSDK.init()` — один раз за сессию.
2. Вне iframe (`window.parent === window`) инициализация сразу отклоняется: SDK работает только внутри
   iframe портала или тестовой среды Студии.
3. У `PkbSDK.init()` нет своего таймаута — вне портала он не завершается никогда. Бридж ждёт 15 с и
   отклоняет инициализацию с ошибкой `PkbSDK.init() timed out`.
4. После `init()`: данные игрока, подписка на `userAuthorized` (обновляет игрока) и `storageSaveError`
   (пишется в лог), платформенное хранилище включено.
5. `bridge.platform.sendMessage('game_ready')` вызывает `sdk.gameStarted()` — один раз. Если включена
   preloader-реклама, `gameStarted()` откладывается до её закрытия (SDK показывает preloader только до
   `gameStarted()`).

## Конфиг

```json
{
    "platforms": {
        "pikabu_games": {
            "preloaderAd": true,
            "verifyPurchases": true,
            "gameSlug": "my-game"
        }
    },
    "payments": [
        {
            "id": "coins_100",
            "pikabu_games": { "id": "coins100" }
        },
        {
            "id": "no_ads"
        }
    ]
}
```

| Параметр | Тип | Описание |
|---|---|---|
| `preloaderAd` | boolean | Показать preloader-рекламу во время загрузки (только мобильные; SDK сам решает, доступна ли она). `gameStarted()` ждёт закрытия рекламы, музыка на это время выключается. По умолчанию выключено. |
| `verifyPurchases` | boolean | Проверять каждую покупку на VkStorage (`POST https://storage.choclategames.ru/payments/pikabu/<slug>/`), см. [Проверка на бекенде](#проверка-на-бекенде). По умолчанию выключено. |
| `gameSlug` | string | Slug игры на VkStorage для `verifyPurchases`. Без него берётся из пути страницы `/play/<slug>/` (игра выложена на VkStorage); не нашёлся — проверка не выполняется (предупреждение в логе). |
| `purchaseVerifyUrl` | string | Полный адрес проверки вместо VkStorage-адреса; если задан, проверка включена без `verifyPurchases`. |

`payments[].pikabu_games.id` — id товара в каталоге Студии, если он отличается от `id` бриджа; без
блока используется `id` бриджа как есть. Блок `"pikabu_games": {}` можно оставить пустым.

## Возможности

| Функция | Поддержка |
|---|---|
| `platform.language` | всегда `'ru'` (у SDK нет API языка, портал русскоязычный) |
| `game_ready` | `sdk.gameStarted()` |
| Interstitial | ✅ `ads.fullscreen` (если `isSupported`) |
| Rewarded | ✅ `ads.rewarded` (если `isSupported`) |
| Preloader | ✅ через `preloaderAd` в конфиге, только мобильные |
| Banner / Advanced banners | ❌ |
| Авторизация | ✅ `auth.openAuthDialog()` |
| Игрок | `id` (есть и у гостей), `name`, `avatar` → `photos`, `isAuthorized` |
| Хранилище | ✅ облачное, для гостей тоже |
| Платежи | ✅ каталог Студии, рубли |
| Лидерборды / достижения | ❌ (локальные достижения бриджа работают) |
| Share / invite / community / rate / favorites | ❌ |
| Серверное время | ❌ |
| События паузы / звука от платформы | ❌ (кроме тех, что бридж ставит сам, см. ниже) |

## Реклама

Перед каждым показом бридж вызывает `canShow()`.

- **Interstitial** (`ads.fullscreen`): `canShow() === false`, `rendered: false` или ошибка → `failed`
  (через `_showAdFailurePopup`, то есть с попапом ошибки, если он включён). Иначе `opened → closed`.
- **Rewarded** (`ads.rewarded`): `opened`, затем `rewarded` **только** при `result.reward === true`
  (досмотрено до конца), затем `closed`. Закрыл раньше — `opened → closed` без награды.
  `canShow() === false` / `rendered: false` / ошибка → `failed`.
- `isInterstitialSupported` / `isRewardedSupported` берутся из `isSupported` SDK.
- Баннеров нет.

Правила площадки, которые бридж за игру не проверяет:

- между fullscreen-показами минимум **120 с** (SDK отвечает `COOLDOWN_ACTIVE`); интервал бриджа по
  умолчанию 80 с, поэтому стоит задать `"advertisement": { "minimumDelayBetweenInterstitial": 120 }`
  в блоке `pikabu_games` (или показывать interstitial реже) — иначе часть показов вернёт `failed`;
- fullscreen нельзя показывать во время активного геймплея — только в паузах (между уровнями,
  после смерти, при выходе в меню);
- fullscreen закрывается не раньше чем через 3 с — это делает сам SDK.

## Хранилище

SDK держит предзагруженный при `init()` key/value-словарь и сам сохраняет изменённые ключи с
небольшой задержкой (autosave).

- `isPlatformStorageAvailable = true` сразу после инициализации, для гостей тоже.
- `get` читает из `storage.getAll()`; `set` / `delete` вызывают `storage.set` / `storage.remove`.
- `flush()` бридж **не вызывает**: у него лимит 100 запросов за 5 минут, частые сохранения бриджа
  быстро его исчерпали бы. Сохранение — на autosave SDK.
- Ошибки сохранения приходят событием `storageSaveError` и пишутся в лог (`logger.warn`).
- Лимит — **200 КБ** JSON на игру. Ошибка `REVISION_CONFLICT` (сейв изменён в другой вкладке)
  требует перезагрузки игры.
- Облачные сохранения обязательны для модерации.

## Авторизация

- `bridge.player.authorize()`: уже авторизован — сразу resolve; иначе открывается
  `auth.openAuthDialog()`. На время диалога игра на паузе и без звука. После закрытия диалога
  игрок не авторизован → reject.
- Событие SDK `userAuthorized` обновляет `bridge.player` в любой момент.
- Логин перед игрой требовать нельзя (правило модерации): гость играет, сохраняется и смотрит рекламу.

## Платежи

- Каталог заводится в Студии загрузкой CSV: `id,name,type,description,price`, где `type` —
  `consumable` | `non_consumable`, `price` в рублях.
- `bridge.payments.purchase(id, { developerPayload })` — `store.purchase({ productId, developerPayload })`.
  Покупка требует логина: SDK сам открывает диалог авторизации. На время формы оплаты игра на паузе
  и без звука. `success: false` → reject с `reason`.
- Покупка в бридже: `{ id, purchaseId, isConsumable, developerPayload, getSignedData() }`, где `id` —
  id товара бриджа (обратное сопоставление через `payments[].pikabu_games.id`).
- `consumePurchase(id)` — `store.consumePurchase(purchaseId)`, покупка убирается из списка.
- `getPurchases()` — non-consumable и ещё не потреблённые consumable. Consumable
  начисляйте сразу и затем вызывайте `consumePurchase`; непотреблённые вернутся при следующем
  запуске — так восстанавливается покупка, прерванная до начисления.
- `getCatalog()`: `name` → `title`, `formattedPrice` → `price`, `currencyCode` → `priceCurrencyCode`
  (только `RUB`), `price / 100` → `priceValue` (SDK отдаёт цену в копейках). Товары конфига, которых
  нет в каталоге Студии, пропускаются с предупреждением в логе.

### Проверка на бекенде

Если покупки начисляет сервер, проверяйте `purchase.getSignedData()`: это JWT, подписанный
**HS256 секретным ключом из Студии**. Сервер проверяет подпись, `productId` / `purchaseId` и
однократность начисления; секретный ключ в клиент не попадает.

Бридж умеет делать эту проверку сам, через VkStorage (`POST /payments/pikabu/<slug>/`). Включается
`verifyPurchases: true` (+ `gameSlug`, иначе slug из пути `/play/<slug>/`) или `purchaseVerifyUrl`.

- Запрос: `POST` с `Content-Type: text/plain` и телом `{"token": "<JWT из getSignedData()>"}` —
  «простой» запрос, браузер не шлёт CORS-preflight.
- Покупка засчитывается только при HTTP 2xx и `{ "ok": true }` в ответе. `{ "ok": true, "duplicate": true }`
  (этот `purchaseId` сервер уже записал — повтор или восстановление) тоже засчитывается.
- `purchase()`: проверка не прошла (ответ 4xx/5xx, `ok` не `true`, сеть) → reject, покупка **не**
  добавляется в список бриджа и не потребляется. На Пикабу она остаётся непотреблённой и при
  следующем `getPurchases()` проверяется снова.
- `getPurchases()`: каждая покупка проверяется отдельно; не прошедшие проверку отбрасываются
  (предупреждение в логе), проверенные остаются.
- Без опций проверки нет и запросов никаких.

> **Сначала ключ, потом опция.** Сервер проверяет подпись секретным ключом Пикабу, который задаётся
> в кабинете VkStorage для игры. Пока ключ не задан, эндпоинт отвечает **409** — и при включённой
> проверке **все покупки отклоняются**. Включайте `verifyPurchases` только после того, как ключ
> сохранён в кабинете VkStorage.

## Пауза и звук

SDK портала сам ставит игру на паузу и глушит звук во время рекламы, диалога авторизации, формы
оплаты и при переключении вкладки — модерация это проверяет. Бридж дополнительно:

- ставит паузу + мьют на время `authorizePlayer()` и `purchase()`;
- выключает звук на время preloader-рекламы;
- для interstitial / rewarded — обычные состояния `opened` / `closed`, на которые игра ставит
  паузу и мьют сама (или через базовый агрегатор бриджа).

## Чек-лист модерации

- [ ] Игра ставится на паузу и замолкает во время рекламы, диалога логина, формы оплаты и при
      уходе со вкладки.
- [ ] Работает с включённым адблоком: `failed` от рекламы не ломает игру, награда без рекламы не
      выдаётся, но и прогресс не блокируется.
- [ ] Интерфейс по умолчанию на русском (бридж отдаёт `language = 'ru'`).
- [ ] Логин не обязателен для начала игры.
- [ ] Облачные сохранения работают (в том числе у гостя); сейв ≤ 200 КБ.
- [ ] Fullscreen — не чаще раза в 120 с и не посреди активного геймплея.
- [ ] `game_ready` отправляется, когда первый экран готов (без него портал считает игру
      незагруженной).
- [ ] Покупки начисляются и consumable потребляются; `getPurchases()` на старте восстанавливает
      non-consumable.

## Тестирование в Студии

- Вне портала `PkbSDK` не работает: локально с `?platform_id=pikabu_games` инициализация упадёт
  (вне iframe — сразу, в чужом iframe — через 15 с). Для локальной отладки используйте другую
  платформу (например `mock`).
- В Студии на вкладке «Тестирование» есть тестовая ссылка: она открывает игру в тестовой среде
  портала с рабочими SDK, рекламой, хранилищем и платежами.
- Сборка подхватывается по «Ссылке на игру» — после выкладки новой версии на свой хостинг
  обновите страницу теста.
