<template>
    <button :class="[$style.button, { [$style.active]: isShowPlayQueue }]" :aria-label="$t('queue__title')" :aria-expanded="isShowPlayQueue" aria-controls="play-queue-panel" @click="isShowPlayQueue = !isShowPlayQueue">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 5h16M4 11h16M4 17h10M18 15v6m-3-3h6" /></svg>
    </button>
</template>

<script setup>
import { isShowPlayQueue } from '@renderer/store/player/queue'
</script>

<style lang="less" module>
.button {
  position: relative; display: flex; align-items: center; flex: none; width: 30px; padding: 0; background: transparent; border: 0; cursor: pointer;
  &:focus-visible { outline: 2px solid var(--color-primary); }
  &.active { color: var(--color-primary); }
}
</style>
