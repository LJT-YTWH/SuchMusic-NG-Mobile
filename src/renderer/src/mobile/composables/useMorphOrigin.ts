import { shallowRef, type ShallowRef } from 'vue'

/** 屏幕坐标系下的矩形（用于「从某处展开成卡片」的原点） */
export interface MorphRect {
  x: number
  y: number
  w: number
  h: number
}

// 全局只保留「最后一次被按下的可展开控件」的位置，
// 这样任何弹层无需在模板里传坐标，就能从触发它的按钮处生长出来。
const lastRect = shallowRef<MorphRect | null>(null)
// 记录时间：过期的位置不该被误用（例如从歌单详情直接打开播放页）
const lastAt = shallowRef(0)
let bound = false

// 记录「从哪来」：底栏面板、播放页底栏按钮、以及各类歌曲/歌单列表行。
// 播放页按此位置生长，关闭时原路收回（从哪来回哪去）。
const ORIGIN_SELECTOR = [
  '[data-morph-origin]',
  '.pdock-panel',
  '.pdock-player',
  '.minibar',
  '.bar-btn',
  '.ctrl-btn',
  '.mp-btn-icon',
  '.song-row',
  '.pl-row',
  '.official-item',
  '.add-song-row',
  '.queue-item',
  '.lyric-result-item',
  '.mp-imgcard'
].join(',')

function rectOf(el: Element | null): MorphRect | null {
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (!r.width || !r.height) return null
  return { x: r.left, y: r.top, w: r.width, h: r.height }
}

/** 手动记录某个元素作为展开原点 */
export function rememberMorphOrigin(el: Element | null): void {
  lastRect.value = rectOf(el)
  lastAt.value = Date.now()
}

/**
 * 取最近的展开原点；超过 maxAge 视为过期，交给调用方用兜底位置，
 * 避免「从很久以前点过的按钮位置」长出整页。
 */
export function recentOrigin(maxAge = 2500): MorphRect | null {
  if (!lastRect.value) return null
  return Date.now() - lastAt.value <= maxAge ? lastRect.value : null
}

/**
 * 兜底原点：屏幕下方居中的小胶囊。
 * 用于「没有捕获到触发按钮」的场景（例如代码直接打开弹层）。
 */
export function fallbackOrigin(): MorphRect {
  const w = 200
  const h = 60
  const vw = window.innerWidth || 360
  const vh = window.innerHeight || 640
  return { x: (vw - w) / 2, y: vh - h - 96, w, h }
}

function bind(): void {
  if (bound || typeof window === 'undefined') return
  bound = true
  // 捕获阶段记录，确保即使控件内部 stopPropagation 也能拿到位置
  document.addEventListener(
    'pointerdown',
    (event) => {
      const target = event.target as HTMLElement | null
      const el = target?.closest?.(ORIGIN_SELECTOR) ?? null
      if (el) {
        lastRect.value = rectOf(el)
        lastAt.value = Date.now()
      }
    },
    true
  )
}

// 模块加载即绑定：原点记录是「弹层从按钮长出来」的公共基础设施，
// 不能依赖某个页面是否调用过 useMorphOrigin（播放页已改为上下滑动，不再调用它）。
if (typeof window !== 'undefined') bind()

export interface MorphOriginApi {
  lastRect: ShallowRef<MorphRect | null>
  rememberMorphOrigin: (el: Element | null) => void
  recentOrigin: (maxAge?: number) => MorphRect | null
}

export function useMorphOrigin(): MorphOriginApi {
  bind()
  return { lastRect, rememberMorphOrigin, recentOrigin }
}
