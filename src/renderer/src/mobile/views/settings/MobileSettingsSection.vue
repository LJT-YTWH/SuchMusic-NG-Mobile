<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { settingsPanels, settingsTitles } from './panels'
import AppearancePanel from './panels/AppearancePanel.vue'

// 设置分组子页（薄壳）：顶部返回导航 + 对应分组面板
// 横屏下为「左导航坞 + 右内容」双栏，内容限宽居中
const route = useRoute()
const router = useRouter()

const section = computed(() => String(route.params.section || ''))
const panel = computed(() => settingsPanels[section.value] || AppearancePanel)
const title = computed(() => settingsTitles[section.value] || '设置')
</script>

<template>
  <div class="mp-page">
    <div class="nav-bar">
      <button class="back-btn" @click="router.back()">
        <i class="mgc_arrow_left_line"></i>
      </button>
      <span class="nav-title">{{ title }}</span>
      <span class="nav-placeholder"></span>
    </div>

    <div class="mp-scroll">
      <div class="section-body">
        <component :is="panel" :key="section" />
        <div class="safe-bottom"></div>
      </div>
    </div>
  </div>
</template>

<style>
@import './panels/settingsPanels.css';
</style>

<style scoped>
.nav-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(12px + var(--sat, 0px)) 16px 8px;
  flex-shrink: 0;
}

.back-btn {
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: var(--mp-fill);
  color: var(--mp-text);
  font-size: 18px;
  padding: 0;
  transition:
    transform 0.15s cubic-bezier(0.32, 0.72, 0.35, 1),
    background 0.15s ease;
}

.back-btn:active {
  transform: scale(0.88);
  background: var(--mp-fill-strong);
}

.nav-title {
  font-size: var(--mp-font-headline);
  font-weight: 700;
  color: var(--mp-text);
}

.nav-placeholder {
  width: 36px;
}

.safe-bottom {
  height: calc(28px + var(--sab, 0px));
  flex-shrink: 0;
}

/* 横屏：内容限宽居中，保持双栏（导航坞 + 内容）视觉平衡 */
@media (orientation: landscape) {
  .section-body {
    max-width: 820px;
    margin: 0 auto;
  }
}
</style>
