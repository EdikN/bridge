# npm-пакет форка

Апстрим публикует `@playgama/bridge` в реестре npm. Форк туда не публикуется и
не будет: чужое имя в реестре занимать нельзя, а своё означало бы, что каждая
игра, база знаний и скилл завода переписывают импорты. Поэтому форк собирается
как **тот же самый пакет** `@playgama/bridge` и раздаётся тарболом из GitHub
Releases — игра пишет привычное `import { bridge } from '@playgama/bridge'`, а
приезжает к ней сборка отсюда.

## Как игра подключает форк

```json
{
  "dependencies": {
    "@playgama/bridge": "https://github.com/EdikN/bridge/releases/download/v2.0.2-fork.1/playgama-bridge-2.0.2-fork.1.tgz"
  }
}
```

Репозиторий публичный, поэтому токен для установки не нужен — ни разработчику,
ни CI, ни фабрике игр.

Точки входа те же, что у апстрима:

| Импорт | Что отдаёт |
| --- | --- |
| `@playgama/bridge` | синглтон `bridge` (он же `default`) и все публичные константы — сам рантайм не содержит, см. ниже |
| `@playgama/bridge/constants` | только константы, без создания моста |
| `@playgama/bridge/global` | типы для `window.bridge` / `window.playgamaBridge` |
| `@playgama/bridge/vite` | Vite-плагин: подключает рантайм `playgama-bridge.js` тегом `<script>` и кладёт его в сборку |
| `@playgama/bridge/dist/playgama-bridge.js` | сам рантайм для `<script>` |

Синглтон один. С 2.3.0 (как и у апстрима) `src/npm.ts` — только прослойка: рантайм
в модульные бандлы **не вшит**, `bridge` из импорта это `window.bridge`, который
создаёт `playgama-bridge.js`, загруженный тегом `<script>` раньше кода игры. Если
рантайма на странице нет, импорт отдаёт прокси, и первое же обращение к нему бросает
ошибку с подсказкой.

Поэтому игра на npm-пакете подключает рантайм одним из способов:

```js
// vite.config.js
import playgamaBridge from '@playgama/bridge/vite'

export default { plugins: [playgamaBridge()] }
```

или кладёт `playgama-bridge.js` рядом с `index.html` и грузит его тегом `<script>`
до скрипта игры.

**Отличие форка:** у Vite-плагина режим по умолчанию `local` — рантайм берётся из
пакета (то есть сборка форка). В апстриме по умолчанию `cdn`, а CDN
`bridge.playgama.com` раздаёт апстримовский рантайм без GamesWeb, доработок VK/OK,
GameMonetize и Android. `mode: 'cdn'` в форке включать не надо.

Игры, которые обновляют тарбол с `2.2.0-fork.*` и раньше не грузили рантайм тегом,
должны добавить плагин или тег — иначе `bridge.initialize()` упадёт с ошибкой
«Playgama Bridge runtime is not loaded».

## Как собрать локально

```bash
npm run build:package   # рантайм + ESM/CJS-прослойки + d.ts
npm pack                # playgama-bridge-<версия>.tgz
```

`build:package` = `build` (скриптовый бандл в `dist/playgama-bridge.js`) +
`build:npm` (webpack `--env npm`: `playgama-bridge.esm.mjs`, `playgama-bridge.cjs.js` и два
бандла констант) + `build:types` (`tsc -p tsconfig.types.json` → `dist/types`).
В апстриме `build:package` не запускает `build`; в форке запускает, потому что
`dist/playgama-bridge.js` — это и есть рантайм, который плагин и тарбол обязаны везти.

Рантайм `dist/playgama-bridge.js` собирается **сплошным** (`bundled`): мосты площадок
вшиты в файл, а не вынесены в асинхронные чанки — чанк пришлось бы тянуть с
`publicPath`, о котором сборщик игры ничего не знает.

## Как выпустить релиз

Выпускает `.github/workflows/npm-release.yml`: прогоняет lint и тесты, собирает
пакет, делает `npm pack` и создаёт релиз с тарболом. Два способа запустить.

**Из вкладки Actions** — «Release npm package» → «Run workflow», поле тега можно
оставить пустым, тогда возьмётся `v<версия из package.json>`. Тега в репозитории
при этом может ещё не быть: релиз создаёт его сам на том коммите, с которого
запущен.

**Тегом:**

```bash
# 1. поднять версию в package.json (например 2.0.3-fork.1)
# 2. закоммитить
git tag v2.0.3-fork.1
git push origin v2.0.3-fork.1
```

Тег обязан совпадать с версией в `package.json` — иначе прогон падает намеренно:
адрес тарбола игры прописывают заранее, и файл, названный не так, никто не
скачает.

## Что важно при слиянии с апстримом

С версии 2.1.0 апстрим сам умеет собирать npm-пакет. При слиянии до 2.1.0 брать
апстримовскую сборку, а из форка сохранить:

* `PLUGIN_NAME: JSON.stringify('playgama-bridge')` в `webpack.config.ts` (upstream с 2.1.0 тоже держит его литералом) — имя, под которым мост
  представляется площадке (Яндекс пишет его как `pluginName`). Оно не должно
  меняться из-за того, что пакет стал скоупнутым;
* `repository` / `homepage` / `bugs`, указывающие на форк;
* типизированные геттеры модулей в `src/PlaygamaBridge.ts`;
* `mode` по умолчанию `'local'` в `vite/index.cjs` (с 2.3.0).
