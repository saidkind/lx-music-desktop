const { test } = require('node:test')
const assert = require('node:assert/strict')
const createHarness = require('./helpers/player-harness.cjs')

function setup(t, mode = 'list') {
  const h = createHarness()
  t.after(h.cleanup)
  h.setting['player.togglePlayMethod'] = mode
  h.lists.set('list', ['A', 'B', 'C'].map(h.song))
  h.player.playList('list', 0)
  h.top = (...ids) => h.actions.addTempPlayList(ids.map(id => ({ musicInfo: h.song(id), listId: null, isTop: true })))
  h.snapshot = () => h.model.serializeQueue({ version: 2, pending: h.queue.queueState.pending,
    cycle: h.queue.queueState.cycle, order: h.queue.queueState.order, current: h.state.playMusicInfo,
    anchor: { listId: 'list', musicId: h.current(), index: 0 }, time: 12, duration: 180 })
  return h
}

test('one independent queue contains every upcoming song; insert goes to its head', async t => {
  const h = setup(t)
  assert.deepEqual(h.ids(), ['B', 'C'])
  h.top('X', 'Y')
  assert.deepEqual(h.ids(), ['X', 'Y', 'B', 'C'])
  const heard = [h.current()]
  for (let i = 0; i < 4; i++) { await h.player.playNext(true); heard.push(h.current()) }
  assert.deepEqual(heard, ['A', 'X', 'Y', 'B', 'C'])
  assert.deepEqual(h.ids(), [])
  assert.deepEqual(h.lists.get('list').map(s => s.id), ['A', 'B', 'C'])
})

test('append adds to the same queue tail, after existing source and inserted songs', t => {
  const h = setup(t)
  h.top('X'); h.add('Y', 'Z')
  assert.deepEqual(h.ids(), ['X', 'B', 'C', 'Y', 'Z'])
})

test('source metadata, deletion, reorder and additions cannot change the queue', async t => {
  const h = setup(t)
  h.lists.get('list')[1].name = 'renamed'
  h.lists.set('list', ['C', 'NEW'].map(h.song))
  h.actions.updatePlayIndex()
  assert.deepEqual(h.ids(), ['B', 'C'])
  assert.equal(h.queue.queueState.pending[0].musicInfo.name, 'B')
  await h.player.playNext(); assert.equal(h.current(), 'B')
  h.lists.delete('list')
  await h.player.playNext(); assert.equal(h.current(), 'C')
})

test('clicking another source song replaces the entire queue, including inserted songs', async t => {
  const h = setup(t)
  h.top('X'); h.add('Y')
  h.lists.set('other', ['D', 'E', 'F'].map(h.song))
  h.player.playList('other', 1)
  assert.equal(h.current(), 'E')
  assert.deepEqual(h.ids(), ['F'])
  await h.player.playPrev(); assert.equal(h.current(), 'E')
  assert.equal(h.queue.queueState.history.length, 1)
})

test('clicking the same source song also resets the edited queue', t => {
  const h = setup(t)
  h.top('X'); h.queue.removeQueue(h.queue.queueState.pending[1].queueId)
  h.player.playList('list', 0)
  assert.deepEqual(h.ids(), ['B', 'C'])
  assert.equal(h.current(), 'A')
})

test('queue play-now consumes only that occurrence and does not rebuild or clear the queue', async t => {
  const h = setup(t)
  h.top('X', 'X', 'Y')
  const [first, second] = h.queue.queueState.pending
  assert.notEqual(first.queueId, second.queueId)
  h.player.playQueueItem(second.queueId)
  assert.equal(h.current(), 'X')
  assert.deepEqual(h.ids(), ['X', 'Y', 'B', 'C'])
  const c = h.queue.queueState.pending.find(item => item.musicInfo.id === 'C')
  h.player.playQueueItem(c.queueId)
  assert.deepEqual(h.ids(), ['X', 'Y', 'B'])
  await h.player.playNext(); assert.equal(h.current(), 'X')
})

test('every row can be moved and removed without changing the source list', async t => {
  const h = setup(t)
  h.top('X')
  h.queue.reorderQueue(h.queue.queueState.pending[2].queueId, 0)
  assert.deepEqual(h.ids(), ['C', 'X', 'B'])
  h.queue.removeQueue(h.queue.queueState.pending[2].queueId)
  assert.deepEqual(h.ids(), ['C', 'X'])
  await h.player.playNext(); assert.equal(h.current(), 'C')
  assert.deepEqual(h.lists.get('list').map(s => s.id), ['A', 'B', 'C'])
})

test('previous puts the song we left at the visible head; next always consumes that head', async t => {
  const h = setup(t)
  h.top('X', 'Y')
  await h.player.playNext(); await h.player.playNext()
  await h.player.playPrev(); assert.equal(h.current(), 'X')
  assert.deepEqual(h.ids(), ['Y', 'B', 'C'])
  await h.player.playPrev(); assert.equal(h.current(), 'A')
  assert.deepEqual(h.ids(), ['X', 'Y', 'B', 'C'])
  h.top('Z')
  await h.player.playNext(); assert.equal(h.current(), 'Z')
  await h.player.playNext(); assert.equal(h.current(), 'X')
})

test('undo restores queue edits, but cannot resurrect consumed songs', async t => {
  const h = setup(t)
  h.top('X')
  h.queue.removeQueue(h.queue.queueState.pending[1].queueId)
  assert.deepEqual(h.ids(), ['X', 'C'])
  h.queue.undoQueue(); assert.deepEqual(h.ids(), ['X', 'B', 'C'])
  h.queue.removeQueue(h.queue.queueState.pending[1].queueId)
  await h.player.playNext()
  h.queue.undoQueue(); assert.deepEqual(h.ids(), ['C'])
})

test('clearing the queue prevents fallback to the source playlist, even in random mode', async t => {
  const h = setup(t, 'random')
  h.queue.removeQueue()
  assert.deepEqual(h.ids(), [])
  assert.equal(await h.player.getNextPlayMusicInfo(), null)
  await h.player.playNext(); assert.equal(h.current(), 'A')
  assert.deepEqual(h.ids(), [])
})

test('clear can be undone, including its independent loop contents', t => {
  const h = setup(t, 'listLoop')
  const before = h.snapshot()
  h.queue.removeQueue(); h.queue.undoQueue()
  assert.deepEqual(h.ids(), ['B', 'C'])
  assert.deepEqual(Array.from(h.queue.queueState.cycle, item => item.queueId), Array.from(before.cycle, item => item.queueId))
})

test('the complete random queue is stable and equals preview and actual playback', async t => {
  const h = setup(t, 'random')
  h.lists.set('list', ['A', 'B', 'C', 'D', 'E'].map(h.song))
  h.player.playList('list', 0)
  const order = h.ids()
  assert.equal(new Set(order).size, 4)
  assert(!order.includes('A'))
  assert.deepEqual(Array.from(await h.player.getPlaybackQueueList(), item => item.musicInfo.id), order)
  assert.deepEqual(h.ids(), order)
  for (const id of order) {
    assert.equal((await h.player.getNextPlayMusicInfo()).musicInfo.id, id)
    assert.equal((await h.player.getNextListMusicInfo()).musicInfo.id, id)
    await h.player.playNext(true)
    assert.equal(h.current(), id)
  }
  assert.equal(h.ids().length, 5)
  assert.equal(new Set(h.ids()).size, 5)
  assert.notEqual(h.ids()[0], h.current())
})

test('insertion, movement, deletion and reopening do not reroll random order', async t => {
  const h = setup(t, 'random')
  const order = h.ids()
  h.top('X', 'Y')
  assert.deepEqual(h.ids(), ['X', 'Y', ...order])
  h.queue.reorderQueue(h.queue.queueState.pending[1].queueId, 0)
  assert.deepEqual(h.ids(), ['Y', 'X', ...order])
  await h.player.getPlaybackQueueList(); await h.player.getPlaybackQueueList()
  await h.player.playNext(); assert.equal(h.current(), 'Y')
  await h.player.playNext(); assert.equal(h.current(), 'X')
  assert.deepEqual(h.ids(), order)
})

test('loop repeats the edited queue snapshots and never resurrects a removed song', async t => {
  const h = setup(t, 'listLoop')
  h.queue.removeQueue(h.queue.queueState.pending[0].queueId)
  h.top('X')
  h.lists.set('list', ['NEW'].map(h.song))
  const heard = []
  for (let i = 0; i < 8; i++) { await h.player.playNext(true); heard.push(h.current()) }
  assert.deepEqual(heard, ['X', 'C', 'A', 'X', 'C', 'A', 'X', 'C'])
})

test('leaving shuffle restores the queue order without reading the source playlist', async t => {
  const h = setup(t)
  h.top('X'); h.lists.set('list', ['NEW'].map(h.song))
  const ordered = h.ids()
  h.setting['player.togglePlayMethod'] = 'random'
  h.player.updateQueuePlayMode()
  assert.deepEqual([...h.ids()].sort(), ['B', 'C', 'X'])
  assert.notDeepEqual(h.ids(), ordered)
  h.setting['player.togglePlayMethod'] = 'listLoop'
  h.player.updateQueuePlayMode()
  assert.deepEqual(h.ids(), ordered)
  assert.equal((await h.player.getNextPlayMusicInfo()).musicInfo.id, 'X')
  await h.player.playNext(true); assert.equal(h.current(), 'X')
})

test('a queue started in shuffle retains its normal order for each other playback mode', async t => {
  for (const mode of ['list', 'listLoop', 'singleLoop', 'none']) {
    const h = setup(t, 'random')
    assert.deepEqual(h.ids(), ['C', 'B'])
    h.setting['player.togglePlayMethod'] = mode
    h.player.updateQueuePlayMode()
    assert.deepEqual(h.ids(), ['B', 'C'])
    const preview = await h.player.getNextPlayMusicInfo()
    assert.equal(preview?.musicInfo.id ?? null, mode === 'singleLoop' ? 'A' : mode === 'none' ? null : 'B')
    await h.player.playNext(true)
    assert.equal(h.current(), mode === 'singleLoop' || mode === 'none' ? 'A' : 'B')
    if (mode === 'list' || mode === 'listLoop') {
      await h.player.playNext(true); assert.equal(h.current(), 'C')
      if (mode === 'list') assert.deepEqual(h.ids(), [])
      else {
        assert.deepEqual(h.ids(), ['A', 'B', 'C'])
        await h.player.playNext(true); assert.equal(h.current(), 'A')
      }
    } else {
      assert.deepEqual(h.ids(), ['B', 'C'])
      await h.player.playNext(); assert.equal(h.current(), 'B')
    }
  }
})

test('unshuffling retains insertions and deletions without resurrecting consumed songs', async t => {
  const h = setup(t, 'random')
  h.top('X', 'Y'); h.add('Z')
  await h.player.playNext(); assert.equal(h.current(), 'X')
  const removed = h.queue.queueState.pending.find(item => item.musicInfo.id === 'C')
  h.queue.removeQueue(removed.queueId)
  h.setting['player.togglePlayMethod'] = 'list'
  h.player.updateQueuePlayMode()
  assert.deepEqual(h.ids(), ['Y', 'B', 'Z'])
  for (const id of ['Y', 'B', 'Z']) { await h.player.playNext(true); assert.equal(h.current(), id) }
  assert.deepEqual(h.ids(), [])
})

test('editing before shuffle and undoing edits during shuffle preserve the normal order', t => {
  const h = setup(t)
  h.top('X', 'Y')
  h.queue.reorderQueue(h.queue.queueState.pending[3].queueId, 1)
  const ordered = h.ids()
  h.setting['player.togglePlayMethod'] = 'random'; h.player.updateQueuePlayMode()
  h.queue.removeQueue(h.queue.queueState.pending[1].queueId); h.queue.undoQueue()
  h.setting['player.togglePlayMethod'] = 'list'; h.player.updateQueuePlayMode()
  assert.deepEqual(h.ids(), ordered)
})

test('moving a song in shuffle updates its position relative to the target when unshuffled', t => {
  const h = setup(t, 'random')
  h.top('X')
  h.queue.reorderQueue(h.queue.queueState.pending[2].queueId, 0)
  assert.deepEqual(h.ids(), ['B', 'X', 'C'])
  h.setting['player.togglePlayMethod'] = 'list'; h.player.updateQueuePlayMode()
  assert.deepEqual(h.ids(), ['B', 'X', 'C'])
})

test('repeated random rounds do not overwrite the normal loop order', async t => {
  const h = setup(t, 'random')
  for (let i = 0; i < 5; i++) await h.player.playNext(true)
  h.setting['player.togglePlayMethod'] = 'listLoop'; h.player.updateQueuePlayMode()
  assert.deepEqual(h.ids(), ['A', 'B', 'C'])
  for (const id of ['A', 'B', 'C', 'A']) { await h.player.playNext(true); assert.equal(h.current(), id) }
})

test('switching away from random leaves the current song and consumes only remaining occurrences', async t => {
  const h = setup(t, 'random')
  h.lists.set('list', ['A', 'B', 'C', 'D', 'E'].map(h.song))
  h.player.playList('list', 0)
  await h.player.playNext(true); assert.equal(h.current(), 'C')
  h.lists.delete('list')
  h.setting['player.togglePlayMethod'] = 'list'; h.player.updateQueuePlayMode()
  assert.equal(h.current(), 'C')
  assert.deepEqual(h.ids(), ['B', 'D', 'E'])
  for (const id of ['B', 'D', 'E']) { await h.player.playNext(true); assert.equal(h.current(), id) }
  await h.player.playNext(true)
  assert.equal(h.current(), 'E'); assert.deepEqual(h.ids(), [])
})

test('clearing and undoing a shuffled queue restores both orders', t => {
  const h = setup(t, 'random')
  h.queue.removeQueue(); h.queue.undoQueue()
  assert.deepEqual(h.ids(), ['C', 'B'])
  h.setting['player.togglePlayMethod'] = 'list'; h.player.updateQueuePlayMode()
  assert.deepEqual(h.ids(), ['B', 'C'])
  h.queue.removeQueue()
  h.setting['player.togglePlayMethod'] = 'random'; h.player.updateQueuePlayMode()
  h.setting['player.togglePlayMethod'] = 'listLoop'; h.player.updateQueuePlayMode()
  assert.deepEqual(h.ids(), [])
})

test('mode switches invalidate an in-flight next selection', async t => {
  const h = setup(t, 'random')
  const next = h.player.playNext(true)
  h.setting['player.togglePlayMethod'] = 'list'; h.player.updateQueuePlayMode()
  await next
  assert.equal(h.current(), 'B')
  assert.deepEqual(h.ids(), ['C'])
})

test('single repeat and single play preserve the queue; manual next still consumes its head', async t => {
  for (const mode of ['singleLoop', 'none']) {
    const h = setup(t, mode)
    h.top('X')
    await h.player.playNext(true)
    assert.equal(h.current(), 'A')
    assert.deepEqual(h.ids(), ['X', 'B', 'C'])
    await h.player.playNext(); assert.equal(h.current(), 'X')
    assert.deepEqual(h.ids(), ['B', 'C'])
  }
})

test('sleep-stop does not consume the queue; manual navigation remains available', async t => {
  const h = setup(t)
  h.window.lx.isPlayedStop = true
  await h.player.playNext(true)
  assert.equal(h.current(), 'A'); assert.deepEqual(h.ids(), ['B', 'C'])
  await h.player.playNext(); assert.equal(h.current(), 'B')
})

test('a newer source selection wins over an in-flight next request', async t => {
  const h = setup(t)
  const next = h.player.playNext()
  h.player.playList('list', 2)
  await next
  assert.equal(h.current(), 'C'); assert.deepEqual(h.ids(), [])
})

test('editing the queue during next selection re-evaluates its head', async t => {
  const h = setup(t)
  const next = h.player.playNext()
  h.top('X')
  await next
  assert.equal(h.current(), 'X'); assert.deepEqual(h.ids(), ['B', 'C'])
})

test('late audio URLs from repeated selections cannot replace the current request', async t => {
  const h = setup(t)
  await h.flush()
  const pending = []
  h.music.getMusicUrl = () => new Promise(resolve => pending.push(resolve))
  h.player.playList('list', 0); await h.flush()
  h.player.playList('list', 0); await h.flush()
  pending[1]('new-url'); await h.flush()
  pending[0]('old-url'); await h.flush()
  assert.equal(h.resources.at(-1), 'new-url')
  assert(!h.resources.includes('old-url'))
})

test('restart restores full queue, current song and random order even with no source playlists', async t => {
  const h = setup(t, 'random')
  h.top('X', 'Y'); await h.player.playNext()
  const snapshot = h.snapshot()
  const restored = createHarness(); t.after(restored.cleanup)
  restored.setting['player.togglePlayMethod'] = 'random'
  restored.player.restoreQueuePlayback(restored.model.parseQueueSnapshot(snapshot))
  assert.equal(restored.current(), 'X')
  assert.equal(restored.state.isPlay.value, false)
  assert.deepEqual(restored.ids(), h.ids())
  await restored.player.playNext(); assert.equal(restored.current(), 'Y')
  assert.deepEqual(restored.ids(), h.ids().slice(1))
})

test('an intentionally empty queue stays empty after restart', async t => {
  const h = setup(t, 'random')
  h.queue.removeQueue()
  const restored = createHarness(); t.after(restored.cleanup)
  restored.setting['player.togglePlayMethod'] = 'random'
  restored.lists.set('list', ['A', 'B', 'C'].map(restored.song))
  restored.player.restoreQueuePlayback(h.snapshot())
  assert.deepEqual(restored.ids(), [])
  assert.equal(await restored.player.getNextPlayMusicInfo(), null)
})

test('restart retains the unshuffled order even after the source playlist is deleted', async t => {
  const h = setup(t, 'random')
  h.top('X'); await h.player.playNext()
  const restored = createHarness(); t.after(restored.cleanup)
  restored.setting['player.togglePlayMethod'] = 'random'
  restored.player.restoreQueuePlayback(restored.model.parseQueueSnapshot(h.snapshot()))
  assert.deepEqual(restored.ids(), ['C', 'B'])
  restored.setting['player.togglePlayMethod'] = 'list'; restored.player.updateQueuePlayMode()
  assert.deepEqual(restored.ids(), ['B', 'C'])
  await restored.player.playNext(true); assert.equal(restored.current(), 'B')
})

test('old playlist plus inserted queue snapshots migrate once into one queue', async t => {
  const h = setup(t, 'random')
  const snapshot = { version: 1, pending: [{ musicInfo: h.song('X'), listId: null, isTempPlay: true, queueId: 'old-X' }],
    current: { musicInfo: h.song('A'), listId: 'list', isTempPlay: false },
    anchor: { listId: 'list', musicId: 'A', index: 0 }, time: 0, duration: 0,
    random: { listId: 'list', ids: ['A', 'C', 'B'] } }
  h.player.restoreQueuePlayback(h.model.parseQueueSnapshot(snapshot))
  assert.deepEqual(h.ids(), ['X', 'C', 'B'])
  h.lists.delete('list')
  await h.player.playNext(); assert.equal(h.current(), 'X')
  await h.player.playNext(); assert.equal(h.current(), 'C')
})

test('older independent snapshots without an order field retain their saved queue on upgrade', t => {
  const h = setup(t, 'random')
  const snapshot = h.snapshot()
  delete snapshot.order
  const restored = createHarness(); t.after(restored.cleanup)
  restored.setting['player.togglePlayMethod'] = 'random'
  restored.player.restoreQueuePlayback(restored.model.parseQueueSnapshot(snapshot))
  assert.deepEqual(restored.ids(), ['C', 'B'])
  restored.setting['player.togglePlayMethod'] = 'list'; restored.player.updateQueuePlayMode()
  assert.deepEqual(restored.ids(), ['C', 'B'])
})

test('snapshot validation rejects corruption and strips resolved URLs', t => {
  const h = setup(t)
  h.queue.queueState.pending[0].musicInfo.meta.url = 'https://expired.example/audio'
  const snapshot = h.snapshot()
  assert(h.model.parseQueueSnapshot(snapshot))
  assert.equal(snapshot.pending[0].musicInfo.meta.url, undefined)
  assert.equal(h.model.parseQueueSnapshot({ ...snapshot, pending: [null] }), null)
  assert.equal(h.model.parseQueueSnapshot({ ...snapshot, cycle: undefined }), null)
  assert.equal(h.model.parseQueueSnapshot({ ...snapshot, time: NaN }), null)
  assert.equal(h.model.parseQueueSnapshot({ ...snapshot, pending: [snapshot.pending[0], snapshot.pending[0]] }), null)
  assert.equal(h.model.parseQueueSnapshot({ ...snapshot, order: [] }), null)
  assert.equal(h.model.parseQueueSnapshot({ ...snapshot, order: ['unknown', snapshot.order[1]] }), null)
  assert.equal(h.model.parseQueueSnapshot({ ...snapshot, order: [snapshot.order[0], snapshot.order[0]] }), null)
})

test('adding songs to an empty player starts the first song and retains the rest', async t => {
  const h = createHarness(); t.after(h.cleanup)
  h.add('X', 'Y'); await h.flush()
  assert.equal(h.current(), 'X'); assert.deepEqual(h.ids(), ['Y'])
})
