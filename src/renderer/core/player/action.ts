import { isEmpty, setPause, setPlay, setResource, setStop } from '@renderer/plugins/player'
import { isPlay, playMusicInfo, musicInfo as _musicInfo } from '@renderer/store/player/state'
import {
  getList,
  clearPlayedList,
  setPlayMusicInfo,
  addPlayedList,
  setMusicInfo,
  setAllStatus,
  setPlayListId,
} from '@renderer/store/player/action'
import { appSetting } from '@renderer/store/setting'
import { getMusicUrl, getPicPath, getLyricInfo } from '../music/index'
import { requestMsg } from '@renderer/utils/message'
import { getRandom } from '@renderer/utils/index'
import { addListMusics, removeListMusics } from '@renderer/store/list/action'
import { loveList } from '@renderer/store/list/state'
import { queueState } from '@renderer/store/player/queue'
import { takeQueueItem, traverseHistory, createQueueItem, replaceQueue, shuffleQueue, getOrderedQueue } from './queueModel'
import { addDislikeInfo, hasDislike } from '@renderer/core/dislikeList'
// import { checkMusicFileAvailable } from '@renderer/utils/music'

let gettingUrlId = ''
let musicRequest = 0
let navigationRequest = 0
const createGettingUrlId = (musicInfo: LX.Music.MusicInfo | LX.Download.ListItem) => {
  const tInfo = 'progress' in musicInfo ? musicInfo.metadata.musicInfo.meta.toggleMusicInfo : musicInfo.meta.toggleMusicInfo
  return `${musicInfo.id}_${tInfo?.id ?? ''}`
}
const createDelayNextTimeout = (delay: number) => {
  let timeout: NodeJS.Timeout | null
  const clearDelayNextTimeout = () => {
    // console.log(this.timeout)
    if (timeout) {
      clearTimeout(timeout)
      timeout = null
    }
  }

  const addDelayNextTimeout = () => {
    clearDelayNextTimeout()
    timeout = setTimeout(() => {
      timeout = null
      if (window.lx.isPlayedStop) return
      console.warn('delay next timeout timeout', delay)
      void playNext(true)
    }, delay)
  }

  return {
    clearDelayNextTimeout,
    addDelayNextTimeout,
  }
}
const { addDelayNextTimeout, clearDelayNextTimeout } = createDelayNextTimeout(5000)
const { addDelayNextTimeout: addLoadTimeout, clearDelayNextTimeout: clearLoadTimeout } = createDelayNextTimeout(100000)

/**
 * 检查音乐信息是否已更改
 */
const diffCurrentMusicInfo = (curMusicInfo: LX.Music.MusicInfo | LX.Download.ListItem, request = musicRequest): boolean => {
  // return curMusicInfo !== playMusicInfo.musicInfo || isPlay.value
  return request !== musicRequest || gettingUrlId != createGettingUrlId(curMusicInfo) || curMusicInfo.id != playMusicInfo.musicInfo?.id || isPlay.value
}

let cancelDelayRetry: (() => void) | null = null
const delayRetry = async(musicInfo: LX.Music.MusicInfo | LX.Download.ListItem, isRefresh: boolean, request: number): Promise<string | null> => {
  // if (cancelDelayRetry) cancelDelayRetry()
  return new Promise<string | null>((resolve, reject) => {
    const time = getRandom(2, 6)
    setAllStatus(window.i18n.t('player__getting_url_delay_retry', { time }))
    const tiemout = setTimeout(() => {
      getMusicPlayUrl(musicInfo, isRefresh, true, request).then((result) => {
        if (request === musicRequest) cancelDelayRetry = null
        resolve(result)
      }).catch(async(err: any) => {
        if (request === musicRequest) cancelDelayRetry = null
        reject(err)
      })
    }, time * 1000)
    cancelDelayRetry = () => {
      clearTimeout(tiemout)
      cancelDelayRetry = null
      resolve(null)
    }
  })
}
const getMusicPlayUrl = async(musicInfo: LX.Music.MusicInfo | LX.Download.ListItem, isRefresh = false, isRetryed = false, request = musicRequest): Promise<string | null> => {
  // this.musicInfo.url = await getMusicPlayUrl(targetSong, type)
  if (request !== musicRequest || window.lx.isPlayedStop) return null
  setAllStatus(window.i18n.t('player__getting_url'))
  if (appSetting['player.autoSkipOnError']) addLoadTimeout()

  return getMusicUrl({
    musicInfo,
    isRefresh,
    onToggleSource(mInfo) {
      if (diffCurrentMusicInfo(musicInfo, request)) return
      setAllStatus(window.i18n.t('toggle_source_try'))
    },
  }).then(url => {
    if (window.lx.isPlayedStop || diffCurrentMusicInfo(musicInfo, request)) return null

    return url
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  }).catch(err => {
    // console.log('err', err.message)
    if (window.lx.isPlayedStop ||
      diffCurrentMusicInfo(musicInfo, request) ||
      err.message == requestMsg.cancelRequest) return null

    if (err.message == requestMsg.tooManyRequests) return delayRetry(musicInfo, isRefresh, request)

    if (!isRetryed) return getMusicPlayUrl(musicInfo, isRefresh, true, request)

    throw err
  })
}

export const setMusicUrl = (musicInfo: LX.Music.MusicInfo | LX.Download.ListItem, isRefresh?: boolean) => {
  // if (appSetting['player.autoSkipOnError']) addLoadTimeout()
  if (!diffCurrentMusicInfo(musicInfo)) return
  if (cancelDelayRetry) cancelDelayRetry()
  gettingUrlId = createGettingUrlId(musicInfo)
  const request = ++musicRequest
  void getMusicPlayUrl(musicInfo, isRefresh, false, request).then((url) => {
    if (!url || request !== musicRequest) return
    setResource(url)
  }).catch((err: any) => {
    if (request !== musicRequest) return
    console.log(err)
    setAllStatus(err.message)
    window.app_event.error()
    if (appSetting['player.autoSkipOnError']) addDelayNextTimeout()
  }).finally(() => {
    if (request === musicRequest) {
      gettingUrlId = ''
      clearLoadTimeout()
    }
  })
}

// 恢复上次播放的状态
const handleRestorePlay = async(restorePlayInfo: LX.Player.SavedPlayInfo) => {
  const request = navigationRequest
  const musicInfo = playMusicInfo.musicInfo
  if (!musicInfo) return

  setImmediate(() => {
    if (request !== navigationRequest || musicInfo.id != playMusicInfo.musicInfo?.id) return
    window.app_event.setProgress(appSetting['player.isSavePlayTime'] ? restorePlayInfo.time : 0, restorePlayInfo.maxTime)
    window.app_event.pause()
  })


  void getPicPath({ musicInfo, listId: playMusicInfo.listId }).then((url: string) => {
    if (request !== navigationRequest || musicInfo.id != playMusicInfo.musicInfo?.id || url == _musicInfo.pic) return
    setMusicInfo({ pic: url })
    window.app_event.picUpdated()
  }).catch(_ => _)

  void getLyricInfo({ musicInfo }).then((lyricInfo) => {
    if (request !== navigationRequest || musicInfo.id != playMusicInfo.musicInfo?.id) return
    setMusicInfo({
      lrc: lyricInfo.lyric,
      tlrc: lyricInfo.tlyric,
      lxlrc: lyricInfo.lxlyric,
      rlrc: lyricInfo.rlyric,
      rawlrc: lyricInfo.rawlrcInfo.lyric,
    })
    window.app_event.lyricUpdated()
  }).catch((err) => {
    console.log(err)
    if (request !== navigationRequest || musicInfo.id != playMusicInfo.musicInfo?.id) return
    setAllStatus(window.i18n.t('lyric__load_error'))
  })

  if (appSetting['player.togglePlayMethod'] == 'random' && !playMusicInfo.isTempPlay) addPlayedList({ ...playMusicInfo as LX.Player.PlayMusicInfo })
}


// 处理音乐播放
const handlePlay = () => {
  navigationRequest++
  musicRequest++
  gettingUrlId = ''
  if (cancelDelayRetry) cancelDelayRetry()
  clearDelayNextTimeout()
  clearLoadTimeout()
  window.lx.isPlayedStop &&= false

  if (window.lx.restorePlayInfo) {
    void handleRestorePlay(window.lx.restorePlayInfo)
    window.lx.restorePlayInfo = null
    return
  }
  const request = navigationRequest
  const musicInfo = playMusicInfo.musicInfo

  if (!musicInfo) return

  setStop()
  window.app_event.pause()

  clearDelayNextTimeout()
  clearLoadTimeout()


  if (appSetting['player.togglePlayMethod'] == 'random' && !playMusicInfo.isTempPlay) addPlayedList({ ...(playMusicInfo as LX.Player.PlayMusicInfo) })

  setMusicUrl(musicInfo)

  void getPicPath({ musicInfo, listId: playMusicInfo.listId }).then((url: string) => {
    if (request !== navigationRequest || musicInfo.id != playMusicInfo.musicInfo?.id || url == _musicInfo.pic) return
    setMusicInfo({ pic: url })
    window.app_event.picUpdated()
  }).catch(_ => _)

  void getLyricInfo({ musicInfo }).then((lyricInfo) => {
    if (request !== navigationRequest || musicInfo.id != playMusicInfo.musicInfo?.id) return
    setMusicInfo({
      lrc: lyricInfo.lyric,
      tlrc: lyricInfo.tlyric,
      lxlrc: lyricInfo.lxlyric,
      rlrc: lyricInfo.rlyric,
      rawlrc: lyricInfo.rawlrcInfo.lyric,
    })
    window.app_event.lyricUpdated()
  }).catch((err) => {
    console.log(err)
    if (request !== navigationRequest || musicInfo.id != playMusicInfo.musicInfo?.id) return
    setAllStatus(window.i18n.t('lyric__load_error'))
  })
}

/**
 * 播放列表内歌曲
 * @param listId 列表id
 * @param id 歌曲id
 */
export const playListById = (listId: string, id: string) => {
  const index = getList(listId).findIndex(m => m.id === id)
  if (index >= 0) playList(listId, index)
}

/** Selecting a source song starts a new, independent queue. */
export const playList = (listId: string, index: number) => {
  const source = getList(listId)
  const selected = source[index]
  if (!selected) return
  const entries = source.filter(info => info.id === selected.id || isQueuePlayable(info))
    .map(musicInfo => createQueueItem({ musicInfo, listId, isTempPlay: false }, () => crypto.randomUUID()))
  const currentIndex = entries.findIndex(item => item.musicInfo.id === selected.id)
  const current = entries[currentIndex]
  const mode = appSetting['player.togglePlayMethod']
  const upcoming = entries.slice(currentIndex + 1)
  if (mode !== 'list') upcoming.push(...entries.slice(0, currentIndex))
  queueState.cycle = [current, ...upcoming]
  queueState.history.splice(0)
  queueState.cursor = -1
  replaceQueue(queueState, mode === 'random' ? shuffleQueue(upcoming, max => getRandom(0, max)) : upcoming, upcoming.map(item => item.queueId))
  clearPlayedList()
  handlePlayNext(current)
}

const isQueuePlayable = (info: LX.Player.PlayMusicInfo['musicInfo']) => 'progress' in info ? info.isComplate : !hasDislike(info)

/** A new loop uses only queue snapshots, never reads the source playlist. */
const fillQueueCycle = () => {
  if (queueState.pending.length || !queueState.cycle.length) return
  const mode = appSetting['player.togglePlayMethod']
  if (mode !== 'random' && mode !== 'listLoop') return
  const nextCycle = queueState.cycle.filter(item => isQueuePlayable(item.musicInfo)).map(info => ({ ...info, queueId: crypto.randomUUID() }))
  let entries = nextCycle
  if (mode === 'random') {
    entries = shuffleQueue(entries, max => getRandom(0, max))
    const nextIndex = entries.findIndex(item => item.musicInfo.id !== playMusicInfo.musicInfo?.id)
    if (nextIndex > 0) [entries[0], entries[nextIndex]] = [entries[nextIndex], entries[0]]
  }
  queueState.cycle = [...nextCycle]
  replaceQueue(queueState, entries, nextCycle.map(item => item.queueId))
}

/** Change shuffle once, then preview, preload and playback all use the same order. */
export const updateQueuePlayMode = () => {
  if (appSetting['player.togglePlayMethod'] === 'random') {
    replaceQueue(queueState, shuffleQueue(queueState.pending, max => getRandom(0, max)), queueState.order)
  } else replaceQueue(queueState, getOrderedQueue(queueState))
  fillQueueCycle()
}

export const getPlaybackQueueList = async(): Promise<LX.Player.QueueItem[]> => [...queueState.pending]

/** The first visible row is also the manually selected next song. */
export const getNextPlayMusicInfo = async(isAutoToggle = true): Promise<LX.Player.PlayMusicInfo | null> => {
  if (isAutoToggle) {
    const mode = appSetting['player.togglePlayMethod']
    if (mode === 'none') return null
    if (mode === 'singleLoop' && playMusicInfo.musicInfo) return { ...playMusicInfo, musicInfo: playMusicInfo.musicInfo }
  }
  return queueState.pending[0] ?? null
}

export const getNextListMusicInfo = getNextPlayMusicInfo

const handlePlayNext = (info: LX.Player.PlayMusicInfo, recordHistory = true) => {
  setPlayListId(info.listId)
  setPlayMusicInfo(info.listId, info.musicInfo, info.isTempPlay, recordHistory, info.queueId)
  handlePlay()
  fillQueueCycle()
}

export const playQueueItem = (queueId: string) => {
  const item = takeQueueItem(queueState, queueId)
  if (item) handlePlayNext(item)
}

export const restoreQueuePlayback = (snapshot: LX.Player.QueueSnapshot) => {
  let current = snapshot.current
  if (snapshot.version === 2) {
    replaceQueue(queueState, snapshot.pending, snapshot.order)
    queueState.cycle = snapshot.cycle!.slice()
  } else {
    // Convert the old playlist + inserted-tracks model once, preserving its next song.
    const { anchor } = snapshot
    let source = getList(anchor.listId).filter(isQueuePlayable)
    if (snapshot.random?.listId === anchor.listId) {
      const byId = new Map(source.map(info => [info.id, info]))
      const ids = snapshot.random.ids.filter(id => byId.has(id))
      source = [...ids.map(id => byId.get(id)!), ...source.filter(info => !ids.includes(info.id))]
    }
    const index = source.findIndex(info => info.id === anchor.musicId)
    let upcoming = source.slice(index + 1)
    if (appSetting['player.togglePlayMethod'] !== 'list') upcoming.push(...source.slice(0, index + 1))
    if (current && !current.isTempPlay) upcoming = upcoming.filter(info => info.id !== current!.musicInfo.id)
    const entries = upcoming.map(musicInfo => createQueueItem({ musicInfo, listId: anchor.listId, isTempPlay: false }, () => crypto.randomUUID()))
    if (appSetting['player.togglePlayMethod'] === 'random' && !snapshot.random?.ids.length) {
      entries.splice(0, entries.length, ...shuffleQueue(entries, max => getRandom(0, max)))
    }
    current = current ? createQueueItem(current, () => crypto.randomUUID()) : null
    replaceQueue(queueState, [...snapshot.pending, ...entries])
    queueState.cycle = [...(current ? [current as LX.Player.QueueItem] : []), ...queueState.pending]
  }
  queueState.history.splice(0)
  queueState.cursor = -1
  if (!current) return
  window.lx.restorePlayInfo = { time: snapshot.time, maxTime: snapshot.duration, listId: current.listId ?? '', index: snapshot.anchor.index }
  // An intentionally cleared queue must stay empty across restarts.
  setPlayListId(current.listId)
  setPlayMusicInfo(current.listId, current.musicInfo, current.isTempPlay, true, current.queueId)
  handlePlay()
}

export const playNext = async(isAutoToggle = false): Promise<void> => {
  if (isAutoToggle && window.lx.isPlayedStop) return
  const request = ++navigationRequest
  const revision = queueState.revision
  const next = await getNextPlayMusicInfo(isAutoToggle)
  if (request !== navigationRequest || (isAutoToggle && window.lx.isPlayedStop)) return
  if (revision !== queueState.revision) return playNext(isAutoToggle)
  if (!next) { stop(); return }
  if (isAutoToggle && appSetting['player.togglePlayMethod'] === 'singleLoop') {
    handlePlayNext(next, false)
    return
  }
  const item = next.queueId ? takeQueueItem(queueState, next.queueId) : null
  if (item) handlePlayNext(item)
}

export const playPrev = async(): Promise<void> => {
  const previous = traverseHistory(queueState, -1)
  if (!previous) return
  // Returning to a previous song puts the song we left at the visible queue head.
  if (playMusicInfo.musicInfo) {
    const current = createQueueItem(playMusicInfo as LX.Player.PlayMusicInfo, () => crypto.randomUUID())
    queueState.pending.unshift(current)
    queueState.order = [current.queueId, ...queueState.order]
    queueState.revision++
  }
  handlePlayNext(previous.info, false)
}

/**
 * 恢复播放
 */
export const play = () => {
  window.lx.isPlayedStop &&= false
  if (playMusicInfo.musicInfo == null) return
  if (isEmpty()) {
    if (createGettingUrlId(playMusicInfo.musicInfo) != gettingUrlId) setMusicUrl(playMusicInfo.musicInfo)
    return
  }
  setPlay()
}

/**
 * 暂停播放
 */
export const pause = () => {
  setPause()
}

/**
 * 停止播放
 */
export const stop = () => {
  navigationRequest++
  musicRequest++
  gettingUrlId = ''
  if (cancelDelayRetry) cancelDelayRetry()
  clearDelayNextTimeout()
  clearLoadTimeout()
  setStop()
  window.app_event.stop()
}

/**
 * 播放、暂停播放切换
 */
export const togglePlay = () => {
  window.lx.isPlayedStop &&= false
  if (isPlay.value) {
    pause()
  } else {
    play()
  }
}

/**
 * 收藏当前播放的歌曲
 */
export const collectMusic = () => {
  if (!playMusicInfo.musicInfo) return
  void addListMusics(loveList.id, ['progress' in playMusicInfo.musicInfo ? playMusicInfo.musicInfo.metadata.musicInfo : playMusicInfo.musicInfo])
}

/**
 * 取消收藏当前播放的歌曲
 */
export const uncollectMusic = () => {
  if (!playMusicInfo.musicInfo) return
  void removeListMusics({ listId: loveList.id, ids: ['progress' in playMusicInfo.musicInfo ? playMusicInfo.musicInfo.metadata.musicInfo.id : playMusicInfo.musicInfo.id] })
}

/**
 * 不喜欢当前播放的歌曲
 */
export const dislikeMusic = async() => {
  if (!playMusicInfo.musicInfo) return
  const minfo = 'progress' in playMusicInfo.musicInfo ? playMusicInfo.musicInfo.metadata.musicInfo : playMusicInfo.musicInfo
  await addDislikeInfo([{ name: minfo.name, singer: minfo.singer }])
  const dislikedIds = new Set(queueState.pending.filter(item => hasDislike(item.musicInfo)).map(item => item.queueId))
  replaceQueue(queueState, queueState.pending.filter(item => !dislikedIds.has(item.queueId)), queueState.order)
  queueState.cycle = queueState.cycle.filter(item => !hasDislike(item.musicInfo))
  await playNext(true)
}
