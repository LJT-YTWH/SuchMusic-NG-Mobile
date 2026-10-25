<script setup lang="ts">
import { ref, reactive, computed, watch, onBeforeUnmount, nextTick } from 'vue'
import { NSpin, NEmpty, NSwitch, useMessage, useDialog } from 'naive-ui'
import { Filesystem, Encoding } from '@capacitor/filesystem'
import { usePlayerStore } from '../../stores/playerStore'
import { usePlaylistStore, type PlaylistTrack } from '../../stores/playlistStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { webAudioEngine } from '../../audio/audio-engine'
import { parseLyricsToCore } from '../../utils/lyric/lyricParser'
import {
  karaokeState,
  generateForCurrentSong,
  regenerateKaraokeWithLyrics,
  clearCurrentKaraoke,
  syncAppliedKaraokeContent
} from '../../utils/karaoke/karaokeService'
import type { KaraokeAlgo } from '../../utils/karaoke/aligner'
import { fetchNewComments, type CommentItem } from '../../apis/netease/comment'
import { cloudSearch, type SearchSong } from '../../apis/netease/search/cloudsearch'
import { fetchNewLyric } from '../../apis/netease/lyric'
import {
  translateSongLyrics,
  applySavedAiLyric,
  applyAiLyricToKaraoke,
  clearAiLyricForSong,
  removeTranslationsFromKaraoke,
  type TranslateProgress
} from '../../utils/aiLyric/aiLyricService'
import { aiSongKeyOf, hasAiLyric } from '../../utils/aiLyric/aiLyricStorage'
import {
  exportSongFiles,
  getSongExportAvailability,
  type SongExportOptions,
  type SongExportAvailability
} from '../../utils/export/songExport'
import { isNativeMobile } from '../../platform'
import { useDesktopLyric } from '../../composables/useDesktopLyric'
import { useTaskbarLyric } from '../../composables/useTaskbarLyric'
import { formatDuration } from '../helpers'
import MobileCover from '../components/MobileCover.vue'
import MobileProgressBar from '../components/MobileProgressBar.vue'
import MobileLyricLine from '../components/MobileLyricLine.vue'
import MarqueeText from '../components/MarqueeText.vue'
import MobileEqPanel from '../components/MobileEqPanel.vue'
import MobileFxPanel from '../components/MobileFxPanel.vue'
import MobileSheet from '../components/MobileSheet.vue'
import defaultCover from '@renderer/assets/icon.png'

const player = usePlayerStore()
const playlistStore = usePlaylistStore()
const settingsStore = useSettingsStore()
const message = useMessage()
const dialog = useDialog()
const { toggleDesktopLyric } = useDesktopLyric()
const { toggle: toggleTaskbarLyric } = useTaskbarLyric()

// ==================== 显示控制 ====================

const visible = computed(() => player.isPlayerPageShown)
const rendered = ref(false)
const closing = ref(false)
// 每次打开递增 key 强制重挂载，确保展开动画完整重播（修复重新打开卡在半路）
const pageKey = ref(0)
let closeTimer: number | undefined

// ==================== 页面上下切换（从屏幕下方滑入 / 滑出） ====================

// 打开完成标记：先在屏幕外（下方）渲染，再上滑到屏幕内
const pageOpened = ref(false)
let openRaf = 0

watch(visible, (v) => {
  if (v) {
    if (closeTimer) {
      clearTimeout(closeTimer)
      closeTimer = undefined
    }
    // 重置上一次关闭时残留的手势状态
    dragY.value = 0
    dragX.value = 0
    gestureAxis.value = 'none'
    transitioning.value = false
    skipGesture = false
    closing.value = false
    pageOpened.value = false
    rendered.value = true
    pageKey.value++
    startLyricEngine()
    // 两帧后再上滑：让起始位置（屏幕下方）先上屏，过渡才有起点
    if (openRaf) cancelAnimationFrame(openRaf)
    openRaf = requestAnimationFrame(() => {
      openRaf = requestAnimationFrame(() => {
        pageOpened.value = true
        openRaf = 0
      })
    })
  } else {
    closing.value = true
    pageOpened.value = false
    stopLyricEngine()
    closeTimer = window.setTimeout(() => {
      rendered.value = false
      closing.value = false
      closeTimer = undefined
    }, 380)
  }
})

const close = (): void => {
  // 保留当前 dragY 作为下滑起点，由 closing 状态统一滑出屏幕
  player.setPlayerPageShown(false)
}

const song = computed(() => player.currentSong)
const coverUrl = computed(() => song.value?.cover || defaultCover)

// ==================== 播放控制 ====================

const togglePlay = async (): Promise<void> => {
  if (!song.value) return
  // 下载缓存进行中：不响应播放/暂停，避免重复触发加载流程
  if (player.isLoading) return
  if (player.isPlaying) {
    await webAudioEngine.pause()
    player.setPlaying(false)
  } else {
    const ok = await webAudioEngine.play()
    if (ok) {
      player.setPlaying(true)
    } else {
      // 引擎内无音频源（应用重启后恢复状态）：交由 PlayerBar 重新加载并播放
      window.dispatchEvent(new CustomEvent('player:replay-current'))
    }
  }
}

const modeIcon = computed(() => {
  switch (player.playMode) {
    case 'loop':
      return 'mgc_repeat_one_line'
    case 'shuffle':
      return 'mgc_shuffle_line'
    default:
      return 'mgc_repeat_line'
  }
})

const modeLabel = computed(() => {
  switch (player.playMode) {
    case 'loop':
      return '单曲循环'
    case 'shuffle':
      return '随机播放'
    default:
      return '列表循环'
  }
})

// ==================== 添加到本地歌单 ====================

const showAddPlaylist = ref(false)
const newPlaylistName = ref('')
const creatingPlaylist = ref(false)

/** 当前播放歌曲 → 歌单曲目 */
function currentTrack(): PlaylistTrack | null {
  const s = song.value
  if (!s) return null
  return {
    id: s.id,
    title: s.title,
    artist: s.artist,
    album: s.album,
    cover: s.cover,
    filePath: s.filePath,
    durationMs: s.durationMs,
    source: s.source,
    sourceSongId: s.sourceSongId
  }
}

function openAddToPlaylist(): void {
  showActions.value = false
  if (!song.value) return
  playlistStore.loadFromStorage()
  newPlaylistName.value = ''
  creatingPlaylist.value = false
  showAddPlaylist.value = true
}

function inPlaylist(playlistId: string): boolean {
  const t = currentTrack()
  return t ? playlistStore.isTrackInPlaylist(playlistId, t) : false
}

function addToPlaylist(playlistId: string): void {
  const t = currentTrack()
  if (!t) return
  const pl = playlistStore.playlists.find((p) => p.id === playlistId)
  const r = playlistStore.addTrackToPlaylist(playlistId, t)
  if (r === 'added') message.success(`已添加到「${pl?.name || '歌单'}」`)
  else if (r === 'exists') message.info('这首歌已在该歌单中')
  else message.error('歌单不存在')
  showAddPlaylist.value = false
}

function createPlaylistAndAdd(): void {
  const name = newPlaylistName.value.trim()
  const t = currentTrack()
  if (!name) {
    message.info('请输入歌单名称')
    return
  }
  if (!t) return
  try {
    const pl = playlistStore.createPlaylistFromTracks(name, [t], t.cover)
    message.success(`已创建「${pl.name}」并添加`)
    showAddPlaylist.value = false
    newPlaylistName.value = ''
    creatingPlaylist.value = false
  } catch (e) {
    message.error(e instanceof Error ? e.message : '创建失败')
  }
}

// ==================== 歌词数据 ====================

interface SimpleLyricWord {
  text: string
  start: number
  end: number
}

interface SimpleLyricLine {
  time: number
  text: string
  ttext?: string
  words?: SimpleLyricWord[]
}

const lyricLines = ref<SimpleLyricLine[]>([])
// 翻译显隐：初始跟随「播放页歌词展示」设置，页内开关同步回写
const showTranslation = ref(settingsStore.lyricDisplay.showTranslation)

watch(showTranslation, (v) => {
  if (settingsStore.lyricDisplay.showTranslation !== v) {
    settingsStore.lyricDisplay.showTranslation = v
  }
})
watch(
  () => settingsStore.lyricDisplay.showTranslation,
  (v) => {
    if (showTranslation.value !== v) showTranslation.value = v
  }
)

// 「播放页歌词展示」设置 → CSS 变量（作用于歌词舞台与迷你歌词）
const lyricVars = computed(() => {
  const ld = settingsStore.lyricDisplay
  const vars: Record<string, string> = {
    '--lyric-font-size': `${ld.fontSize}px`,
    '--lyric-font-weight': ld.bold ? '700' : '400',
    '--lyric-line-height': String(ld.lineHeight),
    '--lyric-dim-opacity': String(ld.dimOpacity),
    '--lyric-blur': ld.blurInactive ? '2px' : '0px'
  }
  if (ld.color) vars['--lyric-color'] = ld.color
  if (ld.activeColor) vars['--lyric-active-color'] = ld.activeColor
  if (ld.subColor) vars['--lyric-sub-color'] = ld.subColor
  return vars
})

// AI 翻译自动套用令牌：防止切歌后旧请求把译文写到新歌曲上
let aiApplyToken = 0

watch(
  () => [song.value?.id, song.value?.lyrics],
  () => {
    const content = song.value?.lyrics || ''
    if (!content) {
      lyricLines.value = []
      return
    }
    try {
      const core = parseLyricsToCore(content)
      lyricLines.value = core
        .map((line) => {
          const words = line.words || []
          const startMs = words.length ? (words[0]?.startTime ?? 0) : 0
          return {
            time: startMs / 1000,
            text: words.map((w) => w.word).join(''),
            ttext: line.translatedLyric || undefined,
            // 逐字歌词：多于一个词单元时保留逐词时间轴供卡拉OK高亮
            words:
              words.length > 1
                ? words.map((w) => ({
                    text: w.word,
                    start: (w.startTime ?? 0) / 1000,
                    end: (w.endTime ?? 0) / 1000
                  }))
                : undefined
          }
        })
        .filter((l) => l.text.trim())
    } catch {
      lyricLines.value = []
    }

    // 已保存过 AI 翻译的歌曲：播放时自动合并译文（已包含则直接跳过）
    const autoSong = song.value
    if (autoSong) {
      const token = ++aiApplyToken
      void applySavedAiLyric(autoSong, content)
        .then((merged) => {
          if (!merged || token !== aiApplyToken) return
          if (player.currentSong?.id !== autoSong.id) return
          player.setLyrics(merged)
          syncAppliedKaraokeContent(autoSong.id, merged)
        })
        .catch(() => undefined)
    }
  },
  { immediate: true }
)

// 歌词包含翻译时才显示翻译开关
const hasTranslation = computed(() => lyricLines.value.some((l) => !!l.ttext))

// ==================== 丝滑歌词引擎（rAF 连续插值） ====================

const lyricStageRef = ref<HTMLElement | null>(null)
const lyricInnerRef = ref<HTMLElement | null>(null)
const activeIdx = ref(-1)
const pageIndex = ref(0) // 0=封面 1=歌词

let rafId = 0
let posTs = performance.now()
let smoothY = 0
let manualUntil = 0 // 手动浏览歌词的截止时间
let engineRunning = false

// positionMs 每次更新时打时间戳，帧间用实时钟外推，消除 250ms 阶梯感
watch(
  () => player.positionMs,
  () => {
    posTs = performance.now()
  }
)

function estTimeSec(): number {
  let t = player.positionMs / 1000
  // 下载缓存期间（isLoading）不外推时间，避免歌词在出声前空跑
  if (player.isPlaying && !player.isLoading) {
    t += (performance.now() - posTs) / 1000
  }
  return t
}

// ---- 行位置缓存 ----
// 旧实现每一帧都读 offsetTop / clientHeight：这会强制浏览器同步重排整页，
// 是歌词滚动卡顿的直接原因。现在只在布局真正变化时测量一次（打开页面 / 切歌 /
// 旋转屏幕 / 改字号），逐帧只做数学运算和 transform 写入。
let lineTops: number[] = []
let lineHeights: number[] = []
let stageHeight = 0
let lastWrittenY = Number.NaN

function measureLyrics(): void {
  const stage = lyricStageRef.value
  const inner = lyricInnerRef.value
  if (!stage || !inner) {
    lineTops = []
    lineHeights = []
    stageHeight = 0
    return
  }
  stageHeight = stage.clientHeight
  const kids = inner.children
  const tops: number[] = []
  const heights: number[] = []
  // children[0] 是顶部占位（.lyric-head-space），最后一个是尾部占位
  for (let i = 1; i < kids.length - 1; i += 1) {
    const el = kids[i] as HTMLElement
    tops.push(el.offsetTop)
    heights.push(el.offsetHeight)
  }
  lineTops = tops
  lineHeights = heights
  lastWrittenY = Number.NaN
}

function lyricTargetY(): number {
  const idx = activeIdx.value
  if (idx < 0 || idx >= lineTops.length) return 0
  // 当前行中心对齐到舞台 38% 高度处
  return lineTops[idx] + lineHeights[idx] / 2 - stageHeight * 0.38
}

// ---- 逐字高亮（Apple Music 风格逐词填充）：每帧更新活跃行内各词的 --p 进度 ----
// 注意：lyricInnerRef 的 children[0] 是顶部占位（.lyric-head-space），歌词行从索引 1 开始
let lastWordLineIdx = -1
let wordPCache: number[] = []
let cachedWordEls: HTMLElement[] = []

function lyricLineEl(idx: number): HTMLElement | null {
  const inner = lyricInnerRef.value
  if (!inner) return null
  return (inner.children[idx + 1] as HTMLElement) ?? null
}

function updateWordHighlight(t: number): void {
  const idx = activeIdx.value
  // 切换活跃行：清除旧行所有词的填充进度，并缓存新行的词节点
  if (idx !== lastWordLineIdx) {
    const oldEl = lastWordLineIdx >= 0 ? lyricLineEl(lastWordLineIdx) : null
    if (oldEl) {
      oldEl.querySelectorAll('.lyric-word').forEach((el) => {
        ;(el as HTMLElement).style.removeProperty('--p')
      })
    }
    lastWordLineIdx = idx
    wordPCache = []
    const el = idx >= 0 ? lyricLineEl(idx) : null
    cachedWordEls = el
      ? Array.from(el.querySelectorAll<HTMLElement>('.lyric-word'))
      : []
  }
  if (idx < 0) return
  const line = lyricLines.value[idx]
  if (!line?.words) return
  const wordEls = cachedWordEls
  const n = Math.min(wordEls.length, line.words.length)
  if (wordPCache.length !== n) wordPCache = new Array(n).fill(-1)
  for (let i = 0; i < n; i++) {
    const w = line.words[i]
    const span = w.end - w.start
    let p = span > 0 ? (t - w.start) / span : 1
    p = p < 0 ? 0 : p > 1 ? 1 : p
    const pct = Math.round(p * 1000) / 10
    if (wordPCache[i] !== pct) {
      wordPCache[i] = pct
      wordEls[i].style.setProperty('--p', pct + '%')
    }
  }
}

function lyricEngineFrame(): void {
  if (!engineRunning) return

  // 1. 用外推时间计算活跃行（二分查找，避免每帧线性扫描歌词数组）
  const t = estTimeSec()
  const lines = lyricLines.value
  let idx = -1
  let lo = 0
  let hi = lines.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].time <= t) {
      idx = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  if (idx !== activeIdx.value) activeIdx.value = idx
  updateWordHighlight(t)

  // 2. 连续插值滚动（非手动浏览时）——只写 transform，不读布局
  const inner = lyricInnerRef.value
  if (inner && performance.now() > manualUntil) {
    const target = Math.max(lyricTargetY(), 0)
    smoothY += (target - smoothY) * 0.085
    if (Math.abs(target - smoothY) < 0.1) smoothY = target
    if (!(Math.abs(smoothY - lastWrittenY) <= 0.05)) {
      inner.style.transform = `translate3d(0, ${(-smoothY).toFixed(2)}px, 0)`
      lastWrittenY = smoothY
    }
  }

  rafId = requestAnimationFrame(lyricEngineFrame)
}

function startLyricEngine(): void {
  if (engineRunning) return
  engineRunning = true
  smoothY = 0
  lastWrittenY = Number.NaN
  void nextTick(measureLyrics)
  rafId = requestAnimationFrame(lyricEngineFrame)
}

function stopLyricEngine(): void {
  engineRunning = false
  cancelAnimationFrame(rafId)
}

// 歌词行 DOM 变化 / 排版设置变化 → 重新测量行位置
watch(
  () => [lyricLines.value.length, settingsStore.lyricDisplay.fontSize, settingsStore.lyricDisplay.lineHeight],
  () => {
    if (!engineRunning) return
    void nextTick(measureLyrics)
  }
)

// 舞台尺寸变化（旋转屏幕、横竖屏切换）→ 重新测量
let lyricObserver: ResizeObserver | null = null
watch(lyricStageRef, (el) => {
  lyricObserver?.disconnect()
  lyricObserver = null
  if (el && typeof ResizeObserver !== 'undefined') {
    lyricObserver = new ResizeObserver(() => measureLyrics())
    lyricObserver.observe(el)
  }
})

// 切歌时重置
watch(
  () => song.value?.id,
  () => {
    smoothY = 0
    lastWrittenY = Number.NaN
    activeIdx.value = -1
    lastWordLineIdx = -1
    cachedWordEls = []
    manualUntil = 0
    lineTops = []
    lineHeights = []
    const inner = lyricInnerRef.value
    if (inner) inner.style.transform = 'translate3d(0, 0, 0)'
  }
)

const seekToLyric = (line: SimpleLyricLine): void => {
  webAudioEngine.seek(line.time * 1000)
  player.setPosition(line.time * 1000)
}

// 封面下迷你歌词
const miniLyric = computed(() => {
  const idx = activeIdx.value
  if (!lyricLines.value.length) return { main: '暂无歌词', sub: '' }
  if (idx < 0) return { main: '…', sub: '' }
  const line = lyricLines.value[idx]
  return {
    main: line.text,
    sub: showTranslation.value ? line.ttext || '' : ''
  }
})

// ==================== 手势系统 ====================

const dragY = ref(0) // 下拉关闭位移
const dragX = ref(0) // 水平轮播位移
const gestureAxis = ref<'none' | 'h' | 'v' | 'lyric'>('none')
const transitioning = ref(false)

let startX = 0
let startY = 0
let lyricStartOffset = 0
// 触摸始于滑杆/按钮等控件时，本轮触摸不触发页面手势（修复拖进度条误触封面切换）
let skipGesture = false

// 横屏检测：横屏下封面与歌词同屏显示，无需左右切换（响应式，驱动布局与按钮差异）
const landscapeMq = window.matchMedia('(orientation: landscape)')
const isLandscape = ref(landscapeMq.matches)
const onOrientationChange = (e: MediaQueryListEvent): void => {
  isLandscape.value = e.matches
}
landscapeMq.addEventListener('change', onOrientationChange)

const pageStyle = computed(() => {
  // 关闭：从当前位置一口气滑到屏幕下方
  if (closing.value) {
    return {
      transform: 'translateY(100%)',
      transition: 'transform 320ms cubic-bezier(0.32, 0.72, 0.35, 1)'
    }
  }
  // 手势拖动 / 回弹：内联 transform 直接跟手
  if (dragY.value > 0 || transitioning.value) {
    return {
      transform: `translateY(${dragY.value}px)`,
      transition: transitioning.value ? 'transform 0.32s cubic-bezier(0.32, 0.72, 0.35, 1)' : 'none'
    }
  }
  // 平时交给 CSS 的 .is-open 控制上滑入场
  return {}
})

const trackStyle = computed(() => {
  const base = pageIndex.value * -50
  return {
    transform: `translateX(calc(${base}% + ${dragX.value}px))`,
    transition: transitioning.value ? 'transform 0.3s cubic-bezier(0.32, 0.72, 0.35, 1)' : 'none'
  }
})

function onTouchStart(e: TouchEvent): void {
  const el = e.target as HTMLElement | null
  // 进度条、按钮、弹层内部的触摸不进入页面手势系统
  skipGesture = !!el?.closest(
    '.n-slider, button, .mp-sheet, .lyric-footer, .ls-more-dialog, .ls-more-mask'
  )
  if (gestureAxis.value !== 'none' || skipGesture) return
  const t = e.touches[0]
  startX = t.clientX
  startY = t.clientY
  transitioning.value = false
}

function onTouchMove(e: TouchEvent): void {
  if (skipGesture) return
  const t = e.touches[0]
  const dx = t.clientX - startX
  const dy = t.clientY - startY

  if (gestureAxis.value === 'none') {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
    if (Math.abs(dx) > Math.abs(dy) && !isLandscape.value) {
      gestureAxis.value = 'h'
    } else if (Math.abs(dy) >= Math.abs(dx) || isLandscape.value) {
      // 歌词页内的垂直拖动 = 浏览歌词；其余区域 = 下拉关闭（横屏下歌词常驻右侧）
      const inLyricStage =
        (pageIndex.value === 1 || isLandscape.value) &&
        (e.target as HTMLElement).closest('.lyric-stage')
      gestureAxis.value = inLyricStage ? 'lyric' : 'v'
      if (gestureAxis.value === 'lyric') {
        lyricStartOffset = smoothY
      }
    }
  }

  if (gestureAxis.value === 'h') {
    dragX.value = dx
  } else if (gestureAxis.value === 'v') {
    dragY.value = Math.max(dy, 0)
  } else if (gestureAxis.value === 'lyric') {
    // 手动浏览歌词：暂停自动跟随 2.5 秒
    const inner = lyricInnerRef.value
    if (inner) {
      smoothY = Math.max(lyricStartOffset - dy, -80)
      inner.style.transform = `translate3d(0, ${(-smoothY).toFixed(2)}px, 0)`
      lastWrittenY = smoothY
      manualUntil = performance.now() + 2500
    }
  }
}

function onTouchEnd(): void {
  if (skipGesture) {
    skipGesture = false
    return
  }
  const axis = gestureAxis.value
  gestureAxis.value = 'none'

  if (axis === 'h') {
    const threshold = window.innerWidth * 0.18
    transitioning.value = true
    if (dragX.value < -threshold && pageIndex.value === 0) {
      pageIndex.value = 1
    } else if (dragX.value > threshold && pageIndex.value === 1) {
      pageIndex.value = 0
    }
    dragX.value = 0
    setTimeout(() => (transitioning.value = false), 320)
  } else if (axis === 'v') {
    if (dragY.value > 110) {
      // 超过阈值：下滑关闭（关闭动画接管后续位移）
      close()
    } else {
      // 未过阈值：回弹
      transitioning.value = true
      dragY.value = 0
      setTimeout(() => (transitioning.value = false), 320)
    }
  }
}

onBeforeUnmount(() => {
  stopLyricEngine()
  lyricObserver?.disconnect()
  lyricObserver = null
  if (closeTimer) clearTimeout(closeTimer)
  if (openRaf) cancelAnimationFrame(openRaf)
  landscapeMq.removeEventListener('change', onOrientationChange)
})

// ==================== 播放队列 ====================

const showQueue = ref(false)

const jumpTo = (index: number): void => {
  player.playSongAtIndex(index)
  showQueue.value = false
}

const clearQueue = (): void => {
  player.clearPlaylist()
  showQueue.value = false
}

// ==================== 评论 ====================

const showComments = ref(false)
const comments = ref<CommentItem[]>([])
const commentsLoading = ref(false)
const commentsTotal = ref(0)
let commentPage = 1
let commentCursor: string | number | undefined

const canComment = computed(() => {
  const s = song.value?.source
  return s === 'wy' || s === 'netease'
})

async function loadComments(reset: boolean): Promise<void> {
  if (!song.value) return
  if (reset) {
    comments.value = []
    commentPage = 1
    commentCursor = undefined
  }
  commentsLoading.value = true
  try {
    const res = await fetchNewComments({
      id: song.value.sourceSongId ?? song.value.id ?? 0,
      type: 0,
      pageNo: commentPage,
      pageSize: 20,
      sortType: 1,
      cursor: commentCursor
    })
    if (res.code === 200 && res.data) {
      comments.value = reset ? res.data.comments : [...comments.value, ...res.data.comments]
      commentsTotal.value = res.data.totalCount
      commentCursor = res.data.cursor
      commentPage++
    }
  } catch (e) {
    console.error('加载评论失败', e)
  } finally {
    commentsLoading.value = false
  }
}

const openComments = (): void => {
  if (!canComment.value) {
    message.info('当前歌曲暂不支持评论')
    return
  }
  showComments.value = true
  void loadComments(true)
}

const formatCommentTime = (ts: number): string => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ==================== 均衡器弹窗 ====================

const showEq = ref(false)

// ==================== 高级音效弹层 ====================

const showFx = ref(false)

// ==================== 更多菜单 ====================

const showActions = ref(false)

// ==================== 下载 ====================

const showDownload = ref(false)
const downloadLoading = ref(false)
const downloadAvailable = reactive<SongExportAvailability>({
  audio: false,
  lyrics: false,
  ai: false,
  karaoke: false,
  audioExt: ''
})
const downloadOptions = reactive<SongExportOptions>({
  audio: false,
  lyrics: false,
  ai: false,
  karaoke: false
})

const downloadCount = computed(
  () => Object.values(downloadOptions).filter(Boolean).length
)

function toggleDownloadOption(key: keyof SongExportOptions): void {
  if (!downloadAvailable[key]) return
  downloadOptions[key] = !downloadOptions[key]
}

function closeDownload(): void {
  if (downloadLoading.value) return
  showDownload.value = false
}

async function openDownload(): Promise<void> {
  showActions.value = false
  const cur = song.value
  if (!cur) return
  if (!isNativeMobile) {
    message.info('仅支持在安卓应用内下载')
    return
  }
  const avail = await getSongExportAvailability(cur)
  Object.assign(downloadAvailable, avail)
  downloadOptions.audio = avail.audio
  downloadOptions.lyrics = avail.lyrics
  downloadOptions.ai = avail.ai
  downloadOptions.karaoke = avail.karaoke
  showDownload.value = true
}

async function confirmDownload(): Promise<void> {
  const cur = song.value
  if (!cur || downloadLoading.value) return
  if (!downloadCount.value) {
    message.info('请至少选择一项下载内容')
    return
  }
  downloadLoading.value = true
  try {
    const res = await exportSongFiles(cur, { ...downloadOptions })
    if (res.canceled) return
    if (!res.count) {
      message.error(res.failed ? '导出失败，请重试' : '没有可导出的内容')
      return
    }
    message.success(
      `已导出 ${res.count} 个文件${res.location ? ` 到 ${res.location}` : ''}`
    )
    showDownload.value = false
  } catch (e) {
    console.error('[下载] 导出失败:', e)
    message.error(e instanceof Error ? e.message : '导出失败，请重试')
  } finally {
    downloadLoading.value = false
  }
}

const openFloatingLyric = async (): Promise<void> => {
  showActions.value = false
  try {
    await toggleDesktopLyric()
  } catch (e) {
    console.error(e)
  }
}

const openMiniLyric = async (): Promise<void> => {
  showActions.value = false
  try {
    await toggleTaskbarLyric()
  } catch (e) {
    console.error(e)
  }
}

// 横屏「更多」弹窗内的完整功能入口（竖屏这些在底栏，横屏收纳进弹窗）
const doToggleMode = (): void => {
  // 菜单保持打开，播放模式标签实时更新
  player.togglePlayMode()
}

const openCommentsFromMenu = (): void => {
  showActions.value = false
  openComments()
}

const openEqFromMenu = (): void => {
  showActions.value = false
  showEq.value = true
}

const openFxFromMenu = (): void => {
  showActions.value = false
  showFx.value = true
}

const openQueueFromMenu = (): void => {
  showActions.value = false
  showQueue.value = true
}

// ==================== 获取在线歌词（本地歌曲） ====================

const isLocalSong = computed(() => !!song.value?.filePath)

/** 由音频文件路径推导同名 .lrc 歌词路径 */
const lrcPathOf = (filePath: string): string =>
  filePath.replace(/\.[^./\\]+$/, '') + '.lrc'

const hasOnlineLrc = ref(false)

async function checkSidecarLrc(filePath: string | undefined): Promise<void> {
  if (!filePath) {
    hasOnlineLrc.value = false
    return
  }
  try {
    await Filesystem.stat({ path: lrcPathOf(filePath) })
    hasOnlineLrc.value = true
  } catch {
    hasOnlineLrc.value = false
  }
}

watch(
  () => song.value?.filePath,
  (fp) => {
    void checkSidecarLrc(fp)
  },
  { immediate: true }
)

// ---- 第一步：搜索候选歌曲 ----
const showLyricSearch = ref(false)
const lyricSearchKeyword = ref('')
const lyricSearching = ref(false)
const lyricResults = ref<SearchSong[]>([])

const openLyricSearch = (): void => {
  showActions.value = false
  lyricSheet.value = ''
  if (!song.value?.filePath) {
    message.info('当前不是本地歌曲')
    return
  }
  lyricSearchKeyword.value = song.value.title || ''
  showLyricSearch.value = true
  void doLyricSearch()
}

async function doLyricSearch(): Promise<void> {
  const kw = lyricSearchKeyword.value.trim()
  if (!kw) {
    message.info('请输入搜索关键词')
    return
  }
  lyricSearching.value = true
  lyricResults.value = []
  try {
    const res = await cloudSearch(kw, 1, 15, 0)
    lyricResults.value = res?.result?.songs || []
    if (!lyricResults.value.length) {
      message.info('未找到匹配的在线歌曲')
    }
  } catch (e) {
    console.error('搜索在线歌曲失败', e)
    message.error('搜索失败，请检查网络')
  } finally {
    lyricSearching.value = false
  }
}

// ---- 第二步：获取歌词并预览 ----
const showLyricPreview = ref(false)
const lyricPreviewLoading = ref(false)
const previewSongTitle = ref('')
const previewLrc = ref('')

// 预览展示：剥离时间轴，仅显示歌词文本行
const previewLines = computed(() =>
  previewLrc.value
    .split('\n')
    .map((l) => l.replace(/\[[^\]]*\]/g, '').trim())
    .filter(Boolean)
)

async function pickLyricResult(item: SearchSong): Promise<void> {
  showLyricSearch.value = false
  showLyricPreview.value = true
  lyricPreviewLoading.value = true
  previewLrc.value = ''
  previewSongTitle.value = `${item.name} - ${(item.ar || []).map((a) => a.name).join('/')}`
  try {
    const res = await fetchNewLyric(item.id)
    const lrc =
      res?.lrc?.lyric || res?.yrc?.lyric || res?.klyric?.lyric || ''
    if (!lrc) {
      showLyricPreview.value = false
      message.info('该歌曲暂无可用歌词')
      return
    }
    previewLrc.value = lrc
  } catch (e) {
    console.error('获取在线歌词失败', e)
    showLyricPreview.value = false
    message.error('获取歌词失败')
  } finally {
    lyricPreviewLoading.value = false
  }
}

// ---- 第三步：保存 LRC 到本地歌曲同目录 ----
const lyricSaving = ref(false)

async function saveOnlineLyric(): Promise<void> {
  const fp = song.value?.filePath
  if (!fp || !previewLrc.value) return
  lyricSaving.value = true
  try {
    await Filesystem.writeFile({
      path: lrcPathOf(fp),
      data: previewLrc.value,
      encoding: Encoding.UTF8,
      recursive: true
    })
    // 立即应用到当前播放
    player.setLyrics(previewLrc.value)
    hasOnlineLrc.value = true
    showLyricPreview.value = false
    message.success('歌词已保存到本地')
  } catch (e) {
    console.error('保存歌词文件失败', e)
    message.error('保存失败，请检查存储权限')
  } finally {
    lyricSaving.value = false
  }
}

// ---- 清空已保存的在线歌词 ----
function clearOnlineLyric(): void {
  showActions.value = false
  lyricSheet.value = ''
  const fp = song.value?.filePath
  if (!fp) return
  dialog.warning({
    title: '清空在线歌词',
    content: '将删除为该歌曲保存的在线歌词 LRC 文件，确定继续吗？',
    positiveText: '清空',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await Filesystem.deleteFile({ path: lrcPathOf(fp) })
      } catch {
        // 文件可能已不存在，视为成功
      }
      if (song.value?.filePath === fp) {
        player.setLyrics('')
      }
      hasOnlineLrc.value = false
      message.success('已清空在线歌词')
    }
  })
}

// ==================== 歌词菜单（歌词 → 在线歌词 / 本地逐字歌词） ====================

// ''=关闭 root=歌词 online=在线歌词 local=本地逐字歌词 algo=选择生成算法
// autoAlgo=自动生成算法 genMode=生成时机 afterPlay=生成完后
const lyricSheet = ref<
  '' | 'root' | 'online' | 'local' | 'algo' | 'autoAlgo' | 'genMode' | 'afterPlay' | 'ai'
>('')

// 卡片标题跟随层级变化（弹层内不再重复渲染标题）
const lyricSheetTitle = computed(() => {
  switch (lyricSheet.value) {
    case 'online':
      return '在线歌词'
    case 'local':
      return '本地逐字歌词'
    case 'algo':
      return '选择生成算法'
    case 'autoAlgo':
      return '自动生成算法'
    case 'genMode':
      return '生成时机'
    case 'afterPlay':
      return '生成完后'
    case 'ai':
      return 'AI 歌词翻译'
    default:
      return '歌词'
  }
})

const openLyricSheet = (): void => {
  showActions.value = false
  lyricSheet.value = 'root'
}

const closeLyricSheet = (): void => {
  lyricSheet.value = ''
}

const karaokeEnabled = computed({
  get: () => settingsStore.karaoke.enabled,
  set: (v: boolean) => {
    settingsStore.karaoke.enabled = v
    message.success(v ? '已开启逐字歌词' : '已关闭逐字歌词，恢复逐行歌词')
  }
})

const hasKaraoke = computed(() => karaokeState.currentHasKaraoke)
const canKaraoke = computed(() => !!song.value?.filePath)

const openAlgoSheet = (): void => {
  if (!canKaraoke.value) {
    message.info('当前不是本地歌曲')
    return
  }
  lyricSheet.value = 'algo'
}

const pickAlgo = (algo: KaraokeAlgo): void => {
  lyricSheet.value = ''
  void generateForCurrentSong(algo)
}

const setGenMode = (mode: 'whilePlaying' | 'afterDone'): void => {
  settingsStore.karaoke.genMode = mode
}

// 设置项当前值（右侧展示）
const autoAlgoLabel = computed(() =>
  settingsStore.karaoke.lastAlgo === 'v3' ? 'V3 算法' : 'V4 算法'
)
const genModeLabel = computed(() =>
  settingsStore.karaoke.genMode === 'afterDone' ? '生成完再播放' : '边播放边生成'
)
const afterPlayLabel = computed(() =>
  settingsStore.karaoke.afterGenPlay === 'continue' ? '接着播放' : '从头播放'
)

const clearKaraoke = (): void => {
  lyricSheet.value = ''
  dialog.warning({
    title: '清空逐字歌词',
    content: '将删除为该歌曲生成的逐字歌词文件，并恢复为逐行歌词，确定继续吗？',
    positiveText: '清空',
    negativeText: '取消',
    onPositiveClick: async () => {
      await clearCurrentKaraoke()
    }
  })
}

// ==================== AI 歌词翻译 ====================

const aiRequirement = ref('')
const aiGenerating = ref(false)
const aiStage = ref('')

/** 当前歌词是否为逐字歌词（决定译文注入方式） */
const currentLyricIsKaraoke = computed(() =>
  (song.value?.lyrics || '').includes('<') && /<\d{1,2}:\d{1,2}/.test(song.value?.lyrics || '')
)

/** 当前歌曲是否已有 AI 翻译（控制「清空」按钮可用性） */
const hasAiTranslation = ref(false)

async function refreshAiTranslationState(): Promise<void> {
  const cur = song.value
  hasAiTranslation.value = cur ? await hasAiLyric(aiSongKeyOf(cur)) : false
}

watch(
  () => song.value?.id,
  () => {
    // 切歌后清空上一次的翻译要求/背景输入
    aiRequirement.value = ''
    showDownload.value = false
    void refreshAiTranslationState()
  },
  { immediate: true }
)

async function startAiTranslate(): Promise<void> {
  const cur = song.value
  if (!cur) return
  const lyrics = cur.lyrics || ''
  if (!lyrics.trim()) {
    message.info('当前歌曲暂无歌词，请先获取歌词')
    return
  }
  if (aiGenerating.value) return

  aiGenerating.value = true
  aiStage.value = '准备中…'
  try {
    const result = await translateSongLyrics({
      song: cur,
      lyrics,
      requirement: aiRequirement.value,
      onProgress: (p: TranslateProgress) => {
        aiStage.value = p.stage
      }
    })

    hasAiTranslation.value = true

    // 仅在仍播放这首歌时应用/询问，避免切歌后误操作
    if (player.currentSong?.id === cur.id) {
      if (result.hasKaraoke) {
        // 已有逐字歌词：询问是否用包含译文的逐行歌词重新生成
        const shouldRegenerate = await new Promise<boolean>((resolve) => {
          let done = false
          const finish = (v: boolean): void => {
            if (done) return
            done = true
            resolve(v)
          }
          dialog.info({
            title: '重新生成逐字歌词',
            content:
              '当前歌曲已有逐字歌词。是否使用包含 AI 翻译的逐行歌词重新生成逐字歌词？生成约需 30~90 秒。',
            positiveText: '重新生成',
            negativeText: '保留现有',
            onPositiveClick: () => finish(true),
            onNegativeClick: () => finish(false),
            onClose: () => finish(false),
            onMaskClick: () => finish(false)
          })
        })

        // 询问期间可能已切歌
        if (player.currentSong?.id === cur.id) {
          if (shouldRegenerate) {
            aiStage.value = '正在重新生成逐字歌词…'
            const ok = await regenerateKaraokeWithLyrics(cur, result.mergedLrc)
            if (!ok) {
              const injected = await applyAiLyricToKaraoke(cur)
              if (injected) {
                player.setLyrics(injected)
                syncAppliedKaraokeContent(cur.id, injected)
              }
            }
          } else {
            const injected = await applyAiLyricToKaraoke(cur)
            const next = injected || result.mergedLrc
            player.setLyrics(next)
            syncAppliedKaraokeContent(cur.id, next)
          }
        }
      } else {
        player.setLyrics(result.mergedLrc)
      }
    }

    message.success(
      `AI 翻译完成（${result.translatedCount} 行），已保存到 AI 翻译歌词目录`
    )
    lyricSheet.value = ''
  } catch (e) {
    console.error('[AI 翻译] 失败:', e)
    message.error(e instanceof Error ? e.message : 'AI 翻译失败，请重试')
  } finally {
    aiGenerating.value = false
    aiStage.value = ''
  }
}

/** 清空当前歌曲的 AI 翻译（同时移除逐字歌词文件中的 AI 译文） */
async function clearCurrentAiTranslate(): Promise<void> {
  const cur = song.value
  if (!cur || aiGenerating.value) return
  try {
    const res = await clearAiLyricForSong(cur)
    if (!res.removed) {
      hasAiTranslation.value = false
      message.info('当前歌曲没有 AI 翻译')
      return
    }

    const next = currentLyricIsKaraoke.value
      ? (res.karaokeContent ?? removeTranslationsFromKaraoke(cur.lyrics || '', res.lines))
      : res.plainLyrics

    if (next != null && player.currentSong?.id === cur.id) {
      player.setLyrics(next)
      syncAppliedKaraokeContent(cur.id, next)
    }
    hasAiTranslation.value = false
    message.success('已清空当前 AI 翻译')
  } catch (e) {
    console.error('[AI 翻译] 清空失败:', e)
    message.error(e instanceof Error ? e.message : '清空失败，请重试')
  }
}

// 逐字歌词服务的全局提示 → 桥接到 naive-ui message
watch(
  () => karaokeState.notice,
  (n) => {
    if (!n) return
    if (n.kind === 'success') message.success(n.text)
    else if (n.kind === 'error') message.error(n.text)
    else message.info(n.text)
  }
)
</script>

<template>
  <Teleport to="body">
    <div
      v-if="rendered"
      :key="pageKey"
      class="player-page"
      :class="{ closing, 'is-open': pageOpened, dragging: gestureAxis === 'v' }"
      :style="pageStyle"
      @touchstart.passive="onTouchStart"
      @touchmove.passive="onTouchMove"
      @touchend="onTouchEnd"
    >
      <!-- 背景：封面高斯模糊 + 渐变压暗（图片自身 filter，避免 backdrop-filter 闪烁与掉帧） -->
      <div class="bg-layer">
        <img :src="coverUrl" class="bg-cover" alt="" />
        <div class="bg-frost"></div>
      </div>

      <div class="page-body">
        <!-- 顶部：关闭 + 标题（左对齐） -->
        <div class="topbar">
          <button class="top-close" @click="close">
            <i class="mgc_down_line"></i>
          </button>
          <div class="title-block">
            <!-- 歌名 / 歌手过长时横向滚动 -->
            <MarqueeText class="song-title" :text="song?.title || '未在播放'" />
            <MarqueeText class="song-artist" :text="song?.artist || 'SuchMusic'" />
          </div>
        </div>

        <!-- 中部：封面 ↔ 歌词 轮播（左右滑动切换） -->
        <div class="stage">
          <div class="stage-track" :style="trackStyle">
            <!-- 封面面板 -->
            <div class="panel cover-panel" :style="lyricVars">
              <MobileCover :src="song?.cover" class="big-cover" radius="var(--mp-r-lg, 28px)" />
              <div class="mini-lyric">
                <div class="mini-main">{{ miniLyric.main }}</div>
                <div v-if="miniLyric.sub" class="mini-sub">{{ miniLyric.sub }}</div>
              </div>
            </div>

            <!-- 歌词面板 -->
            <div class="panel lyric-panel">
              <div v-if="lyricLines.length" ref="lyricStageRef" class="lyric-stage" :style="lyricVars">
                <div ref="lyricInnerRef" class="lyric-inner">
                  <div class="lyric-head-space"></div>
                  <MobileLyricLine
                    v-for="(line, i) in lyricLines"
                    :key="i"
                    :text="line.text"
                    :ttext="line.ttext"
                    :words="line.words"
                    :active="i === activeIdx"
                    :show-translation="showTranslation"
                    @seek="seekToLyric(line)"
                  />
                  <div class="lyric-tail-space"></div>
                </div>
              </div>
              <div v-else class="no-lyric">
                <n-empty description="纯音乐，请欣赏" />
              </div>
              <div class="lyric-footer">
                <button
                  v-if="hasTranslation"
                  class="trans-btn"
                  :class="{ off: !showTranslation }"
                  @click="showTranslation = !showTranslation"
                >
                  <i class="mgc_translate_2_line"></i>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 页面指示点 -->
        <div class="page-dots">
          <span class="dot" :class="{ active: pageIndex === 0 }"></span>
          <span class="dot" :class="{ active: pageIndex === 1 }"></span>
        </div>

        <!-- 进度（独立组件：高频进度更新不会带动整页重渲染） -->
        <MobileProgressBar />

        <!-- 主控制（横屏：底栏收纳为一个「更多」按钮，与播放控制同一行） -->
        <div class="controls">
          <button class="ctrl-btn" @click="player.playPrev()">
            <i class="mgc_skip_previous_fill"></i>
          </button>
          <button class="ctrl-btn play" @click="togglePlay">
            <i
              :class="player.isLoading ? 'mgc_refresh_2_line mp-spin' : player.isPlaying ? 'mgc_pause_fill' : 'mgc_play_fill'"
            ></i>
          </button>
          <button class="ctrl-btn" @click="player.playNext()">
            <i class="mgc_skip_forward_fill"></i>
          </button>
          <button v-if="isLandscape" class="ctrl-btn more" @click="showActions = true">
            <i class="mgc_more_2_line"></i>
          </button>
        </div>

        <!-- 底部五图标栏（仅竖屏；横屏收纳进「更多」弹窗） -->
        <div v-if="!isLandscape" class="bottom-bar">
          <button class="bar-btn" @click="player.togglePlayMode()">
            <i :class="modeIcon"></i>
          </button>
          <button class="bar-btn" @click="openComments">
            <i class="mgc_message_2_line"></i>
          </button>
          <button class="bar-btn" @click="showEq = true">
            <i class="mgc_voice_line"></i>
          </button>
          <button class="bar-btn" @click="showQueue = true">
            <i class="mgc_list_check_2_line"></i>
          </button>
          <button class="bar-btn" @click="showActions = true">
            <i class="mgc_more_2_line"></i>
          </button>
        </div>
      </div>

      <!-- 均衡器弹层（竖屏从按钮展开为卡片；横屏为右侧抽屉。标题由面板自带） -->
      <MobileSheet :show="showEq" @update:show="showEq = $event">
        <MobileEqPanel />
      </MobileSheet>

      <!-- 高级音效弹层（功能列表 → 单项详细配置，标题由面板自带） -->
      <MobileSheet :show="showFx" @update:show="showFx = $event">
        <MobileFxPanel in-sheet />
      </MobileSheet>

      <!-- 更多操作弹层（仅竖屏；横屏使用独立功能面板） -->
      <MobileSheet
        v-if="!isLandscape"
        :show="showActions"
        title="更多"
        meta="MORE"
        @update:show="showActions = $event"
      >
        <div class="action-list">
          <div class="action-item" @click="openAddToPlaylist">
            <i class="mgc_playlist_line"></i>
            <span>添加到本地歌单</span>
          </div>
          <div class="action-item" @click="openLyricSheet">
            <i class="mgc_quill_pen_line"></i>
            <span>歌词</span>
          </div>
          <div class="action-item" @click="openFloatingLyric">
            <i class="mgc_text_line"></i>
            <span>悬浮窗歌词</span>
          </div>
          <div class="action-item" @click="openMiniLyric">
            <i class="mgc_subtitle_line"></i>
            <span>迷你悬浮条</span>
          </div>
          <div class="action-item" @click="openFxFromMenu">
            <i class="mgc_magic_1_line"></i>
            <span>高级</span>
          </div>
          <div class="action-item" @click="openDownload">
            <i class="mgc_download_2_line"></i>
            <span>下载</span>
          </div>
          <div class="action-item cancel" @click="showActions = false">
            <span>取消</span>
          </div>
        </div>
      </MobileSheet>

      <!-- 添加到本地歌单弹层 -->
      <MobileSheet
        :show="showAddPlaylist"
        title="添加到本地歌单"
        meta="MY PLAYLISTS"
        @update:show="showAddPlaylist = $event"
      >
        <div v-if="creatingPlaylist" class="new-pl-form">
          <input
            v-model="newPlaylistName"
            class="new-pl-input"
            placeholder="请输入歌单名称"
            @keyup.enter="createPlaylistAndAdd"
          />
          <button class="new-pl-btn" @click="createPlaylistAndAdd">创建并添加</button>
        </div>
        <div class="action-list">
          <div
            v-for="pl in playlistStore.playlists"
            :key="pl.id"
            class="action-item"
            @click="addToPlaylist(pl.id)"
          >
            <i :class="pl.id === 'favorite' ? 'mgc_heart_fill' : 'mgc_playlist_line'"></i>
            <span class="action-flex">{{ pl.name }}</span>
            <span class="pl-track-count">{{ pl.tracks.length }} 首</span>
            <i v-if="inPlaylist(pl.id)" class="mgc_check_fill pl-checked"></i>
            <i v-else class="mgc_add_line pl-add"></i>
          </div>
          <div v-if="!creatingPlaylist" class="action-item" @click="creatingPlaylist = true">
            <i class="mgc_add_line"></i>
            <span>新建歌单并添加</span>
          </div>
          <div class="action-item cancel" @click="showAddPlaylist = false">
            <span>取消</span>
          </div>
        </div>
      </MobileSheet>

      <!-- 下载弹层 -->
      <MobileSheet
        :show="showDownload"
        title="下载"
        meta="EXPORT"
        @update:show="closeDownload"
      >
        <div class="dl-song">
          {{ song?.title || '未知歌曲' }}<span v-if="song?.artist"> · {{ song.artist }}</span>
        </div>
        <div class="dl-list">
          <div
            class="dl-item"
            :class="{ 'is-disabled': !downloadAvailable.audio }"
            @click="toggleDownloadOption('audio')"
          >
            <span class="dl-check" :class="{ on: downloadOptions.audio }">
              <i v-if="downloadOptions.audio" class="mgc_check_line"></i>
            </span>
            <span class="dl-label">音频文件</span>
            <span class="dl-note">
              {{ downloadAvailable.audio
                ? (downloadAvailable.audioExt || '.mp3').replace('.', '').toUpperCase()
                : '无本地音频' }}
            </span>
          </div>
          <div
            class="dl-item"
            :class="{ 'is-disabled': !downloadAvailable.lyrics }"
            @click="toggleDownloadOption('lyrics')"
          >
            <span class="dl-check" :class="{ on: downloadOptions.lyrics }">
              <i v-if="downloadOptions.lyrics" class="mgc_check_line"></i>
            </span>
            <span class="dl-label">歌词文件</span>
            <span class="dl-note">{{ downloadAvailable.lyrics ? 'LRC' : '暂无歌词' }}</span>
          </div>
          <div
            class="dl-item"
            :class="{ 'is-disabled': !downloadAvailable.ai }"
            @click="toggleDownloadOption('ai')"
          >
            <span class="dl-check" :class="{ on: downloadOptions.ai }">
              <i v-if="downloadOptions.ai" class="mgc_check_line"></i>
            </span>
            <span class="dl-label">AI 翻译歌词</span>
            <span class="dl-note">{{ downloadAvailable.ai ? '含译文 LRC' : '未生成' }}</span>
          </div>
          <div
            class="dl-item"
            :class="{ 'is-disabled': !downloadAvailable.karaoke }"
            @click="toggleDownloadOption('karaoke')"
          >
            <span class="dl-check" :class="{ on: downloadOptions.karaoke }">
              <i v-if="downloadOptions.karaoke" class="mgc_check_line"></i>
            </span>
            <span class="dl-label">逐字歌词</span>
            <span class="dl-note">{{ downloadAvailable.karaoke ? '增强 LRC' : '未生成' }}</span>
          </div>
        </div>
        <div class="dl-actions">
          <button
            class="mp-btn-primary dl-btn"
            :disabled="downloadLoading || !downloadCount"
            @click="confirmDownload"
          >
            {{ downloadLoading ? '正在导出…' : '选择目录并下载' }}
          </button>
        </div>
        <div class="dl-hint">会打开系统目录选择器，文件保存到你选择的文件夹。</div>
      </MobileSheet>

      <!-- 歌词分类弹层（层级：歌词 → 在线歌词 / 本地逐字歌词 → 生成算法） -->
      <MobileSheet
        :show="!!lyricSheet"
        :title="lyricSheetTitle"
        meta="LYRICS"
        @update:show="!$event && closeLyricSheet()"
      >
        <!-- 第一级：歌词 -->
        <template v-if="lyricSheet === 'root'">
          <div class="action-list">
            <div class="action-item" @click="lyricSheet = 'online'">
              <i class="mgc_download_2_line"></i>
              <span>在线歌词</span>
              <i class="mgc_right_line action-arrow"></i>
            </div>
            <div class="action-item" @click="lyricSheet = 'local'">
              <i class="mgc_font_size_line"></i>
              <span>本地逐字歌词</span>
              <i class="mgc_right_line action-arrow"></i>
            </div>
            <div class="action-item" @click="lyricSheet = 'ai'">
              <i class="mgc_magic_1_line"></i>
              <span>AI 歌词翻译</span>
              <i class="mgc_right_line action-arrow"></i>
            </div>
          </div>
        </template>

        <!-- 第二级：在线歌词 -->
        <template v-else-if="lyricSheet === 'online'">
          <div class="action-list">
            <div v-if="isLocalSong" class="action-item" @click="openLyricSearch">
              <i class="mgc_download_2_line"></i>
              <span>获取在线歌词</span>
            </div>
            <div v-if="isLocalSong && hasOnlineLrc" class="action-item" @click="clearOnlineLyric">
              <i class="mgc_eraser_line"></i>
              <span>清空在线歌词</span>
            </div>
            <div v-if="!isLocalSong" class="sheet-tip">当前不是本地歌曲</div>
            <div class="action-item cancel" @click="lyricSheet = 'root'">
              <i class="mgc_left_line"></i>
              <span>返回</span>
            </div>
          </div>
        </template>

        <!-- 第二级：本地逐字歌词 -->
        <template v-else-if="lyricSheet === 'local'">
          <div class="action-list">
            <div class="action-item">
              <i class="mgc_font_line"></i>
              <span class="action-flex">逐字歌词</span>
              <n-switch :value="karaokeEnabled" size="small" @update:value="karaokeEnabled = $event" />
            </div>
            <div class="action-item">
              <i class="mgc_repeat_line"></i>
              <span class="action-flex">自动生成</span>
              <n-switch
                :value="settingsStore.karaoke.autoGenerate"
                size="small"
                @update:value="settingsStore.karaoke.autoGenerate = $event"
              />
            </div>
            <div class="action-item" @click="lyricSheet = 'autoAlgo'">
              <i class="mgc_command_line"></i>
              <span class="action-flex">自动生成算法</span>
              <span class="action-value">{{ autoAlgoLabel }}</span>
              <i class="mgc_right_line action-arrow"></i>
            </div>
            <div class="action-item" @click="openAlgoSheet">
              <i class="mgc_magic_1_line"></i>
              <span class="action-flex">生成逐字歌词</span>
              <i class="mgc_right_line action-arrow"></i>
            </div>
            <div class="action-item" @click="lyricSheet = 'genMode'">
              <i class="mgc_time_line"></i>
              <span class="action-flex">生成时机</span>
              <span class="action-value">{{ genModeLabel }}</span>
              <i class="mgc_right_line action-arrow"></i>
            </div>
            <div class="action-item" @click="lyricSheet = 'afterPlay'">
              <i class="mgc_play_circle_line"></i>
              <span class="action-flex">生成完后</span>
              <span class="action-value">{{ afterPlayLabel }}</span>
              <i class="mgc_right_line action-arrow"></i>
            </div>
            <div v-if="hasKaraoke" class="action-item" @click="clearKaraoke">
              <i class="mgc_eraser_line danger-text"></i>
              <span class="danger-text">清空逐字歌词</span>
            </div>
            <div class="action-item cancel" @click="lyricSheet = 'root'">
              <i class="mgc_left_line"></i>
              <span>返回</span>
            </div>
          </div>
        </template>

        <!-- 三级：自动生成算法 -->
        <template v-else-if="lyricSheet === 'autoAlgo'">
          <div class="action-list">
            <div class="action-item" @click="settingsStore.karaoke.lastAlgo = 'v3'">
              <i
                :class="
                  settingsStore.karaoke.lastAlgo === 'v3'
                    ? 'mgc_check_circle_fill'
                    : 'mgc_round_line'
                "
              ></i>
              <span>V3 算法</span>
            </div>
            <div class="action-item" @click="settingsStore.karaoke.lastAlgo = 'v4'">
              <i
                :class="
                  settingsStore.karaoke.lastAlgo === 'v4'
                    ? 'mgc_check_circle_fill'
                    : 'mgc_round_line'
                "
              ></i>
              <span>V4 算法（默认）</span>
            </div>
            <div class="action-item cancel" @click="lyricSheet = 'local'">
              <i class="mgc_left_line"></i>
              <span>返回</span>
            </div>
          </div>
        </template>

        <!-- 三级：生成时机 -->
        <template v-else-if="lyricSheet === 'genMode'">
          <div class="action-list">
            <div class="action-item" @click="setGenMode('whilePlaying')">
              <i
                :class="
                  settingsStore.karaoke.genMode === 'whilePlaying'
                    ? 'mgc_check_circle_fill'
                    : 'mgc_round_line'
                "
              ></i>
              <span>边播放边生成</span>
            </div>
            <div class="action-item" @click="setGenMode('afterDone')">
              <i
                :class="
                  settingsStore.karaoke.genMode === 'afterDone'
                    ? 'mgc_check_circle_fill'
                    : 'mgc_round_line'
                "
              ></i>
              <span>等生成完后再播放</span>
            </div>
            <div class="action-item cancel" @click="lyricSheet = 'local'">
              <i class="mgc_left_line"></i>
              <span>返回</span>
            </div>
          </div>
        </template>

        <!-- 三级：生成完后 -->
        <template v-else-if="lyricSheet === 'afterPlay'">
          <div class="action-list">
            <div class="action-item" @click="settingsStore.karaoke.afterGenPlay = 'restart'">
              <i
                :class="
                  settingsStore.karaoke.afterGenPlay === 'restart'
                    ? 'mgc_check_circle_fill'
                    : 'mgc_round_line'
                "
              ></i>
              <span>从头播放</span>
            </div>
            <div class="action-item" @click="settingsStore.karaoke.afterGenPlay = 'continue'">
              <i
                :class="
                  settingsStore.karaoke.afterGenPlay === 'continue'
                    ? 'mgc_check_circle_fill'
                    : 'mgc_round_line'
                "
              ></i>
              <span>接着播放</span>
            </div>
            <div class="action-item cancel" @click="lyricSheet = 'local'">
              <i class="mgc_left_line"></i>
              <span>返回</span>
            </div>
          </div>
        </template>

        <!-- 第三级：选择生成算法 -->
        <!-- AI 歌词翻译 -->
        <template v-else-if="lyricSheet === 'ai'">
          <div class="ai-panel">
            <div class="ai-tip">
              可填写歌曲背景或翻译要求（也可留空），AI 会逐行翻译当前歌词。
            </div>
            <textarea
              v-model="aiRequirement"
              class="ai-textarea"
              rows="4"
              :disabled="aiGenerating"
              placeholder="例如：这是电影《…》的主题曲，讲述主角在异乡的思念；请用更口语、克制的中文翻译，保留人名与专有名词。"
            ></textarea>
            <div v-if="aiGenerating" class="ai-status">{{ aiStage || '正在翻译…' }}</div>
            <button
              class="mp-btn-primary ai-btn"
              :disabled="aiGenerating"
              @click="startAiTranslate"
            >
              {{ aiGenerating ? '正在翻译…' : '开始翻译' }}
            </button>
            <button
              class="ai-clear-btn"
              :disabled="aiGenerating || !hasAiTranslation"
              @click="clearCurrentAiTranslate"
            >
              <i class="mgc_delete_line"></i>
              清空当前 AI 翻译
            </button>
            <div class="ai-hint">
              翻译结果会保存到应用私有目录 ai-lyrics/，可在「设置 → 本地与缓存」中管理；
              若该曲已有逐字歌词，会询问是否用包含译文的逐行歌词重新生成逐字歌词。
            </div>
          </div>
          <div class="action-list">
            <div class="action-item cancel" @click="lyricSheet = 'root'">
              <i class="mgc_left_line"></i>
              <span>返回</span>
            </div>
          </div>
        </template>

        <template v-else-if="lyricSheet === 'algo'">
          <div class="action-list">
            <div class="action-item algo-item" @click="pickAlgo('v3')">
              <i class="mgc_command_line"></i>
              <span class="algo-main">
                <span>V3 算法</span>
                <span class="algo-note">生成需要 30~90 秒，请耐心等待</span>
              </span>
            </div>
            <div class="action-item algo-item" @click="pickAlgo('v4')">
              <i class="mgc_command_line"></i>
              <span class="algo-main">
                <span>V4 算法</span>
                <span class="algo-note">生成需要 30~90 秒，请耐心等待</span>
              </span>
            </div>
            <div class="action-item cancel" @click="lyricSheet = 'local'">
              <i class="mgc_left_line"></i>
              <span>返回</span>
            </div>
          </div>
        </template>
      </MobileSheet>

      <!-- 横屏「更多」功能面板：独立居中弹窗（不复用底部弹层），宫格式完整功能菜单 -->
      <div v-if="showActions && isLandscape" class="ls-more-mask" @click="showActions = false"></div>
      <div v-if="showActions && isLandscape" class="ls-more-dialog">
        <div class="ls-more-head">
          <span class="ls-more-title">更多功能</span>
          <button class="ls-more-close" @click="showActions = false">
            <i class="mgc_close_line"></i>
          </button>
        </div>
        <div class="ls-more-grid">
          <button class="ls-more-item" @click="doToggleMode">
            <span class="ls-more-icon"><i :class="modeIcon"></i></span>
            <span class="ls-more-label">{{ modeLabel }}</span>
          </button>
          <button class="ls-more-item" @click="openCommentsFromMenu">
            <span class="ls-more-icon"><i class="mgc_message_2_line"></i></span>
            <span class="ls-more-label">评论</span>
          </button>
          <button class="ls-more-item" @click="openEqFromMenu">
            <span class="ls-more-icon"><i class="mgc_voice_line"></i></span>
            <span class="ls-more-label">均衡器</span>
          </button>
          <button class="ls-more-item" @click="openQueueFromMenu">
            <span class="ls-more-icon"><i class="mgc_list_check_2_line"></i></span>
            <span class="ls-more-label">播放队列</span>
          </button>
          <button class="ls-more-item" @click="openAddToPlaylist">
            <span class="ls-more-icon"><i class="mgc_playlist_line"></i></span>
            <span class="ls-more-label">添加到歌单</span>
          </button>
          <button class="ls-more-item" @click="openFloatingLyric">
            <span class="ls-more-icon"><i class="mgc_text_line"></i></span>
            <span class="ls-more-label">悬浮窗歌词</span>
          </button>
          <button class="ls-more-item" @click="openMiniLyric">
            <span class="ls-more-icon"><i class="mgc_subtitle_line"></i></span>
            <span class="ls-more-label">迷你悬浮条</span>
          </button>
          <button class="ls-more-item" @click="openFxFromMenu">
            <span class="ls-more-icon"><i class="mgc_magic_1_line"></i></span>
            <span class="ls-more-label">高级</span>
          </button>
          <button class="ls-more-item" @click="openLyricSheet">
            <span class="ls-more-icon"><i class="mgc_quill_pen_line"></i></span>
            <span class="ls-more-label">歌词</span>
          </button>
          <button class="ls-more-item" @click="openDownload">
            <span class="ls-more-icon"><i class="mgc_download_2_line"></i></span>
            <span class="ls-more-label">下载</span>
          </button>
        </div>
      </div>

      <!-- 播放队列 -->
      <MobileSheet
        :show="showQueue"
        :title="`播放队列 · ${player.playlist.length} 首`"
        meta="PLAY QUEUE"
        @update:show="showQueue = $event"
      >
        <div class="sheet-title-row">
          <span class="sheet-clear" @click="clearQueue">清空队列</span>
        </div>
        <div class="sheet-scroll">
          <div
            v-for="(s, i) in player.playlist"
            :key="`${s.id}-${i}`"
            class="queue-item"
            :class="{ active: player.currentIndex === i }"
            @click="jumpTo(i)"
          >
            <i v-if="player.currentIndex === i" class="mgc_volume_line queue-playing"></i>
            <span class="queue-title">{{ s.title }}</span>
            <span class="queue-artist">- {{ s.artist }}</span>
          </div>
          <n-empty v-if="!player.playlist.length" description="队列为空" style="padding: 40px 0" />
        </div>
      </MobileSheet>

      <!-- 评论 -->
      <MobileSheet
        :show="showComments"
        :title="`评论 · ${commentsTotal}`"
        meta="COMMENTS"
        @update:show="showComments = $event"
      >
        <div class="sheet-scroll">
          <div v-for="c in comments" :key="c.commentId" class="comment-item">
            <img :src="c.user.avatarUrl" class="comment-avatar" loading="lazy" />
            <div class="comment-main">
              <div class="comment-nick">{{ c.user.nickname }}</div>
              <div class="comment-content">{{ c.content }}</div>
              <div class="comment-meta">
                <span>{{ formatCommentTime(c.time) }}</span>
                <span class="comment-like"><i class="mgc_thumb_up_2_line"></i>{{ c.likedCount }}</span>
              </div>
            </div>
          </div>
          <div v-if="commentsLoading" class="mp-loading"><n-spin size="small" /></div>
          <div
            v-else-if="comments.length && comments.length < commentsTotal"
            class="load-more"
            @click="loadComments(false)"
          >
            加载更多
          </div>
          <n-empty v-if="!commentsLoading && !comments.length" description="暂无评论" style="padding: 40px 0" />
        </div>
      </MobileSheet>

      <!-- 在线歌词：搜索候选歌曲 -->
      <MobileSheet
        :show="showLyricSearch"
        title="获取在线歌词"
        meta="SEARCH LYRICS"
        @update:show="showLyricSearch = $event"
      >
        <div class="lyric-search-bar">
          <div class="mp-input lyric-search-input">
            <i class="mgc_search_line"></i>
            <input
              v-model="lyricSearchKeyword"
              placeholder="搜索歌曲名"
              @keyup.enter="doLyricSearch"
            />
          </div>
          <button class="lyric-search-btn" @click="doLyricSearch">搜索</button>
        </div>
        <div class="sheet-scroll">
          <div v-if="lyricSearching" class="mp-loading"><n-spin size="small" /></div>
          <template v-else>
            <div
              v-for="item in lyricResults"
              :key="item.id"
              class="lyric-result-item"
              @click="pickLyricResult(item)"
            >
              <div class="lyric-result-main">
                <div class="lyric-result-title">{{ item.name }}</div>
                <div class="lyric-result-sub">
                  {{ (item.ar || []).map((a) => a.name).join(' / ') }}
                  <span v-if="item.al?.name"> · {{ item.al.name }}</span>
                </div>
              </div>
              <span class="lyric-result-dt">{{ formatDuration(item.dt) }}</span>
            </div>
            <n-empty v-if="!lyricResults.length" description="输入关键词搜索在线歌曲" style="padding: 40px 0" />
          </template>
        </div>
      </MobileSheet>

      <!-- 在线歌词：预览与保存 -->
      <MobileSheet
        :show="showLyricPreview"
        title="歌词预览"
        meta="PREVIEW"
        @update:show="showLyricPreview = $event"
      >
        <div class="lyric-preview-song">{{ previewSongTitle }}</div>
        <div class="sheet-scroll lyric-preview-scroll">
          <div v-if="lyricPreviewLoading" class="mp-loading"><n-spin size="small" /></div>
          <template v-else>
            <div v-for="(line, i) in previewLines" :key="i" class="lyric-preview-line">{{ line }}</div>
          </template>
        </div>
        <div v-if="!lyricPreviewLoading && previewLrc" class="lyric-preview-actions">
          <button class="lyric-action-btn cancel" @click="showLyricPreview = false">取消</button>
          <button class="lyric-action-btn primary" :disabled="lyricSaving" @click="saveOnlineLyric">
            {{ lyricSaving ? '保存中…' : '保存歌词到本地' }}
          </button>
        </div>
      </MobileSheet>
    </div>
  </Teleport>
</template>

<style scoped>
/* ==================== AI 歌词翻译 ==================== */
.ai-panel {
  padding: 0 20px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ai-tip {
  font-size: 12px;
  line-height: 1.55;
  color: var(--mp-text-2, rgba(60, 60, 67, 0.6));
}

.ai-textarea {
  width: 100%;
  box-sizing: border-box;
  min-height: 96px;
  padding: 10px 12px;
  border: none;
  border-radius: var(--mp-r-md, 16px);
  background: var(--mp-fill, rgba(120, 120, 128, 0.12));
  color: var(--mp-text, #1c1c1e);
  font-size: 13.5px;
  line-height: 1.5;
  resize: none;
  outline: none;
  font-family: inherit;
}

.ai-textarea::placeholder {
  color: var(--mp-text-3, rgba(60, 60, 67, 0.33));
}

.ai-status {
  font-size: 12.5px;
  color: var(--mp-primary, #2c8efd);
}

.ai-btn {
  height: 44px;
  width: 100%;
}

.ai-btn:disabled {
  opacity: 0.55;
}

.ai-clear-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 42px;
  border: none;
  border-radius: var(--mp-r-pill, 999px);
  background: var(--mp-fill, rgba(120, 120, 128, 0.12));
  color: var(--mp-danger, #ff3b30);
  font-size: 13.5px;
  font-weight: 600;
  transition: opacity 0.15s ease;
}

.ai-clear-btn:disabled {
  opacity: 0.45;
}

.dl-song {
  padding: 0 20px 10px;
  font-size: 13px;
  color: var(--mp-text-3, rgba(60, 60, 67, 0.6));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dl-list {
  padding: 0 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.dl-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-radius: var(--mp-r-md, 20px);
  background: var(--mp-fill, rgba(120, 120, 128, 0.12));
  color: var(--mp-text, #1c1c1e);
  font-size: 15px;
}

.dl-item:active {
  opacity: 0.7;
}

.dl-item.is-disabled {
  opacity: 0.42;
}

.dl-check {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1.5px solid var(--mp-text-3, rgba(60, 60, 67, 0.33));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  flex-shrink: 0;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;
}

.dl-check.on {
  background: var(--mp-primary, #2c8efd);
  border-color: var(--mp-primary, #2c8efd);
  color: #fff;
}

.dl-label {
  flex: 1;
}

.dl-note {
  font-size: 12px;
  color: var(--mp-text-3, rgba(60, 60, 67, 0.6));
}

.dl-actions {
  padding: 14px 18px 6px;
}

.dl-btn {
  width: 100%;
  height: 46px;
  font-size: 15px;
  font-weight: 600;
}

.dl-hint {
  padding: 2px 20px 0;
  font-size: 12px;
  color: var(--mp-text-3, rgba(60, 60, 67, 0.6));
  text-align: center;
  line-height: 1.4;
}

.ai-hint {
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--mp-text-3, rgba(60, 60, 67, 0.33));
}

/* ============ 全屏封面背景 + 高斯模糊 ============ */
.player-page {
  position: fixed;
  inset: 0;
  z-index: 1500;
  overflow: hidden;
  background: transparent;
  /* 上下切换：未打开时停在屏幕下方，打开后滑上来；关闭时滑回去 */
  transform: translateY(100%);
  transition: transform 340ms cubic-bezier(0.32, 0.72, 0.35, 1);
  will-change: transform;
  overscroll-behavior: none;
}

.player-page.is-open {
  transform: translateY(0);
}

.bg-layer {
  position: absolute;
  inset: 0;
  z-index: 1;
  overflow: hidden;
  background: #15161a;
}

/* 封面等比铺满并外扩，自身高斯模糊（边缘不外露、无 backdrop-filter 闪烁） */
.bg-cover {
  position: absolute;
  inset: -48px;
  width: calc(100% + 96px);
  height: calc(100% + 96px);
  object-fit: cover;
  filter: blur(44px) saturate(1.55) brightness(0.72);
  -webkit-filter: blur(44px) saturate(1.55) brightness(0.72);
  transform: translateZ(0);
}

/* 渐变压暗层，保证前景可读性 */
.bg-frost {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    rgba(12, 12, 16, 0.4) 0%,
    rgba(12, 12, 16, 0.26) 34%,
    rgba(12, 12, 16, 0.46) 72%,
    rgba(12, 12, 16, 0.66) 100%
  );
}

.player-page.closing .page-body {
  /* 关闭时保持内容可见：整页一起滑下去，而不是先淡成一张空背景 */
  opacity: 1;
  transform: translateY(0);
  transition: none;
}

.page-body {
  position: relative;
  z-index: 2;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding:
    calc(10px + var(--sat, 0px))
    calc(22px + var(--sar, 0px))
    calc(10px + var(--sab, 0px))
    calc(22px + var(--sal, 0px));
  box-sizing: border-box;
  opacity: 0;
  transform: translateY(10px);
  /* 整页内容只做透明度 + 位移：filter 过渡在低端安卓 WebView 上会掉帧，
     模糊入场留给卡片外壳，视觉上依旧是「卡片长出来后内容浮现」 */
  transition:
    opacity 160ms ease,
    transform 240ms ease;
}

.player-page.is-open .page-body {
  opacity: 1;
  transform: translateY(0);
  transition:
    opacity 300ms ease 240ms,
    transform 520ms cubic-bezier(0.22, 1, 0.36, 1) 200ms;
}

/* ============ 顶部 ============ */
.topbar {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  flex-shrink: 0;
}

.top-close {
  width: 38px;
  height: 38px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  font-size: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  margin-left: -8px;
  flex-shrink: 0;
  transition:
    transform 0.15s ease,
    opacity 0.15s ease;
}

.top-close:active {
  transform: scale(0.88);
  opacity: 0.8;
}

.title-block {
  flex: 1;
  min-width: 0;
  padding-top: 6px;
}

.song-title {
  color: #fff;
  font-size: 20px;
  font-weight: 700;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.25);
}

.song-artist {
  color: rgba(255, 255, 255, 0.72);
  font-size: 13.5px;
  margin-top: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ============ 轮播舞台 ============ */
.stage {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.stage-track {
  display: flex;
  width: 200%;
  height: 100%;
  will-change: transform;
}

.panel {
  width: 50%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ---- 封面面板 ---- */
.cover-panel {
  align-items: center;
  justify-content: center;
  gap: 20px;
}

/* 提高特异性，确保正方形尺寸压过组件根的 width/height:100% */
.cover-panel .big-cover {
  width: min(74vw, 42vh);
  height: min(74vw, 42vh);
  background: rgba(255, 255, 255, 0.08);
}

.mini-lyric {
  text-align: center;
  max-width: 86vw;
  min-height: 42px;
}

.mini-main {
  color: var(--lyric-active-color, #fff);
  font-size: 15px;
  font-weight: 600;
  font-family: var(--lyric-font-family, inherit);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mini-sub {
  color: var(--lyric-sub-color, rgba(255, 255, 255, 0.65));
  font-size: 13px;
  font-family: var(--lyric-font-family, inherit);
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ---- 歌词面板 ---- */
.lyric-stage {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  position: relative;
  mask-image: linear-gradient(to bottom, transparent, #000 14%, #000 86%, transparent);
  -webkit-mask-image: linear-gradient(to bottom, transparent, #000 14%, #000 86%, transparent);
}

.lyric-inner {
  will-change: transform;
}

.lyric-head-space {
  height: 30vh;
}

.lyric-tail-space {
  height: 40vh;
}

/* 单行歌词的样式在 MobileLyricLine.vue 内（子组件隔离渲染，换行只更新相邻两行） */

.no-lyric {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.lyric-footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  padding: 6px 4px 2px;
  flex-shrink: 0;
}

.trans-btn {
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.trans-btn.off {
  opacity: 0.4;
}

/* ============ 页面指示点 ============ */
.page-dots {
  display: flex;
  justify-content: center;
  gap: 6px;
  padding: 8px 0 2px;
  flex-shrink: 0;
}

.dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.3);
  transition:
    background 0.25s,
    width 0.25s;
}

.dot.active {
  background: #fff;
  width: 14px;
  border-radius: 3px;
}

/* ============ 进度（样式在 MobileProgressBar 内） ============ */

/* ============ 主控制 ============ */
.controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 42px;
  flex-shrink: 0;
  margin-top: 8px;
}

.ctrl-btn {
  width: 60px;
  height: 60px;
  border: none;
  background: transparent;
  color: #fff;
  font-size: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition:
    transform 0.15s ease,
    opacity 0.15s ease;
}

.ctrl-btn:active {
  transform: scale(0.88);
  opacity: 0.7;
}

.ctrl-btn.play {
  width: 74px;
  height: 74px;
  border-radius: 50%;
  background: #fff;
  color: #15151a;
  font-size: 34px;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.3);
}

/* 下载缓存等待中的旋转加载图标 */
.mp-spin {
  display: inline-block;
  animation: mp-spin-rotate 1s linear infinite;
}

@keyframes mp-spin-rotate {
  to {
    transform: rotate(360deg);
  }
}

/* ============ 底部图标栏 ============ */
.bottom-bar {
  display: flex;
  align-items: center;
  justify-content: space-around;
  flex-shrink: 0;
  margin-top: 8px;
  padding-top: 4px;
}

.bar-btn {
  width: 48px;
  height: 44px;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.78);
  font-size: 21px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition:
    transform 0.15s ease,
    opacity 0.15s ease;
}

.bar-btn:active {
  transform: scale(0.85);
  opacity: 0.6;
}

/* ============ 弹层 ============ */
.sheet-bottom-space {
  height: calc(14px + var(--sab, 0px));
  flex-shrink: 0;
}

.action-list {
  padding: 0 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* 竖屏弹层高度受限时可滚动（此前无溢出让列表滑不动） */
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}

.action-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border-radius: var(--mp-r-md, 20px);
  background: var(--mp-fill);
  color: var(--mp-text);
  font-size: 15px;
}

.action-item i {
  font-size: 20px;
  color: var(--mp-primary);
}

.action-item:active {
  opacity: 0.7;
}

.action-item.cancel {
  justify-content: center;
  font-weight: 600;
  margin-top: 4px;
}

.action-item .action-arrow {
  margin-left: auto;
  font-size: 16px;
  color: var(--mp-text-3, rgba(60, 60, 67, 0.33));
}

.action-item .action-flex {
  flex: 1;
}

.action-item .action-value {
  font-size: 13px;
  color: var(--mp-text-3, rgba(60, 60, 67, 0.33));
  margin-left: auto;
  margin-right: 2px;
}

/* ===== 添加到歌单 ===== */
.pl-track-count {
  font-size: 12px;
  color: var(--mp-text-3, rgba(60, 60, 67, 0.33));
  margin-left: auto;
  margin-right: 4px;
}

.pl-checked {
  color: var(--mp-success, #30d158);
  font-size: 18px;
}

.pl-add {
  color: var(--mp-text-3, rgba(60, 60, 67, 0.33));
  font-size: 18px;
}

.new-pl-form {
  display: flex;
  gap: 10px;
  padding: 0 18px 12px;
}

.new-pl-input {
  flex: 1;
  min-width: 0;
  height: 40px;
  border: none;
  outline: none;
  border-radius: 12px;
  padding: 0 12px;
  font-size: 14px;
  color: var(--mp-text, #1c1c1e);
  background: var(--mp-fill, rgba(120, 120, 128, 0.12));
}

.new-pl-btn {
  flex-shrink: 0;
  height: 40px;
  padding: 0 16px;
  border: none;
  border-radius: 12px;
  background: var(--mp-primary, #2c8efd);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
}

.new-pl-btn:active {
  opacity: 0.8;
}

.action-item .danger-text {
  color: var(--mp-danger, #ff453a);
}

.sheet-tip {
  padding: 2px 20px 6px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--mp-text-3, rgba(60, 60, 67, 0.33));
}

.algo-item {
  align-items: flex-start;
}

.algo-item > i {
  margin-top: 2px;
}

.algo-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.algo-note {
  font-size: 11.5px;
  color: var(--mp-text-3, rgba(60, 60, 67, 0.33));
}

/* 逐字歌词双层文本的样式在 MobileLyricLine.vue 内 */

.sheet-title-row {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  padding: 0 2px 10px;
}

.sheet-clear {
  font-size: 13px;
  color: var(--mp-danger);
}

.sheet-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 0 18px 18px;
  min-height: 0;
}

.queue-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 4px;
  border-bottom: 0.5px solid var(--mp-separator);
}

.queue-item.active .queue-title,
.queue-item.active .queue-artist {
  color: var(--mp-primary);
}

.queue-playing {
  color: var(--mp-primary);
  flex-shrink: 0;
}

.queue-title {
  font-size: 14px;
  color: var(--mp-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 55%;
}

.queue-artist {
  font-size: 12px;
  color: var(--mp-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.comment-item {
  display: flex;
  gap: 10px;
  padding: 12px 0;
  border-bottom: 0.5px solid var(--mp-separator);
}

.comment-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
  background: var(--mp-bg-secondary);
}

.comment-main {
  flex: 1;
  min-width: 0;
}

.comment-nick {
  font-size: 12px;
  color: var(--mp-text-2);
}

.comment-content {
  font-size: 14px;
  color: var(--mp-text);
  margin-top: 3px;
  line-height: 1.5;
}

.comment-meta {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--mp-text-3);
  margin-top: 5px;
}

.comment-like i {
  margin-right: 3px;
}

.load-more {
  text-align: center;
  color: var(--mp-primary);
  font-size: 13px;
  padding: 16px;
}

/* ============ 横屏「更多」右侧滑入抽屉（与队列/均衡器等二级菜单同一设计逻辑） ============ */
.ls-more-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 2100;
  animation: ls-more-fade 0.22s ease;
}

.ls-more-dialog {
  position: fixed;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 2101;
  width: min(320px, 44vw);
  height: 100%;
  overflow-y: auto;
  background: var(--mp-bg-elevated);
  border-radius: var(--mp-r-lg, 28px) 0 0 var(--mp-r-lg, 28px);
  box-shadow: -18px 0 48px rgba(0, 0, 0, 0.3);
  padding: 18px calc(16px + var(--sar, 0px)) 20px 16px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  animation: ls-more-slide 0.3s cubic-bezier(0.32, 0.72, 0.35, 1);
}

@keyframes ls-more-slide {
  from {
    transform: translateX(100%);
  }
}

@keyframes ls-more-fade {
  from {
    opacity: 0;
  }
}

.ls-more-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.ls-more-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--mp-text);
}

.ls-more-close {
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 50%;
  background: var(--mp-fill);
  color: var(--mp-text);
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

/* 抽屉内双列宫格，内容超高可滚动 */
.ls-more-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px 8px;
  align-content: start;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.ls-more-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  border: none;
  background: transparent;
  padding: 6px 2px;
  border-radius: var(--mp-r-sm, 16px);
  transition:
    transform 0.15s ease,
    opacity 0.15s ease;
}

.ls-more-item:active {
  transform: scale(0.92);
  opacity: 0.8;
}

.ls-more-icon {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: var(--mp-fill);
  color: var(--mp-primary);
  font-size: 23px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ls-more-icon.active {
  color: var(--mp-danger);
}

.ls-more-label {
  font-size: 12px;
  color: var(--mp-text-2);
  white-space: nowrap;
}

/* ============ 横屏 UI（全新设计，参考鸿蒙横屏规范） ============
   规范要点：
   1. 宽高比差异大时采用左右分栏：左侧视觉区（封面+歌曲信息），右侧内容区（歌词+进度+控制）
   2. 挪移布局：歌曲标题从顶部挪移到封面下方，充分利用横向空间
   3. 封面严格保持 1:1 比例，不拉伸变形
   4. 核心交互（关闭、控制键）避开挖孔/圆角安全区
   5. 触控目标 ≥ 40px，横向空间充裕时控制键成一排 */
@media (orientation: landscape) {
  .page-body {
    display: grid;
    grid-template-columns: minmax(0, 43%) minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) auto auto auto;
    grid-template-areas:
      'cover lyric'
      'info lyric'
      'progress lyric'
      'controls lyric';
    column-gap: 24px;
    /* 四周留出舒适边距，左右同时避让挖孔/圆角安全区。
       顶部固定值、不用 --sat：横屏状态栏已粘性隐藏，
       避免下拉短暂唤出状态栏时 --sat 跳变挤压封面与标题间距 */
    padding:
      14px
      calc(30px + var(--sar, 0px))
      calc(12px + var(--sab, 0px))
      calc(30px + var(--sal, 0px));
  }

  /* 顶栏拆开：关闭按钮悬浮左上角，标题块挪移到封面下方 */
  .topbar {
    display: contents;
  }

  .top-close {
    position: absolute;
    top: 12px;
    left: calc(16px + var(--sal, 0px));
    z-index: 5;
    margin-left: 0;
    width: 40px;
    height: 40px;
  }

  .title-block {
    grid-area: info;
    text-align: center;
    padding-top: 0;
  }

  .song-title {
    font-size: 17px;
  }

  .song-artist {
    font-size: 12.5px;
  }

  /* 拆开轮播容器，封面面板成为 grid 子项（左封面、右歌词） */
  .stage,
  .stage-track {
    display: contents;
  }

  .stage-track {
    transform: none !important;
  }

  .panel {
    width: auto;
    height: auto;
    min-height: 0;
  }

  .cover-panel {
    grid-area: cover;
    justify-content: center;
    gap: 0;
  }

  /* 正方形封面：高度受屏高约束，aspect-ratio 保证严格 1:1
     （尺寸为原 46vh/30vw 的 95%；max 约束防止网格行被压缩时溢出挤压标题） */
  .cover-panel .big-cover {
    height: min(43.7vh, 28.5vw);
    max-height: 100%;
    max-width: 100%;
    width: auto;
    aspect-ratio: 1 / 1;
    /* 居中容器里给右侧留白 → 封面整体左移 23px，修正横屏下的偏右观感 */
    margin-right: 46px;
  }

  .mini-lyric,
  .page-dots {
    display: none;
  }

  .lyric-panel {
    grid-area: lyric;
  }

  .lyric-head-space {
    height: 22vh;
  }

  .lyric-tail-space {
    height: 32vh;
  }

  .lyric-line {
    padding: 8px;
  }

  /* 横屏布局字号同样恒等于激活尺寸，缩放比例不变；
     遵循「播放页歌词展示」字号设置并略微缩小适配横屏。
     歌词行是子组件，需要 :deep 才能命中其内部元素 */
  .lyric-stage :deep(.lyric-text) {
    font-size: calc(var(--lyric-font-size, 20px) * 0.875);
  }

  .progress-area {
    grid-area: progress;
    margin-top: 6px;
  }

  /* 控制行：上一曲 / 播放暂停 / 下一曲 / 更多 同一行
     margin-bottom 将整行上移，远离屏幕底边 */
  .controls {
    grid-area: controls;
    gap: 26px;
    margin-top: 4px;
    margin-bottom: 10px;
  }

  .ctrl-btn {
    width: 48px;
    height: 48px;
    font-size: 26px;
  }

  .ctrl-btn.play {
    width: 60px;
    height: 60px;
    font-size: 28px;
  }

  .ctrl-btn.more {
    color: rgba(255, 255, 255, 0.85);
    font-size: 24px;
  }
}

/* ============ 在线歌词：搜索与预览 ============ */
.lyric-search-bar {
  display: flex;
  gap: 10px;
  padding: 4px 20px 10px;
}

.lyric-search-input {
  flex: 1;
}

.lyric-search-btn {
  border: none;
  border-radius: 12px;
  padding: 0 16px;
  background: var(--mp-primary, #2c8efd);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
}

.lyric-result-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 20px;
}

.lyric-result-item:active {
  background: var(--mp-fill, rgba(120, 120, 128, 0.12));
}

.lyric-result-main {
  flex: 1;
  min-width: 0;
}

.lyric-result-title {
  font-size: 14.5px;
  font-weight: 500;
  color: var(--mp-text, #1c1c1e);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lyric-result-sub {
  font-size: 12px;
  color: var(--mp-text-2, rgba(60, 60, 67, 0.6));
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lyric-result-dt {
  font-size: 11px;
  color: var(--mp-text-3, rgba(60, 60, 67, 0.33));
  flex-shrink: 0;
}

.lyric-preview-song {
  padding: 0 20px 8px;
  font-size: 12.5px;
  color: var(--mp-text-2, rgba(60, 60, 67, 0.6));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lyric-preview-scroll {
  max-height: 46vh;
}

.lyric-preview-line {
  padding: 5px 20px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--mp-text, #1c1c1e);
}

.lyric-preview-actions {
  display: flex;
  gap: 12px;
  padding: 12px 20px 4px;
}

.lyric-action-btn {
  flex: 1;
  height: 42px;
  border: none;
  border-radius: 12px;
  font-size: 14.5px;
  font-weight: 600;
}

.lyric-action-btn.cancel {
  background: var(--mp-fill, rgba(120, 120, 128, 0.12));
  color: var(--mp-text, #1c1c1e);
}

.lyric-action-btn.primary {
  background: var(--mp-primary, #2c8efd);
  color: #fff;
}

.lyric-action-btn:disabled {
  opacity: 0.6;
}
</style>
