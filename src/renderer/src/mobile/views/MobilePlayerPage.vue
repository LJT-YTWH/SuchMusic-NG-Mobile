<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { NSlider, NSpin, NEmpty, NSwitch, useMessage, useDialog } from 'naive-ui'
import { Filesystem, Encoding } from '@capacitor/filesystem'
import { usePlayerStore } from '../../stores/playerStore'
import { usePlaylistStore, type PlaylistTrack } from '../../stores/playlistStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { webAudioEngine } from '../../audio/audio-engine'
import { parseLyricsToCore } from '../../utils/lyric/lyricParser'
import {
  karaokeState,
  generateForCurrentSong,
  clearCurrentKaraoke
} from '../../utils/karaoke/karaokeService'
import type { KaraokeAlgo } from '../../utils/karaoke/aligner'
import { fetchNewComments, type CommentItem } from '../../apis/netease/comment'
import { cloudSearch, type SearchSong } from '../../apis/netease/search/cloudsearch'
import { fetchNewLyric } from '../../apis/netease/lyric'
import { useDesktopLyric } from '../../composables/useDesktopLyric'
import { useTaskbarLyric } from '../../composables/useTaskbarLyric'
import { formatDuration } from '../helpers'
import MobileCover from '../components/MobileCover.vue'
import MobileEqPanel from '../components/MobileEqPanel.vue'
import MobileFxPanel from '../components/MobileFxPanel.vue'
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
// 每次打开递增 key 强制重挂载，确保上滑动画完整重播（修复重新打开卡在半路）
const pageKey = ref(0)
let closeTimer: number | undefined

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
    rendered.value = true
    pageKey.value++
    startLyricEngine()
  } else {
    closing.value = true
    stopLyricEngine()
    closeTimer = window.setTimeout(() => {
      rendered.value = false
      closing.value = false
      closeTimer = undefined
    }, 300)
  }
})

const close = (): void => {
  // 复位下拉位移，避免下次打开停在半路
  dragY.value = 0
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

const progressPercent = computed(() => {
  const d = song.value?.durationMs ?? 0
  if (!d) return 0
  return Math.min((player.positionMs / d) * 100, 100)
})

const handleSeek = (percent: number): void => {
  const d = song.value?.durationMs ?? 0
  if (!d) return
  const target = (percent / 100) * d
  webAudioEngine.seek(target)
  player.setPosition(target)
}

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

function lyricTargetY(): number {
  const stage = lyricStageRef.value
  const inner = lyricInnerRef.value
  if (!stage || !inner) return 0
  const idx = activeIdx.value
  if (idx < 0 || idx >= inner.children.length) return 0
  const el = inner.children[idx] as HTMLElement
  // 当前行中心对齐到舞台 38% 高度处
  return el.offsetTop + el.clientHeight / 2 - stage.clientHeight * 0.38
}

// ---- 逐字高亮（Apple Music 风格逐词填充）：每帧更新活跃行内各词的 --p 进度 ----
// 注意：lyricInnerRef 的 children[0] 是顶部占位（.lyric-head-space），歌词行从索引 1 开始
let lastWordLineIdx = -1
let wordPCache: number[] = []

function lyricLineEl(idx: number): HTMLElement | null {
  const inner = lyricInnerRef.value
  if (!inner) return null
  return (inner.children[idx + 1] as HTMLElement) ?? null
}

function updateWordHighlight(t: number): void {
  const idx = activeIdx.value
  // 切换活跃行：清除旧行所有词的填充进度
  if (idx !== lastWordLineIdx) {
    const oldEl = lastWordLineIdx >= 0 ? lyricLineEl(lastWordLineIdx) : null
    if (oldEl) {
      oldEl.querySelectorAll('.lyric-word').forEach((el) => {
        ;(el as HTMLElement).style.removeProperty('--p')
      })
    }
    lastWordLineIdx = idx
    wordPCache = []
  }
  if (idx < 0) return
  const line = lyricLines.value[idx]
  if (!line?.words) return
  const el = lyricLineEl(idx)
  if (!el) return
  const wordEls = el.querySelectorAll('.lyric-word')
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
      ;(wordEls[i] as HTMLElement).style.setProperty('--p', pct + '%')
    }
  }
}

function lyricEngineFrame(): void {
  if (!engineRunning) return

  // 1. 用外推时间计算活跃行
  const t = estTimeSec()
  let idx = -1
  const lines = lyricLines.value
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= t) idx = i
    else break
  }
  if (idx !== activeIdx.value) activeIdx.value = idx
  updateWordHighlight(t)

  // 2. 连续插值滚动（非手动浏览时）
  const inner = lyricInnerRef.value
  if (inner && performance.now() > manualUntil) {
    const target = Math.max(lyricTargetY(), 0)
    smoothY += (target - smoothY) * 0.085
    if (Math.abs(target - smoothY) < 0.1) smoothY = target
    inner.style.transform = `translate3d(0, ${-smoothY}px, 0)`
  }

  rafId = requestAnimationFrame(lyricEngineFrame)
}

function startLyricEngine(): void {
  if (engineRunning) return
  engineRunning = true
  smoothY = 0
  rafId = requestAnimationFrame(lyricEngineFrame)
}

function stopLyricEngine(): void {
  engineRunning = false
  cancelAnimationFrame(rafId)
}

// 切歌时重置
watch(
  () => song.value?.id,
  () => {
    smoothY = 0
    activeIdx.value = -1
    lastWordLineIdx = -1
    manualUntil = 0
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
  const parts: string[] = []
  if (dragY.value > 0) parts.push(`translateY(${dragY.value}px)`)
  return {
    transform: parts.join(' '),
    transition: transitioning.value ? 'transform 0.32s cubic-bezier(0.32, 0.72, 0.35, 1)' : 'none'
  }
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
      inner.style.transform = `translate3d(0, ${-smoothY}px, 0)`
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
  if (closeTimer) clearTimeout(closeTimer)
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
  '' | 'root' | 'online' | 'local' | 'algo' | 'autoAlgo' | 'genMode' | 'afterPlay'
>('')

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
      :class="{ closing, dragging: gestureAxis === 'v' }"
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
            <div class="song-title">{{ song?.title || '未在播放' }}</div>
            <div class="song-artist">{{ song?.artist || 'SuchMusic' }}</div>
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
                  <div
                    v-for="(line, i) in lyricLines"
                    :key="i"
                    class="lyric-line"
                    :class="{ active: i === activeIdx }"
                    @click="seekToLyric(line)"
                  >
                    <div class="lyric-text">
                      <template v-if="line.words && line.words.length">
                        <template v-for="(w, wi) in line.words" :key="wi"
                          ><span class="lyric-word"
                            ><span class="lw-base">{{ w.text }}</span
                            ><span class="lw-fill" aria-hidden="true">{{ w.text }}</span></span
                          >&#8203;</template
                        >
                      </template>
                      <template v-else>{{ line.text }}</template>
                    </div>
                    <div v-if="showTranslation && line.ttext" class="lyric-ttext">{{ line.ttext }}</div>
                  </div>
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

        <!-- 进度 -->
        <div class="progress-area">
          <n-slider
            :value="progressPercent"
            :tooltip="false"
            class="progress-slider"
            @update:value="handleSeek"
          />
          <div class="time-row">
            <span>{{ formatDuration(player.positionMs) || '0:00' }}</span>
            <span>{{ formatDuration(song?.durationMs) || '0:00' }}</span>
          </div>
        </div>

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

      <!-- 均衡器弹层（就地调节，不跳转设置页；横屏自动变为右侧抽屉） -->
      <div v-if="showEq" class="mp-sheet-mask" @click="showEq = false"></div>
      <div v-if="showEq" class="mp-sheet">
        <div class="sheet-grabber"></div>
        <MobileEqPanel />
        <div class="sheet-bottom-space"></div>
      </div>

      <!-- 高级音效弹层（功能列表 → 单项详细配置；横屏自动变为右侧抽屉） -->
      <div v-if="showFx" class="mp-sheet-mask" @click="showFx = false"></div>
      <div v-if="showFx" class="mp-sheet">
        <div class="sheet-grabber"></div>
        <MobileFxPanel in-sheet />
        <div class="sheet-bottom-space"></div>
      </div>

      <!-- 更多操作弹层（仅竖屏；横屏使用独立居中功能面板） -->
      <div v-if="showActions && !isLandscape" class="mp-sheet-mask" @click="showActions = false"></div>
      <div v-if="showActions && !isLandscape" class="mp-sheet">
        <div class="sheet-grabber"></div>
        <div class="sheet-title">更多</div>
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
          <div class="action-item cancel" @click="showActions = false">
            <span>取消</span>
          </div>
        </div>
      </div>

      <!-- 添加到本地歌单弹层 -->
      <div v-if="showAddPlaylist" class="mp-sheet-mask" @click="showAddPlaylist = false"></div>
      <div v-if="showAddPlaylist" class="mp-sheet">
        <div class="sheet-grabber"></div>
        <div class="sheet-title">添加到本地歌单</div>
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
      </div>

      <!-- 歌词分类弹层（层级：歌词 → 在线歌词 / 本地逐字歌词 → 生成算法） -->
      <div v-if="lyricSheet" class="mp-sheet-mask" @click="closeLyricSheet"></div>
      <div v-if="lyricSheet" class="mp-sheet">
        <div class="sheet-grabber"></div>

        <!-- 第一级：歌词 -->
        <template v-if="lyricSheet === 'root'">
          <div class="sheet-title">歌词</div>
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
          </div>
        </template>

        <!-- 第二级：在线歌词 -->
        <template v-else-if="lyricSheet === 'online'">
          <div class="sheet-title">在线歌词</div>
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
          <div class="sheet-title">本地逐字歌词</div>
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
          <div class="sheet-title">自动生成算法</div>
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
          <div class="sheet-title">生成时机</div>
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
          <div class="sheet-title">生成完后</div>
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
        <template v-else-if="lyricSheet === 'algo'">
          <div class="sheet-title">选择生成算法</div>
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
        <div class="sheet-bottom-space"></div>
      </div>

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
        </div>
      </div>

      <!-- 播放队列弹层（横屏自动变为右侧抽屉） -->
      <div v-if="showQueue" class="mp-sheet-mask" @click="showQueue = false"></div>
      <div v-if="showQueue" class="mp-sheet">
        <div class="sheet-grabber"></div>
        <div class="sheet-title-row">
          <span class="sheet-title">播放队列 · {{ player.playlist.length }} 首</span>
          <span class="sheet-clear" @click="clearQueue">清空</span>
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
      </div>

      <!-- 评论弹层（横屏自动变为右侧抽屉） -->
      <div v-if="showComments" class="mp-sheet-mask" @click="showComments = false"></div>
      <div v-if="showComments" class="mp-sheet">
        <div class="sheet-grabber"></div>
        <div class="sheet-title">评论 · {{ commentsTotal }}</div>
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
      </div>

      <!-- 在线歌词：搜索候选歌曲弹层 -->
      <div v-if="showLyricSearch" class="mp-sheet-mask" @click="showLyricSearch = false"></div>
      <div v-if="showLyricSearch" class="mp-sheet">
        <div class="sheet-grabber"></div>
        <div class="sheet-title">获取在线歌词</div>
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
        <div class="sheet-bottom-space"></div>
      </div>

      <!-- 在线歌词：预览与保存弹层 -->
      <div v-if="showLyricPreview" class="mp-sheet-mask" @click="showLyricPreview = false"></div>
      <div v-if="showLyricPreview" class="mp-sheet">
        <div class="sheet-grabber"></div>
        <div class="sheet-title">歌词预览</div>
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
        <div class="sheet-bottom-space"></div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ============ 全屏封面背景 + 高斯模糊 ============ */
.player-page {
  position: fixed;
  inset: 0;
  z-index: 1500;
  overflow: hidden;
  background: #101014;
  animation: page-slide-up 0.34s cubic-bezier(0.32, 0.72, 0.35, 1);
  will-change: transform;
  overscroll-behavior: none;
}

.bg-layer {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
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

.player-page.closing {
  animation: page-slide-down 0.28s cubic-bezier(0.32, 0.72, 0.35, 1) forwards;
}

@keyframes page-slide-up {
  from {
    transform: translateY(100%);
  }
}

@keyframes page-slide-down {
  to {
    transform: translateY(100%);
  }
}

.page-body {
  position: relative;
  z-index: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding:
    calc(10px + var(--sat, 0px))
    calc(22px + var(--sar, 0px))
    calc(10px + var(--sab, 0px))
    calc(22px + var(--sal, 0px));
  box-sizing: border-box;
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

.lyric-line {
  padding: 11px 8px;
  opacity: var(--lyric-dim-opacity, 0.38);
  filter: blur(var(--lyric-blur, 0px));
  transition:
    opacity 0.35s ease,
    filter 0.35s ease;
  transform-origin: left center;
}

.lyric-line.active {
  opacity: 1;
  filter: none;
}

/* 歌词排版关键设计：布局尺寸恒等于激活尺寸（20px/700），
   非激活行用 transform: scale 视觉缩小。
   这样每句歌词的换行位置永远提前按放大后的最大字号算好，
   激活时只有 transform 变化，不会边放大边重排换行。
   注：字号/颜色/字重/行距均可被「播放页歌词展示」设置的 CSS 变量覆盖 */
.lyric-text {
  color: var(--lyric-color, #fff);
  font-size: var(--lyric-font-size, 20px);
  font-weight: var(--lyric-font-weight, 700);
  font-family: var(--lyric-font-family, inherit);
  line-height: var(--lyric-line-height, 1.55);
  text-align: left;
  transform: scale(0.85);
  transform-origin: left center;
  transition: transform 0.3s ease;
}

.lyric-line.active .lyric-text {
  color: var(--lyric-active-color, var(--lyric-color, #fff));
  transform: scale(1);
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
}

.lyric-ttext {
  color: var(--lyric-sub-color, rgba(255, 255, 255, 0.6));
  font-size: calc(var(--lyric-font-size, 20px) * 0.675);
  font-family: var(--lyric-font-family, inherit);
  line-height: 1.5;
  margin-top: 3px;
  text-align: left;
}

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

/* ============ 进度 ============ */
.progress-area {
  flex-shrink: 0;
  margin-top: 4px;
}

.progress-slider :deep(.n-slider-rail) {
  height: 4px !important;
  border-radius: var(--mp-r-pill, 999px) !important;
  background: rgba(255, 255, 255, 0.22) !important;
}

.progress-slider :deep(.n-slider-rail__fill) {
  background: #fff !important;
  border-radius: var(--mp-r-pill, 999px) !important;
}

.progress-slider :deep(.n-slider-handle) {
  width: 13px !important;
  height: 13px !important;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35) !important;
}

.time-row {
  display: flex;
  justify-content: space-between;
  color: rgba(255, 255, 255, 0.55);
  font-size: 11px;
  margin-top: 2px;
  font-variant-numeric: tabular-nums;
}

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

/* ============ 逐字歌词高亮（Apple Music 风格逐词填充） ============
   双层原生文本、像素级重合：底层为原文（原生文本填充，加粗/字体与逐行一致），
   上层为同一文本的高亮副本，按演唱进度 --p 裁剪显示。
   inline-block + white-space:pre 保证两层的基线、字距完全对齐（无重影），
   同时保留词尾空格宽度；中文换行由词间的零宽空格提供断行点 */
.lyric-word {
  position: relative;
  display: inline-block;
  white-space: pre;
}

/* 关键：全局存在 *,*:before,*:after{font-weight:400} 的重置，
   会直接命中词/层元素并覆盖继承，导致逐字歌词字重变细；
   这里显式继承 .lyric-text 的字重（跟主行一致） */
.lyric-word,
.lw-base,
.lw-fill {
  font-weight: inherit;
}

/* 未唱部分压低亮度（与行提亮同步过渡，激活时不闪暗） */
.lyric-line.active .lw-base {
  opacity: 0.6;
  transition: opacity 0.35s ease;
}

.lw-fill {
  position: absolute;
  left: 0;
  top: 0;
  white-space: pre;
  color: var(--lyric-active-color, #fff);
  clip-path: inset(0 calc(100% - var(--p, 0%)) 0 0);
  pointer-events: none;
}

.sheet-title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 18px 12px;
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
     遵循「播放页歌词展示」字号设置并略微缩小适配横屏 */
  .lyric-text {
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
