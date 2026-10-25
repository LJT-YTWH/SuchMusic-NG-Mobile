<script setup lang="ts">
import { useLibraryLayout } from '../composables/useLibraryLayout'

/** 横屏曲库浏览方式切换（列表 ↔ Cover Flow），仅在横屏显示 */
const { isLandscape, isCoverFlow, toggleMode } = useLibraryLayout()
</script>

<template>
  <button
    v-if="isLandscape"
    class="layout-toggle"
    type="button"
    :aria-label="isCoverFlow ? '切换为列表视图' : '切换为 Cover Flow 视图'"
    :title="isCoverFlow ? '列表视图' : 'Cover Flow'"
    @click="toggleMode"
  >
    <svg v-if="isCoverFlow" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="4.2" rx="1.4" />
      <rect x="3.5" y="11.2" width="17" height="4.2" rx="1.4" />
      <rect x="3.5" y="17.4" width="17" height="2.6" rx="1.3" />
    </svg>
    <svg v-else viewBox="0 0 24 24" aria-hidden="true">
      <rect x="8.6" y="4.4" width="8.6" height="15.2" rx="2" />
      <path d="M6.2 6.4 3.6 8.2v7.6l2.6 1.8" />
      <path d="m17.8 6.4 2.6 1.8v7.6l-2.6 1.8" />
    </svg>
  </button>
</template>

<style scoped>
.layout-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--mp-fill);
  color: var(--mp-text);
  transition:
    transform 0.16s cubic-bezier(0.32, 0.72, 0.35, 1),
    background 0.16s ease;
}

.layout-toggle:active {
  transform: scale(0.9);
  background: var(--mp-fill-strong);
}

.layout-toggle svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
