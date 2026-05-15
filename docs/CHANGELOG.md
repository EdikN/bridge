# Changelog

## [Unreleased]

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
