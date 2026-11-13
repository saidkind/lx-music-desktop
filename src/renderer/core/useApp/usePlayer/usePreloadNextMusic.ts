import { onBeforeUnmount, watch } from '@common/utils/vueTools'
import { onTimeupdate, getCurrentTime } from '@renderer/plugins/player'
import { playProgress } from '@renderer/store/player/playProgress'
import { musicInfo } from '@renderer/store/player/state'
import { queueState } from '@renderer/store/player/queue'
import { getNextPlayMusicInfo } from '@renderer/core/player'
import { getMusicUrl } from '@renderer/core/music'

export default () => {
  let generation = 0
  const state = { loading: false, prepared: false }
  let lastAttempt = -Infinity
  let cancelCheck: (() => void) | null = null

  const checkMusicUrl = async(url: string): Promise<boolean> => new Promise(resolve => {
    const audio = new Audio()
    audio.preload = 'auto'
    audio.crossOrigin = 'anonymous'
    audio.muted = true
    const finish = (result: boolean) => {
      clearTimeout(timer)
      audio.removeEventListener('error', onError)
      audio.removeEventListener('canplay', onReady)
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      cancelCheck = null
      resolve(result)
    }
    const onReady = () => { finish(true) }
    const onError = () => { finish(false) }
    const timer = setTimeout(onError, 8000)
    cancelCheck = () => { finish(false) }
    audio.addEventListener('error', onError)
    audio.addEventListener('canplay', onReady)
    audio.src = url
  })

  const reset = () => {
    generation++
    cancelCheck?.()
    state.loading = false
    state.prepared = false
    lastAttempt = -Infinity
  }

  const preload = async() => {
    if (state.loading || state.prepared || performance.now() - lastAttempt < 3000) return
    const version = generation
    state.loading = true
    lastAttempt = performance.now()
    try {
      const info = await getNextPlayMusicInfo()
      if (!info || version !== generation) return
      let url = await getMusicUrl({ musicInfo: info.musicInfo }).catch(() => '')
      if (!url || version !== generation) return
      let valid = await checkMusicUrl(url)
      if (version !== generation) return
      if (!valid) {
        url = await getMusicUrl({ musicInfo: info.musicInfo, isRefresh: true }).catch(() => '')
        if (!url || version !== generation) return
        valid = await checkMusicUrl(url)
      }
      if (version === generation) state.prepared = valid
    } catch {
      // Preloading is best-effort; playback will resolve and report failures itself.
    } finally {
      if (version === generation) state.loading = false
    }
  }

  watch(() => queueState.revision, reset, { flush: 'sync' })
  window.app_event.on('setProgress', reset)
  window.app_event.on('musicToggled', reset)
  const removeTimeupdate = onTimeupdate(() => {
    if (window.lx.isPlayedStop || !musicInfo.id) return
    const remaining = playProgress.maxPlayTime - getCurrentTime()
    if (playProgress.maxPlayTime > 10 && remaining > 0 && remaining < 10) void preload()
  })
  onBeforeUnmount(() => {
    reset()
    removeTimeupdate()
    window.app_event.off('setProgress', reset)
    window.app_event.off('musicToggled', reset)
  })
}
