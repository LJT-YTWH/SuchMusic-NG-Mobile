<script setup lang="ts">
// 逐字歌词生成全局遮罩：阻塞式生成时全屏转圈提示（可取消/最小化）；
// 最小化后变为顶部居中的悬浮提示（点击可还原）；后台生成时底部小胶囊
// 取消确认在遮罩内内联展示，避免系统对话框层级低于遮罩的问题
import { ref, watch } from 'vue'
import { NSpin } from 'naive-ui'
import {
  karaokeState,
  cancelGeneration,
  acceptKaraokePrompt,
  dismissKaraokePrompt
} from '../../utils/karaoke/karaokeService'

const confirming = ref(false)

// 生成结束/新任务开始时复位确认态
watch(
  () => karaokeState.blocking,
  (v) => {
    if (!v) confirming.value = false
  }
)

function onConfirmCancel(): void {
  confirming.value = false
  cancelGeneration()
}

function onMinimize(): void {
  karaokeState.minimized = true
}

function onRestore(): void {
  karaokeState.minimized = false
}
</script>

<template>
  <Teleport to="body">
    <!-- 询问：当前歌曲没有逐字歌词，是否生成 -->
    <div v-if="karaokeState.prompt && !karaokeState.generating" class="karaoke-gen-mask">
      <div class="karaoke-gen-box">
        <div class="karaoke-gen-title">生成逐字歌词？</div>
        <div class="karaoke-gen-note karaoke-prompt-song">
          《{{ karaokeState.prompt.title }}》还没有逐字歌词
        </div>
        <div class="karaoke-gen-actions">
          <button class="kg-btn" @click="dismissKaraokePrompt()">取消</button>
          <button class="kg-btn kg-primary" @click="acceptKaraokePrompt()">生成</button>
        </div>
      </div>
    </div>
    <!-- 阻塞式生成：全屏遮罩 -->
    <div v-if="karaokeState.blocking && !karaokeState.minimized" class="karaoke-gen-mask">
      <div class="karaoke-gen-box">
        <n-spin size="large" />
        <template v-if="!confirming">
          <div class="karaoke-gen-title">正在生成</div>
          <div class="karaoke-gen-note">生成需要 30~90 秒，请耐心等待</div>
          <div class="karaoke-gen-actions">
            <button class="kg-btn kg-cancel" @click="confirming = true">取消生成</button>
            <button class="kg-btn kg-minimize" @click="onMinimize">
              <i class="mgc_minimize_line"></i>最小化
            </button>
          </div>
        </template>
        <template v-else>
          <div class="karaoke-gen-title">取消生成？</div>
          <div class="karaoke-gen-note">确定要取消本次逐字歌词生成吗？</div>
          <div class="karaoke-gen-actions">
            <button class="kg-btn kg-cancel" @click="onConfirmCancel">确认取消</button>
            <button class="kg-btn" @click="confirming = false">继续等待</button>
          </div>
        </template>
      </div>
    </div>
    <!-- 最小化：顶部居中悬浮提示（安全区往下），点击还原 -->
    <div
      v-else-if="karaokeState.blocking && karaokeState.minimized"
      class="karaoke-gen-pill top"
      @click="onRestore"
    >
      <n-spin size="small" />
      <span>正在生成…</span>
    </div>
    <!-- 后台生成（边播放边生成）：底部小胶囊 -->
    <div v-else-if="karaokeState.generating" class="karaoke-gen-pill">
      <n-spin size="small" />
      <span>正在后台生成逐字歌词…</span>
    </div>
  </Teleport>
</template>

<style scoped>
.karaoke-gen-mask {
  position: fixed;
  inset: 0;
  z-index: 3000;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: karaoke-fade 0.22s ease;
}

.karaoke-gen-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 30px 36px 24px;
  border-radius: 24px;
  background: var(--mp-bg-elevated, #fff);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.3);
  max-width: 78vw;
}

.karaoke-gen-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--mp-text, #1c1c1e);
}

.karaoke-gen-note {
  font-size: 11.5px;
  color: var(--mp-text-3, rgba(60, 60, 67, 0.33));
}

.karaoke-gen-actions {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}

.kg-btn {
  border: none;
  border-radius: 999px;
  padding: 8px 18px;
  font-size: 13px;
  font-weight: 600;
  background: var(--mp-fill, rgba(120, 120, 128, 0.12));
  color: var(--mp-text, #1c1c1e);
  display: flex;
  align-items: center;
  gap: 5px;
}

.kg-btn:active {
  opacity: 0.7;
}

.kg-btn.kg-cancel {
  color: var(--mp-danger, #ff453a);
}

.kg-btn.kg-primary {
  background: var(--mp-primary, #2c8efd);
  color: #fff;
}

.karaoke-prompt-song {
  max-width: 62vw;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.kg-btn.kg-minimize i {
  font-size: 15px;
}

.karaoke-gen-pill {
  position: fixed;
  left: 50%;
  bottom: calc(86px + var(--sab, 0px));
  transform: translateX(-50%);
  z-index: 3000;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-radius: 999px;
  background: var(--mp-bg-elevated, #fff);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
  font-size: 12px;
  color: var(--mp-text, #1c1c1e);
  animation: karaoke-fade 0.25s ease;
}

/* 最小化后的顶部悬浮提示（安全区往下一点） */
.karaoke-gen-pill.top {
  top: calc(12px + var(--sat, 0px));
  bottom: auto;
}

@keyframes karaoke-fade {
  from {
    opacity: 0;
  }
}
</style>
