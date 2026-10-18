import type { Component } from 'vue'
import AppearancePanel from './AppearancePanel.vue'
import PlaybackPanel from './PlaybackPanel.vue'
import LyricsPanel from './LyricsPanel.vue'
import LyricDisplayPanel from './LyricDisplayPanel.vue'
import PreferencePanel from './PreferencePanel.vue'
import SourcePanel from './SourcePanel.vue'
import LocalPanel from './LocalPanel.vue'
import AboutPanel from './AboutPanel.vue'

// 设置分组 key → 面板组件
export const settingsPanels: Record<string, Component> = {
  appearance: AppearancePanel,
  playback: PlaybackPanel,
  lyricDisplay: LyricDisplayPanel,
  lyrics: LyricsPanel,
  preference: PreferencePanel,
  source: SourcePanel,
  local: LocalPanel,
  about: AboutPanel
}

export const settingsTitles: Record<string, string> = {
  appearance: '外观',
  playback: '播放',
  lyricDisplay: '播放页歌词展示',
  lyrics: '悬浮歌词',
  preference: '偏好',
  source: '音源与插件',
  local: '本地与缓存',
  about: '关于'
}
