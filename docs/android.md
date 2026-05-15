# Android APK Build Guide

Это руководство описывает, как упаковать HTML5-игру с Playgama Bridge в Android APK с помощью [Capacitor](https://capacitorjs.com/) и монетизировать её через Yandex Mobile Ads.

## Архитектура

```
Игровой проект (HTML5)
  └── Playgama Bridge (платформа: android)
        └── capacitor-plugin-yandex-mobile-ads
              └── Yandex Mobile Ads Android SDK
```

Bridge автоматически определяет среду Capacitor при запуске и переключается на платформу `android`.

## Предварительные требования

| Инструмент | Версия |
|------------|--------|
| Node.js | ≥ 18 |
| JDK | ≥ 17 |
| Android SDK | API 23+ |
| Android Studio | любая актуальная (опционально) |

## Установка

### 1. Добавить Capacitor в игровой проект

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init "Название Игры" "com.example.mygame" --web-dir dist
```

### 2. Установить плагин Yandex Mobile Ads

```bash
npm install capacitor-plugin-yandex-mobile-ads
```

## Конфигурация

### playgama-bridge-config.json

Добавьте ad unit ID в конфиг вашей игры:

```json
{
    "advertisement": {
        "interstitial": {
            "adUnitId": "R-M-XXXXXXXX-1"
        },
        "rewarded": {
            "adUnitId": "R-M-XXXXXXXX-2"
        },
        "banner": {
            "adUnitId": "R-M-XXXXXXXX-3"
        }
    }
}
```

Опционально, если используете AppMetrica:

```json
{
    "appMetricaKey": "ваш-appmetrica-ключ"
}
```

Ad unit ID получают в [Yandex Advertising Network](https://partner.yandex.ru/). Для тестирования используйте демо-ID: `demo-interstitial-yandex`, `demo-rewarded-yandex`, `demo-banner-yandex`.

## Поддерживаемые функции

| Функция | Поддержка |
|---------|-----------|
| Interstitial реклама | ✓ |
| Rewarded реклама | ✓ |
| Banner реклама | ✓ |
| Локальное хранилище (localStorage) | ✓ |
| Платежи | ✗ |
| Лидерборды | ✗ |
| Авторизация | ✗ |

## Сборка APK

### Шаг 1: Собрать веб-ресурсы

```bash
npm run build
```

### Шаг 2: Добавить Android платформу

```bash
npx cap add android
npx cap sync
```

### Шаг 3: Debug APK (для тестирования)

```bash
npx cap build android
```

APK будет создан по пути: `android/app/build/outputs/apk/debug/app-debug.apk`

Установка на устройство:
```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

### Шаг 4: Release APK (для публикации)

```bash
cd android
./gradlew assembleRelease
```

Release APK необходимо подписать ключом. Создание ключа:

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
        release {
            signingConfig signingConfigs.release
        }
    }
}
```

## Обновление после изменений в игре

После каждого изменения веб-кода:

```bash
npm run build
npx cap sync
```

## Troubleshooting

**Bridge определяет платформу как `mock` вместо `android`**
— Убедитесь, что плагин установлен и `npx cap sync` выполнен. `window.Capacitor.isNativePlatform()` должен возвращать `true` только в нативной сборке.

**Реклама не показывается**
— Проверьте правильность `adUnitId` в конфиге.
— Убедитесь, что устройство имеет доступ к интернету.
— Используйте демо-ID для тестирования.

**Ошибка сборки Gradle**
— Убедитесь, что JDK 17 установлен и прописан в `JAVA_HOME`.
— Выполните `cd android && ./gradlew clean`.
