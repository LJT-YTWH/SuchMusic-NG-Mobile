<script setup lang="ts">
export interface LyricWord {
  text: string
  start: number
  end: number
}

/**
 * 单行歌词（独立组件）
 *
 * 性能关键：播放页的 activeIdx 每换行都会变化。若歌词行直接内联在播放页里，
 * 换行时整页模板（含逐字歌词的双层文本，动辄数千个节点）都要重新 diff。
 * 拆成子组件后，兄弟行 props 未变化，Vue 会直接跳过它们的渲染，
 * 每次换行只更新前后两行。
 */
defineProps<{
  text: string
  ttext?: string
  words?: LyricWord[]
  active?: boolean
  showTranslation?: boolean
}>()

const emit = defineEmits<{ (e: 'seek'): void }>()

function onClick(): void {
  emit('seek')
}
</script>

<template>
  <div class="lyric-line" :class="{ active }" @click="onClick">
    <div class="lyric-text">
      <template v-if="words && words.length">
        <template v-for="(w, wi) in words" :key="`${wi}-${w.start}`"
          ><span class="lyric-word"
            ><span class="lw-base">{{ w.text }}</span
            ><span class="lw-fill" aria-hidden="true">{{ w.text }}</span></span
          >&#8203;</template
        >
      </template>
      <template v-else>{{ text }}</template>
    </div>
    <div v-if="showTranslation && ttext" class="lyric-ttext">{{ ttext }}</div>
  </div>
</template>

<style scoped>
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

/* 布局尺寸恒等于激活尺寸（20px/700），非激活行用 transform: scale 视觉缩小。
   这样每句歌词的换行位置永远提前按放大后的最大字号算好，
   激活时只有 transform 变化，不会边放大边重排换行。 */
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

/* ============ 逐字歌词高亮（Apple Music 风格逐词填充） ============
   双层原生文本、像素级重合：底层为原文，上层为同一文本的高亮副本，
   按演唱进度 --p 裁剪显示 */
.lyric-word {
  position: relative;
  display: inline-block;
  white-space: pre;
}

/* 全局存在 *,*:before,*:after{font-weight:400} 的重置，会直接命中词/层元素
   并覆盖继承，导致逐字歌词字重变细；这里显式继承行字重 */
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
</style>
