const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const CONFIG_PATH = path.join(ROOT, 'bridge-deploy.config.json')
const DIST_MAIN = path.join(ROOT, 'dist', 'playgama-bridge.js')
const DIST_PLATFORMS = path.join(ROOT, 'dist', 'platform-bridges')

function copyRecursive(src, dest) {
    if (!fs.existsSync(src)) return
    fs.mkdirSync(dest, { recursive: true })
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name)
        const destPath = path.join(dest, entry.name)
        if (entry.isDirectory()) {
            copyRecursive(srcPath, destPath)
        } else {
            fs.copyFileSync(srcPath, destPath)
        }
    }
}

if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`[deploy] Config not found: ${CONFIG_PATH}`)
    process.exit(1)
}

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
const targets = config.targets || []

let deployed = 0
let skipped = 0

for (const target of targets) {
    const label = target.description ? `${target.description} (${target.path})` : target.path

    if (!fs.existsSync(target.path)) {
        console.log(`[SKIP] ${label} – path not found`)
        skipped++
        continue
    }

    fs.copyFileSync(DIST_MAIN, path.join(target.path, 'playgama-bridge.js'))
    copyRecursive(DIST_PLATFORMS, path.join(target.path, 'platform-bridges'))
    console.log(`[OK]   ${label}`)
    deployed++
}

console.log(`\nDeploy complete: ${deployed} copied, ${skipped} skipped.`)
