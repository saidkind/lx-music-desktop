import { computed } from '@common/utils/vueTools'
import { queueState } from './queue'

export const queueTrackCount = computed(() => queueState.pending.length)
