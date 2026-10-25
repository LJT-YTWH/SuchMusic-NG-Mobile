<script setup lang="ts">
import { computed } from 'vue'
import { NSlider } from 'naive-ui'
import { usePlayerStore } from '../../stores/playerStore'
import { webAudioEngine } from '../../audio/audio-engine'
import { formatDuration } from '../helpers'

/**
 * 播放进度条（独立组件）
 *
 * 性能关键：positionMs 每 250ms 更新一次。若直接写在播放页模板里，
 * 会让整个播放页（含上百行歌词的上千个节点）每 250ms 全量 diff 一次。
 * 拆成独立组件后，高频刷新只影响这一小块 DOM。
 */
const player = usePlayerStore()

const duration = computed(() => player.currentSong?.durationMs ?? 0)

const progressPercent = computed(() => {
  if (!duration.value) return 0
  return Math.min((player.positionMs / duration.value) * 100, 100)
})

const currentText = computed(() => formatDuration(player.positionMs) || '0:00')
const totalText = computed(() => formatDuration(duration.value) || '0:00')

function onSeek(percent: number): void {
  const d = duration.value
  if (!d) return
  const target = (percent / 100) * d
  webAudioEngine.seek(target)
  player.setPosition(target)
}
</script>

<template>
  <div class="progress-area">
    <n-slider
      :value="progressPercent"
      :tooltip="false"
      class="progress-slider"
      @update:value="onSeek"
    />
    <div class="time-row">
      <span>{{ currentText }}</span>
      <span>{{ totalText }}</span>
    </div>
  </div>
</template>

<style scoped>
.progress-area {
  flex-shrink: 0;
  margin-top: 4px;
}

.progress-slider :deep(.n-slider-rail) {
  height: 4px !important;
  border-radius: var(--mp-r-pill, 999px) !important;
  background: rgba(255, 255, 255, 0.22) !important;
}

.progress-slider :deep(.n-slider-rail__fill) {
  background: #fff !important;
  border-radius: var(--mp-r-pill, 999px) !important;
}

.progress-slider :deep(.n-slider-handle) {
  width: 13px !important;
  height: 13px !important;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35) !important;
}

.time-row {
  display: flex;
  justify-content: space-between;
  color: rgba(255, 255, 255, 0.55);
  font-size: 11px;
  margin-top: 2px;
  font-variant-numeric: tabular-nums;
}
</style>
