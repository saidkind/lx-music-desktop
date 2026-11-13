
declare namespace LX {
  namespace Player {
    interface PlayMusicInfo {
      queueId?: string
      /**
       * 当前播放歌曲的列表 id
       */
      musicInfo: LX.Download.ListItem | LX.Music.MusicInfo
      /**
        * 当前播放歌曲的列表 id
        */
      listId: string | null
      /**
        * 是否属于 “稍后播放”
        */
      isTempPlay: boolean
    }

    interface PlayInfo {
      playerMusicId: string | null
      /**
       * 当前正在播放歌曲 index
       */
      playIndex: number
      /**
      * 播放器的播放列表 id
      */
      playerListId: string | null
      /**
      * 播放器播放歌曲 index
      */
      playerPlayIndex: number
    }

    interface TempPlayListItem {
      /**
       * 播放列表id
       */
      listId: string | null
      /**
       * 歌曲信息
       */
      musicInfo: LX.Music.MusicInfo | LX.Download.ListItem
      /**
       * 是否添加到列表顶部
       */
      isTop?: boolean
    }

    interface SavedPlayInfo {
      time: number
      maxTime: number
      listId: string
      index: number
    }

    interface QueueItem extends PlayMusicInfo {
      queueId: string
    }

    interface QueueAnchor {
      listId: string | null
      musicId: string | null
      index: number
    }

    interface QueueHistoryItem {
      info: PlayMusicInfo
      anchor: QueueAnchor
    }

    interface RandomQueue {
      listId: string | null
      ids: string[]
    }

    interface QueueSnapshot {
      random?: RandomQueue
      version: 1 | 2
      cycle?: QueueItem[]
      /** Normal order of pending occurrences; absent in older snapshots. */
      order?: string[]
      pending: QueueItem[]
      current: PlayMusicInfo | null
      anchor: QueueAnchor
      time: number
      duration: number
    }

  }
}
