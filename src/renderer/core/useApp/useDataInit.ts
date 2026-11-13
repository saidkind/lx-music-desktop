import { getPlayInfo, getPlayQueue } from '@renderer/utils/ipc'
import music from '@renderer/utils/musicSdk'
import { log } from '@common/utils'
import { getListMusics, getUserLists, registerAction } from '@renderer/store/list/action'


import useInitUserApi from './useInitUserApi'
import { play, playList, restoreQueuePlayback } from '@renderer/core/player'
import { parseQueueSnapshot } from '@renderer/core/player/queueModel'
import { queueReady } from '@renderer/store/player/queue'
import { getDownloadList } from '@renderer/store/download/action'
import { LIST_IDS } from '@common/constants'
import { onBeforeUnmount } from '@common/utils/vueTools'
import { appSetting } from '@renderer/store/setting'
import { playMusicInfo } from '@renderer/store/player/state'
import { initDislikeInfo, registerRemoteDislikeAction } from '@renderer/core/dislikeList'

const initPrevPlayInfo = async() => {
  window.lx.restorePlayInfo = null
  const loadList = async(id: string) => id === LIST_IDS.DOWNLOAD ? getDownloadList() : getListMusics(id)
  const snapshot = parseQueueSnapshot(await getPlayQueue())
  if (snapshot) {
    if (snapshot.version === 1 && snapshot.anchor.listId) await loadList(snapshot.anchor.listId)
    if (snapshot.version === 1 && snapshot.current?.listId && snapshot.current.listId !== snapshot.anchor.listId) await loadList(snapshot.current.listId)
    restoreQueuePlayback(snapshot)
  } else {
    const info = await getPlayInfo()
    if (!info?.listId || info.index < 0) return
    const list = await loadList(info.listId)
    if (!list[info.index]) return
    window.lx.restorePlayInfo = info
    playList(info.listId, info.index)
  }

  if (appSetting['player.startupAutoPlay']) {
    const musicInfo = playMusicInfo.musicInfo
    if (!musicInfo) return
    setTimeout(() => {
      if (musicInfo.id == playMusicInfo.musicInfo?.id) play()
    })
  }
}

export default () => {
  const initUserApi = useInitUserApi()

  let unregister: null | (() => void) = null
  let unregisterDislikeEvent: null | (() => void) = null

  onBeforeUnmount(() => {
    if (unregister) unregister()
    if (unregisterDislikeEvent) unregisterDislikeEvent()
  })

  return async() => {
    await Promise.all([
      initUserApi(), // 自定义API
    ]).catch(err => {
      log.error(err)
    })
    void music.init() // 初始化音乐sdk
    unregister = registerAction((ids) => {
      window.app_event.myListUpdate(ids)
    })
    window.lxData.userLists = await getUserLists() // 获取用户列表
    unregisterDislikeEvent = registerRemoteDislikeAction()
    await initDislikeInfo() // 获取不喜欢列表
    await initPrevPlayInfo().catch(err => {
      log.error(err)
    }).finally(() => {
      queueReady.value = true
    }) // 初始化上次的歌曲播放信息
  }
}
