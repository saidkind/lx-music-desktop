import { addTempPlayList } from '@renderer/store/player/action'
import { playList } from '@renderer/core/player'
import { LIST_IDS } from '@common/constants'

export default ({ selectedList, list, listAll, removeAllSelect }) => {
  const handlePlayMusic = (index) => {
    playList(LIST_IDS.DOWNLOAD, listAll.value.indexOf(list.value[index]))
  }

  const handlePlayMusicLater = (index, single = false, isTop = false) => {
    if (selectedList.value.length && !single) {
      addTempPlayList(list.value.filter(item => selectedList.value.some(selected => selected.id === item.id)).map(s => ({ isTop, listId: LIST_IDS.DOWNLOAD, musicInfo: s })))
      removeAllSelect()
    } else {
      addTempPlayList([{ isTop, listId: LIST_IDS.DOWNLOAD, musicInfo: list.value[index] }])
    }
  }

  return {
    handlePlayMusic,
    handlePlayMusicLater,
  }
}
