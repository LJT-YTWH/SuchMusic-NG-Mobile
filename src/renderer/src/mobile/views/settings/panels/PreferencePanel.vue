<script setup lang="ts">
import { useSettingsStore } from '../../../../stores/settingsStore'

// 偏好：启动时的屏幕方向等
const settingsStore = useSettingsStore()

const orientations = [
  { label: '自动', value: 'auto' },
  { label: '竖屏', value: 'portrait' },
  { label: '横屏', value: 'landscape' }
]
</script>

<template>
  <div class="sp-panel">
    <div class="mp-section-title">打开软件时的屏幕方向</div>
    <div class="mp-segment">
      <span
        v-for="o in orientations"
        :key="o.value"
        class="seg-item"
        :class="{ active: settingsStore.preference.orientation === o.value }"
        @click="settingsStore.preference.orientation = o.value as never"
      >
        {{ o.label }}
      </span>
    </div>
    <div class="tip">
      自动：跟随系统方向旋转（默认）；竖屏：始终以竖屏打开；横屏：始终以横屏打开。
      切换后立即生效，并会在下次启动时保持。
    </div>
  </div>
</template>
