<script setup lang="ts">
import { NSwitch } from 'naive-ui'
import { useSettingsStore } from '../../../../stores/settingsStore'
import { useLibraryLayout } from '../../../composables/useLibraryLayout'

// 偏好：启动时的屏幕方向、横屏逛歌单方式、长列表虚拟滚动等
const settingsStore = useSettingsStore()
const { mode, setMode } = useLibraryLayout()

const orientations = [
  { label: '自动', value: 'auto' },
  { label: '竖屏', value: 'portrait' },
  { label: '横屏', value: 'landscape' }
]

const libraryLayouts = [
  { label: '传统列表', value: 'list', icon: 'mgc_list_check_2_line' },
  { label: 'Cover Flow', value: 'coverflow', icon: 'mgc_album_2_line' }
] as const
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

    <div class="mp-section-title">横屏浏览歌单方式</div>
    <div class="mp-segment">
      <span
        v-for="l in libraryLayouts"
        :key="l.value"
        class="seg-item seg-item-icon"
        :class="{ active: mode === l.value }"
        @click="setMode(l.value)"
      >
        <i :class="l.icon"></i>
        {{ l.label }}
      </span>
    </div>
    <div class="tip">
      控制横屏下「我的、歌单广场、排行榜、本地音乐、歌单详情」的浏览方式。
      默认使用传统列表；选择 Cover Flow 后进入这些页面会以 3D 封面流展示（右侧竖直滑动条可快速翻页）。
    </div>

    <div class="mp-section-title">性能</div>
    <div class="mp-list setting-list">
      <div class="setting-row">
        <span class="row-label">长列表虚拟滚动</span>
        <n-switch
          :value="settingsStore.general.virtualScroll"
          @update:value="settingsStore.general.virtualScroll = $event"
        />
      </div>
    </div>
    <div class="tip">
      超过 120 首的列表只渲染可视区域，降低长列表的内存占用与卡顿（默认开启）。
      如遇列表显示异常可临时关闭以排查。
    </div>
  </div>
</template>

<style scoped>
.seg-item-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.seg-item-icon i {
  font-size: 15px;
}
</style>
