const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const vue = require('vue')
const createHarness = require('./helpers/player-harness.cjs')

async function waitFor(predicate) {
  for (let i = 0; i < 400; i++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.ok(predicate(), 'operation should finish')
}

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-local-playback-'))
  const saved = [], calls = [], cleanups = []
  let reads = 0
  const online = {
    getMusicUrl: async args => { calls.push(args); return 'https://audio.test/' + args.musicInfo.id },
    getPicUrl: async() => '', getLyricInfo: async() => ({ rawlrcInfo: {} }),
  }
  const ipc = { downloadTasksGet: async() => { reads++; return saved }, setPowerSaveBlocker() {} }
  const h = createHarness({ mocks: {
    'src/renderer/core/music/index.ts': undefined,
    'src/renderer/core/music/online.ts': online,
    'src/renderer/core/music/utils.ts': {
      getOnlineOtherSourceMusicUrlByLocal: async() => ({ url: 'https://audio.test/local-fallback', isFromCache: true }),
    },
    '@common/utils/vueTools': { ...vue, markRawList: v => v, onBeforeUnmount: fn => cleanups.push(fn) },
    '@common/utils/nodejs': undefined,
    '@common/utils/common': undefined,
    '@common/constants': undefined,
    '@common/utils/lyricUtils/kg': {},
    '@common/utils/tools': { clipFileNameLength: name => name },
    '@renderer/utils/music': undefined,
    '@renderer/utils/ipc': ipc,
    '@renderer/utils': { arrPush: (a, b) => a.push(...b), arrUnshift: (a, b) => a.unshift(...b), joinPath: path.join },
    '@renderer/store': { qualityList: { value: {} }, proxy: {} },
    '@renderer/store/index': { proxy: {} },
    '@renderer/worker/utils': {},
    '@renderer/plugins/i18n': { useI18n: () => key => key },
    '@renderer/store/list/listManage': { defaultList: { id: 'default', name: 'default' }, loveList: { id: 'love', name: 'love' }, userLists: [] },
  } })
  h.setting['download.savePath'] = dir
  h.setting['player.togglePlayMethod'] = 'list'
  const resolver = h.load('src/renderer/core/music/index.ts')
  resolver.getPicPath = async() => ''
  resolver.getLyricInfo = async() => ({ rawlrcInfo: {} })
  const song = (id, source = 'kw') => ({ ...h.song(id), source })
  const download = (musicInfo, options = {}) => {
    const quality = options.quality ?? '128k'
    const fileName = options.fileName ?? `${musicInfo.source}-${musicInfo.id}-${quality}.mp3`
    const filePath = options.filePath ?? path.join(dir, fileName)
    if (options.exists !== false) fs.writeFileSync(filePath, options.content ?? 'audio fixture')
    const task = { id: musicInfo.id + '-' + quality, isComplate: true, status: 'completed', progress: 100,
      metadata: { musicInfo, quality, ext: 'mp3', fileName, filePath }, ...options.task }
    saved.push(task)
    return task
  }
  t.after(() => { cleanups.forEach(fn => fn()); h.cleanup(); fs.rmSync(dir, { recursive: true, force: true }) })
  return { ...h, dir, saved, calls, online, ipc, resolver, song, download, reads: () => reads,
    url: info => resolver.getMusicUrl({ musicInfo: info }), fileUrl: task => pathToFileURL(task.metadata.filePath).href }
}

test('online songs use completed downloads before saved alternate sources, with escaped file URLs', async t => {
  const h = setup(t)
  const song = h.song('A'); song.meta.toggleMusicInfo = h.song('alternate', 'wy')
  const task = h.download(song, { fileName: '中文 #100% ?.mp3' })
  assert.equal(await h.url(song), h.fileUrl(task))
  assert.equal(h.calls.length, 0)
  assert.equal(h.reads(), 1, 'downloads load without opening the download page')
})

test('match source and ID, not same titles or IDs from other providers', async t => {
  const h = setup(t), song = h.song('A')
  h.download({ ...song, id: 'another-version' })
  h.download({ ...song, source: 'wy' })
  assert.equal(await h.url(song), 'https://audio.test/A')
  assert.equal(h.calls.length, 1)
})

test('ignore incomplete, missing, empty, directory and unsupported APE files', async t => {
  const h = setup(t)
  const cases = [
    { task: { isComplate: false, status: 'run' } }, { exists: false }, { content: '' },
    { exists: false, filePath: h.dir, fileName: 'directory.mp3' }, { fileName: 'unsupported.APE' },
  ]
  for (const [i, options] of cases.entries()) {
    const song = h.song(String(i)); h.download(song, options)
    // Add subsequent tasks to the live store after the first initialization.
    if (i) h.mocks['@renderer/store/download/state'].downloadList.push(h.saved.at(-1))
    assert.equal(await h.url(song), 'https://audio.test/' + i)
  }
})

test('prefer highest available quality, but preserve an explicitly selected download', async t => {
  const h = setup(t), song = h.song('A')
  const mp3 = h.download(song)
  const flac = h.download(song, { quality: 'flac', fileName: 'A.flac' })
  assert.equal(await h.url(song), h.fileUrl(flac))
  assert.equal(await h.url(mp3), h.fileUrl(mp3))
  fs.unlinkSync(flac.metadata.filePath)
  assert.equal(await h.url(song), h.fileUrl(mp3), 'a missing higher quality file does not block another download')
})

test('recover a moved download at the configured save path and recheck deleted files', async t => {
  const h = setup(t), song = h.song('A')
  const task = h.download(song)
  const realPath = task.metadata.filePath
  task.metadata.filePath = path.join(h.dir, 'old', task.metadata.fileName)
  assert.equal(await h.url(song), pathToFileURL(realPath).href)
  fs.unlinkSync(realPath)
  assert.equal(await h.url(song), 'https://audio.test/A')
})

test('local library files take priority over saved alternate sources', async t => {
  const h = setup(t)
  const filePath = path.join(h.dir, 'local #%.mp3'); fs.writeFileSync(filePath, 'audio')
  const song = { ...h.song('local', 'local'), meta: { filePath, toggleMusicInfo: h.song('alternate') } }
  assert.equal(await h.url(song), pathToFileURL(filePath).href)
  assert.equal(h.calls.length, 0)
  fs.unlinkSync(filePath)
  assert.equal(await h.url(song), 'https://audio.test/alternate')
})

test('a failing saved alternate source falls back to the original online song', async t => {
  const h = setup(t), song = h.song('A')
  song.meta.toggleMusicInfo = h.song('alternate')
  h.online.getMusicUrl = async args => {
    h.calls.push(args)
    if (args.musicInfo.id === 'alternate') throw new Error('unavailable')
    return 'https://audio.test/A'
  }
  assert.equal(await h.url(song), 'https://audio.test/A')
  assert.deepEqual(h.calls.map(a => a.musicInfo.id), ['alternate', 'A'])
  assert.equal(h.calls[0].allowToggleSource, false)
})

test('concurrent download initialization is shared, including empty lists; failures can retry', async t => {
  const h = setup(t)
  const downloads = h.load('src/renderer/store/download/action.ts')
  h.ipc.downloadTasksGet = async() => { throw new Error('temporary read failure') }
  assert.equal(await h.url(h.song('A')), 'https://audio.test/A', 'read failures must not block online playback')
  let release, reads = 0
  h.ipc.downloadTasksGet = () => { reads++; return new Promise(resolve => { release = resolve }) }
  const first = downloads.getDownloadList(), second = downloads.getDownloadList()
  release([])
  assert.equal(await first, await second)
  await downloads.getDownloadList()
  assert.equal(reads, 1)
})

test('refresh skips a bad local file and retries online without consuming or changing the queue', async t => {
  const h = setup(t), a = h.song('A'), b = h.song('B')
  a.meta.toggleMusicInfo = h.song('alternate')
  const task = h.download(a)
  h.load('src/renderer/core/useApp/usePlayer/usePlayEvent.ts').default()
  h.lists.set('list', [a, b]); h.player.playList('list', 0)
  await waitFor(() => h.resources.length === 1)
  assert.equal(h.resources[0], h.fileUrl(task))
  assert.equal(h.calls.length, 0)
  const queueId = h.state.playMusicInfo.queueId
  h.window.app_event.playerError(3) // MEDIA_ERR_DECODE
  await waitFor(() => h.resources.length === 2)
  assert.equal(h.resources[1], 'https://audio.test/alternate')
  assert.equal(h.calls[0].isRefresh, true)
  assert.equal(h.current(), 'A'); assert.equal(h.state.playMusicInfo.queueId, queueId)
  assert.deepEqual(h.ids(), ['B'])
})

test('a slow local lookup cannot replace the song after the user switches tracks', async t => {
  const h = setup(t), a = h.song('A'), b = h.song('B')
  const task = h.download(a)
  let release
  h.ipc.downloadTasksGet = () => new Promise(resolve => { release = resolve })
  h.lists.set('list', [a, b]); h.player.playList('list', 0)
  await waitFor(() => !!release)
  h.player.playList('list', 1)
  release([task])
  await waitFor(() => h.resources.length > 0)
  assert.deepEqual(h.resources, ['https://audio.test/B'])
  assert.equal(h.current(), 'B')
})

test('next-song preload uses downloaded audio and falls back online if decoding fails', async t => {
  const h = setup(t), a = h.song('A'), b = h.song('B')
  const task = h.download(b)
  h.lists.set('list', [a, b]); h.player.playList('list', 0)
  await waitFor(() => h.resources.length === 1)
  const urls = []
  class Audio extends require('node:events').EventEmitter {
    addEventListener(...args) { this.on(...args) }
    removeEventListener(...args) { this.off(...args) }
    pause() {} removeAttribute() {} load() {}
    set src(url) { urls.push(url); queueMicrotask(() => this.emit(url.startsWith('file:') ? 'error' : 'canplay')) }
  }
  h.context.Audio = Audio
  h.mocks['@renderer/plugins/player'].getCurrentTime = () => 175
  let timeupdate
  h.mocks['@renderer/plugins/player'].onTimeupdate = fn => { timeupdate = fn; return () => {} }
  h.load('src/renderer/store/player/playProgress.ts').playProgress.maxPlayTime = 180
  h.load('src/renderer/core/useApp/usePlayer/usePreloadNextMusic.ts').default()
  timeupdate()
  await waitFor(() => urls.length === 2)
  assert.deepEqual(urls, [h.fileUrl(task), 'https://audio.test/B'])
  assert.equal(h.calls.at(-1).isRefresh, true)
  assert.deepEqual(h.ids(), ['B'])
})
