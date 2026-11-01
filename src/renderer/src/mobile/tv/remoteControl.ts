import { usePlayerStore } from '../../stores/playerStore'
import { webAudioEngine } from '../../audio/audio-engine'
import './tv.css'

/**
 * 安卓电视（Android TV / Google TV / 电视盒子）遥控器支持
 *
 * 电视上没有触摸屏，所有操作都来自遥控器的方向键 + OK + 返回键，因此这里做三件事：
 * 1. `initTvSupport()` 识别电视环境，给 <html> 打上 `tv-mode` 标记（样式与布局适配）；
 * 2. 空间导航（spatial navigation）：方向键在当前可见的可交互元素之间按几何位置
 *    移动焦点，OK/Enter 触发点击；WebView 原生并不提供这套行为，必须自行实现；
 * 3. 媒体键（播放/暂停、上一首、下一首）映射到播放器。
 *
 * 说明：焦点移动优先在「没有被其它浮层遮住」的元素之间进行（用 elementFromPoint 做
 * 遮挡判定），这样播放页、卡片弹窗打开时不会被底层的底栏控件抢走焦点。
 */

type Direction = 'up' | 'down' | 'left' | 'right'

interface Candidate {
  el: HTMLElement
  rect: DOMRect
}

const ARROW_DIR: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right'
}

/**
 * 可聚焦候选：
 * 1. 原生可聚焦元素（按钮、链接、输入框、显式 tabindex）；
 * 2. 应用内「可点击但默认不可聚焦」的容器（歌单卡片、设置行、分段选择器等），
 *    首次被聚焦时由本模块补上 data-tv-focus + tabindex="-1"。
 */
const CANDIDATE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="switch"]',
  '[role="tab"]',
  '[tabindex]:not([tabindex="-1"])',
  '.mp-press',
  '.mp-cell',
  '.mp-chip',
  '.mp-imgcard',
  '.mp-tab',
  '.mp-tabpill .tab',
  '.mp-section-more',
  '.pl-card',
  '.pl-row',
  '.song-row',
  '.seg-item',
  '.setting-row',
  '.action-item',
  '.plugin-btn',
  '.algo-item',
  '.play-all',
  '.search-pill',
  '[data-tv-focus]'
].join(',')

/**
 * 兜底扫描：应用里还有大量「div + @click」的容器（卡片、行、按钮式条目）。
 * 通过 Vue 在 DOM 上挂的 `_vei`（事件调用器）判断是否绑了点击，比穷举类名稳妥。
 */
const GENERIC_SCAN = 'div,li,span,label,a'
/** 覆盖大半屏的元素视为遮罩/容器，不参与导航（否则焦点会落在透明遮罩上） */
const MAX_COVER_RATIO = 0.55

function hasVueClick(el: HTMLElement): boolean {
  const vei = (el as unknown as { _vei?: Record<string, unknown> })._vei
  return !!vei && (!!vei.onClick || !!vei.onclick)
}

/** 方向键找不到可去元素时，退回滚动：滚动步长取容器可视高度的比例 */
const SCROLL_STEP_RATIO = 0.6

let enabled = false
let installed = false

export function isTvMode(): boolean {
  return enabled
}

/**
 * 电视环境判定：
 * 1. 原生注入（MainActivity 通过 addJavascriptInterface 暴露 SuchTvInfo.isTv()），最可靠；
 * 2. UA 关键字（Android TV / Google TV / 常见电视与盒子型号）；
 * 3. 安卓 + 完全没有触摸屏 + 大屏（电视盒子通常属于这一类）。
 */
export function detectTvDevice(): boolean {
  try {
    const native = (window as unknown as { SuchTvInfo?: { isTv?: () => boolean } }).SuchTvInfo
    if (native && typeof native.isTv === 'function') return native.isTv() === true
  } catch {
    /* 原生接口不可用，继续走 UA 判定 */
  }

  const ua = navigator.userAgent || ''
  if (
    /(Android\s?TV|Google\s?TV|GoogleTV|AFT[A-Z0-9]{2,}|BRAVIA|SmartTV|SMART-TV|AndroidTV|TV\sBuild)/i.test(
      ua
    )
  ) {
    return true
  }
  if (/Android/i.test(ua) && navigator.maxTouchPoints === 0) {
    const shortSide = Math.min(screen.width, screen.height)
    if (shortSide >= 600) return true
  }
  return false
}

// ==================== 候选元素收集 ====================

function isVisible(el: HTMLElement): boolean {
  const check = (el as HTMLElement & { checkVisibility?: (o?: object) => boolean }).checkVisibility
  if (typeof check === 'function') {
    // checkVisibility 会连带检查祖先的 opacity / visibility（关闭态胶囊会被排除）
    const visible = check.call(el, {
      checkOpacity: true,
      checkVisibilityCSS: true,
      opacityProperty: true,
      visibilityProperty: true
    })
    if (!visible) return false
  }
  const cs = getComputedStyle(el)
  if (cs.visibility === 'hidden' || cs.display === 'none') return false
  if (parseFloat(cs.opacity) < 0.05) return false
  // 关闭态的音乐控制胶囊 / 点击遮罩层：pointer-events: none，不可交互
  if (cs.pointerEvents === 'none') return false
  return true
}

function collect(): Candidate[] {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const maxArea = vw * vh * MAX_COVER_RATIO
  const out: Candidate[] = []
  const seen = new Set<HTMLElement>()

  const pushIfUsable = (el: HTMLElement): void => {
    if (seen.has(el)) return
    seen.add(el)
    if (el.closest('[aria-hidden="true"]')) return
    const rect = el.getBoundingClientRect()
    if (rect.width < 4 || rect.height < 4) return
    if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= vw || rect.top >= vh) return
    if (rect.width * rect.height > maxArea) return
    if (!isVisible(el)) return
    out.push({ el, rect })
  }

  document.querySelectorAll<HTMLElement>(CANDIDATE_SELECTOR).forEach(pushIfUsable)

  // 兜底：绑定了 Vue 点击监听的容器（div / li / span 等），只做属性检查，开销很小
  document.querySelectorAll<HTMLElement>(GENERIC_SCAN).forEach((el) => {
    if (seen.has(el) || !hasVueClick(el)) return
    pushIfUsable(el)
  })

  return out
}

// ==================== 几何打分 ====================

function center(rect: DOMRect): { x: number; y: number } {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

/**
 * 从 current 出发，按方向挑出几何上最合适的下一个元素。
 * 打分：主方向间隙 + 1.4 × 垂直方向偏移，完全不在同一行/列的元素额外加罚分。
 */
function scoreTargets(current: DOMRect, candidates: Candidate[], dir: Direction): Candidate[] {
  const cur = center(current)
  const scored: Array<Candidate & { score: number }> = []
  const vertical = dir === 'down' || dir === 'up'

  for (const c of candidates) {
    const mid = center(c.rect)
    let primary = 0
    let perp = 0
    let misaligned = false

    if (vertical) {
      const forward = dir === 'down' ? mid.y > cur.y + 0.5 : mid.y < cur.y - 0.5
      if (!forward) continue
      primary = dir === 'down' ? c.rect.top - current.bottom : current.top - c.rect.bottom
      perp = Math.abs(mid.x - cur.x)
      misaligned = c.rect.right <= current.left || c.rect.left >= current.right
    } else {
      const forward = dir === 'right' ? mid.x > cur.x + 0.5 : mid.x < cur.x - 0.5
      if (!forward) continue
      primary = dir === 'right' ? c.rect.left - current.right : current.left - c.rect.right
      perp = Math.abs(mid.y - cur.y)
      misaligned = c.rect.bottom <= current.top || c.rect.top >= current.bottom
    }

    const score = Math.max(0, primary) + perp * 1.4 + (misaligned ? 260 : 0)
    scored.push({ ...c, score })
  }

  scored.sort((a, b) => a.score - b.score)
  return scored
}

/** 判断元素中心点是否被其它浮层遮挡（播放页、卡片弹窗、胶囊点击层等） */
function isCovered(el: HTMLElement, rect: DOMRect): boolean {
  const x = Math.min(Math.max(rect.left + rect.width / 2, 1), window.innerWidth - 1)
  const y = Math.min(Math.max(rect.top + rect.height / 2, 1), window.innerHeight - 1)
  const hit = document.elementFromPoint(x, y)
  if (!hit) return false
  return !(el === hit || el.contains(hit) || hit.contains(el))
}

// ==================== 焦点操作 ====================

function focusTarget(c: Candidate): void {
  const el = c.el
  if (el.tabIndex < 0 && !el.hasAttribute('data-tv-focus')) {
    // 让 div / span 这类容器可以被 .focus()
    el.setAttribute('data-tv-focus', '')
    el.setAttribute('tabindex', '-1')
  }
  el.focus({ preventScroll: true })
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

function isEditable(el: Element | null): boolean {
  if (!el) return false
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return true
  if (el instanceof HTMLSelectElement) return true
  return (el as HTMLElement).isContentEditable === true
}

/** 多行输入：方向键交给系统光标，不抢 */
function isMultilineEditable(el: Element | null): boolean {
  if (!el) return false
  if (el instanceof HTMLTextAreaElement) return true
  return (el as HTMLElement).isContentEditable === true
}

/** 滑块（naive-ui 等）：左右键调整数值比移动焦点更有用 */
function isSlider(el: Element | null): boolean {
  return !!el && el instanceof HTMLElement && el.matches('[role="slider"], .n-slider')
}

function isNativeControl(el: HTMLElement): boolean {
  return (
    el instanceof HTMLButtonElement ||
    el instanceof HTMLAnchorElement ||
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  )
}

/** OK / Enter：原生控件交给浏览器默认行为，容器则转发给内部控件或直接派发点击 */
function activate(el: HTMLElement): void {
  if (isNativeControl(el)) return
  const inner = el.querySelector<HTMLElement>(
    'button:not([disabled]), [role="switch"], input, select, textarea, a[href]'
  )
  if (inner && inner !== el) {
    inner.click()
    return
  }
  el.click()
}

function findScrollable(start: HTMLElement | null): HTMLElement | null {
  let node: HTMLElement | null = start
  while (node && node !== document.body) {
    const cs = getComputedStyle(node)
    const oy = cs.overflowY
    if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight + 4) return node
    node = node.parentElement
  }
  const doc = document.scrollingElement as HTMLElement | null
  if (doc && doc.scrollHeight > doc.clientHeight + 4) return doc
  // 焦点在侧栏/底栏时没有滚动祖先，退回页面主滚动容器
  const main = document.querySelector<HTMLElement>('.mp-scroll, [data-tv-scroll]')
  if (main && main.scrollHeight > main.clientHeight + 4) return main
  return null
}

function scrollFallback(dir: Direction): void {
  if (dir !== 'up' && dir !== 'down') return
  const scroller = findScrollable(document.activeElement as HTMLElement | null)
  if (!scroller) return
  const step = scroller.clientHeight * SCROLL_STEP_RATIO
  scroller.scrollBy({ top: dir === 'down' ? step : -step, behavior: 'smooth' })
}

function focusInitial(candidates: Candidate[]): void {
  const visible = candidates.filter((c) => !isCovered(c.el, c.rect))
  const pool = visible.length ? visible : candidates
  const preferred =
    pool.find((c) => c.el.hasAttribute('data-tv-initial')) ||
    pool.find((c) => c.el.matches('.lsd-item.active')) ||
    pool.slice().sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)[0]
  if (preferred) focusTarget(preferred)
}

// ==================== 方向键 ====================

function moveFocus(dir: Direction): void {
  const candidates = collect()
  if (!candidates.length) return

  const active = document.activeElement as HTMLElement | null
  let current: Candidate | null = candidates.find((c) => c.el === active) ?? null
  if (!current && active && active !== document.body && active !== document.documentElement) {
    const rect = active.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) current = { el: active, rect }
  }

  // 焦点元素被新打开的浮层（播放页 / 卡片弹窗）盖住时，重新在顶层找入口
  if (current && isCovered(current.el, current.rect)) current = null

  if (!current) {
    focusInitial(candidates)
    return
  }

  const ordered = scoreTargets(current.rect, candidates, dir) as Array<Candidate & { score: number }>
  // 最多试 24 个：被浮层遮住的元素跳过，避免焦点跑到看不见的底栏上
  const limit = Math.min(ordered.length, 24)
  for (let i = 0; i < limit; i++) {
    const next = ordered[i]
    if (next.el === current.el) continue
    if (isCovered(next.el, next.rect)) continue
    focusTarget(next)
    return
  }

  scrollFallback(dir)
}

// ==================== 媒体键 ====================

type MediaAction = 'toggle' | 'play' | 'pause' | 'next' | 'prev'

const MEDIA_KEY_ACTION: Record<string, MediaAction> = {
  MediaPlayPause: 'toggle',
  MediaPlay: 'play',
  MediaPause: 'pause',
  MediaTrackNext: 'next',
  MediaTrackPrevious: 'prev'
}

async function runMediaAction(action: MediaAction): Promise<void> {
  const player = usePlayerStore()
  if (action === 'next') {
    player.playNext()
    return
  }
  if (action === 'prev') {
    player.playPrev()
    return
  }
  if (!player.currentSong || player.isLoading) return

  const wantPlay = action === 'play' ? true : action === 'pause' ? false : !player.isPlaying
  if (wantPlay === player.isPlaying) return

  if (wantPlay) {
    const ok = await webAudioEngine.play()
    if (ok) player.setPlaying(true)
    else window.dispatchEvent(new CustomEvent('player:replay-current'))
  } else {
    await webAudioEngine.pause()
    player.setPlaying(false)
  }
}

// ==================== 事件入口 ====================

function onKeyDown(event: KeyboardEvent): void {
  if (!enabled) return
  if (event.defaultPrevented) return
  if (event.altKey || event.ctrlKey || event.metaKey) return

  const media = MEDIA_KEY_ACTION[event.key]
  if (media) {
    event.preventDefault()
    void runMediaAction(media)
    return
  }

  const dir = ARROW_DIR[event.key]
  if (dir) {
    const active = document.activeElement
    // 多行输入：方向键留给系统光标
    if (isMultilineEditable(active)) return
    // 单行输入：左右键移动光标，上下键离开输入框（否则遥控器会卡在输入框里）
    if (isEditable(active) && (dir === 'left' || dir === 'right')) return
    // 滑块：左右键调整数值（naive-ui 自带键盘支持），上下键继续走空间导航
    if (isSlider(active) && (dir === 'left' || dir === 'right')) return
    event.preventDefault()
    moveFocus(dir)
    return
  }

  if (event.key === 'Enter' || event.key === 'NumpadEnter') {
    const active = document.activeElement as HTMLElement | null
    if (!active || active === document.body || isEditable(active)) return
    if (isNativeControl(active)) return // 按钮/链接等由浏览器处理
    event.preventDefault()
    activate(active)
    return
  }

  if (event.key === 'Escape' && isEditable(document.activeElement)) {
    ;(document.activeElement as HTMLElement).blur()
  }
}

/** 首屏给遥控器一个可见的起点（当前页导航按钮），否则用户不知道焦点在哪 */
function ensureInitialFocus(): void {
  const active = document.activeElement
  if (active && active !== document.body && active !== document.documentElement) return
  const candidates = collect()
  if (!candidates.length) return
  focusInitial(candidates)
}

function onNativeMediaEvent(event: Event): void {
  const detail = (event as CustomEvent<string>).detail
  if (detail === 'toggle' || detail === 'play' || detail === 'pause' || detail === 'next' || detail === 'prev') {
    void runMediaAction(detail)
  }
}

/**
 * 安装遥控器支持。判定为电视环境时才生效，普通手机/平板完全不受影响。
 * @param force 传 true 可强制启用（调试用）
 */
export function initTvSupport(force = false): boolean {
  const tv = force || detectTvDevice()
  if (!tv) return false
  enabled = true
  document.documentElement.classList.add('tv-mode')
  if (installed) return true  // 重复调用只补标记，不重复绑定事件
  installed = true

  // 冒泡阶段监听：让页面内组件（如 Cover Flow 的左右键）先处理，处理过的不再抢
  document.addEventListener('keydown', onKeyDown)
  window.addEventListener('tv:media', onNativeMediaEvent)
  // 首屏（等应用挂载、路由就绪后）把焦点放到当前页导航上
  window.setTimeout(ensureInitialFocus, 1200)
  return true
}
