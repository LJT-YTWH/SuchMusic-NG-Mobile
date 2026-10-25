<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { recentOrigin } from '../composables/useMorphOrigin'

/**
 * 竖屏播放页的二级弹层：从被点击的底部按钮位置「放大」成卡片。
 * 缩放原点用 pointerdown 记录的按钮矩形，未记录时退化为卡片中心。
 * 横屏下不使用本组件（仍为右侧抽屉）。
 */
const props = withDefaults(
  defineProps<{
    show: boolean
    title?: string
    meta?: string
  }>(),
  { title: '', meta: '' }
)

const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()

const CARD_W_MAX = 452
const CARD_H_MAX = 620

const cardStyle = computed(() => {
  const vw = typeof window !== 'undefined' ? window.innerWidth || 360 : 360
  const vh = typeof window !== 'undefined' ? window.innerHeight || 640 : 640
  const w = Math.min(CARD_W_MAX, vw - 40)
  const h = Math.min(CARD_H_MAX, Math.max(320, vh - 96))
  return { width: `${w}px`, height: `${h}px` }
})

const rendered = ref(false)
const entered = ref(false)
const originStyle = ref<Record<string, string>>({})
let enterRaf = 0
let closeTimer: number | undefined

function clearTimers(): void {
  if (enterRaf) cancelAnimationFrame(enterRaf)
  enterRaf = 0
  if (closeTimer) {
    clearTimeout(closeTimer)
    closeTimer = undefined
  }
}

function open(): void {
  clearTimers()
  const vw = window.innerWidth || 360
  const vh = window.innerHeight || 640
  const w = Math.min(CARD_W_MAX, vw - 40)
  const h = Math.min(CARD_H_MAX, Math.max(320, vh - 96))
  const left = (vw - w) / 2
  const top = (vh - h) / 2

  // 缩放原点 = 触发按钮中心在卡片坐标系里的位置
  const rect = recentOrigin()
  const cx = rect ? rect.x + rect.w / 2 : vw / 2
  const cy = rect ? rect.y + rect.h / 2 : vh / 2
  originStyle.value = {
    transformOrigin: `${Math.min(Math.max(cx - left, 0), w).toFixed(1)}px ${Math.min(
      Math.max(cy - top, 0),
      h
    ).toFixed(1)}px`
  }

  rendered.value = true
  entered.value = false
  enterRaf = requestAnimationFrame(() => {
    entered.value = true
    enterRaf = 0
  })
}

function close(): void {
  clearTimers()
  entered.value = false
  closeTimer = window.setTimeout(() => {
    rendered.value = false
    closeTimer = undefined
  }, 280)
}

watch(
  () => props.show,
  (v) => {
    if (v) open()
    else if (rendered.value) close()
  },
  { immediate: true }
)

const requestClose = (): void => emit('update:show', false)

const onKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape' && props.show) requestClose()
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  clearTimers()
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="rendered" class="mcd-mask" :class="{ on: entered }" @click="requestClose"></div>

    <section
      v-if="rendered"
      class="mcd-card"
      :class="{ open: entered }"
      :style="[cardStyle, originStyle]"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
    >
      <header class="mcd-head" :class="{ bare: !title && !meta }">
        <div v-if="title || meta" class="mcd-heading">
          <span class="mcd-name">{{ title }}</span>
          <span v-if="meta" class="mcd-meta">{{ meta }}</span>
        </div>
        <button class="mcd-close" type="button" aria-label="关闭" @click="requestClose">
          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path d="m6 6 8 8M14 6l-8 8" />
          </svg>
        </button>
      </header>

      <div class="mcd-body">
        <slot />
      </div>
    </section>
  </Teleport>
</template>

<style scoped>
.mcd-mask {
  position: fixed;
  inset: 0;
  z-index: 2380;
  background: rgba(0, 0, 0, 0.46);
  opacity: 0;
  transition: opacity 160ms ease;
  -webkit-tap-highlight-color: transparent;
}

.mcd-mask.on {
  opacity: 1;
}

.mcd-card {
  position: fixed;
  left: 50%;
  top: 50%;
  z-index: 2381;
  display: flex;
  flex-direction: column;
  max-width: calc(100vw - 40px);
  max-height: calc(100vh - 96px);
  padding: 18px 18px calc(14px + var(--sab, 0px));
  border-radius: 34px;
  background:
    radial-gradient(140% 180% at 8% -30%, rgba(255, 255, 255, 0.14), transparent 48%),
    radial-gradient(70% 110% at 96% -10%, rgba(59, 155, 255, 0.1), transparent 54%),
    linear-gradient(155deg, #232529 0%, #141519 52%, #0a0b0d 100%);
  box-shadow:
    0 56px 100px -48px rgba(0, 0, 0, 0.64),
    0 24px 48px -34px rgba(0, 0, 0, 0.34),
    inset 0 1px 0 rgba(255, 255, 255, 0.13),
    inset 0 0 0 1px rgba(255, 255, 255, 0.065);
  color: #fff;
  box-sizing: border-box;
  /* 从触发按钮位置放大出来 */
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.12);
  transition:
    opacity 140ms ease,
    transform 260ms cubic-bezier(0.22, 1, 0.36, 1);

  /* 深色卡片内的设计令牌：让沿用 mp-* 变量的内容自动适配深色 */
  --mp-text: #f2f2f7;
  --mp-text-2: rgba(235, 235, 245, 0.62);
  --mp-text-3: rgba(235, 235, 245, 0.38);
  --mp-bg: #141519;
  --mp-bg-elevated: #1d1f24;
  --mp-bg-secondary: #2a2d33;
  --mp-fill: rgba(255, 255, 255, 0.08);
  --mp-fill-strong: rgba(255, 255, 255, 0.16);
  --mp-separator: rgba(255, 255, 255, 0.1);
  --mp-frosted-bg: rgba(30, 32, 38, 0.7);
  --mp-frosted-border: rgba(255, 255, 255, 0.1);
}

.mcd-card.open {
  opacity: 1;
  transform: translate(-50%, -50%) scale(1);
}

@media (prefers-reduced-motion: reduce) {
  .mcd-mask,
  .mcd-card {
    transition-duration: 1ms !important;
  }
}

.mcd-head {
  display: flex;
  flex: 0 0 auto;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 2px 4px 10px;
}

/* 内容自带标题时（均衡器 / 高级音效），卡片头只保留关闭按钮 */
.mcd-head.bare {
  justify-content: flex-end;
  padding-bottom: 4px;
}

.mcd-heading {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.mcd-name {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: #f7f7f3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mcd-meta {
  font-size: 9.5px;
  font-weight: 500;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.36);
}

.mcd-close {
  display: grid;
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.72);
  transition:
    transform 0.2s ease,
    background-color 0.2s ease;
}

.mcd-close svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
}

.mcd-close:active {
  transform: scale(0.9);
  background: rgba(255, 255, 255, 0.14);
}

.mcd-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}

/* 内部沿用以 mp-sheet 为基础的结构，卡片自身滚动时取消内层滚动约束 */
.mcd-body :deep(.action-list),
.mcd-body :deep(.sheet-scroll),
.mcd-body :deep(.add-song-list),
.mcd-body :deep(.dl-list) {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: none;
  max-height: none;
  min-height: 0;
  overflow: visible;
  padding: 0 2px 4px;
}

/* 卡片自带 18px 内边距，内部区块改用对齐用的 2px，避免内容被二次缩进 */
.mcd-body :deep(.ai-panel),
.mcd-body :deep(.new-pl-form),
.mcd-body :deep(.lyric-search-bar),
.mcd-body :deep(.dl-song),
.mcd-body :deep(.lyric-preview-song),
.mcd-body :deep(.dl-actions),
.mcd-body :deep(.dl-hint),
.mcd-body :deep(.lyric-preview-actions),
.mcd-body :deep(.eq-head),
.mcd-body :deep(.fx-head) {
  padding-left: 2px;
  padding-right: 2px;
}

@media (max-width: 360px) {
  .mcd-card {
    border-radius: 28px;
    padding-left: 14px;
    padding-right: 14px;
  }
}

/* ==================== 浅色模式适配 ====================
   卡片本身固定为深色玻璃，浅色主题下内部沿用 mp-* 变量的面板
   （列表、下载项、队列、评论、AI 翻译等）会变成深色文字压在深色底上。
   这里把卡片改成白色玻璃，并强制覆盖一套浅色 token。 */
html[data-theme='light'] .mcd-mask {
  background: rgba(0, 0, 0, 0.32);
}

html[data-theme='light'] .mcd-card {
  background:
    radial-gradient(140% 180% at 8% -30%, rgba(255, 255, 255, 0.95), transparent 48%),
    radial-gradient(70% 110% at 96% -10%, rgba(44, 142, 253, 0.08), transparent 54%),
    linear-gradient(155deg, #ffffff 0%, #f8f8fb 52%, #f1f1f5 100%);
  box-shadow:
    0 40px 80px -40px rgba(0, 0, 0, 0.3),
    0 20px 40px -30px rgba(0, 0, 0, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.95),
    inset 0 0 0 1px rgba(0, 0, 0, 0.05);
  color: #1c1c1e;

  --mp-text: #1c1c1e;
  --mp-text-2: rgba(60, 60, 67, 0.6);
  --mp-text-3: rgba(60, 60, 67, 0.33);
  --mp-bg: #f5f5f7;
  --mp-bg-elevated: #ffffff;
  --mp-bg-secondary: #ececf1;
  --mp-fill: rgba(120, 120, 128, 0.12);
  --mp-fill-strong: rgba(120, 120, 128, 0.2);
  --mp-separator: rgba(60, 60, 67, 0.08);
  --mp-frosted-bg: rgba(255, 255, 255, 0.72);
  --mp-frosted-border: rgba(255, 255, 255, 0.6);
}

html[data-theme='light'] .mcd-name {
  color: #1c1c1e;
}

html[data-theme='light'] .mcd-meta {
  color: rgba(60, 60, 67, 0.45);
}

html[data-theme='light'] .mcd-close {
  border-color: rgba(0, 0, 0, 0.08);
  background: rgba(0, 0, 0, 0.05);
  color: rgba(60, 60, 67, 0.7);
}

html[data-theme='light'] .mcd-close:active {
  background: rgba(0, 0, 0, 0.1);
}
</style>
