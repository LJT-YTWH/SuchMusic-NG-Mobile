<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

/**
 * 竖屏播放页的卡片式弹层。
 * 按产品要求：不做「从按钮展开」的形变动画，直接以卡片形式弹出（轻微淡入），
 * 关闭也直接收起，减少动画开销。
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

const rendered = ref(false)
const entered = ref(false)
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
  }, 160)
}

function requestClose(): void {
  emit('update:show', false)
}

watch(
  () => props.show,
  (v) => {
    if (v) open()
    else if (rendered.value) close()
  },
  { immediate: true }
)

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
    <div v-if="rendered" class="mmc-mask" :class="{ on: entered }" @click="requestClose"></div>

    <section
      v-if="rendered"
      class="mmc-surface"
      :class="{ open: entered }"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
    >
      <div class="mmc-face">
        <header class="mmc-head" :class="{ bare: !title && !meta }">
          <div v-if="title || meta" class="mmc-heading">
            <span class="mmc-name">{{ title }}</span>
            <span v-if="meta" class="mmc-meta">{{ meta }}</span>
          </div>
          <button class="mmc-close" type="button" aria-label="收起" @click="requestClose">
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path d="m6 6 8 8M14 6l-8 8" />
            </svg>
          </button>
        </header>

        <div class="mmc-body">
          <slot />
        </div>
      </div>
    </section>
  </Teleport>
</template>

<style scoped>
.mmc-mask {
  position: fixed;
  inset: 0;
  z-index: 2380;
  background: rgba(0, 0, 0, 0.46);
  opacity: 0;
  transition: opacity 140ms ease;
  -webkit-tap-highlight-color: transparent;
}

.mmc-mask.on {
  opacity: 1;
}

/* 固定尺寸卡片，直接弹出，不做形变 */
.mmc-surface {
  position: fixed;
  left: 50%;
  top: 50%;
  z-index: 2381;
  display: flex;
  flex-direction: column;
  width: min(452px, calc(100vw - 40px));
  height: min(620px, calc(100dvh - 96px));
  min-height: 320px;
  box-sizing: border-box;
  border-radius: 34px;
  overflow: hidden;
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
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.985);
  transition:
    opacity 140ms ease,
    transform 160ms cubic-bezier(0.22, 1, 0.36, 1);

  /* 深色卡片内的移动端设计令牌：让内部沿用 mp-* 变量的内容自动适配 */
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

.mmc-surface.open {
  opacity: 1;
  transform: translate(-50%, -50%) scale(1);
}

.mmc-face {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  padding: 18px 18px calc(14px + var(--sab, 0px));
}

.mmc-head {
  display: flex;
  flex: 0 0 auto;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 2px 4px 10px;
}

/* 内容自带标题时（均衡器 / 高级音效），卡片头只保留关闭按钮 */
.mmc-head.bare {
  justify-content: flex-end;
  padding-bottom: 4px;
}

.mmc-heading {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.mmc-name {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: #f7f7f3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mmc-meta {
  font-size: 9.5px;
  font-weight: 500;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.36);
}

.mmc-close {
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
  transition: transform 0.16s ease;
}

.mmc-close svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
}

.mmc-close:active {
  transform: scale(0.9);
}

.mmc-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}

/* 内部沿用底栏弹层的结构，卡片自身滚动时取消内层滚动约束 */
.mmc-body :deep(.action-list),
.mmc-body :deep(.sheet-scroll),
.mmc-body :deep(.add-song-list),
.mmc-body :deep(.dl-list) {
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
.mmc-body :deep(.ai-panel),
.mmc-body :deep(.new-pl-form),
.mmc-body :deep(.lyric-search-bar),
.mmc-body :deep(.dl-song),
.mmc-body :deep(.lyric-preview-song),
.mmc-body :deep(.dl-actions),
.mmc-body :deep(.dl-hint),
.mmc-body :deep(.lyric-preview-actions),
.mmc-body :deep(.eq-head),
.mmc-body :deep(.fx-head) {
  padding-left: 2px;
  padding-right: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .mmc-mask,
  .mmc-surface {
    transition-duration: 1ms !important;
  }
}
</style>
