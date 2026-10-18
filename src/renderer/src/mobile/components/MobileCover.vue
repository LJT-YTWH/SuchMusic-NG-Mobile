<script setup lang="ts">
import { ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    src?: string
    radius?: string
    round?: boolean
  }>(),
  { src: '', radius: 'var(--mp-r-sm, 14px)', round: false }
)

const failed = ref(false)
watch(
  () => props.src,
  () => {
    failed.value = false
  }
)
</script>

<template>
  <div
    class="mp-cover"
    :class="{ 'is-round': round }"
    :style="round ? {} : { borderRadius: radius }"
  >
    <img v-if="src && !failed" :src="src" loading="lazy" alt="" @error="failed = true" />
    <!-- 无封面占位：渐变底 + 音乐 SVG 图标 -->
    <div v-else class="mp-cover-fallback">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M9 18.5V6.8c0-.5.35-.93.84-1.05l8.8-1.96A1 1 0 0 1 20 4.77v11.4"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <circle
          cx="6.6"
          cy="18.4"
          r="2.6"
          stroke="currentColor"
          stroke-width="1.7"
        />
        <circle
          cx="17.4"
          cy="16.2"
          r="2.6"
          stroke="currentColor"
          stroke-width="1.7"
        />
      </svg>
    </div>
  </div>
</template>

<style scoped>
.mp-cover {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--mp-bg-secondary, #ececf1);
}

.mp-cover.is-round {
  border-radius: 50%;
}

.mp-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.mp-cover-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--mp-primary, #2c8efd) 16%, var(--mp-bg-secondary, #ececf1)) 0%,
    var(--mp-bg-secondary, #ececf1) 70%
  );
}

.mp-cover-fallback svg {
  width: 42%;
  height: 42%;
  color: color-mix(in srgb, var(--mp-primary, #2c8efd) 55%, var(--mp-text-3, #b0b0b5));
}
</style>
