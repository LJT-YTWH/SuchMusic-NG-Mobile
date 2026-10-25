<script setup lang="ts">
import type { LibraryLayoutMode } from '../composables/useLibraryLayout'

defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  (e: 'choose', mode: LibraryLayoutMode): void
  (e: 'postpone'): void
}>()
</script>

<template>
  <Teleport to="body">
    <Transition name="lp">
      <div v-if="show" class="lp-mask" @click="emit('postpone')">
        <div class="lp-card" role="dialog" aria-modal="true" aria-label="选择横屏浏览方式" @click.stop>
          <header class="lp-head">
            <div class="lp-heading">
              <span class="lp-eyebrow">LANDSCAPE · LIBRARY</span>
              <h2 class="lp-title">横屏怎么逛歌单？</h2>
              <p class="lp-desc">
                横屏打开歌单、专辑、排行榜时，选一种你更喜欢的浏览方式。之后可在页面右上角随时切换。
              </p>
            </div>
            <button class="lp-skip" type="button" aria-label="稍后再说" @click="emit('postpone')">
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" /></svg>
            </button>
          </header>

          <div class="lp-options">
            <button class="lp-option" type="button" @click="emit('choose', 'list')">
              <span class="lp-preview preview-list" aria-hidden="true">
                <span class="row"><i class="thumb" /><i class="line" /></span>
                <span class="row"><i class="thumb" /><i class="line" /></span>
                <span class="row"><i class="thumb" /><i class="line" /></span>
              </span>
              <span class="lp-option-copy">
                <span class="lp-option-name">传统列表</span>
                <span class="lp-option-sub">信息更密集，一屏看更多</span>
              </span>
            </button>

            <button class="lp-option" type="button" @click="emit('choose', 'coverflow')">
              <span class="lp-preview preview-flow" aria-hidden="true">
                <i class="cover c1" />
                <i class="cover c2" />
                <i class="cover c3" />
              </span>
              <span class="lp-option-copy">
                <span class="lp-option-name">
                  Cover Flow
                  <span class="lp-badge">新</span>
                </span>
                <span class="lp-option-sub">3D 封面流，横滑专辑墙</span>
              </span>
            </button>
          </div>

          <footer class="lp-foot">
            <button class="lp-later" type="button" @click="emit('postpone')">稍后再说</button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.lp-mask {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(6, 7, 10, 0.52);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.lp-card {
  width: min(560px, 100%);
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  padding: 20px 22px 16px;
  border-radius: 28px;
  background:
    radial-gradient(120% 150% at 8% -20%, rgba(255, 255, 255, 0.14), transparent 52%),
    linear-gradient(155deg, #23252a 0%, #14151a 56%, #0a0b0e 100%);
  border: 0.5px solid rgba(255, 255, 255, 0.14);
  box-shadow:
    0 40px 90px -40px rgba(0, 0, 0, 0.7),
    inset 0 1px 0 rgba(255, 255, 255, 0.12);
  color: #fff;
  box-sizing: border-box;
}

.lp-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.lp-heading {
  min-width: 0;
}

.lp-eyebrow {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.2em;
  color: rgba(255, 255, 255, 0.38);
}

.lp-title {
  margin: 8px 0 0;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #f7f7f3;
}

.lp-desc {
  margin: 8px 0 0;
  font-size: 12.5px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.52);
  max-width: 420px;
}

.lp-skip {
  display: grid;
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.66);
}

.lp-skip svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
}

.lp-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 18px;
}

.lp-option {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.045);
  color: #fff;
  text-align: left;
  transition:
    transform 0.2s cubic-bezier(0.32, 0.72, 0, 1),
    border-color 0.2s ease,
    background-color 0.2s ease;
}

.lp-option:active {
  transform: scale(0.98);
  border-color: rgba(59, 155, 255, 0.5);
  background: rgba(59, 155, 255, 0.12);
}

.lp-preview {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  height: 84px;
  padding: 10px;
  border-radius: 14px;
  overflow: hidden;
  background: linear-gradient(155deg, #1c1e23, #0d0e11);
  box-sizing: border-box;
}

.preview-list .row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.preview-list .thumb {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: linear-gradient(145deg, #3b9bff, #2b6cff);
  opacity: 0.85;
}

.preview-list .line {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.18);
}

.preview-list .row:nth-child(2) .line {
  width: 70%;
  flex: none;
}

.preview-flow {
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 0;
  perspective: 240px;
}

.preview-flow .cover {
  width: 38px;
  height: 52px;
  border-radius: 3px;
  background: linear-gradient(150deg, #3b9bff, #1b3f8f);
  box-shadow: 0 6px 14px rgba(0, 0, 0, 0.5);
}

.preview-flow .c1 {
  transform: translateX(10px) rotateY(42deg) scale(0.86);
  opacity: 0.6;
}

.preview-flow .c2 {
  z-index: 2;
  width: 42px;
  height: 58px;
  background: linear-gradient(150deg, #f3f1ec, #b9c4d6);
}

.preview-flow .c3 {
  transform: translateX(-10px) rotateY(-42deg) scale(0.86);
  opacity: 0.6;
}

.lp-option-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.lp-option-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: #f5f6f8;
}

.lp-badge {
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(59, 155, 255, 0.18);
  color: #8cc4ff;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.06em;
}

.lp-option-sub {
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.42);
  line-height: 1.4;
}

.lp-foot {
  display: flex;
  justify-content: center;
  margin-top: 12px;
}

.lp-later {
  padding: 8px 18px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgba(255, 255, 255, 0.46);
  font-size: 12.5px;
}

.lp-enter-active,
.lp-leave-active {
  transition: opacity 0.26s ease;
}

.lp-enter-active .lp-card,
.lp-leave-active .lp-card {
  transition: transform 0.34s cubic-bezier(0.22, 1, 0.36, 1);
}

.lp-enter-from,
.lp-leave-to {
  opacity: 0;
}

.lp-enter-from .lp-card,
.lp-leave-to .lp-card {
  transform: translateY(12px) scale(0.96);
}

@media (max-width: 560px) {
  .lp-options {
    grid-template-columns: minmax(0, 1fr);
  }

  .lp-preview {
    height: 72px;
  }
}
</style>
