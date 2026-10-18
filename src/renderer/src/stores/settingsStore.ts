import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { webAudioEngine } from '../audio/audio-engine'
import { setPrimaryColor, setGlobalFontFamily } from '../themes'
import { isNativeMobile } from '../platform'

export interface GeneralSettings {
  onlineServices: boolean
  closeAction: 'minimize' | 'quit'
  remindOnClose: boolean
  taskbarProgress: boolean
  orpheusProtocol: boolean
  autoCheckUpdate: boolean
  updateChannel: 'stable' | 'beta'
  searchResultOrder: string[]
}

export interface AppearanceSettings {
  globalFont: string
  lyricsFont: string
  taskbarLyricsFont: string
  desktopLyricsFont: string
  themeMode: 'system' | 'light' | 'dark'
  themeColorPreset: string
  customThemeColor: string
  playlistLayoutStyle: 'classic' | 'modern'
  songListStyle: 'card' | 'plain'
}

export interface PlaybackSettings {
  autoHideCursorWhenControlsHidden: boolean
  limiterStrength: number
  eqEnabled: boolean
  eqGains: number[]
  eqPreset: string
  lyricsAutoSize: boolean
  lyricsFontSize: number
  lyricsAreaRatio: number
  lyricsAppleStyle: boolean
  lyricsBlurEnabled: boolean
  lyricsSpringEnabled: boolean
  playerBackgroundStyle: 'classic' | 'amll'
  desktopLyricsFontSize: number
  desktopLyricsColor: string
  desktopLyricsActiveColor: string
  desktopLyricsOpacity: number
  desktopLyricsShowNextLine: boolean
  desktopLyricsAlign: 'left' | 'center' | 'right'
  desktopLyricsLocked: boolean
  desktopLyricsForceDuet: boolean
}

export interface LocalSettings {
  scanDirs: string[]
  cacheDir?: string
}

export interface SourceSettings {
  preferredPlatform: string
  preferredQuality: string
}

export interface PreferenceSettings {
  /** 启动时的屏幕方向：auto=跟随系统（默认） portrait=竖屏 landscape=横屏 */
  orientation: 'auto' | 'portrait' | 'landscape'
}

/** 高级音效设置（6 种功能，恢复默认时回到 DEFAULT_ADVANCED_FX） */
export interface AdvancedFxSettings {
  /** 变速播放 */
  rateEnabled: boolean
  /** 播放速度 0.5 - 2.0 */
  playbackRate: number
  /** 变速时保持音调（仅对元素播放路径有效） */
  preservePitch: boolean
  /** 响度均衡（动态范围压缩，统一大小声） */
  loudnessEnabled: boolean
  /** 响度均衡强度 0 - 1 */
  loudnessStrength: number
  /** 声像平衡 */
  balanceEnabled: boolean
  /** 左右声像 -1（全左）- 1（全右） */
  balance: number
  /** 立体声扩展 */
  widthEnabled: boolean
  /** 立体声宽度 0 - 2（1 = 原始） */
  stereoWidth: number
  /** 交叉淡入淡出 */
  crossfadeEnabled: boolean
  /** 淡入淡出时长（秒）1 - 12 */
  crossfadeSeconds: number
  /** 人声消除（卡拉 OK） */
  vocalRemovalEnabled: boolean
  /** 用户已确认「开启高级音效后在线音乐需先下载再播放」的提示 */
  confirmed: boolean
}

export const DEFAULT_ADVANCED_FX: AdvancedFxSettings = {
  rateEnabled: false,
  playbackRate: 1,
  preservePitch: true,
  loudnessEnabled: false,
  loudnessStrength: 0.5,
  balanceEnabled: false,
  balance: 0,
  widthEnabled: false,
  stereoWidth: 1.5,
  crossfadeEnabled: false,
  crossfadeSeconds: 6,
  vocalRemovalEnabled: false,
  confirmed: false
}

/** 播放页歌词展示设置（恢复默认时回到 DEFAULT_LYRIC_DISPLAY） */
export interface LyricDisplaySettings {
  /** 基准字号 px */
  fontSize: number
  /** 普通歌词颜色（空串 = 默认白） */
  color: string
  /** 高亮（当前行）颜色（空串 = 默认） */
  activeColor: string
  /** 翻译/次要行颜色（空串 = 默认） */
  subColor: string
  /** 加粗 */
  bold: boolean
  /** 行距倍数 */
  lineHeight: number
  /** 非激活行透明度 0.1 - 1 */
  dimOpacity: number
  /** 非激活行模糊 */
  blurInactive: boolean
  /** 默认显示翻译 */
  showTranslation: boolean
}

export const DEFAULT_LYRIC_DISPLAY: LyricDisplaySettings = {
  fontSize: 20,
  color: '',
  activeColor: '',
  subColor: '',
  bold: true,
  lineHeight: 1.55,
  dimOpacity: 0.38,
  blurInactive: false,
  showTranslation: true
}

/** 逐字歌词设置（本地逐字歌词功能，恢复默认时回到 DEFAULT_KARAOKE） */
export interface KaraokeSettings {
  /** 逐字歌词总开关（开启后使用逐字歌词，关闭后使用逐行歌词） */
  enabled: boolean
  /** 自动生成：开启后每首歌都自动生成逐字歌词 */
  autoGenerate: boolean
  /** 自动生成时机：whilePlaying=边播放边生成 afterDone=等生成完后再播放 */
  genMode: 'whilePlaying' | 'afterDone'
  /** 生成完后的播放位置：restart=从头播放 continue=接着播放（仅 afterDone 生效） */
  afterGenPlay: 'restart' | 'continue'
  /** 上次使用的生成算法 */
  lastAlgo: 'v3' | 'v4'
}

export const DEFAULT_KARAOKE: KaraokeSettings = {
  enabled: false,
  autoGenerate: true,
  genMode: 'whilePlaying',
  afterGenPlay: 'restart',
  lastAlgo: 'v4'
}

export const useSettingsStore = defineStore('settings', () => {
  // --- State ---
  const general = ref<GeneralSettings>({
    onlineServices: true,
    closeAction: 'minimize',
    remindOnClose: true,
    taskbarProgress: true,
    orpheusProtocol: true,
    autoCheckUpdate: true,
    updateChannel: 'stable',
    searchResultOrder: ['tx', 'kg', 'wy', 'kw', 'bilibili', 'mg']
  })

  const appearance = ref<AppearanceSettings>({
    globalFont: 'Microsoft YaHei UI',
    lyricsFont: 'Microsoft YaHei UI',
    taskbarLyricsFont: 'Microsoft YaHei UI',
    desktopLyricsFont: 'Microsoft YaHei UI',
    themeMode: 'system',
    themeColorPreset: 'default',
    customThemeColor: '#2C8EFD',
    playlistLayoutStyle: 'classic',
    songListStyle: 'card'
  })

  const playback = ref<PlaybackSettings>({
    autoHideCursorWhenControlsHidden: true,
    limiterStrength: 0.6,
    eqEnabled: false,
    eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    eqPreset: 'flat',
    // 歌词自适应大小开关
    lyricsAutoSize: true,
    // 歌词基础字号（px）
    lyricsFontSize: 28,
    // 播放页歌词区域占比（百分比，表示右侧歌词区域宽度）
    lyricsAreaRatio: 60,
    // 是否启用 Apple 风格歌词
    lyricsAppleStyle: true,
    // Apple 风格歌词模糊效果开关
    lyricsBlurEnabled: true,
    // Apple 风格歌词弹簧效果开关
    lyricsSpringEnabled: true,
    playerBackgroundStyle: 'classic',
    // 桌面歌词设置
    desktopLyricsFontSize: 24,
    desktopLyricsColor: '#ffffff',
    desktopLyricsActiveColor: '#18a058',
    desktopLyricsOpacity: 1.0,
    desktopLyricsShowNextLine: true,
    desktopLyricsAlign: 'center',
    desktopLyricsLocked: false,
    desktopLyricsForceDuet: false
  })

  const local = ref<LocalSettings>({
    scanDirs: [],
    cacheDir: ''
  })

  const source = ref<SourceSettings>({
    preferredPlatform: 'all',
    preferredQuality: '128k'
  })

  const preference = ref<PreferenceSettings>({
    orientation: 'auto'
  })

  const lyricDisplay = ref<LyricDisplaySettings>({ ...DEFAULT_LYRIC_DISPLAY })

  // 高级音效设置
  const advancedFx = ref<AdvancedFxSettings>({ ...DEFAULT_ADVANCED_FX })

  // 逐字歌词设置
  const karaoke = ref<KaraokeSettings>({ ...DEFAULT_KARAOKE })

  // 恢复播放页歌词展示为默认设置（原地更新，保持对象引用不变）
  const resetLyricDisplay = () => {
    Object.assign(lyricDisplay.value, DEFAULT_LYRIC_DISPLAY)
  }

  // 恢复高级音效为默认设置（保留「已确认提示」标记，避免恢复后再次弹窗打扰）
  const resetAdvancedFx = () => {
    const confirmed = advancedFx.value.confirmed
    Object.assign(advancedFx.value, DEFAULT_ADVANCED_FX, { confirmed })
  }

  // 同步屏幕方向设置到原生层（仅移动端生效）
  watch(
    () => preference.value.orientation,
    (mode) => {
      if (!isNativeMobile) return
      import('../platform/mobile/native')
        .then((m) => m.AppPrefs.setOrientation({ mode }))
        .catch((e) => console.warn('设置屏幕方向失败', e))
    },
    { immediate: true }
  )

  // --- Actions ---
  
  // 构造统一的字体栈字符串
  const buildFontStack = (font: string): string => {
    // 组合用户选择字体与系统通用字体栈
    return `"${font}", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
  }

  // 应用全局字体到 body 与 Naive UI 主题
  watch(
    () => appearance.value.globalFont,
    (newFont) => {
      if (newFont) {
        const stack = buildFontStack(newFont)
        document.body.style.fontFamily = stack
        setGlobalFontFamily(stack)
      }
    },
    { immediate: true }
  )

  // 同步主题主色到 Naive UI 主题
  watch(
    () => appearance.value.customThemeColor,
    (color) => {
      if (color) {
        setPrimaryColor(color)
      }
    },
    { immediate: true }
  )

  // 同步压限器设置到音频引擎
  watch(
    () => playback.value.limiterStrength,
    (val) => {
      webAudioEngine.setLimiterStrength(val)
    },
    { immediate: true }
  )

  // 同步均衡器启用状态
  watch(
    () => playback.value.eqEnabled,
    (val) => {
      webAudioEngine.setEqEnabled(val)
    },
    { immediate: true }
  )

  // 同步均衡器各频段增益
  watch(
    () => playback.value.eqGains,
    (val) => {
      webAudioEngine.setEqGains(val)
    },
    { immediate: true, deep: true }
  )

  // ---- 同步高级音效到音频引擎 ----

  // 变速播放（未启用时按 1 倍速）
  watch(
    () => [advancedFx.value.rateEnabled, advancedFx.value.playbackRate, advancedFx.value.preservePitch],
    () => {
      webAudioEngine.setPlaybackRate(
        advancedFx.value.rateEnabled ? advancedFx.value.playbackRate : 1,
        advancedFx.value.preservePitch
      )
    },
    { immediate: true }
  )

  // 响度均衡
  watch(
    () => [advancedFx.value.loudnessEnabled, advancedFx.value.loudnessStrength],
    () => {
      webAudioEngine.setLoudness(advancedFx.value.loudnessEnabled, advancedFx.value.loudnessStrength)
    },
    { immediate: true }
  )

  // 声像平衡（未启用时居中）
  watch(
    () => [advancedFx.value.balanceEnabled, advancedFx.value.balance],
    () => {
      webAudioEngine.setBalance(advancedFx.value.balanceEnabled ? advancedFx.value.balance : 0)
    },
    { immediate: true }
  )

  // 立体声扩展 + 人声消除（共用 M/S 矩阵：中声道增益 / 侧声道增益）
  watch(
    () => [advancedFx.value.widthEnabled, advancedFx.value.stereoWidth, advancedFx.value.vocalRemovalEnabled],
    () => {
      webAudioEngine.setMsMatrix(
        advancedFx.value.vocalRemovalEnabled ? 0 : 1,
        advancedFx.value.widthEnabled ? advancedFx.value.stereoWidth : 1
      )
    },
    { immediate: true }
  )

  // 交叉淡入淡出
  watch(
    () => [advancedFx.value.crossfadeEnabled, advancedFx.value.crossfadeSeconds],
    () => {
      webAudioEngine.setCrossfade(advancedFx.value.crossfadeEnabled, advancedFx.value.crossfadeSeconds)
    },
    { immediate: true }
  )

  // Persistence (Optional for now, can be expanded later)
  const loadSettings = () => {
    const stored = localStorage.getItem('app-settings')
    if (stored) {
      try {
        const data = JSON.parse(stored)
        if (data.general) general.value = { ...general.value, ...data.general }
        if (data.appearance) appearance.value = { ...appearance.value, ...data.appearance }
        if (data.playback) playback.value = { ...playback.value, ...data.playback }
        if (data.local) local.value = { ...local.value, ...data.local }
        if (data.source) source.value = { ...source.value, ...data.source }
        if (data.preference) preference.value = { ...preference.value, ...data.preference }
        if (data.lyricDisplay) lyricDisplay.value = { ...lyricDisplay.value, ...data.lyricDisplay }
        if (data.advancedFx) advancedFx.value = { ...advancedFx.value, ...data.advancedFx }
        if (data.karaoke) karaoke.value = { ...karaoke.value, ...data.karaoke }
      } catch (e) {
        console.error('Failed to load settings', e)
      }
    }
  }

  const saveSettings = () => {
    localStorage.setItem('app-settings', JSON.stringify({
      general: general.value,
      appearance: appearance.value,
      playback: playback.value,
      local: local.value,
      source: source.value,
      preference: preference.value,
      lyricDisplay: lyricDisplay.value,
      advancedFx: advancedFx.value,
      karaoke: karaoke.value
    }))
  }

  // Watch for changes to save
  watch([general, appearance, playback, local, source, preference, lyricDisplay, advancedFx, karaoke], () => {
    saveSettings()
  }, { deep: true })

  // Initialize
  loadSettings()

  const updateAppearance = (settings: Partial<AppearanceSettings>) => {
    appearance.value = { ...appearance.value, ...settings }
  }

  return {
    general,
    appearance,
    playback,
    local,
    source,
    preference,
    lyricDisplay,
    advancedFx,
    karaoke,
    resetLyricDisplay,
    resetAdvancedFx,
    updateAppearance
  }
})
