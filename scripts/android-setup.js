#!/usr/bin/env node
/**
 * android-setup.js  — часть bridge (EdikN/bridge)
 *
 * Полная автоматизация сборки Android для проектов на Playgama Bridge + Capacitor.
 * Запускать из корня любого игрового проекта, либо передавать путь аргументом.
 *
 * Использование:
 *   node /path/to/bridge/scripts/android-setup.js [путь_к_проекту] [флаги]
 *   npm run android:setup -- [путь_к_проекту] [флаги]   (из папки bridge)
 *
 * Флаги:
 *   --release      собрать release APK (по умолчанию debug)
 *   --install      установить APK на подключённый девайс после сборки
 *   --skip-build   пропустить npm build + cap sync (если уже сделан)
 *   --skip-gradle  пропустить Gradle сборку
 *
 * Переменные окружения (машино-специфичные настройки):
 *   JAVA_HOME         — путь к JDK 17+  (автодетект если не задан)
 *   ANDROID_HOME      — путь к Android SDK  (автодетект если не задан)
 *   ANDROID_SDK_ROOT  — альтернатива ANDROID_HOME
 */

'use strict';

const { execSync } = require('child_process');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');
const https = require('https');

// ─── Константы ────────────────────────────────────────────────────────────
const BRIDGE_DIR         = path.resolve(__dirname, '..');   // корень bridge-репозитория
const YANDEX_SDK_VERSION = '8.6.0';
const APPMETRICA_VERSION = '8.6.0';   // mobileads 8.6.0 требует analytics [8.5.1, 9.0.0)

// ─── Аргументы командной строки ───────────────────────────────────────────
const args        = process.argv.slice(2);
const PROJECT     = path.resolve(args.find(a => !a.startsWith('--')) || process.cwd());
const IS_RELEASE  = args.includes('--release');
const DO_INSTALL  = args.includes('--install');
const SKIP_BUILD  = args.includes('--skip-build');
const SKIP_GRADLE = args.includes('--skip-gradle');

// ─── Автодетект инструментов ──────────────────────────────────────────────
function detectJdk() {
    // 1. Из окружения
    if (process.env.JAVA_HOME && fs.existsSync(process.env.JAVA_HOME)) return process.env.JAVA_HOME;

    // 2. Типичные пути Windows
    const winRoots = [
        'C:\\Program Files\\Eclipse Adoptium',
        'C:\\Program Files\\Java',
        'C:\\Program Files\\Microsoft',
    ];
    for (const root of winRoots) {
        if (!fs.existsSync(root)) continue;
        const dirs = fs.readdirSync(root)
            .filter(d => /jdk.*(17|18|19|20|21|22|23|24|25)/i.test(d))
            .sort().reverse();
        if (dirs.length) return path.join(root, dirs[0]);
    }

    // 3. Домашняя папка пользователя (наш скачанный JDK)
    const userJdkDir = path.join(os.homedir(), 'jdk-21');
    if (fs.existsSync(userJdkDir)) {
        const sub = fs.readdirSync(userJdkDir)[0];
        if (sub) return path.join(userJdkDir, sub);
    }

    // 4. macOS
    try {
        const out = execSync('/usr/libexec/java_home -v 17+', { encoding: 'utf8', stdio: 'pipe' });
        if (out.trim()) return out.trim();
    } catch {}

    return null;
}

function detectAndroidSdk() {
    // 1. Из окружения
    const fromEnv = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
    if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

    // 2. local.properties текущего проекта
    const localProps = path.join(PROJECT, 'android', 'local.properties');
    if (fs.existsSync(localProps)) {
        const m = fs.readFileSync(localProps, 'utf8').match(/sdk\.dir=(.+)/);
        if (m) {
            const p = m[1].trim().replace(/\\\\/g, '\\');
            if (fs.existsSync(p)) return p;
        }
    }

    // 3. Стандартные пути
    const candidates = [
        path.join(os.homedir(), 'Android', 'Sdk'),
        path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk'),
        'C:\\Users\\Eduard\\Android\\Sdk',
        path.join(os.homedir(), 'Library', 'Android', 'sdk'),  // macOS
        path.join(os.homedir(), 'Android', 'sdk'),              // Linux
    ];
    for (const p of candidates) {
        if (fs.existsSync(path.join(p, 'platform-tools'))) return p;
    }

    return null;
}

const JDK = detectJdk();
const SDK = detectAndroidSdk();

// ─── Вспомогательные функции ──────────────────────────────────────────────
const clr = {
    reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m',
    yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m',
};
const log   = msg => console.log(`${clr.cyan}▶${clr.reset} ${msg}`);
const ok    = msg => console.log(`${clr.green}✓${clr.reset} ${msg}`);
const warn  = msg => console.log(`${clr.yellow}⚠${clr.reset} ${msg}`);
const fail  = msg => { console.error(`${clr.red}✗ ${msg}${clr.reset}`); process.exit(1); };
const title = msg => console.log(`\n${clr.bold}${clr.cyan}═══ ${msg} ═══${clr.reset}`);

function buildEnv() {
    const env = { ...process.env };
    if (JDK) {
        env.JAVA_HOME = JDK;
        env.PATH = `${path.join(JDK, 'bin')}${path.delimiter}${env.PATH}`;
    }
    if (SDK) {
        env.ANDROID_HOME = SDK;
        env.ANDROID_SDK_ROOT = SDK;
        env.PATH = `${path.join(SDK, 'platform-tools')}${path.delimiter}${env.PATH}`;
    }
    return env;
}

function run(cmd, cwd = PROJECT, silent = false) {
    try {
        return execSync(cmd, {
            cwd,
            env: buildEnv(),
            stdio: silent ? 'pipe' : 'inherit',
            encoding: 'utf8',
        }) || '';
    } catch (e) {
        if (silent) return '';
        throw e;
    }
}

function write(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
}

function patchLine(content, regex, replacement) {
    return regex.test(content) ? content.replace(regex, replacement) : `${replacement}\n${content}`;
}

// ─── ШАГ 1: Проверка проекта ──────────────────────────────────────────────
function checkProject() {
    title('Проверка проекта');
    if (!fs.existsSync(path.join(PROJECT, 'package.json'))) fail(`Не найден package.json в ${PROJECT}`);

    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT, 'package.json'), 'utf8'));
    ok(`Проект: ${pkg.name || path.basename(PROJECT)}`);

    if (!fs.existsSync(path.join(PROJECT, 'capacitor.config.json'))) {
        fail('Не найден capacitor.config.json — проект не является Capacitor-проектом');
    }

    if (!fs.existsSync(path.join(PROJECT, 'android'))) {
        log('Папка android/ не найдена, добавляю платформу...');
        run('npx cap add android');
        ok('Платформа android добавлена');
    } else {
        ok('Платформа android уже есть');
    }

    if (!JDK) fail('JDK 17+ не найден. Установите JDK или задайте JAVA_HOME');
    ok(`JDK: ${JDK}`);

    if (!SDK) fail('Android SDK не найден. Установите Android Studio или задайте ANDROID_HOME');
    ok(`Android SDK: ${SDK}`);

    return pkg;
}

// ─── ШАГ 1б: id рекламы — из конфига моста в нативную сборку ─────────────
// playgama-bridge-config.json уезжает в APK обычным JSON (assets/public), и id
// блоков R-M-… оттуда собирают боты: у PunchBox на украденные id шли пачки
// фальшивых запросов и кликов, а сеть в ответ урезала рекламу настоящим
// игрокам. Плагин ≥ 1.2.0 берёт id и ключ AppMetrica из
// android/yandex-ads.properties и зашивает в APK закодированным ресурсом
// (yandex-ads-config.gradle), поэтому из конфига они убираются.
const AD_PROPERTIES = 'yandex-ads.properties';
const AD_KINDS = ['interstitial', 'rewarded', 'banner'];
const AD_PROPERTIES_HEADER = [
    '# id блоков Yandex Mobile Ads и ключ AppMetrica для capacitor-plugin-yandex-mobile-ads.',
    '# Плагин зашивает их в APK закодированным ресурсом. В playgama-bridge-config.json',
    '# их не возвращать: он лежит в APK открытым JSON, и id оттуда крадут боты.',
    '# Переменные окружения YANDEX_ADS_BANNER, YANDEX_ADS_INTERSTITIAL,',
    '# YANDEX_ADS_REWARDED, YANDEX_APPMETRICA_KEY главнее этого файла.',
];

function readProperties(file) {
    const result = {};
    if (!fs.existsSync(file)) return result;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*([^#!=:\s][^=:]*?)\s*[=:]\s*(.*?)\s*$/);
        if (match && match[2]) result[match[1]] = match[2];
    }
    return result;
}

function moveAdIdsToNative() {
    title(`id рекламы → android/${AD_PROPERTIES}`);
    const propsPath = path.join(PROJECT, 'android', AD_PROPERTIES);
    const props = readProperties(propsPath);

    const found = {};
    const configs = ['public/playgama-bridge-config.json', 'playgama-bridge-config.json']
        .map(rel => path.join(PROJECT, rel))
        .filter(file => fs.existsSync(file));
    for (const file of configs) {
        const text = fs.readFileSync(file, 'utf8');
        let config;
        try {
            config = JSON.parse(text.replace(/^﻿/, ''));
        } catch {
            warn(`${path.relative(PROJECT, file)} — не JSON, id рекламы из него не перенесены`);
            continue;
        }
        let changed = false;
        const take = (key, holder, field) => {
            const value = holder && holder[field];
            if (typeof value !== 'string' || !value.trim()) return;
            if (!found[key]) found[key] = value.trim();
            delete holder[field];
            changed = true;
        };
        for (const scope of [config, config.platforms && config.platforms.android]) {
            if (!scope) continue;
            take('appMetricaKey', scope, 'appMetricaKey');
            for (const kind of AD_KINDS) take(kind, scope.advertisement && scope.advertisement[kind], 'adUnitId');
        }
        if (changed) {
            const indent = (text.match(/\n( +)"/) || [])[1]?.length || 4;
            write(file, `${JSON.stringify(config, null, indent)}\n`);
            ok(`${path.relative(PROJECT, file)}: id рекламы и ключ AppMetrica убраны`);
        }
    }

    // Файл главнее конфига: его заполняли сознательно, а в конфиге мог
    // остаться id блока, который уже заменён.
    const missing = Object.keys(found).filter(key => !props[key]);
    if (missing.length) {
        const lines = fs.existsSync(propsPath)
            ? [fs.readFileSync(propsPath, 'utf8').replace(/\s*$/, '')]
            : AD_PROPERTIES_HEADER;
        write(propsPath, `${[...lines, ...missing.map(key => `${key}=${found[key]}`)].join('\n')}\n`);
        ok(`android/${AD_PROPERTIES}: ${missing.join(', ')}`);
    }

    const all = { ...found, ...props };
    const absent = AD_KINDS.filter(kind => !all[kind]);
    if (absent.length === AD_KINDS.length) {
        warn(`id рекламы нет ни в конфиге, ни в android/${AD_PROPERTIES} — реклама в APK не заработает`);
    } else if (absent.length) {
        warn(`нет id для: ${absent.join(', ')}`);
    } else {
        ok('id рекламы будут зашиты в APK, в конфиге моста их нет');
    }
}

// ─── ШАГ 2: npm install ───────────────────────────────────────────────────
function npmInstall() {
    title('Установка зависимостей');
    if (!fs.existsSync(path.join(PROJECT, 'node_modules'))) {
        log('Запускаю npm install...');
        run('npm install');
        ok('npm install завершён');
    } else {
        ok('node_modules уже существует');
    }
}

// ─── ШАГ 3: Пересборка playgama-bridge.js для Android ────────────────────
function rebuildBridge() {
    title('Сборка playgama-bridge.js (Android)');
    const projectPublic = path.join(PROJECT, 'public', 'playgama-bridge.js');

    if (fs.existsSync(projectPublic)) {
        const content = fs.readFileSync(projectPublic, 'utf8');
        // Маркер — самая новая Android-возможность (id рекламы из нативной
        // сборки, `adUnits` в ответе initialize), чтобы старая сборка bridge
        // без неё пересобиралась.
        if (content.includes('isNativePlatform') && content.includes('getLaunchNotification')
            && content.includes('adUnits')) {
            ok('playgama-bridge.js уже умеет брать id рекламы из нативной сборки');
            return;
        }
    }

    log('Устанавливаю зависимости bridge...');
    if (!fs.existsSync(path.join(BRIDGE_DIR, 'node_modules'))) {
        run('npm install', BRIDGE_DIR);
    }

    log('Собираю bridge с поддержкой Android...');
    run('npx webpack --config-name platform --env platform=android --env noLint=true', BRIDGE_DIR);

    const bridgeDist = path.join(BRIDGE_DIR, 'dist', 'playgama-bridge.js');
    if (!fs.existsSync(bridgeDist)) fail('Сборка bridge не удалась');

    fs.mkdirSync(path.join(PROJECT, 'public'), { recursive: true });
    fs.copyFileSync(bridgeDist, projectPublic);
    ok('playgama-bridge.js скопирован в public/');
}

// ─── ШАГ 4: Vite build ────────────────────────────────────────────────────
function buildWeb() {
    if (SKIP_BUILD) { warn('Пропускаю npm run build (--skip-build)'); return; }
    title('Сборка веб-приложения');
    run('npm run build');
    ok('Веб-сборка завершена');
}

// ─── ШАГ 5: cap sync ─────────────────────────────────────────────────────
function capSync() {
    if (SKIP_BUILD) { warn('Пропускаю cap sync (--skip-build)'); return; }
    title('Capacitor sync');
    run('npx cap sync android');
    ok('cap sync завершён');
}

// ─── ШАГ 6: Патч Yandex плагина ──────────────────────────────────────────
function patchYandexPlugin() {
    title('Патч Yandex Mobile Ads плагина');

    const pluginDir = path.join(PROJECT, 'node_modules', 'capacitor-plugin-yandex-mobile-ads', 'android');
    if (!fs.existsSync(pluginDir)) {
        warn('capacitor-plugin-yandex-mobile-ads не найден в node_modules, пропускаю');
        return;
    }

    // build.gradle — версия SDK
    const buildGradle = path.join(pluginDir, 'build.gradle');
    if (fs.existsSync(buildGradle)) {
        let content = fs.readFileSync(buildGradle, 'utf8');
        const match = content.match(/com\.yandex\.android:mobileads:([\d.]+)/);
        const current = match?.[1];
        if (current && current !== YANDEX_SDK_VERSION) {
            content = content.replace(
                /com\.yandex\.android:mobileads:[\d.]+/,
                `com.yandex.android:mobileads:${YANDEX_SDK_VERSION}`,
            );
            fs.writeFileSync(buildGradle, content, 'utf8');
            ok(`Yandex SDK: ${current} → ${YANDEX_SDK_VERSION}`);
        } else {
            ok(`Yandex SDK уже ${YANDEX_SDK_VERSION}`);
        }

        // AppMetrica — analytics for the native build. Declared here rather than
        // relied upon transitively: the ads SDK may or may not pull it in
        // depending on version, and the manager references its classes directly.
        content = fs.readFileSync(buildGradle, 'utf8');
        const amMatch = content.match(/io\.appmetrica\.analytics:analytics:([\d.]+)/);
        if (!amMatch) {
            content = content.replace(
                /(implementation 'com\.yandex\.android:mobileads:[\d.]+')/,
                `$1\n    implementation 'io.appmetrica.analytics:analytics:${APPMETRICA_VERSION}'`,
            );
            fs.writeFileSync(buildGradle, content, 'utf8');
            ok(`AppMetrica ${APPMETRICA_VERSION} добавлена в зависимости плагина`);
        } else if (amMatch[1] !== APPMETRICA_VERSION) {
            content = content.replace(
                /io\.appmetrica\.analytics:analytics:[\d.]+/,
                `io.appmetrica.analytics:analytics:${APPMETRICA_VERSION}`,
            );
            fs.writeFileSync(buildGradle, content, 'utf8');
            ok(`AppMetrica: ${amMatch[1]} → ${APPMETRICA_VERSION}`);
        } else {
            ok(`AppMetrica уже ${APPMETRICA_VERSION}`);
        }

        // R8 keep-правила для приложения: consumer-rules.pro плагина.
        content = fs.readFileSync(buildGradle, 'utf8');
        if (!content.includes('consumerProguardFiles')) {
            content = content.replace(
                /(defaultConfig\s*\{)/,
                `$1\n        consumerProguardFiles 'consumer-rules.pro'`,
            );
            fs.writeFileSync(buildGradle, content, 'utf8');
            ok('consumerProguardFiles подключён в build.gradle плагина');
        }
    }

    const templates = path.join(__dirname, 'android-templates');

    // yandex-ads-config.gradle — id рекламы из android/yandex-ads.properties в
    // закодированный ресурс плагина (см. moveAdIdsToNative). Перезаписывается
    // по ревизии, как менеджер; build.gradle плагина его подключает.
    const configGradle = path.join(pluginDir, 'yandex-ads-config.gradle');
    const configTemplate = fs.readFileSync(path.join(templates, 'yandex-ads-config.gradle'), 'utf8');
    const configRevisionOf = text =>
        Number((text.match(/playgama-yandex-ads-config-revision:\s*(\d+)/) || [])[1] || 0);
    const currentConfig = fs.existsSync(configGradle) ? fs.readFileSync(configGradle, 'utf8') : '';
    if (configRevisionOf(currentConfig) < configRevisionOf(configTemplate)) {
        write(configGradle, configTemplate);
        ok(`yandex-ads-config.gradle ревизии ${configRevisionOf(configTemplate)} записан`);
    }
    if (fs.existsSync(buildGradle)) {
        const content = fs.readFileSync(buildGradle, 'utf8');
        if (!content.includes('yandex-ads-config.gradle')) {
            fs.writeFileSync(buildGradle, `${content.replace(/\s*$/, '')}\n\n`
                + '// id рекламы из android/yandex-ads.properties — см. yandex-ads-config.gradle\n'
                + "apply from: 'yandex-ads-config.gradle'\n", 'utf8');
            ok('yandex-ads-config.gradle подключён в build.gradle плагина');
        }
    }

    const rulesTarget = path.join(pluginDir, 'consumer-rules.pro');
    const rules = fs.readFileSync(path.join(templates, 'consumer-rules.pro'), 'utf8');
    if (!fs.existsSync(rulesTarget) || fs.readFileSync(rulesTarget, 'utf8') !== rules) {
        write(rulesTarget, rules);
        ok('consumer-rules.pro (keep для com.yandex.mobile.ads / io.appmetrica) записан');
    }

    // YandexMobileAdsManager.kt — кэш preload, back-off, Ad Revenue → AppMetrica,
    // баннер не перекрывает игру. Перезаписывается, только если ревизия копии в
    // плагине ниже ревизии шаблона: плагин из свежего репозитория не откатывается.
    const managerKt = path.join(
        pluginDir, 'src', 'main', 'java', 'com', 'playgama', 'yandexads', 'YandexMobileAdsManager.kt',
    );
    const managerTemplate = fs.readFileSync(path.join(templates, 'YandexMobileAdsManager.kt'), 'utf8');
    const revisionOf = text => Number((text.match(/playgama-ads-manager-revision:\s*(\d+)/) || [])[1] || 0);
    const current = fs.existsSync(managerKt) ? fs.readFileSync(managerKt, 'utf8') : '';
    if (revisionOf(current) < revisionOf(managerTemplate)) {
        write(managerKt, managerTemplate);
        ok(`YandexMobileAdsManager.kt обновлён до ревизии ${revisionOf(managerTemplate)}`);
    } else {
        ok(`YandexMobileAdsManager.kt уже ревизии ${revisionOf(current)}`);
    }

    patchNotifications(pluginDir);
}

// Локальные уведомления (bridge.notifications). Нативный код лежит в
// scripts/android-templates и копируется в плагин, так что для старой версии
// плагина в игре достаточно обновить bridge и перезапустить этот скрипт.
function patchNotifications(pluginDir) {
    const templates = path.join(__dirname, 'android-templates');
    const kotlinDir = path.join(pluginDir, 'src', 'main', 'java', 'com', 'playgama', 'yandexads');
    // NativeAdConfig.kt — вместе с плагином: YandexMobileAdsPlugin.kt из
    // шаблона без него не соберётся.
    const files = [
        ['PlaygamaNotifications.kt', path.join(kotlinDir, 'PlaygamaNotifications.kt')],
        ['YandexMobileAdsPlugin.kt', path.join(kotlinDir, 'YandexMobileAdsPlugin.kt')],
        ['NativeAdConfig.kt', path.join(kotlinDir, 'NativeAdConfig.kt')],
        ['AndroidManifest.xml', path.join(pluginDir, 'src', 'main', 'AndroidManifest.xml')],
    ];

    let changed = 0;
    for (const [name, target] of files) {
        const content = fs.readFileSync(path.join(templates, name), 'utf8');
        if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') === content) continue;
        write(target, content);
        changed++;
    }
    ok(changed ? `Уведомления: обновлено файлов плагина — ${changed}` : 'Уведомления уже встроены в плагин');
}

// ─── ШАГ 7: gradle.properties ────────────────────────────────────────────
function fixGradleProperties() {
    title('Настройка gradle.properties');
    const gradleProps = path.join(PROJECT, 'android', 'gradle.properties');
    if (!fs.existsSync(gradleProps)) { warn('gradle.properties не найден'); return; }

    let content = fs.readFileSync(gradleProps, 'utf8');
    let changed = false;

    // JDK путь
    if (JDK) {
        const jdkEscaped = JDK.replace(/\\/g, '\\\\');
        const jdkLine = `org.gradle.java.home=${jdkEscaped}`;
        if (!content.includes(jdkEscaped)) {
            content = patchLine(content, /org\.gradle\.java\.home=.+/, jdkLine);
            changed = true;
        }
    }

    // Отключаем SOCKS proxy если не запущен (ломает Maven загрузку)
    if (/^systemProp\.socksProxyHost=/m.test(content) && !/^#systemProp\.socksProxyHost=/m.test(content)) {
        content = content
            .replace(/^systemProp\.socksProxyHost=/m, '#systemProp.socksProxyHost=')
            .replace(/^systemProp\.socksProxyPort=/m, '#systemProp.socksProxyPort=')
            .replace(/^systemProp\.http\.nonProxyHosts=/m, '#systemProp.http.nonProxyHosts=');
        changed = true;
    }

    if (changed) { fs.writeFileSync(gradleProps, content, 'utf8'); ok('gradle.properties обновлён'); }
    else ok('gradle.properties уже корректен');
}

// ─── ШАГ 8: local.properties ─────────────────────────────────────────────
function createLocalProperties() {
    title('local.properties');
    const localProps = path.join(PROJECT, 'android', 'local.properties');
    const sdkEscaped = SDK.replace(/\\/g, '\\\\');

    if (!fs.existsSync(localProps) || !fs.readFileSync(localProps, 'utf8').includes(sdkEscaped)) {
        write(localProps, `## Автогенерировано android-setup.js — не коммитить!\nsdk.dir=${sdkEscaped}\n`);
        ok('local.properties создан');
    } else {
        ok('local.properties уже корректен');
    }
}

// ─── ШАГ 9: MainActivity.java — fullscreen ───────────────────────────────
function fixMainActivity() {
    title('MainActivity.java (fullscreen)');
    const capCfg = JSON.parse(fs.readFileSync(path.join(PROJECT, 'capacitor.config.json'), 'utf8'));
    const appId = capCfg.appId;
    if (!appId) { warn('appId не задан в capacitor.config.json'); return; }

    const javaPath = path.join(PROJECT, 'android', 'app', 'src', 'main', 'java',
        ...appId.split('.'), 'MainActivity.java');

    if (!fs.existsSync(javaPath)) { warn(`MainActivity.java не найден: ${javaPath}`); return; }

    const existing = fs.readFileSync(javaPath, 'utf8');
    if (existing.includes('WindowInsetsControllerCompat')) {
        ok('MainActivity.java уже настроен');
        return;
    }

    write(javaPath, MAIN_ACTIVITY_JAVA.replace(/\{\{PACKAGE\}\}/g, appId));
    ok('MainActivity.java обновлён (fullscreen + hide system bars)');
}

// ─── ШАГ 10: styles.xml ──────────────────────────────────────────────────
function fixStyles() {
    title('styles.xml');
    const stylesPath = path.join(PROJECT, 'android', 'app', 'src', 'main', 'res', 'values', 'styles.xml');
    if (!fs.existsSync(stylesPath)) { warn('styles.xml не найден'); return; }

    let content = fs.readFileSync(stylesPath, 'utf8');
    if (content.includes('android:windowFullscreen')) { ok('styles.xml уже настроен'); return; }

    content = content.replace(
        /(<style name="AppTheme\.NoActionBar"[^>]*>)/,
        `$1\n        <item name="android:windowFullscreen">true</item>\n        <item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>`,
    );
    fs.writeFileSync(stylesPath, content, 'utf8');
    ok('styles.xml обновлён');
}

// ─── ШАГ 11: Gradle distribution ─────────────────────────────────────────
async function ensureGradle() {
    title('Проверка Gradle');

    const wrapperProps = path.join(PROJECT, 'android', 'gradle', 'wrapper', 'gradle-wrapper.properties');
    if (!fs.existsSync(wrapperProps)) { warn('gradle-wrapper.properties не найден'); return; }

    const content = fs.readFileSync(wrapperProps, 'utf8');
    const m = content.match(/gradle-([\d.]+)-(\w+)\.zip/);
    if (!m) { warn('Версия Gradle не определена'); return; }

    const [, version, type] = m;
    const distsDir = path.join(os.homedir(), '.gradle', 'wrapper', 'dists');
    const versionDir = path.join(distsDir, `gradle-${version}-${type}`);

    // Проверяем есть ли уже скачанный zip (без .part файла)
    if (fs.existsSync(versionDir)) {
        const subdirs = fs.readdirSync(versionDir);
        for (const sub of subdirs) {
            const zip = path.join(versionDir, sub, `gradle-${version}-${type}.zip`);
            const part = zip + '.part';
            if (fs.existsSync(zip) && !fs.existsSync(part)) {
                ok(`Gradle ${version} уже скачан`);
                return;
            }
            // Удаляем битый .part файл
            if (fs.existsSync(part)) fs.unlinkSync(part);
        }
    }

    log(`Gradle ${version} не найден, скачиваю...`);
    const tmpDir = path.join(versionDir, Math.random().toString(36).slice(2, 12));
    fs.mkdirSync(tmpDir, { recursive: true });
    const dest = path.join(tmpDir, `gradle-${version}-${type}.zip`);
    await downloadFile(`https://services.gradle.org/distributions/gradle-${version}-${type}.zip`, dest);
    ok(`Gradle ${version} скачан`);
}

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const get = u => https.get(u, res => {
            if (res.statusCode === 301 || res.statusCode === 302) { get(res.headers.location); return; }
            res.pipe(file);
            file.on('finish', () => file.close(resolve));
        }).on('error', e => { fs.unlink(dest, () => {}); reject(e); });
        get(url);
    });
}

// ─── ШАГ 12: Gradle build ────────────────────────────────────────────────
function buildApk() {
    if (SKIP_GRADLE) { warn('Пропускаю Gradle build (--skip-gradle)'); return null; }
    title(`Gradle: ${IS_RELEASE ? 'assembleRelease' : 'assembleDebug'}`);

    const gradlew = path.join(PROJECT, 'android', os.platform() === 'win32' ? 'gradlew.bat' : 'gradlew');
    const task = IS_RELEASE ? 'assembleRelease' : 'assembleDebug';
    run(`"${gradlew}" ${task}`, path.join(PROJECT, 'android'));

    const apkDir = path.join(PROJECT, 'android', 'app', 'build', 'outputs', 'apk',
        IS_RELEASE ? 'release' : 'debug');
    const apks = fs.existsSync(apkDir) ? fs.readdirSync(apkDir).filter(f => f.endsWith('.apk')) : [];
    if (!apks.length) fail('APK не найден после сборки');

    const apkPath = path.join(apkDir, apks[0]);
    ok(`APK: ${apkPath}`);
    return apkPath;
}

// ─── ШАГ 13: ADB install ─────────────────────────────────────────────────
function adbInstall(apkPath) {
    if (!DO_INSTALL || !apkPath) return;
    title('ADB: установка на устройство');

    const adb = path.join(SDK, 'platform-tools', os.platform() === 'win32' ? 'adb.exe' : 'adb');
    if (!fs.existsSync(adb)) { warn('adb не найден'); return; }

    const devices = run(`"${adb}" devices`, PROJECT, true);
    if (!devices.split('\n').slice(1).some(l => l.includes('\tdevice'))) {
        warn('Нет подключённых устройств'); return;
    }

    try {
        run(`"${adb}" install -r "${apkPath}"`, PROJECT);
    } catch {
        const { appId } = JSON.parse(fs.readFileSync(path.join(PROJECT, 'capacitor.config.json'), 'utf8'));
        run(`"${adb}" uninstall ${appId}`, PROJECT, true);
        run(`"${adb}" install "${apkPath}"`, PROJECT);
    }
    ok('APK установлен');

    try {
        const { appId } = JSON.parse(fs.readFileSync(path.join(PROJECT, 'capacitor.config.json'), 'utf8'));
        run(`"${adb}" shell am start -n ${appId}/.MainActivity`, PROJECT);
        ok('Приложение запущено');
    } catch {}
}

// ─── Шаблон: MainActivity.java ────────────────────────────────────────────
const MAIN_ACTIVITY_JAVA = `package {{PACKAGE}};

import android.os.Bundle;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        hideSystemUI();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUI();
    }

    private void hideSystemUI() {
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        WindowInsetsControllerCompat controller =
            new WindowInsetsControllerCompat(window, window.getDecorView());
        controller.hide(WindowInsetsCompat.Type.statusBars() | WindowInsetsCompat.Type.navigationBars());
        controller.setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        );
    }
}
`;

// ─── Запуск ───────────────────────────────────────────────────────────────
async function main() {
    console.log(`\n${clr.bold}${clr.green}Playgama Android Setup${clr.reset}  (bridge: ${BRIDGE_DIR})`);
    console.log(`Проект: ${clr.cyan}${PROJECT}${clr.reset}`);
    console.log(`Режим:  ${clr.cyan}${IS_RELEASE ? 'release' : 'debug'}${clr.reset}\n`);

    checkProject();
    moveAdIdsToNative();
    npmInstall();
    rebuildBridge();
    buildWeb();
    capSync();
    patchYandexPlugin();
    fixGradleProperties();
    createLocalProperties();
    fixMainActivity();
    fixStyles();
    await ensureGradle();
    const apkPath = buildApk();
    adbInstall(apkPath);

    console.log(`\n${clr.bold}${clr.green}✓ Готово!${clr.reset}`);
    if (apkPath) {
        console.log(`APK: ${clr.cyan}${apkPath}${clr.reset}`);
        if (!DO_INSTALL) {
            const adb = path.join(SDK, 'platform-tools', os.platform() === 'win32' ? 'adb.exe' : 'adb');
            console.log(`\nУстановить:\n  ${clr.yellow}"${adb}" install "${apkPath}"${clr.reset}`);
        }
    }
}

main().catch(e => fail(e.message || String(e)));
