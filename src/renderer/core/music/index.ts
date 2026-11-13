import { encodePath } from '@common/utils/common'
import { getLocalFilePath } from '@renderer/utils/music'

import {
  getMusicUrl as getOnlineMusicUrl,
  getPicUrl as getOnlinePicUrl,
  getLyricInfo as getOnlineLyricInfo,
} from './online'
import {
  getDownloadedFileUrl,
  getPicUrl as getDownloadPicUrl,
  getLyricInfo as getDownloadLyricInfo,
} from './download'
import {
  getMusicUrl as getLocalMusicUrl,
  getPicUrl as getLocalPicUrl,
  getLyricInfo as getLocalLyricInfo,
} from './local'


export const getMusicUrl = async({
  musicInfo,
  quality,
  isRefresh = false,
  onToggleSource,
  allowToggleSource,
}: {
  musicInfo: LX.Music.MusicInfo | LX.Download.ListItem
  isRefresh?: boolean
  quality?: LX.Quality
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
  allowToggleSource?: boolean
}): Promise<string> => {
  const info = 'progress' in musicInfo ? musicInfo.metadata.musicInfo : musicInfo
  // 音频加载失败后的刷新必须跳过本地文件，避免反复重试损坏的文件。
  if (!isRefresh) {
    const localUrl = await (info.source === 'local'
      ? getLocalFilePath(info).then(path => path ? encodePath(path) : '')
      : getDownloadedFileUrl('progress' in musicInfo ? musicInfo : info)
    ).catch(() => '')
    if (localUrl) return localUrl
  }
  // 已保存的换源信息仅用于在线回退，不能抢在本地文件之前。
  if (info.meta.toggleMusicInfo) {
    try {
      return await getOnlineMusicUrl({ musicInfo: info.meta.toggleMusicInfo, isRefresh, quality, allowToggleSource: false })
    } catch {}
  }
  if (info.source === 'local') return getLocalMusicUrl({ musicInfo: info, isRefresh, onToggleSource, allowToggleSource })
  return getOnlineMusicUrl({ musicInfo: info, isRefresh, quality, onToggleSource, allowToggleSource })
}

export const getPicPath = async({
  musicInfo,
  isRefresh = false,
  listId,
  onToggleSource,
}: {
  musicInfo: LX.Music.MusicInfo | LX.Download.ListItem
  listId?: string | null
  isRefresh?: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<string> => {
  if ('progress' in musicInfo) {
    return getDownloadPicUrl({ musicInfo, isRefresh, listId, onToggleSource })
  } else if (musicInfo.source == 'local') {
    return getLocalPicUrl({ musicInfo, isRefresh, listId, onToggleSource })
  } else {
    return getOnlinePicUrl({ musicInfo, isRefresh, listId, onToggleSource })
  }
}

export const getLyricInfo = async({
  musicInfo,
  isRefresh = false,
  onToggleSource,
}: {
  musicInfo: LX.Music.MusicInfo | LX.Download.ListItem
  isRefresh?: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<LX.Player.LyricInfo> => {
  if ('progress' in musicInfo) {
    return getDownloadLyricInfo({ musicInfo, isRefresh, onToggleSource })
  } else if (musicInfo.source == 'local') {
    return getLocalLyricInfo({ musicInfo, isRefresh, onToggleSource })
  } else {
    return getOnlineLyricInfo({ musicInfo, isRefresh, onToggleSource })
  }
}
