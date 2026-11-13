/** The queue owns song snapshots; source playlists never drive later navigation. */
export const createQueueState = () => ({
  pending: [] as LX.Player.QueueItem[],
  // Normal order of the remaining occurrences, independent of their shuffled display order.
  order: [] as string[],
  cycle: [] as LX.Player.QueueItem[],
  history: [] as LX.Player.QueueHistoryItem[],
  cursor: -1,
  revision: 0,
})

export type QueueState = ReturnType<typeof createQueueState>

export const branchHistory = (state: QueueState) => { state.history.splice(state.cursor + 1) }

/** Copy metadata as well, so renaming or editing a source track cannot mutate the queue. */
export const createQueueItem = (info: LX.Player.PlayMusicInfo, createId: () => string): LX.Player.QueueItem => ({
  ...info,
  musicInfo: JSON.parse(JSON.stringify(info.musicInfo, (key, value) => key === 'url' ? undefined : value)),
  queueId: createId(),
})

export const shuffleQueue = <T>(items: T[], random: (max: number) => number): T[] => {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = random(i + 1)
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export const replaceQueue = (state: QueueState, items: LX.Player.QueueItem[], order = items.map(item => item.queueId)) => {
  const ids = new Set(items.map(item => item.queueId))
  const orderedIds = new Set(order)
  state.order = [...order.filter(id => ids.has(id)), ...items.filter(item => !orderedIds.has(item.queueId)).map(item => item.queueId)]
  state.pending.splice(0, state.pending.length, ...items)
  state.revision++
}

export const getOrderedQueue = (state: QueueState): LX.Player.QueueItem[] => {
  const entries = new Map(state.pending.map(item => [item.queueId, item]))
  return state.order.map(id => entries.get(id)).filter((item): item is LX.Player.QueueItem => !!item)
}

// Retain already played entries for loop mode, followed by the edited upcoming order.
export const syncQueueCycle = (state: QueueState) => {
  const pendingIds = new Set(state.pending.map(item => item.queueId))
  const cycleIds = new Set(state.cycle.map(item => item.queueId))
  state.cycle = [...state.cycle.filter(item => !pendingIds.has(item.queueId)), ...getOrderedQueue(state).filter(item => cycleIds.has(item.queueId))]
}

export const enqueue = (state: QueueState, items: LX.Player.TempPlayListItem[], createId: () => string) => {
  if (!items.length) return
  const entries = items.map(({ musicInfo, listId }) => createQueueItem({ musicInfo, listId, isTempPlay: true }, createId))
  const first = entries.filter((_, index) => items[index].isTop)
  const last = entries.filter((_, index) => !items[index].isTop)
  branchHistory(state)
  state.pending.unshift(...first)
  state.pending.push(...last)
  state.order = [...first.map(item => item.queueId), ...state.order, ...last.map(item => item.queueId)]
  state.cycle = [...state.cycle, ...entries]
  syncQueueCycle(state)
  state.revision++
}

export const moveQueueItem = (state: QueueState, queueId: string, to: number) => {
  const from = state.pending.findIndex(item => item.queueId === queueId)
  if (from < 0 || to < 0 || to >= state.pending.length || from === to) return
  const [item] = state.pending.splice(from, 1)
  state.pending.splice(to, 0, item)
  // Apply this explicit edit to the normal order too, without copying unrelated shuffle positions.
  state.order = state.order.filter(id => id !== queueId)
  const neighbor = state.pending[to + (to < from ? 1 : -1)]
  const neighborIndex = state.order.indexOf(neighbor.queueId)
  state.order.splice(neighborIndex + (to < from ? 0 : 1), 0, queueId)
  syncQueueCycle(state)
  state.revision++
}

export const takeQueueItem = (state: QueueState, queueId: string) => {
  const index = state.pending.findIndex(item => item.queueId === queueId)
  if (index < 0) return null
  const [item] = state.pending.splice(index, 1)
  state.order = state.order.filter(id => id !== queueId)
  state.revision++
  return item
}

export const recordPlayback = (state: QueueState, info: LX.Player.PlayMusicInfo, anchor: LX.Player.QueueAnchor) => {
  branchHistory(state)
  state.history.push({ info: { ...info }, anchor: { ...anchor } })
  if (state.history.length > 100) state.history.splice(0, state.history.length - 100)
  state.cursor = state.history.length - 1
  state.revision++
}

export const traverseHistory = (state: QueueState, direction: -1 | 1) => {
  const index = state.cursor + direction
  if (index < 0 || index >= state.history.length) return null
  state.cursor = index
  state.revision++
  return state.history[index]
}

/** Never persist resolved audio URLs. Version 1 is accepted for one-time migration. */
export const serializeQueue = (snapshot: LX.Player.QueueSnapshot): LX.Player.QueueSnapshot => {
  return JSON.parse(JSON.stringify(snapshot, (key, value) => key === 'url' ? undefined : value))
}

export const parseQueueSnapshot = (data: unknown): LX.Player.QueueSnapshot | null => {
  if (!data || typeof data !== 'object') return null
  const snapshot = data as LX.Player.QueueSnapshot
  const validInfo = (info: LX.Player.PlayMusicInfo) => {
    if (!info || typeof info !== 'object' || typeof info.isTempPlay !== 'boolean' || (info.listId !== null && typeof info.listId !== 'string')) return false
    if (info.queueId !== undefined && typeof info.queueId !== 'string') return false
    const music = info.musicInfo
    if (!music || typeof music.id !== 'string') return false
    const song = 'progress' in music ? music.metadata?.musicInfo : music
    return !!song && typeof song.name === 'string' && typeof song.singer === 'string' &&
      ['kw', 'kg', 'tx', 'wy', 'mg', 'local'].includes(song.source) && !!song.meta && typeof song.meta === 'object'
  }
  const validItems = (items: LX.Player.QueueItem[]) => Array.isArray(items) &&
    items.every(item => validInfo(item) && typeof item.queueId === 'string') && new Set(items.map(item => item.queueId)).size === items.length
  if (![1, 2].includes(snapshot.version) || !validItems(snapshot.pending)) return null
  if (snapshot.version === 2 && !validItems(snapshot.cycle!)) return null
  if (snapshot.order !== undefined && (!Array.isArray(snapshot.order) || snapshot.order.length !== snapshot.pending.length ||
    new Set(snapshot.order).size !== snapshot.order.length || !snapshot.order.every(id => snapshot.pending.some(item => item.queueId === id)))) return null
  if (snapshot.current !== null && !validInfo(snapshot.current)) return null
  const anchor = snapshot.anchor
  if (!anchor || (anchor.listId !== null && typeof anchor.listId !== 'string') || (anchor.musicId !== null && typeof anchor.musicId !== 'string') || !Number.isInteger(anchor.index)) return null
  if (!Number.isFinite(snapshot.time) || snapshot.time < 0 || !Number.isFinite(snapshot.duration) || snapshot.duration < 0) return null
  if (snapshot.random && ((typeof snapshot.random.listId !== 'string' && snapshot.random.listId !== null) ||
    !Array.isArray(snapshot.random.ids) || !snapshot.random.ids.every(id => typeof id === 'string') ||
    new Set(snapshot.random.ids).size !== snapshot.random.ids.length)) return null
  return snapshot
}
