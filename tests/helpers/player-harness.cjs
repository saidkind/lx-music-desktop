const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const vue = require('vue')
const { EventEmitter } = require('node:events')
const { webcrypto } = require('node:crypto')
const root = path.resolve(__dirname, '../..')

module.exports = function createHarness(options = {}) {
  const cache = new Map()
  const lists = new Map()
  const resources = []
  const timers = new Set()
  const setting = { 'player.togglePlayMethod': 'listLoop', 'player.autoSkipOnError': false, 'player.isSavePlayTime': false }
  const progress = { nowPlayTime: 0, maxPlayTime: 0 }
  const events = new EventEmitter()
  const window = {
    lxData: {}, lx: { isPlayedStop: false, restorePlayInfo: null, worker: { main: {} } },
    i18n: { t: (key) => key },
    app_event: new Proxy(events, { get: (target, key) => key in target ? typeof target[key] === 'function' ? target[key].bind(target) : target[key] : (...args) => target.emit(key, ...args) }),
  }
  const music = { getMusicUrl: async({ musicInfo }) => 'audio:' + musicInfo.id, getPicPath: async() => '', getLyricInfo: async() => ({ rawlrcInfo: {} }) }
  const filter = { run: async(args) => load('src/renderer/worker/main/list.ts').filterMusicList(args) }
  window.lx.worker.main.filterMusicList = args => filter.run(args)
  const mocks = {
    '@common/utils/vueTools': { ...vue, markRawList: value => value },
    '@renderer/store/list/action': { getListMusicsFromCache: id => lists.get(id) ?? [], addListMusics: async() => {}, removeListMusics: async() => {} },
    '@renderer/store/download/state': { downloadList: [] },
    '@renderer/store/setting': { appSetting: setting },
    '@renderer/store/list/state': { loveList: { id: 'love' } },
    '@renderer/store/dislikeList': { dislikeInfo: { names: new Set(), musicNames: new Set(), singerNames: new Set() } },
    '@renderer/core/dislikeList': { addDislikeInfo: async() => {}, hasDislike: () => false },
    '@renderer/utils/ipc': { setPowerSaveBlocker() {} },
    '@renderer/utils/index': { getRandom: min => min },
    '@renderer/utils/message': { requestMsg: { tooManyRequests: '429', cancelRequest: 'cancel' } },
    '@renderer/utils/music': {},
    '@common/utils/nodejs': {},
    '@common/utils/common': {},
    '@common/utils': {},
    '@common/constants': { LIST_IDS: { DOWNLOAD: 'download', PLAY_LATER: null }, SPLIT_CHAR: { DISLIKE_NAME: '@', DISLIKE_NAME_ALIAS: '-' } },
    '@renderer/plugins/player': {
      isEmpty: () => !resources.length,
      setPause: () => { load('src/renderer/store/player/state.ts').isPlay.value = false },
      setStop: () => { load('src/renderer/store/player/state.ts').isPlay.value = false },
      setPlay: () => { load('src/renderer/store/player/state.ts').isPlay.value = true },
      setResource: url => resources.push(url),
    },
    'src/renderer/core/music/index.ts': music,
    'src/renderer/store/player/playProgress.ts': { playProgress: progress, setProgress: (time, maxTime) => { progress.nowPlayTime = time; progress.maxPlayTime = maxTime } },
    ...options.mocks,
  }
  for (const specifier of Object.keys(mocks)) {
    if (!/^@(renderer|common)\//.test(specifier)) continue
    let file = specifier.replace(/^@renderer\//, 'src/renderer/').replace(/^@common\//, 'src/common/')
    if (!path.extname(file)) file += fs.existsSync(path.join(root, file + '.ts')) ? '.ts' : '/index.ts'
    if (!(file in mocks)) mocks[file] = mocks[specifier]
  }
  const context = vm.createContext({
    window, crypto: webcrypto, console: { ...console, log() {}, warn() {} }, performance,
    setImmediate, clearImmediate,
    setTimeout: (fn, delay) => { const timer = setTimeout(fn, delay); timer.unref(); timers.add(timer); return timer },
    clearTimeout: timer => { clearTimeout(timer); timers.delete(timer) },
    ...options.globals,
  })
  function resolve(specifier, from) {
    if (require('node:module').isBuiltin(specifier)) return specifier
    if (mocks[specifier]) return specifier
    let file = specifier.startsWith('.') ? path.relative(root, path.resolve(path.dirname(path.join(root, from)), specifier)) : specifier
    file = file.replace(/^@renderer\//, 'src/renderer/').replace(/^@common\//, 'src/common/')
    if (!path.extname(file)) file += fs.existsSync(path.join(root, file + '.ts')) ? '.ts' : '/index.ts'
    return file
  }
  function load(file) {
    if (require('node:module').isBuiltin(file)) return require(file)
    if (mocks[file]) return mocks[file]
    if (cache.has(file)) return cache.get(file).exports
    const module = { exports: {} }
    cache.set(file, module)
    const output = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
    vm.runInContext('(function(require,module,exports){' + output + '\n})', context, { filename: file })(specifier => load(resolve(specifier, file)), module, module.exports)
    return module.exports
  }
  const player = load('src/renderer/core/player/action.ts')
  const state = load('src/renderer/store/player/state.ts')
  const actions = load('src/renderer/store/player/action.ts')
  const queue = load('src/renderer/store/player/queue.ts')
  const model = load('src/renderer/core/player/queueModel.ts')
  const song = id => ({ id, name: id, singer: 'Artist', source: 'kw', interval: '03:00', meta: { _qualitys: { '128k': {} } } })
  const ids = () => Array.from(queue.queueState.pending, item => item.musicInfo.id)
  const add = (...ids) => actions.addTempPlayList(ids.map(id => ({ musicInfo: song(id), listId: null })))
  const current = () => state.playMusicInfo.musicInfo?.id
  const flush = async() => { for (let i = 0; i < 12; i++) await Promise.resolve() }
  return { player, state, actions, queue, model, lists, song, add, ids, current, setting, music, filter, resources, window, flush, load, mocks, context, cleanup: () => { for (const timer of timers) clearTimeout(timer) } }
}
