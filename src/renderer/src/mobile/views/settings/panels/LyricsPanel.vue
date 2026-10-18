<script setup lang="ts">
import { NSwitch, NSlider } from 'naive-ui'
import { useSettingsStore } from '../../../../stores/settingsStore'

// 悬浮歌词：样式、颜色与对齐方式
const settingsStore = useSettingsStore()

const aligns = [
  { label: '居左', value: 'left' },
  { label: '居中', value: 'center' },
  { label: '居右', value: 'right' }
]
</script>

<template>
  <div class="sp-panel">
    <div class="mp-section-title">悬浮窗歌词</div>
    <div class="mp-list setting-list">
      <div class="slider-row">
        <span class="row-label">字号</span>
        <n-slider
          :value="settingsStore.playback.desktopLyricsFontSize"
          :min="12"
          :max="48"
          class="row-slider"
          @update:value="settingsStore.playback.desktopLyricsFontSize = $event"
        />
        <span class="row-value">{{ settingsStore.playback.desktopLyricsFontSize }}px</span>
      </div>
      <div class="setting-row">
        <span class="row-label">文字颜色</span>
        <input
          type="color"
          :value="settingsStore.playback.desktopLyricsColor"
          class="inline-color"
          @input="settingsStore.playback.desktopLyricsColor = ($event.target as HTMLInputElement).value"
        />
      </div>
      <div class="setting-row">
        <span class="row-label">高亮颜色</span>
        <input
          type="color"
          :value="settingsStore.playback.desktopLyricsActiveColor"
          class="inline-color"
          @input="settingsStore.playback.desktopLyricsActiveColor = ($event.target as HTMLInputElement).value"
        />
      </div>
      <div class="slider-row">
        <span class="row-label">背景透明度</span>
        <n-slider
          :value="settingsStore.playback.desktopLyricsOpacity * 100"
          :min="10"
          :max="100"
          class="row-slider"
          @update:value="settingsStore.playback.desktopLyricsOpacity = $event / 100"
        />
        <span class="row-value">{{ Math.round(settingsStore.playback.desktopLyricsOpacity * 100) }}%</span>
      </div>
      <div class="setting-row">
        <span class="row-label">显示下一行</span>
        <n-switch
          :value="settingsStore.playback.desktopLyricsShowNextLine"
          @update:value="settingsStore.playback.desktopLyricsShowNextLine = $event"
        />
      </div>
      <div class="setting-row">
        <span class="row-label">锁定悬浮窗（双击悬浮窗解锁）</span>
        <n-switch
          :value="settingsStore.playback.desktopLyricsLocked"
          @update:value="settingsStore.playback.desktopLyricsLocked = $event"
        />
      </div>
    </div>

    <div class="mp-section-title">对齐方式</div>
    <div class="mp-segment">
      <span
        v-for="a in aligns"
        :key="a.value"
        class="seg-item"
        :class="{ active: settingsStore.playback.desktopLyricsAlign === a.value }"
        @click="settingsStore.playback.desktopLyricsAlign = a.value as never"
      >
        {{ a.label }}
      </span>
    </div>
    <div class="tip">悬浮窗歌词需要授予「悬浮窗」权限，在播放页更多菜单中开启。</div>
  </div>
</template>
