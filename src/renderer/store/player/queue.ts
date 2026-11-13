import { shallowReactive, ref } from '@common/utils/vueTools'
import { createQueueState, moveQueueItem, takeQueueItem, replaceQueue } from '@renderer/core/player/queueModel'

const initial = createQueueState()
export const queueState = shallowReactive({
  ...initial,
  pending: shallowReactive(initial.pending),
  history: shallowReactive(initial.history),
})
export const isShowPlayQueue = ref(false)
export const queueReady = ref(false)
export const queueNotice = ref('')
export const queueUndo = shallowReactive<{ items: LX.Player.QueueItem[] | null, cycle: LX.Player.QueueItem[], order: string[], revision: number }>({ items: null, cycle: [], order: [], revision: -1 })
let noticeTimer: ReturnType<typeof setTimeout> | undefined

export const notifyQueue = (message: string) => {
  clearTimeout(noticeTimer)
  queueNotice.value = message
  noticeTimer = setTimeout(() => {
    queueNotice.value = ''
    queueUndo.items = null
  }, 8000)
}

export const reorderQueue = (queueId: string, index: number) => {
  moveQueueItem(queueState, queueId, index)
}

export const removeQueue = (queueId?: string) => {
  const items = [...queueState.pending]
  const cycle = [...queueState.cycle]
  const order = [...queueState.order]
  if (queueId) {
    takeQueueItem(queueState, queueId)
    queueState.cycle = queueState.cycle.filter(item => item.queueId !== queueId)
  } else {
    replaceQueue(queueState, [])
    queueState.cycle = []
  }
  queueUndo.items = items
  queueUndo.cycle = cycle
  queueUndo.order = order
  queueUndo.revision = queueState.revision
  notifyQueue(window.i18n.t(queueId ? 'queue__removed' : 'queue__cleared'))
}

export const undoQueue = () => {
  if (!queueUndo.items || queueUndo.revision !== queueState.revision) return
  replaceQueue(queueState, queueUndo.items, queueUndo.order)
  queueState.cycle = queueUndo.cycle
  queueUndo.items = null
  notifyQueue(window.i18n.t('queue__restored'))
}
