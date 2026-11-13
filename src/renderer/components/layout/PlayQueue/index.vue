<template>
  <transition
    :css="appSetting['common.isShowAnimation']" :duration="200"
    :enter-active-class="$style.transition" :leave-active-class="$style.transition"
    :enter-from-class="$style.hidden" :leave-to-class="$style.hidden" @after-enter="afterEnter"
  >
    <div v-if="isShowPlayQueue" :class="[$style.overlay, { [$style.detail]: isShowPlayerDetail }]" @click.self="close">
      <section id="play-queue-panel" :class="$style.panel" role="dialog" :aria-label="t('queue__title')">
        <header :class="$style.header">
          <h2>{{ t('queue__title') }} <span>{{ t('queue__count', { count: queueTrackCount }) }}</span></h2>
          <button ref="closeButton" type="button" :aria-label="t('queue__close')" @click="close">×</button>
        </header>
        <div :class="$style.current">
          <svg-icon name="music" :class="$style.art" />
          <div :class="$style.song">
            <span :class="$style.label">{{ t('queue__now') }}</span>
            <strong>{{ musicInfo.name || t('queue__no_current') }}</strong>
            <span>{{ musicInfo.singer }}</span>
            <span v-if="status" :class="$style.playStatus">{{ status }}</span>
          </div>
        </div>
        <div :class="$style.sectionTitle">
          <span>{{ t('queue__pending') }} · {{ modeName }}</span>
          <button type="button" :disabled="!pending.length" @click="removeQueue()">{{ t('queue__clear') }}</button>
        </div>
        <base-virtualized-list
          v-if="rows.length" ref="listRef" v-slot="{ item }: { item: QueueViewRow }" :class="$style.list" :list="rows"
          key-name="key" :item-height="rowHeight" container-class="scroll" :aria-label="t('queue__title')" @dragover="scrollDrag"
        >
          <div
            :class="[$style.row, { [$style.dragOver]: dropTarget === item.key }]" :data-queue-id="item.key"
            @dblclick="playQueueItem(item.key)" @dragover.prevent="dropTarget = item.key" @drop.prevent="drop(item)"
          >
            <button
              type="button" :class="$style.grip" draggable="true" :aria-label="t('queue__drag')"
              @dragstart="drag($event, item.key)" @dragend="endDrag" @keydown.alt.up.prevent="move(item.key, item.index - 1)" @keydown.alt.down.prevent="move(item.key, item.index + 1)"
            >⋮⋮</button>
            <span :class="$style.number" aria-hidden="true">{{ item.index + 1 }}</span>
            <div :class="$style.song" :aria-label="songLabel(item.info.musicInfo)" :title="songLabel(item.info.musicInfo)">
              <strong>{{ songOf(item.info.musicInfo).name }}</strong>
              <span>{{ songOf(item.info.musicInfo).singer }}</span>
            </div>
            <div :class="$style.actions" @dblclick.stop @click.stop>
              <button type="button" :aria-label="t('queue__play_now')" @click="playQueueItem(item.key)">▶</button>
              <button type="button" :disabled="item.index === 0" :aria-label="t('queue__move_up')" @click="move(item.key, item.index - 1)">↑</button>
              <button type="button" :disabled="item.index === pending.length - 1" :aria-label="t('queue__move_down')" @click="move(item.key, item.index + 1)">↓</button>
              <button type="button" :disabled="item.index === 0" :aria-label="t('queue__play_next')" @click="move(item.key, 0)">⇡</button>
              <button type="button" :aria-label="t('queue__remove')" @click="removeQueue(item.key)">×</button>
            </div>
          </div>
        </base-virtualized-list>
        <div v-else :class="$style.empty"><p>{{ t('queue__empty') }}</p><p>{{ t('queue__empty_tip') }}</p></div>
        <div v-if="queueNotice" :class="$style.notice" role="status" aria-live="polite">
          <span>{{ queueNotice }}</span><button v-if="canUndo" type="button" @click="undoQueue">{{ t('queue__undo') }}</button>
        </div>
        <footer v-if="isRandom && pending.length" :class="$style.footer">{{ t('queue__random_tip') }}</footer>
        <div :class="$style.navigation">
          <button type="button" :disabled="!playMusicInfo.musicInfo" @click="playPrev()">{{ t('player__prev') }}</button>
          <span v-if="nextLabel" :aria-label="nextLabel">{{ t('queue__next_label', { name: nextLabel }) }}</span>
          <span v-else>{{ t('queue__end') }}</span>
          <button type="button" :disabled="!playMusicInfo.musicInfo && !pending.length" @click="playNext()">{{ t('player__next') }}</button>
        </div>
      </section>
    </div>
  </transition>
  <div v-if="queueNotice && !isShowPlayQueue" :class="[$style.toast, { [$style.detailToast]: isShowPlayerDetail }]" role="status" aria-live="polite">
    <span>{{ queueNotice }}</span><button type="button" @click="isShowPlayQueue = true">{{ t('queue__open') }}</button>
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, computed, watch, onBeforeUnmount } from '@common/utils/vueTools'
import { useI18n } from '@renderer/plugins/i18n'
import { queueState, isShowPlayQueue, queueNotice, queueUndo, reorderQueue, removeQueue, undoQueue } from '@renderer/store/player/queue'
import { queueTrackCount } from '@renderer/store/player/queueView'
import { musicInfo, playMusicInfo, status, isShowPlayerDetail } from '@renderer/store/player/state'
import { getNextPlayMusicInfo, playQueueItem, playNext, playPrev } from '@renderer/core/player'
import { appSetting } from '@renderer/store/setting'

const t = useI18n()
const closeButton = ref<HTMLButtonElement>()
const listRef = ref<{ $el: HTMLElement, scrollToIndex: (index: number) => void }>()
const pending = computed(() => [...queueState.pending])
const rowHeight = computed(() => Math.ceil(appSetting['common.fontSize'] * 3.5))
const canUndo = computed(() => queueUndo.items && queueUndo.revision === queueState.revision)
const nextInfo = shallowRef<LX.Player.PlayMusicInfo | null>(null)
interface QueueViewRow { key: string, info: LX.Player.QueueItem, index: number }
const rows = computed<QueueViewRow[]>(() => pending.value.map((info, index) => ({ key: info.queueId, info, index })))
const isRandom = computed(() => appSetting['player.togglePlayMethod'] === 'random')
const dropTarget = ref('')
let draggedId = ''
let opener: HTMLElement | null = null
let previewVersion = 0

const songOf = (info: LX.Music.MusicInfo | LX.Download.ListItem) => 'progress' in info ? info.metadata.musicInfo : info
const songLabel = (info: LX.Music.MusicInfo | LX.Download.ListItem) => {
  const song = songOf(info)
  return `${song.name} - ${song.singer}`
}
const nextLabel = computed(() => nextInfo.value ? songLabel(nextInfo.value.musicInfo) : '')
const modeName = computed(() => t(({
  listLoop: 'player__play_toggle_mode_list_loop',
  random: 'player__play_toggle_mode_random',
  list: 'player__play_toggle_mode_list',
  singleLoop: 'player__play_toggle_mode_single_loop',
  none: 'player__play_toggle_mode_off',
} as const)[appSetting['player.togglePlayMethod']]))

const close = () => { isShowPlayQueue.value = false }
const afterEnter = () => {
  // Focusing an off-screen sliding panel otherwise scrolls the entire app sideways.
  closeButton.value?.focus({ preventScroll: true })
  listRef.value?.scrollToIndex(0)
}
const keydown = (event: KeyboardEvent) => {
  if (!isShowPlayQueue.value || event.key !== 'Escape') return
  event.preventDefault()
  event.stopImmediatePropagation()
  close()
}
watch(isShowPlayQueue, visible => {
  if (visible) {
    opener = document.activeElement as HTMLElement | null
    document.addEventListener('keydown', keydown, true)
  } else {
    document.removeEventListener('keydown', keydown, true)
    opener?.focus({ preventScroll: true })
  }
})
watch(() => [queueState.revision, appSetting['player.togglePlayMethod']], async() => {
  const version = ++previewVersion
  const next = await getNextPlayMusicInfo().catch(() => null)
  if (version === previewVersion) nextInfo.value = next
}, { immediate: true })
const move = (id: string, index: number) => {
  // Keep the viewport fixed when reordering; keyed rows retain their own focus.
  reorderQueue(id, index)
}
const drag = (event: DragEvent, id: string) => {
  draggedId = id
  event.dataTransfer?.setData('text/plain', id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
const endDrag = () => { draggedId = ''; dropTarget.value = '' }
const drop = (row: QueueViewRow) => {
  if (draggedId) reorderQueue(draggedId, row.index)
  endDrag()
}
const scrollDrag = (event: DragEvent) => {
  const element = listRef.value?.$el
  if (!element || !draggedId) return
  const bounds = element.getBoundingClientRect()
  if (event.clientY < bounds.top + 30) element.scrollTop -= 18
  else if (event.clientY > bounds.bottom - 30) element.scrollTop += 18
}
onBeforeUnmount(() => {
  previewVersion++
  document.removeEventListener('keydown', keydown, true)
})
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';
.overlay { position: absolute; top: @height-toolbar; bottom: @height-player; left: @width-app-left; right: 0; z-index: 11; display: flex; justify-content: flex-end; overflow: hidden; &::before { content: ''; position: absolute; inset: 0; background: rgb(0 0 0 / 8%); pointer-events: none; } }
.detail { bottom: 100px; left: 0; }
.panel { position: relative; width: min(390px, 100%); height: 100%; display: flex; flex-direction: column; background: var(--color-content-background); color: var(--color-font); box-shadow: -4px 0 18px rgb(0 0 0 / 12%); font-size: 14px; transform: translateX(0); }
.panel button, .toast button { flex: none; padding: 5px 7px; background: transparent; color: var(--color-font); border: 0; border-radius: 4px; cursor: pointer; font-size: inherit; &:hover { background: var(--color-primary-background-hover); } &:focus-visible { outline: 2px solid var(--color-primary); outline-offset: -2px; } &:disabled { opacity: .3; cursor: default; } }
.header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 16px; flex: none; h2 { font-size: 16px; } span { font-size: 12px; font-weight: normal; color: var(--color-font-label); margin-left: 8px; } button { font-size: 23px; } }
.current { flex: none; display: flex; align-items: center; gap: 12px; margin: 0 16px 8px; padding: 10px 12px; border-radius: 6px; background: var(--color-primary-background-hover); max-height: 110px; }
.art { width: 30px; height: 30px; flex: none; color: var(--color-primary); }
.song { min-width: 0; flex: auto; display: flex; flex-direction: column; gap: 4px; strong { font-weight: 500; .mixin-ellipsis-1(); } span { font-size: 12px; color: var(--color-font-label); .mixin-ellipsis-1(); } .label { color: var(--color-primary); } }
.sectionTitle { flex: none; padding: 0 16px 4px; display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--color-font-label); }
.list { flex: 1; min-height: 60px; overflow-anchor: none; }
.row { height: 100%; box-sizing: border-box; display: flex; align-items: center; gap: 6px; padding: 0 8px; border-bottom: 1px solid var(--color-primary-alpha-900); &:hover { background: var(--color-primary-background-hover); } .grip { cursor: grab; padding: 6px 3px; color: var(--color-font-label); } }
.number { flex: none; width: 28px; font-size: 12px; text-align: center; color: var(--color-font-label); }
.dragOver { box-shadow: inset 0 2px var(--color-primary); background: var(--color-primary-background-hover); }
.actions { display: flex; flex: none; gap: 1px; button { width: 25px; padding: 6px 2px; } }
.empty { flex: 1; min-height: 40px; display: flex; flex-direction: column; justify-content: center; text-align: center; padding: 16px; gap: 8px; color: var(--color-font-label); font-size: 12px; }
.notice { flex: none; min-height: 28px; padding: 2px 16px; display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 12px; color: var(--color-font-label); button { color: var(--color-primary); } }
.footer { flex: none; padding: 8px 16px; border-top: 1px solid var(--color-primary-alpha-900); color: var(--color-font-label); font-size: 12px; }
.navigation { flex: none; border-top: 1px solid var(--color-primary-alpha-900); padding: 8px; display: flex; align-items: center; gap: 8px; justify-content: space-between; span { color: var(--color-font-label); font-size: 12px; .mixin-ellipsis-1(); } }
.toast { position: absolute; bottom: @height-player + 12px; right: 12px; z-index: 11; display: flex; align-items: center; gap: 10px; max-width: calc(100% - 24px); padding: 8px 12px; border-radius: 6px; background: var(--color-content-background); box-shadow: 0 2px 15px rgb(0 0 0 / 18%); font-size: 13px; button { color: var(--color-primary); } }
.detailToast { bottom: 112px; }
.transition { &::before { transition: opacity .2s ease; } .panel { transition: transform .2s cubic-bezier(.2, .8, .2, 1); } }
.hidden { &::before { opacity: 0; } .panel { transform: translateX(100%); } }
@media (max-height: 600px) { .current { padding: 6px 10px; margin-bottom: 4px; } .header { padding: 4px 12px; } .navigation { padding: 4px 8px; } }
@media (prefers-reduced-motion: reduce) { .transition::before, .transition .panel { transition: none; } }
</style>
