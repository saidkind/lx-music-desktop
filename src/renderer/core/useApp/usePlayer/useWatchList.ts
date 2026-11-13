import { onBeforeUnmount } from '@common/utils/vueTools'
import { updatePlayIndex } from '@renderer/store/player/action'
import { throttle } from '@common/utils'

export default () => {
  // Only refresh the source-list highlight. The independent queue and current song survive edits.
  const handleListChange = throttle(() => { updatePlayIndex() })
  window.app_event.on('myListUpdate', handleListChange)
  window.app_event.on('downloadListUpdate', handleListChange)
  onBeforeUnmount(() => {
    window.app_event.off('myListUpdate', handleListChange)
    window.app_event.off('downloadListUpdate', handleListChange)
  })
}
