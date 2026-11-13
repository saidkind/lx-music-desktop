import { watch, onBeforeUnmount, toRaw } from '@common/utils/vueTools'
import { playMusicInfo, playInfo } from '@renderer/store/player/state'
import { playProgress } from '@renderer/store/player/playProgress'
import { queueState, queueReady } from '@renderer/store/player/queue'
import { appSetting } from '@renderer/store/setting'
import { savePlayQueue } from '@renderer/utils/ipc'
import { serializeQueue } from '@renderer/core/player/queueModel'

export default () => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const save = () => {
    clearTimeout(timer)
    timer = undefined
    if (!queueReady.value) return
    const current: LX.Player.PlayMusicInfo | null = playMusicInfo.musicInfo ? { musicInfo: toRaw(playMusicInfo.musicInfo), listId: playMusicInfo.listId, isTempPlay: playMusicInfo.isTempPlay, queueId: playMusicInfo.queueId } : null
    savePlayQueue(serializeQueue({
      version: 2,
      pending: toRaw(queueState.pending),
      current,
      cycle: toRaw(queueState.cycle),
      order: toRaw(queueState.order),
      anchor: { listId: playInfo.playerListId, musicId: playInfo.playerMusicId, index: playInfo.playerPlayIndex },
      time: appSetting['player.isSavePlayTime'] ? playProgress.nowPlayTime : 0,
      duration: playProgress.maxPlayTime,
    }))
  }
  // Queue edits are saved immediately after the synchronous playback transition.
  watch(() => [queueReady.value, queueState.revision, playInfo.playerMusicId, playMusicInfo.musicInfo], save, { flush: 'post' })
  watch(() => playProgress.nowPlayTime, () => {
    if (!timer && queueReady.value && appSetting['player.isSavePlayTime']) timer = setTimeout(save, 2000)
  })
  window.addEventListener('beforeunload', save)
  window.app_event.on('pause', save)
  onBeforeUnmount(() => {
    save()
    window.removeEventListener('beforeunload', save)
    window.app_event.off('pause', save)
  })
}
