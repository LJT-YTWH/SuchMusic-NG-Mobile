<script setup lang="ts">
import { useSettingsStore } from '../../../../stores/settingsStore'

// 外观：主题模式 + 主题色
const settingsStore = useSettingsStore()

const themeModes = [
  { label: '跟随系统', value: 'system' },
  { label: '浅色', value: 'light' },
  { label: '深色', value: 'dark' }
]

const themeColors = [
  '#2C8EFD', '#0a84ff', '#5e5ce6', '#bf5af2',
  '#ff375f', '#ff9f0a', '#30d158', '#18a058',
  '#00c7be', '#8e8e93'
]
</script>

<template>
  <div class="sp-panel">
    <div class="mp-section-title">主题模式</div>
    <div class="mp-segment">
      <span
        v-for="m in themeModes"
        :key="m.value"
        class="seg-item"
        :class="{ active: settingsStore.appearance.themeMode === m.value }"
        @click="settingsStore.appearance.themeMode = m.value as never"
      >
        {{ m.label }}
      </span>
    </div>

    <div class="mp-section-title">主题色</div>
    <div class="mp-list color-list">
      <span
        v-for="c in themeColors"
        :key="c"
        class="color-dot"
        :class="{ active: settingsStore.appearance.customThemeColor === c }"
        :style="{ background: c }"
        @click="settingsStore.appearance.customThemeColor = c"
      >
        <i v-if="settingsStore.appearance.customThemeColor === c" class="mgc_check_line"></i>
      </span>
      <label
        class="color-dot custom"
        :style="{ background: 'conic-gradient(#ff375f, #ff9f0a, #30d158, #0a84ff, #bf5af2, #ff375f)' }"
      >
        <input
          type="color"
          :value="settingsStore.appearance.customThemeColor"
          class="color-input"
          @input="settingsStore.appearance.customThemeColor = ($event.target as HTMLInputElement).value"
        />
      </label>
    </div>

    <div class="tip">移动端使用系统默认字体，字体设置在桌面版可用。</div>
  </div>
</template>
