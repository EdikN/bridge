const path = require('path')
const fs = require('fs')
const webpack = require('webpack')
const ESLintPlugin = require('eslint-webpack-plugin')
const TerserPlugin = require('terser-webpack-plugin')
const packageJson = require('./package.json')
const { ALL_PLATFORM_IDS } = require('./scripts/platforms')

const platformDirName = 'platform-bridges'

class CopyToUnityTemplatePlugin {
    apply(compiler) {
        compiler.hooks.afterEmit.tap('CopyToUnityTemplatePlugin', () => {
            const distDir = path.resolve(__dirname, 'dist')
            const destDir = path.resolve(__dirname, 'UnityTemplate')

            const mainSrc = path.join(distDir, 'playgama-bridge.js')
            if (fs.existsSync(mainSrc)) {
                fs.copyFileSync(mainSrc, path.join(destDir, 'playgama-bridge.js'))
                console.log('Copied playgama-bridge.js → UnityTemplate/')
            }

            const platformsSrc = path.join(distDir, platformDirName)
            const platformsDest = path.join(destDir, platformDirName)
            if (fs.existsSync(platformsSrc)) {
                if (fs.existsSync(platformsDest)) {
                    fs.rmSync(platformsDest, { recursive: true })
                }
                fs.cpSync(platformsSrc, platformsDest, { recursive: true })
                console.log(`Copied ${platformDirName}/ → UnityTemplate/`)
            }
        })
    }
}

class CleanPlatformsPlugin {
    apply(compiler) {
        compiler.hooks.beforeRun.tap('CleanPlatformsPlugin', () => {
            const platformsDir = path.resolve(__dirname, `dist/${platformDirName}`)
            if (fs.existsSync(platformsDir)) {
                fs.rmSync(platformsDir, { recursive: true })
            }
        })
    }
}

const createPlatformDefines = (targetPlatforms) => {
    const includeAll = targetPlatforms.length === 0
    const defines = {}
    for (const id of ALL_PLATFORM_IDS) {
        defines[`__INCLUDE_${id.toUpperCase()}__`] = includeAll || targetPlatforms.includes(id)
    }
    return defines
}

const createConfig = (targetPlatforms = [], { noLint = false } = {}) => ({
    mode: 'production',
    entry: './src/index.js',
    output: {
        filename: 'playgama-bridge.js',
        chunkFilename: (pathData) => {
            const chunkId = String(pathData.chunk.id || pathData.chunk.name || '')
            const platformDirNameRegex = new RegExp(`${platformDirName}_(\\w+)_js`)
            const match = chunkId.match(platformDirNameRegex)
            if (match) {
                const name = match[1]
                    .replace(/PlatformBridge/, '')
                    .replace(/([A-Z])/g, '-$1')
                    .replace(/-/g, '')
                    .toLowerCase()
                return `${platformDirName}/${name}.js`
            }
            return `${platformDirName}/${chunkId}.js`
        },
        path: path.resolve(__dirname, 'dist'),
        publicPath: 'auto',
    },
    module: {
        rules: [
            {
                test: /\.m?js$/,
                exclude: /(node_modules|bower_components)/,
                use: {
                    loader: 'babel-loader',
                    options: {
                        presets: ['@babel/preset-env'],
                    },
                },
            },
        ],
    },
    optimization: {
        chunkIds: 'named',
        minimizer: [
            new TerserPlugin({
                extractComments: false,
                terserOptions: {
                    format: {
                        comments: false,
                    },
                },
            }),
        ],
        splitChunks: {
            chunks: 'async',
            cacheGroups: {
                default: false,
                defaultVendors: false,
            },
        },
    },
    plugins: [
        new CleanPlatformsPlugin(),
        new CopyToUnityTemplatePlugin(),
        ...noLint ? [] : [new ESLintPlugin()],
        new webpack.DefinePlugin({
            PLUGIN_VERSION: JSON.stringify(packageJson.version),
            PLUGIN_NAME: JSON.stringify(packageJson.name),
            ...createPlatformDefines(targetPlatforms),
        }),
    ],
    devServer: {
        port: 3535,
    },
})

module.exports = (env = {}) => {
    const targetPlatform = env.platform || ''
    const targetPlatforms = targetPlatform ? targetPlatform.split(',') : []
    const noLint = Boolean(env.noLint)

    if (targetPlatforms.length > 0) {
        const config = createConfig(targetPlatforms, { noLint })
        return {
            ...config,
            name: 'platform',
            output: {
                filename: 'playgama-bridge.js',
                path: path.resolve(__dirname, `dist`),
                publicPath: 'auto',
            },
            plugins: [
                ...config.plugins,
                new webpack.optimize.LimitChunkCountPlugin({
                    maxChunks: 1,
                }),
            ],
        }
    }

    const baseConfig = createConfig([], { noLint })

    const dynamicConfig = {
        ...baseConfig,
        name: 'dynamic',
        plugins: [
            ...baseConfig.plugins,
        ],
    }

    const bundledConfig = {
        ...baseConfig,
        name: 'bundled',
        plugins: [
            ...baseConfig.plugins,
            new webpack.optimize.LimitChunkCountPlugin({
                maxChunks: 1,
            }),
        ],
    }

    return [dynamicConfig, bundledConfig]
}
