<script setup lang="ts">
import { NSwitch, NSlider, useMessage, useDialog } from 'naive-ui'
import { useSettingsStore } from '../../../../stores/settingsStore'

// 播放页歌词展示：颜色、排版与恢复默认
const settingsStore = useSettingsStore()
const message = useMessage()
const dialog = useDialog()

const ld = settingsStore.lyricDisplay

// ==================== 颜色（空串 = 默认） ====================

function colorProxy(key: 'color' | 'activeColor' | 'subColor', fallback: string) {
  return {
    get: () => settingsStore.lyricDisplay[key] || fallback,
    set: (v: string) => {
      settingsStore.lyricDisplay[key] = v
    }
  }
}

const mainColor = colorProxy('color', '#ffffff')
const activeColor = colorProxy('activeColor', '#ffffff')
const subColor = colorProxy('subColor', '#999999')

// ==================== 恢复默认 ====================

function restoreDefaults(): void {
  dialog.warning({
    title: '恢复默认',
    content: '确定将播放页歌词展示的全部设置恢复为默认吗？',
    positiveText: '恢复默认',
    negativeText: '取消',
    onPositiveClick: () => {
      settingsStore.resetLyricDisplay()
      message.success('已恢复默认设置')
    }
  })
}
</script>

<template>
  <div class="sp-panel">
    <!-- 排版 -->
    <div class="mp-section-title">排版</div>
    <div class="mp-list setting-list">
      <div class="slider-row">
        <span class="row-label">字号</span>
        <n-slider
          :value="ld.fontSize"
          :min="14"
          :max="32"
          class="row-slider"
          @update:value="ld.fontSize = $event"
        />
        <span class="row-value">{{ ld.fontSize }}px</span>
      </div>
      <div class="slider-row">
        <span class="row-label">行距</span>
        <n-slider
          :value="ld.lineHeight"
          :min="1.2"
          :max="2.2"
          :step="0.05"
          class="row-slider"
          @update:value="ld.lineHeight = $event"
        />
        <span class="row-value">{{ ld.lineHeight.toFixed(2) }}</span>
      </div>
      <div class="slider-row">
        <span class="row-label">非激活行透明度</span>
        <n-slider
          :value="Math.round(ld.dimOpacity * 100)"
          :min="10"
          :max="100"
          class="row-slider"
          @update:value="ld.dimOpacity = $event / 100"
        />
        <span class="row-value">{{ Math.round(ld.dimOpacity * 100) }}%</span>
      </div>
      <div class="setting-row">
        <span class="row-label">加粗</span>
        <n-switch :value="ld.bold" @update:value="ld.bold = $event" />
      </div>
      <div class="setting-row">
        <span class="row-label">非激活行模糊</span>
        <n-switch :value="ld.blurInactive" @update:value="ld.blurInactive = $event" />
      </div>
      <div class="setting-row">
        <span class="row-label">显示翻译</span>
        <n-switch :value="ld.showTranslation" @update:value="ld.showTranslation = $event" />
      </div>
    </div>

    <!-- 颜色 -->
    <div class="mp-section-title">颜色</div>
    <div class="mp-list setting-list">
      <div class="setting-row">
        <span class="row-label">歌词颜色</span>
        <span style="display: flex; align-items: center; gap: 10px">
          <span v-if="ld.color" class="plugin-btn" @click="ld.color = ''">默认</span>
          <input
            type="color"
            class="inline-color"
            :value="mainColor.get()"
            @input="mainColor.set(($event.target as HTMLInputElement).value)"
          />
        </span>
      </div>
      <div class="setting-row">
        <span class="row-label">高亮颜色（当前行）</span>
        <span style="display: flex; align-items: center; gap: 10px">
          <span v-if="ld.activeColor" class="plugin-btn" @click="ld.activeColor = ''">默认</span>
          <input
            type="color"
            class="inline-color"
            :value="activeColor.get()"
            @input="activeColor.set(($event.target as HTMLInputElement).value)"
          />
        </span>
      </div>
      <div class="setting-row">
        <span class="row-label">翻译颜色</span>
        <span style="display: flex; align-items: center; gap: 10px">
          <span v-if="ld.subColor" class="plugin-btn" @click="ld.subColor = ''">默认</span>
          <input
            type="color"
            class="inline-color"
            :value="subColor.get()"
            @input="subColor.set(($event.target as HTMLInputElement).value)"
          />
        </span>
      </div>
    </div>

    <!-- 恢复默认 -->
    <div class="mp-list setting-list" style="margin-top: 10px">
      <div class="setting-row" @click="restoreDefaults">
        <span class="row-label danger"><i class="mgc_refresh_2_line row-ic"></i>恢复默认设置</span>
        <i class="mgc_arrow_right_line row-arrow"></i>
      </div>
    </div>
    <div class="tip">设置实时生效，可在播放页歌词区域查看效果。</div>
  </div>
</template>
