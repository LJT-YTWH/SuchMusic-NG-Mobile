<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { rememberMorphOrigin } from '../composables/useMorphOrigin'
import { preloadCovers } from '../utils/coverCache'

export interface CoverFlowItem {
  id: string | number
  title: string
  subtitle?: string
  cover?: string
  badge?: string
}

const props = withDefaults(
  defineProps<{
    items: CoverFlowItem[]
    label?: string
    startIndex?: number
    /** 左下角信息区小标题 */
    eyebrow?: string
    /** 是否显示左上角品牌块（歌单详情显示；我的/本地/广场/榜单等主界面不显示） */
    showBrand?: boolean
  }>(),
  { label: 'Cover Flow', startIndex: 0, eyebrow: 'NOW SHOWING', showBrand: false }
)

const emit = defineEmits<{
  (e: 'select', item: CoverFlowItem, index: number): void
  (e: 'active', item: CoverFlowItem, index: number): void
}>()

const stageEl = ref<HTMLElement | null>(null)
const flowEl = ref<HTMLElement | null>(null)
const scrubEl = ref<HTMLElement | null>(null)
const thumbEl = ref<HTMLElement | null>(null)
const failed = ref<Record<string, boolean>>({})

const activeIndex = ref(0)
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

const CFG = {
  gap: 0.72,
  depth: 0.42,
  perspective: 6.5,
  tilt: 48,
  tiltStep: 8,
  tiltMax: 76,
  maxRange: 7,
  spring: 158,
  damping: 25.5,
  flick: 0.16,
  wheelGain: 0.58,
  dragGain: 0.92
}

const state = {
  pos: 0,
  target: 0,
  vel: 0,
  width: 240,
  gapPx: 180,
  depthPx: 100,
  current: -1,
  dragging: false,
  scrubbing: false,
  pointerId: -1,
  downX: 0,
  downY: 0,
  startPos: 0,
  lastX: 0,
  lastT: 0,
  downItem: -1,
  moved: false,
  raf: 0,
  lastFrame: 0,
  scrubH: 0,
  thumbH: 48,
  wheelTimer: 0,
  zCenter: -999
}

/* ---------------- 虚拟化：只渲染窗口内的封面 ----------------
   歌单详情可能有上千首，全量渲染 = 上千个 <img> + 3D 图层，是卡顿主因。
   这里按中心索引维护一个滑动窗口，窗口外直接不渲染。 */
const range = ref(5)
const winStart = ref(0)
const winSize = computed(() => range.value * 2 + 5)

const windowItems = computed(() => {
  const start = Math.min(Math.max(0, winStart.value), Math.max(0, props.items.length - 1))
  return props.items.slice(start, start + winSize.value).map((item, i) => ({
    item,
    index: start + i
  }))
})

const itemEls = new Map<number, HTMLElement>()
const appliedTransforms = new Map<number, string>()
const appliedShades = new Map<number, number>()
const shadeEls = new Map<number, HTMLElement | null>()

function setItemRef(el: unknown, index: number): void {
  if (el) {
    itemEls.set(index, el as HTMLElement)
    // 新节点：清掉缓存，保证下一帧一定会写入 transform / 遮罩
    appliedTransforms.delete(index)
    appliedShades.delete(index)
    shadeEls.delete(index)
  } else {
    itemEls.delete(index)
  }
}

const last = computed(() => Math.max(0, props.items.length - 1))
const total = computed(() => props.items.length)
const current = computed(() => props.items[activeIndex.value] || null)

const pad = (v: number): string => String(v).padStart(2, '0')
const counter = computed(() => `${pad(activeIndex.value + 1)} / ${pad(total.value)}`)

/** 指针捕获丢失时兜底收尾 */
function onLostCapture(): void {
  if (!state.dragging) return
  state.moved = true
  endDrag()
}

/* ---------------- 测量 ---------------- */

function anyItemEl(): HTMLElement | null {
  for (const el of itemEls.values()) return el
  return null
}

function measure(): void {
  const first = anyItemEl()
  if (first) state.width = first.offsetWidth || 240
  state.gapPx = state.width * CFG.gap
  state.depthPx = state.width * CFG.depth
  if (flowEl.value) {
    flowEl.value.style.perspective = `${(state.width * CFG.perspective).toFixed(1)}px`
  }
  const stageW = stageEl.value?.clientWidth || window.innerWidth || 360
  const half = stageW / 2
  range.value = Math.max(
    3,
    Math.min(CFG.maxRange, Math.ceil((half + state.width * 0.72) / state.gapPx) + 1)
  )
  syncWindow(true)
}

function measureScrub(): void {
  if (!scrubEl.value || !thumbEl.value) return
  state.scrubH = scrubEl.value.clientHeight || 240
  state.thumbH = thumbEl.value.offsetHeight || 48
  thumbOffset = Number.NaN
}

/* ---------------- 虚拟窗口 ---------------- */

function syncWindow(force = false): void {
  const size = winSize.value
  const center = Math.round(state.pos)
  const start = winStart.value
  if (force || center - start < 2 || center - start > size - 3) {
    const next = Math.max(
      0,
      Math.min(center - range.value - 2, Math.max(0, props.items.length - size))
    )
    if (next !== start || force) {
      winStart.value = next
      nextTick(() => {
        measureScrub()
        render()
        updateScrubber()
      })
    }
  }
}

/* ---------------- 渲染 ---------------- */

function render(): void {
  const pos = state.pos
  const rangeV = range.value
  const gap = state.gapPx
  const depth = state.depthPx
  const center = Math.round(pos)

  if (center !== state.zCenter) {
    state.zCenter = center
    for (const [i, el] of itemEls) {
      el.style.zIndex = String(1000 - Math.abs(i - center) * 10)
    }
  }

  for (const [i, el] of itemEls) {
    const d = i - pos
    const ad = Math.abs(d)

    if (ad > rangeV) {
      if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden'
      continue
    }
    if (el.style.visibility !== 'visible') el.style.visibility = 'visible'

    const tilt = Math.min(
      CFG.tiltMax,
      CFG.tilt * (ad < 1 ? ad : 1) + CFG.tiltStep * (ad > 1 ? ad - 1 : 0)
    )
    const angle = d < 0 ? tilt : -tilt
    const x = d * gap
    const z = -ad * depth
    const transform = `translate3d(${x.toFixed(2)}px, 0, ${z.toFixed(2)}px) rotateY(${angle.toFixed(
      2
    )}deg)`

    if (transform !== appliedTransforms.get(i)) {
      el.style.transform = transform
      appliedTransforms.set(i, transform)
    }

    const shade = Math.min(0.42, Math.max(0, ad * 0.11 - 0.02))
    if (Math.abs(shade - (appliedShades.get(i) ?? -1)) > 0.005) {
      let veil = shadeEls.get(i)
      if (veil === undefined) {
        veil = el.querySelector<HTMLElement>('.cf-shade')
        shadeEls.set(i, veil)
      }
      if (veil) veil.style.opacity = shade.toFixed(2)
      appliedShades.set(i, shade)
    }
  }
}

function updateSelection(): void {
  if (!props.items.length) return
  const index = Math.max(0, Math.min(last.value, Math.round(state.pos)))
  if (index === state.current) return
  state.current = index
  activeIndex.value = index
  const item = props.items[index]
  if (item) emit('active', item, index)
}

let thumbOffset = Number.NaN

function updateScrubber(): void {
  if (!state.scrubH || !thumbEl.value) return
  const usable = Math.max(1, state.scrubH - state.thumbH)
  const ratio = last.value === 0 ? 0 : state.pos / last.value
  const clamped = ratio < 0 ? 0 : ratio > 1 ? 1 : ratio
  const y = clamped * usable
  if (Math.abs(y - thumbOffset) < 0.05) return
  thumbOffset = y
  thumbEl.value.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`
}

/* ---------------- 运动 ---------------- */

function clampIndex(v: number): number {
  return v < 0 ? 0 : v > last.value ? last.value : v
}

function clampRubber(v: number): number {
  if (v < 0) return v * 0.28
  if (v > last.value) return last.value + (v - last.value) * 0.28
  return v
}

function kick(): void {
  if (state.raf) return
  state.lastFrame = performance.now()
  state.raf = window.requestAnimationFrame(tick)
}

function settleNow(): void {
  state.pos = state.target
  state.vel = 0
  syncWindow()
  render()
  updateSelection()
  updateScrubber()
}

function tick(now: number): void {
  state.raf = 0
  let dt = (now - state.lastFrame) / 1000
  state.lastFrame = now
  if (!(dt > 0)) dt = 1 / 60
  if (dt > 0.05) dt = 0.05

  if (!state.dragging && !state.scrubbing) {
    if (reduceMotion.matches) {
      state.pos = state.target
      state.vel = 0
    } else {
      const force = (state.target - state.pos) * CFG.spring - state.vel * CFG.damping
      state.vel += force * dt
      state.pos += state.vel * dt
      if (Math.abs(state.target - state.pos) < 0.0006 && Math.abs(state.vel) < 0.008) {
        state.pos = state.target
        state.vel = 0
      }
    }
  }

  syncWindow()
  render()
  updateSelection()
  updateScrubber()

  const settled =
    !state.dragging && !state.scrubbing && state.pos === state.target && state.vel === 0
  if (!settled) kick()
}

function goTo(index: number): void {
  const dest = clampIndex(index)
  const distance = Math.abs(dest - state.pos)
  state.target = dest
  // 距离过远时直接落位，避免扫过中间所有封面
  if (reduceMotion.matches || distance > 4.5) {
    settleNow()
    return
  }
  if (distance > 0.001) state.vel *= 0.3
  kick()
}

function goBy(delta: number): void {
  goTo(Math.round(state.target) + delta)
}

/** 外接键盘（平板/手柄映射）左右切换 */
function onKeydown(event: KeyboardEvent): void {
  if (event.metaKey || event.ctrlKey || event.altKey) return
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    goBy(1)
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    goBy(-1)
  }
}

/* ---------------- 指针拖拽 ---------------- */

function onPointerDown(event: PointerEvent): void {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  if (!event.isPrimary) return
  if (state.scrubbing) return
  const target = event.target as HTMLElement | null
  if (target?.closest?.('.cf-scrub')) return

  state.dragging = true
  state.pointerId = event.pointerId
  state.downX = event.clientX
  state.downY = event.clientY
  state.startPos = state.pos
  state.lastX = event.clientX
  state.lastT = performance.now()
  state.vel = 0
  state.moved = false
  const itemNode = target?.closest?.('.cf-item') as HTMLElement | null
  state.downItem = itemNode ? Number(itemNode.dataset.index ?? -1) : -1

  window.clearTimeout(state.wheelTimer)
  stageEl.value?.classList.add('is-grabbing')
  stageEl.value?.focus({ preventScroll: true })
  try {
    stageEl.value?.setPointerCapture(event.pointerId)
  } catch {
    /* 老版本 Safari 忽略 */
  }
  kick()
}

function onPointerMove(event: PointerEvent): void {
  if (!state.dragging || event.pointerId !== state.pointerId) return
  const dx = event.clientX - state.downX
  const dy = event.clientY - state.downY

  if (!state.moved && dx * dx + dy * dy > 20) state.moved = true
  if (!state.moved) return

  const next = clampRubber(state.startPos - dx / (state.gapPx * CFG.dragGain))
  const now = performance.now()
  const dt = Math.max(8, now - state.lastT)
  const instant = (next - state.pos) / (dt / 1000)
  state.vel = state.vel * 0.65 + instant * 0.35
  if (Math.abs(state.vel) < 0.02) state.vel = 0

  state.pos = next
  state.target = next
  state.lastT = now
  kick()
}

function endDrag(event?: PointerEvent): void {
  if (!state.dragging) return
  if (event && event.pointerId !== state.pointerId) return

  const moved = state.moved
  const downItem = state.downItem

  state.dragging = false
  state.downItem = -1
  stageEl.value?.classList.remove('is-grabbing')

  try {
    if (event && stageEl.value?.hasPointerCapture(event.pointerId)) {
      stageEl.value.releasePointerCapture(event.pointerId)
    }
  } catch {
    /* noop */
  }

  if (!moved && downItem >= 0) {
    const index = downItem
    if (index !== state.current) {
      goTo(index)
    } else {
      // 点击位于中央的封面 = 打开；把这张封面记为播放页展开原点（从哪来回哪去）
      const item = props.items[index]
      rememberMorphOrigin(itemEls.get(index) ?? null)
      if (item) emit('select', item, index)
      state.target = clampIndex(Math.round(state.pos))
      kick()
    }
    return
  }

  const projected = state.pos + state.vel * CFG.flick
  state.target = clampIndex(Math.round(projected))
  state.vel = Math.max(-3.5, Math.min(3.5, state.vel * 0.28))

  if (reduceMotion.matches) settleNow()
  else kick()
}

function onPointerCancel(event: PointerEvent): void {
  state.moved = true
  endDrag(event)
}

/* ---------------- 右侧竖直拖动条 ---------------- */

function scrubTo(clientY: number): void {
  if (!scrubEl.value) return
  const rect = scrubEl.value.getBoundingClientRect()
  const usable = Math.max(1, rect.height - state.thumbH)
  const y = Math.min(usable, Math.max(0, clientY - rect.top - state.thumbH / 2))
  const value = last.value === 0 ? 0 : (y / usable) * last.value
  state.pos = value
  state.target = value
  state.vel = 0
  kick()
}

function onScrubDown(event: PointerEvent): void {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  if (!event.isPrimary) return
  event.preventDefault()
  event.stopPropagation()

  state.scrubbing = true
  state.pointerId = event.pointerId
  state.thumbH = thumbEl.value?.offsetHeight || 48
  try {
    scrubEl.value?.setPointerCapture(event.pointerId)
  } catch {
    /* noop */
  }
  window.clearTimeout(state.wheelTimer)
  stageEl.value?.classList.add('is-scrubbing')
  scrubTo(event.clientY)
  kick()
}

function onScrubMove(event: PointerEvent): void {
  if (!state.scrubbing || event.pointerId !== state.pointerId) return
  scrubTo(event.clientY)
}

function onScrubUp(event?: PointerEvent): void {
  if (!state.scrubbing) return
  if (event && event.pointerId !== state.pointerId) return
  state.scrubbing = false
  stageEl.value?.classList.remove('is-scrubbing')
  try {
    if (event && scrubEl.value?.hasPointerCapture(event.pointerId)) {
      scrubEl.value.releasePointerCapture(event.pointerId)
    }
  } catch {
    /* noop */
  }
  state.target = clampIndex(Math.round(state.pos))
  state.vel = 0
  if (reduceMotion.matches) settleNow()
  else kick()
}

/* ---------------- 滚轮 ---------------- */

function onWheel(event: WheelEvent): void {
  if (event.ctrlKey) return
  if (state.dragging || state.scrubbing) return

  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1
  const dx = event.deltaX * unit
  const dy = event.deltaY * unit
  const delta = Math.abs(dx) > Math.abs(dy) ? dx : dy
  if (!delta) return

  event.preventDefault()
  window.clearTimeout(state.wheelTimer)
  state.target = clampIndex(state.target + delta / (state.gapPx * CFG.wheelGain))
  state.vel *= 0.5
  kick()
  state.wheelTimer = window.setTimeout(() => {
    state.target = clampIndex(Math.round(state.target))
    kick()
  }, 140)
}

/* ---------------- 封面预热 ----------------
   平移时提前把前后几张封面拉进 WebView 图片缓存，
   虚拟化窗口外的 <img> 被销毁后再回来也不会闪白 */
function prefetchAround(index: number): void {
  const start = Math.max(0, index - 4)
  const end = Math.min(props.items.length, index + 5)
  preloadCovers(
    props.items.slice(start, end).map((it) => it.cover),
    10
  )
}

watch(
  () => [activeIndex.value, props.items.length] as const,
  () => prefetchAround(activeIndex.value),
  { immediate: true }
)

/* ---------------- 生命周期 ---------------- */

function relaunch(startIndex = 0): void {
  const start = Math.min(Math.max(0, startIndex), last.value)
  state.pos = start
  state.target = start
  state.vel = 0
  state.current = -1
  state.zCenter = -999
  appliedTransforms.clear()
  appliedShades.clear()
  shadeEls.clear()
  winStart.value = Math.max(0, Math.min(start - range.value - 2, Math.max(0, props.items.length - winSize.value)))
  nextTick(() => {
    measure()
    measureScrub()
    render()
    updateSelection()
    updateScrubber()
  })
}

const onResize = (): void => {
  if (state.dragging) {
    state.moved = true
    endDrag()
  }
  measure()
  measureScrub()
  render()
  updateScrubber()
  kick()
}

const onVisibility = (): void => {
  if (document.visibilityState === 'visible') kick()
}

// 数据异步到达：首次填充用 startIndex，之后保持当前浏览位置
let booted = false
watch(
  () => props.items.length,
  (len) => {
    if (!len) return
    if (!booted) {
      booted = true
      relaunch(props.startIndex)
      return
    }
    relaunch(Math.max(0, Math.min(state.current, len - 1)))
  }
)

onMounted(() => {
  booted = true
  relaunch(props.startIndex)
  window.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('resize', onResize, { passive: true })
  window.addEventListener('orientationchange', onResize, { passive: true })
  document.addEventListener('visibilitychange', onVisibility)
})

onBeforeUnmount(() => {
  if (state.raf) cancelAnimationFrame(state.raf)
  window.clearTimeout(state.wheelTimer)
  window.removeEventListener('wheel', onWheel)
  window.removeEventListener('resize', onResize)
  window.removeEventListener('orientationchange', onResize)
  document.removeEventListener('visibilitychange', onVisibility)
  itemEls.clear()
  appliedTransforms.clear()
  appliedShades.clear()
  shadeEls.clear()
})
</script>

<template>
  <div class="cf" :style="{ '--cf-anchor': showBrand ? '44%' : '38%' }">
    <header class="cf-top">
      <div class="cf-lead">
        <slot name="lead" />
        <!-- 品牌块只在歌单详情显示；主界面留空，让封面流整体上移 -->
        <template v-if="showBrand">
          <span class="cf-mark" aria-hidden="true"></span>
          <span class="cf-brand-text">
            <span class="cf-brand-name">{{ label }}</span>
            <span class="cf-brand-meta">{{ total }} 项</span>
          </span>
        </template>
      </div>
      <p class="cf-hint" aria-hidden="true">
        <span>拖拽</span><i>·</i><span>点击封面打开</span>
      </p>
    </header>

    <div
      ref="stageEl"
      class="cf-stage"
      tabindex="0"
      role="listbox"
      aria-label="封面流，左右切换，点击中央封面打开"
      @keydown="onKeydown"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="endDrag"
      @pointercancel="onPointerCancel"
      @lostpointercapture="onLostCapture"
    >
      <div ref="flowEl" class="cf-flow">
        <div
          v-for="entry in windowItems"
          :key="entry.item.id"
          :ref="(el) => setItemRef(el, entry.index)"
          class="cf-item"
          :data-index="entry.index"
          role="option"
          :aria-selected="entry.index === activeIndex"
          :aria-label="`${entry.item.title}${entry.item.subtitle ? ' — ' + entry.item.subtitle : ''}`"
        >
          <div class="cf-card">
            <div class="cf-ph">
              <span>{{ (entry.item.title || '?').trim().charAt(0) }}</span>
            </div>
            <img
              v-if="entry.item.cover && !failed[String(entry.item.id)]"
              class="cf-art"
              :src="entry.item.cover"
              alt=""
              loading="eager"
              decoding="async"
              draggable="false"
              @error="failed[String(entry.item.id)] = true"
            />
            <div class="cf-shade" aria-hidden="true"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- 左下角信息区：标题 / 歌手完整展示（不再被底部拖动条挤压） -->
    <div class="cf-hud">
      <p class="cf-eyebrow">
        <span class="cf-dot" aria-hidden="true"></span>
        <span>{{ eyebrow }}</span>
        <span class="cf-index">{{ counter }}</span>
      </p>
      <h2 class="cf-title">{{ current?.title || '—' }}</h2>
      <p class="cf-artist">{{ current?.subtitle || '' }}</p>
      <p v-if="current?.badge" class="cf-badge">{{ current.badge }}</p>
    </div>

    <!-- 右侧竖直拖动条 -->
    <div
      ref="scrubEl"
      class="cf-scrub"
      role="slider"
      tabindex="0"
      aria-label="浏览"
      aria-orientation="vertical"
      :aria-valuemin="1"
      :aria-valuemax="Math.max(1, total)"
      :aria-valuenow="activeIndex + 1"
      @pointerdown="onScrubDown"
      @pointermove="onScrubMove"
      @pointerup="onScrubUp"
      @pointercancel="onScrubUp"
    >
      <span class="cf-scrub-track" aria-hidden="true"></span>
      <span ref="thumbEl" class="cf-scrub-thumb" aria-hidden="true"></span>
    </div>
  </div>
</template>

<style scoped>
.cf {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  /* 透明背景：直接透出页面自身的主题背景 */
  background: transparent;
  --cf-cover: clamp(112px, min(50vh, 28vw), 320px);
  --cf-anchor: 43%;
  --cf-hud: clamp(14px, 2.4vw, 40px);
  --cf-ease: cubic-bezier(0.22, 1, 0.36, 1);
  color: var(--mp-text, #1c1c1e);
  overscroll-behavior: none;
  -webkit-user-select: none;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}

/* ---------------- 顶部 ---------------- */
.cf-top {
  position: absolute;
  inset: 0 0 auto;
  z-index: 4;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 12px calc(var(--cf-hud) + var(--sar, 0px)) 0 var(--cf-hud);
  pointer-events: none;
}

/* 歌单详情：返回按钮 + 品牌块；主界面：留空（顶部只保留右侧提示） */
.cf-lead {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  pointer-events: auto;
}

.cf-mark {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--mp-primary, #2c8efd);
  box-shadow: 0 0 12px 2px color-mix(in srgb, var(--mp-primary, #2c8efd) 40%, transparent);
}

.cf-brand-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.cf-brand-name {
  max-width: 42vw;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--mp-text-2, rgba(60, 60, 67, 0.6));
}

.cf-brand-meta {
  font-size: 10px;
  line-height: 1;
  letter-spacing: 0.05em;
  color: var(--mp-text-3, rgba(60, 60, 67, 0.33));
  font-variant-numeric: tabular-nums;
}

.cf-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding-top: 1px;
  font-size: 10px;
  line-height: 1;
  letter-spacing: 0.04em;
  color: var(--mp-text-3, rgba(60, 60, 67, 0.33));
  white-space: nowrap;
}

.cf-hint i {
  font-style: normal;
  opacity: 0.6;
}

/* ---------------- 3D 舞台 ---------------- */
.cf-stage {
  position: absolute;
  inset: 0;
  z-index: 1;
  cursor: grab;
  touch-action: none;
  outline: none;
}

.cf-stage.is-grabbing {
  cursor: grabbing;
}

.cf-flow {
  position: absolute;
  inset: 0;
  perspective-origin: 50% var(--cf-anchor);
  opacity: 0;
  animation: cf-in 420ms var(--cf-ease) 40ms forwards;
}

@keyframes cf-in {
  to {
    opacity: 1;
  }
}

.cf-item {
  position: absolute;
  left: 50%;
  top: var(--cf-anchor);
  width: var(--cf-cover);
  height: var(--cf-cover);
  margin-left: calc(var(--cf-cover) / -2);
  margin-top: calc(var(--cf-cover) / -2);
  transform-origin: 50% 50%;
  backface-visibility: hidden;
  visibility: hidden;
  /* 不写 will-change：3D 变换本身就会提升合成层，
     为窗口内所有封面额外声明只会白占显存 */
}

.cf-card {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: 3px;
  background: var(--mp-bg-secondary, #ececf1);
  box-shadow:
    0 26px 44px -20px rgba(0, 0, 0, 0.45),
    0 8px 18px rgba(0, 0, 0, 0.18),
    inset 0 0 0 1px rgba(255, 255, 255, 0.14);
}

.cf-card::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0) 26%),
    linear-gradient(0deg, rgba(0, 0, 0, 0.14), rgba(0, 0, 0, 0) 22%);
}

.cf-ph {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: linear-gradient(
    155deg,
    var(--mp-bg-secondary, #ececf1) 0%,
    color-mix(in srgb, var(--mp-bg-secondary, #ececf1) 70%, #000) 100%
  );
}

.cf-ph span {
  font-size: calc(var(--cf-cover) * 0.19);
  font-weight: 600;
  letter-spacing: 0.12em;
  color: color-mix(in srgb, var(--mp-text, #1c1c1e) 24%, transparent);
}

.cf-art {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  animation: cf-art-in 320ms var(--cf-ease) both;
}

@keyframes cf-art-in {
  from {
    opacity: 0;
  }
}

.cf-shade {
  position: absolute;
  inset: 0;
  background: #000;
  opacity: 0;
  pointer-events: none;
}

/* ---------------- 左下信息区 ---------------- */
.cf-hud {
  position: absolute;
  left: var(--cf-hud);
  bottom: clamp(10px, 2.2vh, 22px);
  z-index: 3;
  width: min(54%, 460px);
  pointer-events: none;
}

.cf-eyebrow {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 7px;
  font-size: 9px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--mp-text-3, rgba(60, 60, 67, 0.33));
  white-space: nowrap;
}

.cf-dot {
  flex: none;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--mp-primary, #2c8efd);
  box-shadow: 0 0 10px 1px color-mix(in srgb, var(--mp-primary, #2c8efd) 45%, transparent);
}

.cf-index {
  margin-left: 3px;
  letter-spacing: 0.1em;
  color: var(--mp-text-2, rgba(60, 60, 67, 0.6));
  font-variant-numeric: tabular-nums;
}

/* 标题完整展示：允许换行，不做省略号截断 */
.cf-title {
  margin: 0;
  font-size: clamp(15px, 1.9vw, 23px);
  font-weight: 700;
  line-height: 1.22;
  letter-spacing: -0.018em;
  color: var(--mp-text, #1c1c1e);
  overflow-wrap: anywhere;
}

.cf-artist {
  margin: 5px 0 0;
  font-size: 12px;
  line-height: 1.35;
  color: var(--mp-text-2, rgba(60, 60, 67, 0.6));
  overflow-wrap: anywhere;
}

.cf-badge {
  margin: 6px 0 0;
  font-size: 9.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mp-text-3, rgba(60, 60, 67, 0.33));
  font-variant-numeric: tabular-nums;
}

/* ---------------- 右侧竖直拖动条 ---------------- */
.cf-scrub {
  position: absolute;
  right: calc(var(--cf-hud) * 0.5 + var(--sar, 0px));
  top: 50%;
  z-index: 5;
  width: 30px;
  height: clamp(140px, 52vh, 340px);
  transform: translateY(-50%);
  pointer-events: auto;
  cursor: pointer;
  touch-action: none;
}

.cf-scrub-track {
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 3px;
  margin-left: -1.5px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--mp-text, #1c1c1e) 16%, transparent);
}

.cf-scrub-thumb {
  position: absolute;
  left: 50%;
  top: 0;
  width: 5px;
  height: 46px;
  margin-left: -2.5px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--mp-text, #1c1c1e) 78%, transparent);
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.22);
  will-change: transform;
}

@media (max-height: 400px) {
  .cf-hint {
    display: none;
  }

  .cf-badge {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .cf-flow {
    animation-duration: 1ms;
  }

  .cf-art {
    animation-duration: 1ms;
  }
}
</style>
