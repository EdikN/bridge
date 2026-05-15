# Android

Руководство по сборке Android APK из HTML5-игры с Playgama Bridge через [Capacitor](https://capacitorjs.com/) + Yandex Mobile Ads.

## Архитектура

```
Игровой проект (HTML5)
  └── playgama-bridge.js (platform=android)
        └── AndroidPlatformBridge
              └── capacitor-plugin-yandex-mobile-ads
                    └── Yandex Mobile Ads Android SDK 7.18.6+
```

## Предварительные требования

| Инструмент | Версия |
|------------|--------|
| Node.js | ≥ 18 |
| JDK | ≥ 17 |
| Android SDK | API 23+ |

## Начальная настройка проекта

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android
npm install capacitor-plugin-yandex-mobile-ads
npx cap init "Название Игры" "com.example.mygame" --web-dir dist
npx cap add android
```

## playgama-bridge-config.json

```json
{
    "advertisement": {
        "interstitial": { "adUnitId": "R-M-XXXXXXXX-1" },
        "rewarded":     { "adUnitId": "R-M-XXXXXXXX-2" },
        "banner":       { "adUnitId": "R-M-XXXXXXXX-3" }
    }
}
```

Ad unit ID получают в [Yandex Advertising Network](https://partner.yandex.ru/).  
Тестовые ID: `demo-interstitial-yandex`, `demo-rewarded-yandex`, `demo-banner-yandex`.

## Поддерживаемые функции

| Функция | Поддержка |
|---------|-----------|
| Interstitial реклама | ✓ |
| Rewarded реклама | ✓ |
| Banner реклама (10% снизу) | ✓ |
| localStorage | ✓ |
| Fullscreen (без статус-бара) | ✓ |
| Платежи | ✗ |
| Лидерборды | ✗ |
| Авторизация | ✗ |

## Release APK и подпись

Release APK необходимо подписать. Создание ключа:

```bash
keytool -genkey -v -keystore my-release-key.keystore \
  -keyalg RSA -keysize 2048 -validity 10000 -alias my-alias
```

Добавьте в `android/app/build.gradle`:

```gradle
android {
    signingConfigs {
        release {
            storeFile file('my-release-key.keystore')
            storePassword 'пароль'
            keyAlias 'my-alias'
            keyPassword 'пароль'
        }
    }
    buildTypes {
        release { signingConfig signingConfigs.release }
    }
}
```

Затем:
```bash
node /path/to/bridge/scripts/android-setup.js --release
```

---

## Автоматизация: android-setup.js

`scripts/android-setup.js` — автоматизирует полный цикл сборки Android APK. Запускается один раз на новом проекте и настраивает всё окружение.

## Быстрый старт

```bash
# Из папки игрового проекта:
node /path/to/bridge/scripts/android-setup.js

# Или через npm из папки bridge:
npm run android:setup -- /path/to/my-game
npm run android:build -- /path/to/my-game    # только пересборка APK
npm run android:install -- /path/to/my-game  # пересборка + установка на телефон
```

## Флаги

| Флаг | Описание |
|------|----------|
| `--release` | Собрать release APK (по умолчанию: debug) |
| `--install` | Установить APK на подключённое устройство после сборки |
| `--skip-build` | Пропустить `npm run build` + `cap sync` |
| `--skip-gradle` | Пропустить Gradle сборку (только патчи и конфиги) |

## Переменные окружения

Скрипт автодетектирует JDK и Android SDK. Если автодетект не сработал — задайте вручную:

```bash
JAVA_HOME=/path/to/jdk-21  ANDROID_HOME=/path/to/sdk  node scripts/android-setup.js
```

## Что делает скрипт (по шагам)

| # | Шаг | Описание |
|---|-----|----------|
| 1 | **Проверка проекта** | Проверяет `package.json`, `capacitor.config.json`. Добавляет `android/` если нет |
| 2 | **npm install** | Устанавливает зависимости если `node_modules` отсутствует |
| 3 | **Bridge rebuild** | Пересобирает `playgama-bridge.js` с флагом `platform=android` (включает `AndroidPlatformBridge`) |
| 4 | **Vite build** | `npm run build` — собирает веб-ресурсы в `dist/` |
| 5 | **cap sync** | `npx cap sync android` — копирует `dist/` в Android assets, устанавливает плагины |
| 6 | **Yandex plugin patch** | Обновляет Yandex Mobile Ads SDK до `7.18.6` (фикс краша TLSv1), применяет логику баннера 10%/90% |
| 7 | **gradle.properties** | Прописывает путь к JDK, отключает SOCKS-прокси если задан |
| 8 | **local.properties** | Создаёт файл с путём к Android SDK |
| 9 | **MainActivity.java** | Включает fullscreen + скрывает статус-бар и навигационную полоску |
| 10 | **styles.xml** | Добавляет `windowFullscreen` и `windowLayoutInDisplayCutoutMode` |
| 11 | **Gradle download** | Скачивает Gradle wrapper если нет в `~/.gradle/wrapper/dists/` |
| 12 | **Gradle build** | `gradlew assembleDebug` или `assembleRelease` |
| 13 | **ADB install** | Устанавливает APK и запускает приложение (с флагом `--install`) |

## Автодетект инструментов

### JDK (приоритет по убыванию)
1. `JAVA_HOME` переменная окружения
2. `C:\Program Files\Eclipse Adoptium\jdk-2x.x`
3. `C:\Program Files\Java\jdk-2x`
4. `~/jdk-21/` (скачанный скриптом)
5. macOS: `/usr/libexec/java_home -v 17+`

### Android SDK (приоритет по убыванию)
1. `ANDROID_HOME` / `ANDROID_SDK_ROOT`
2. `android/local.properties` текущего проекта
3. `~/Android/Sdk` (стандартный путь Android Studio)
4. macOS: `~/Library/Android/sdk`

## Идемпотентность

Скрипт безопасно запускать повторно — каждый шаг проверяет текущее состояние перед применением изменений:

- `playgama-bridge.js` — пересобирается только если нет `isNativePlatform` в файле
- Yandex SDK — обновляется только если версия отличается от `7.18.6`
- `YandexMobileAdsManager.kt` — патчится только если нет логики `heightPixels * 0.10`
- `MainActivity.java` — перезаписывается только если нет `WindowInsetsControllerCompat`
- `local.properties` — создаётся только если отсутствует или путь SDK не совпадает
- Gradle — скачивается только если нет в кэше `~/.gradle/wrapper/dists/`

## Известные проблемы

### Краш `protocol TLSv1 is not supported`
Yandex Mobile Ads SDK версий до `7.8.x` использует TLSv1 который отключён на Android 10+.  
**Решение**: скрипт автоматически обновляет SDK до `7.18.6`.

### Bridge определяет платформу как `mock`
`playgama-bridge.js` собран без флага `platform=android` — в бандле отсутствует `AndroidPlatformBridge`.  
**Решение**: скрипт автоматически пересобирает bridge если `isNativePlatform` отсутствует в файле.

### `SDK location not found`
`local.properties` отсутствует или указывает на несуществующий путь.  
**Решение**: скрипт создаёт/обновляет `local.properties` автоматически.

### Gradle не скачивается (Connection refused)
Настроен SOCKS-прокси в `gradle.properties`, но он не запущен.  
**Решение**: скрипт комментирует прокси-строки и скачивает Gradle через HTTPS напрямую.

## Структура Android проекта после настройки

```
android/
├── app/
│   ├── src/main/
│   │   ├── java/<package>/MainActivity.java  ← fullscreen, скрыт system UI
│   │   ├── res/values/styles.xml             ← windowFullscreen = true
│   │   └── assets/public/                   ← веб-ресурсы из dist/
│   └── build/outputs/apk/debug/app-debug.apk
├── gradle.properties    ← JAVA_HOME, без SOCKS-прокси
└── local.properties     ← sdk.dir (не коммитить!)
```

## Баннерная реклама

Баннер занимает ровно **10% высоты экрана** снизу. WebView сжимается до **90%**, чтобы баннер не перекрывал игровой контент.

При скрытии баннера (`hideBanner`) WebView автоматически восстанавливается до 100%.

При ошибке загрузки баннера WebView тоже восстанавливается до 100%.

## Fullscreen

Статус-бар и навигационная полоска скрываются через `WindowInsetsControllerCompat` (работает на Android 5+, рекомендуемый API для Android 11+). При свайпе сверху/снизу системные панели временно появляются и прячутся сами (`BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`).
