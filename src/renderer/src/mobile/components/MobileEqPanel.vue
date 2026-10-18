<script setup lang="ts">
import { NSwitch, NSlider } from 'naive-ui'
import { useSettingsStore } from '../../stores/settingsStore'

const settingsStore = useSettingsStore()

const EQ_BANDS = [31, 62, 125, 250, 500, '1k', '2k', '4k', '8k', '16k']

const eqPresets = [
  { id: 'flat', name: '平坦', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'pop', name: '流行', gains: [2, 3, 3, 1, -1, -1, 2, 3, 3, 2] },
  { id: 'rock', name: '摇滚', gains: [3, 4, 2, 0, -1, -1, 1, 3, 4, 3] },
  { id: 'vocal', name: '人声', gains: [-2, -1, 0, 2, 3, 3, 2, 0, -1, -2] },
  { id: 'bass', name: '低音增强', gains: [5, 4, 3, 1, 0, -1, -2, -3, -4, -5] }
]

function applyEqPreset(id: string): void {
  const preset = eqPresets.find((p) => p.id === id)
  if (!preset) return
  settingsStore.playback.eqGains = [...preset.gains]
  settingsStore.playback.eqPreset = id
}

function setEqBand(index: number, value: number): void {
  const gains = [...settingsStore.playback.eqGains]
  gains[index] = value
  settingsStore.playback.eqGains = gains
  settingsStore.playback.eqPreset = 'custom'
}
</script>

<template>
  <div class="eq-panel">
    <div class="eq-head">
      <span class="eq-title">均衡器</span>
      <n-switch
        :value="settingsStore.playback.eqEnabled"
        @update:value="settingsStore.playback.eqEnabled = $event"
      />
    </div>

    <div class="eq-presets">
      <span
        v-for="p in eqPresets"
        :key="p.id"
        class="mp-chip"
        :class="{ active: settingsStore.playback.eqPreset === p.id }"
        @click="applyEqPreset(p.id)"
      >
        {{ p.name }}
      </span>
      <span class="mp-chip" :class="{ active: settingsStore.playback.eqPreset === 'custom' }">
        自定义
      </span>
    </div>

    <div class="eq-bands" :class="{ disabled: !settingsStore.playback.eqEnabled }">
      <div v-for="(band, i) in EQ_BANDS" :key="band" class="eq-band">
        <span class="band-gain">{{ settingsStore.playback.eqGains[i] ?? 0 }}</span>
        <n-slider
          :value="settingsStore.playback.eqGains[i] ?? 0"
          :min="-12"
          :max="12"
          :step="1"
          vertical
          reverse
          :tooltip="false"
          class="band-slider"
          @update:value="setEqBand(i, $event)"
        />
        <span class="band-label">{{ band }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.eq-panel {
  display: flex;
  flex-direction: column;
}

.eq-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 20px 12px;
}

.eq-title {
  font-size: var(--mp-font-headline, 17px);
  font-weight: 700;
  color: var(--mp-text, #1c1c1e);
}

.eq-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 20px 16px;
}

.eq-bands {
  display: flex;
  justify-content: space-between;
  padding: 4px 20px 10px;
  transition: opacity 0.2s ease;
}

.eq-bands.disabled {
  opacity: 0.4;
  pointer-events: none;
}

.eq-band {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.band-gain {
  font-size: 10px;
  color: var(--mp-text-2, rgba(60, 60, 67, 0.6));
  font-variant-numeric: tabular-nums;
  height: 14px;
}

.band-slider {
  height: 132px;
}

.band-label {
  font-size: 10px;
  color: var(--mp-text-3, rgba(60, 60, 67, 0.33));
  font-variant-numeric: tabular-nums;
}

/* 横屏（右侧抽屉内）：压缩滑杆与间距，保证 10 段均衡器一屏可用 */
@media (orientation: landscape) {
  .eq-head {
    padding: 12px 20px 8px;
  }

  .eq-presets {
    padding: 0 20px 12px;
  }

  .band-slider {
    height: 104px;
  }
}
</style>
