// Раскладывает последний релиз форка по локальным проектам.
//
// `npm run build:deploy` копирует в проекты из bridge-deploy.config.json то,
// что собрано здесь и сейчас, — и только когда его запустили руками. Релиз же
// выпускается на GitHub (тег или кнопка в Actions), и локальные проекты о нём
// не узнавали: игры неделями жили на мосте, от которого давно ушли.
//
// Этот скрипт спрашивает у GitHub последний релиз и, если в проекте лежит
// более старый, кладёт туда `playgama-bridge.js` из этого релиза — ровно тот
// файл, что выпущен, а не то, что лежит в рабочей копии. Что куда уже
// разложено, помнится в .deploy-state.json, поэтому гонять его можно сколько
// угодно часто: без нового релиза он ничего не трогает. Запускает его
// планировщик Windows (scripts/install-sync-task.ps1).
//
//   node scripts/sync-release.js            разложить, если вышел новый релиз
//   node scripts/sync-release.js --dry-run  только показать, что изменилось бы
//   node scripts/sync-release.js --force    разложить заново, даже если уже стоит
//   node scripts/sync-release.js --tag v2.1.0-fork.1   конкретный релиз

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const CONFIG_PATH = path.join(ROOT, 'bridge-deploy.config.json')
const STATE_PATH = path.join(ROOT, '.deploy-state.json')
const LOG_PATH = path.join(ROOT, '.deploy-sync.log')
const REPO = 'EdikN/bridge'
const ASSET = 'playgama-bridge.js'
// Меньше этого настоящим мостом быть не может: так выглядит страница ошибки.
const MIN_ASSET_BYTES = 50 * 1024

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const force = args.includes('--force')
const tagIndex = args.indexOf('--tag')
const wantedTag = tagIndex >= 0 ? args[tagIndex + 1] : ''

function log(line) {
    const stamped = `${new Date().toISOString()} ${line}`
    console.log(line)
    try {
        fs.appendFileSync(LOG_PATH, `${stamped}\n`)
    } catch {
        // журнал — сведение, а не условие раскладки
    }
}

function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
        return fallback
    }
}

// Один и тот же каталог в конфиге встречается дважды и в разном регистре
// (c:\ и C:\) — на Windows это одна папка.
function keyOf(target) {
    return path.resolve(target).toLowerCase()
}

async function fetchRelease() {
    const url = wantedTag
        ? `https://api.github.com/repos/${REPO}/releases/tags/${encodeURIComponent(wantedTag)}`
        : `https://api.github.com/repos/${REPO}/releases/latest`
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'bridge-sync-release' }
    const token = (process.env.GITHUB_TOKEN || '').trim()
    if (token) headers.Authorization = `Bearer ${token}`
    const response = await fetch(url, { headers })
    if (!response.ok) {
        throw new Error(`GitHub ответил ${response.status} на ${url}`)
    }
    const release = await response.json()
    const asset = (release.assets || []).find((item) => item.name === ASSET)
    if (!asset) {
        throw new Error(`в релизе ${release.tag_name} нет ${ASSET}`)
    }
    return { tag: release.tag_name, url: asset.browser_download_url }
}

async function download(url) {
    const response = await fetch(url, { headers: { 'User-Agent': 'bridge-sync-release' } })
    if (!response.ok) {
        throw new Error(`скачивание ${url}: ${response.status}`)
    }
    const body = Buffer.from(await response.arrayBuffer())
    if (body.length < MIN_ASSET_BYTES) {
        throw new Error(`скачалось ${body.length} байт — это не мост`)
    }
    return body
}

async function main() {
    const config = readJson(CONFIG_PATH, null)
    if (!config) {
        log(`[sync] нет конфига ${CONFIG_PATH}`)
        process.exit(1)
    }

    const seen = new Set()
    const targets = (config.targets || []).filter((target) => {
        const key = keyOf(target.path)
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })

    const release = await fetchRelease()
    const state = readJson(STATE_PATH, {})

    const pending = targets.filter((target) => {
        if (!fs.existsSync(target.path)) return false
        const done = state[keyOf(target.path)]
        const file = path.join(target.path, ASSET)
        return force || !done || done.tag !== release.tag || !fs.existsSync(file)
    })

    if (pending.length === 0) {
        console.log(`[sync] ${release.tag} уже разложен везде`)
        return
    }

    const body = dryRun ? null : await download(release.url)
    let copied = 0

    for (const target of targets) {
        const label = target.description ? `${target.description.trim()} (${target.path})` : target.path
        if (!fs.existsSync(target.path)) {
            log(`[SKIP] ${label} – папки нет`)
            continue
        }
        if (!pending.includes(target)) continue

        const was = (state[keyOf(target.path)] || {}).tag || 'неизвестно'
        if (dryRun) {
            log(`[DRY]  ${label}: ${was} → ${release.tag}`)
            continue
        }
        const file = path.join(target.path, ASSET)
        const temp = `${file}.sync-tmp`
        try {
            fs.writeFileSync(temp, body)
            fs.renameSync(temp, file)
        } catch (error) {
            try { fs.unlinkSync(temp) } catch { /* нечего убирать */ }
            log(`[FAIL] ${label}: ${error.message}`)
            continue
        }
        state[keyOf(target.path)] = { tag: release.tag, at: new Date().toISOString() }
        log(`[OK]   ${label}: ${was} → ${release.tag}`)
        copied++
    }

    if (!dryRun) {
        fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 4)}\n`)
        log(`[sync] ${release.tag}: разложено в ${copied} из ${pending.length}`)
    }
}

main().catch((error) => {
    log(`[sync] ошибка: ${error.message}`)
    process.exit(1)
})
