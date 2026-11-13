import { getDownloadFilePath } from '@renderer/utils/music'
import { encodePath } from '@common/utils/common'
import { QUALITYS } from '@common/constants'
import { getDownloadList } from '@renderer/store/download/action'

import {
  getPicUrl as getOnlinePicUrl,
  getLyricInfo as getOnlineLyricInfo,
} from './online'
import { buildLyricInfo, getCachedLyricInfo } from './utils'
import { buildSavePath } from '@renderer/store/download/utils'

export const getDownloadedFileUrl = async(musicInfo: LX.Music.MusicInfoOnline | LX.Download.ListItem): Promise<string> => {
  // 从下载列表点播时，优先使用用户选中的那份文件。
  if ('progress' in musicInfo) {
    const path = await getDownloadFilePath(musicInfo, buildSavePath(musicInfo))
    if (path) return encodePath(path)
  }
  const info = 'progress' in musicInfo ? musicInfo.metadata.musicInfo : musicInfo
  const list = await getDownloadList()
  const candidates = list.filter(item => item.isComplate &&
    item.metadata.musicInfo.source === info.source && item.metadata.musicInfo.id === info.id,
  ).sort((a, b) => QUALITYS.indexOf(a.metadata.quality) - QUALITYS.indexOf(b.metadata.quality))
  for (const item of candidates) {
    const path = await getDownloadFilePath(item, buildSavePath(item))
    if (path) return encodePath(path)
  }
  return ''
}

export const getPicUrl = async({ musicInfo, isRefresh, listId, onToggleSource = () => {} }: {
  musicInfo: LX.Download.ListItem
  isRefresh: boolean
  listId?: string | null
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<string> => {
  if (!isRefresh) {
    const path = await getDownloadFilePath(musicInfo, buildSavePath(musicInfo))
    if (path) {
      const pic = await window.lx.worker.main.getMusicFilePic(path)
      if (pic) return pic
    }

    const onlineMusicInfo = musicInfo.metadata.musicInfo
    if (onlineMusicInfo.meta.picUrl) return onlineMusicInfo.meta.picUrl
  }

  return getOnlinePicUrl({ musicInfo: musicInfo.metadata.musicInfo, isRefresh, onToggleSource }).then((url) => {
    // TODO: when listId required save url (update downloadInfo)

    return url
  })
}

export const getLyricInfo = async({ musicInfo, isRefresh, onToggleSource = () => {} }: {
  musicInfo: LX.Download.ListItem
  isRefresh: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<LX.Player.LyricInfo> => {
  if (!isRefresh) {
    const lyricInfo = await getCachedLyricInfo(musicInfo.metadata.musicInfo)
    if (lyricInfo) return buildLyricInfo(lyricInfo)
  }

  return getOnlineLyricInfo({
    musicInfo: musicInfo.metadata.musicInfo,
    isRefresh,
    onToggleSource,
  }).catch(async() => {
    // 尝试读取文件内歌词
    const path = await getDownloadFilePath(musicInfo, buildSavePath(musicInfo))
    if (path) {
      const rawlrcInfo = await window.lx.worker.main.getMusicFileLyric(path)
      if (rawlrcInfo) return buildLyricInfo(rawlrcInfo)
    }

    throw new Error('failed')
  })
}
