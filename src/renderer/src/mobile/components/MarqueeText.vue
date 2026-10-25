<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

/**
 * 单行文本跑马灯
 *
 * 只有文本宽度超过容器时才滚动：复制一份文本、用 CSS 动画把整组平移 -50%，
 * 首尾相接、无跳帧；未溢出时保持静态，不产生任何持续动画开销。
 */
const props = withDefaults(
  defineProps<{
    text?: string
    /** 滚动速度（px/s），默认 34 */
    speed?: number
  }>(),
  { text: '', speed: 34 }
)

const wrapRef = ref<HTMLElement | null>(null)
const innerRef = ref<HTMLElement | null>(null)
const scrolling = ref(false)
const duration = ref(10)

let observer: ResizeObserver | null = null

function measure(): void {
  const wrap = wrapRef.value
  const inner = innerRef.value
  if (!wrap) return

  const textEl = inner?.querySelector<HTMLElement>('.mq-text')
  if (!textEl) {
    scrolling.value = false
    return
  }

  // 用 Range 精确量文本本身（不含右侧间距），避免误判溢出
  const range = document.createRange()
  range.selectNodeContents(textEl)
  const textWidth = range.getBoundingClientRect().width
  const overflow = textWidth > wrap.clientWidth + 1
  scrolling.value = overflow
  if (overflow) {
    duration.value = Math.max(6, Math.round((textWidth + 40) / Math.max(10, props.speed)))
  }
}

watch(
  () => props.text,
  () => nextTick(measure)
)

onMounted(() => {
  void nextTick(measure)
  // 字体加载完成后文本宽度会变，再量一次，避免该滚却不滚
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    void document.fonts.ready.then(() => measure())
  }
  if (typeof ResizeObserver !== 'undefined' && wrapRef.value) {
    observer = new ResizeObserver(() => measure())
    observer.observe(wrapRef.value)
  }
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})
</script>

<template>
  <div ref="wrapRef" class="mq" :class="{ 'is-scrolling': scrolling }">
    <div ref="innerRef" class="mq-inner" :style="{ '--mq-duration': `${duration}s` }">
      <span class="mq-text">{{ text }}</span>
      <span v-if="scrolling" class="mq-text" aria-hidden="true">{{ text }}</span>
    </div>
  </div>
</template>

<style scoped>
.mq {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}

.mq-inner {
  display: inline-flex;
  width: max-content;
  will-change: transform;
}

.mq-text {
  flex: none;
  padding-right: 40px;
}

/* 溢出时匀速左移；两份等宽文本 + 相同间距，-50% 正好无缝衔接 */
.mq.is-scrolling .mq-inner {
  animation: mq-move var(--mq-duration, 10s) linear infinite;
}

@keyframes mq-move {
  to {
    transform: translateX(-50%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .mq.is-scrolling .mq-inner {
    animation: none;
  }
}
</style>
