<script setup lang="ts">
import { NSlider } from 'naive-ui'
import { useSettingsStore } from '../../../../stores/settingsStore'
import MobileEqPanel from '../../../components/MobileEqPanel.vue'
import MobileFxPanel from '../../../components/MobileFxPanel.vue'

// 播放：压限器 + 十段均衡器 + 高级音效
const settingsStore = useSettingsStore()
</script>

<template>
  <div class="sp-panel">
    <div class="mp-section-title">音量压限</div>
    <div class="mp-list setting-list">
      <div class="slider-row">
        <span class="row-label">压限器强度</span>
        <n-slider
          :value="settingsStore.playback.limiterStrength * 100"
          :min="0"
          :max="100"
          class="row-slider"
          @update:value="settingsStore.playback.limiterStrength = $event / 100"
        />
        <span class="row-value">{{ Math.round(settingsStore.playback.limiterStrength * 100) }}%</span>
      </div>
    </div>

    <div class="mp-section-title">均衡器</div>
    <div class="mp-list setting-list eq-card">
      <MobileEqPanel />
    </div>

    <div class="mp-section-title">高级</div>
    <div class="mp-list setting-list fx-card">
      <MobileFxPanel />
    </div>
  </div>
</template>

<style scoped>
.fx-card {
  padding-top: 12px;
  padding-bottom: 6px;
}
</style>
