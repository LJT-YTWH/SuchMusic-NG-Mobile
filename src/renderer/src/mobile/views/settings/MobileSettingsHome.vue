<script setup lang="ts">
import { useRouter } from 'vue-router'
import { settingsGroups as groups } from './settingsGroups'

// 设置首页：大标题 + 分组入口列表（点击进入对应子页）
// 横屏下为「左导航坞 + 右列表」双栏，点击选项后推入新界面（同样双栏）
const router = useRouter()
</script>

<template>
  <div class="mp-page">
    <div class="mp-header mp-rise">
      <div class="header-row">
        <button class="back-btn" aria-label="返回" @click="router.back()">
          <i class="mgc_arrow_left_line"></i>
        </button>
        <div class="mp-title">设置</div>
      </div>
    </div>

    <div class="mp-scroll">
      <div class="settings-list">
        <div
          v-for="(group, gi) in groups"
          :key="gi"
          class="mp-cell-group mp-rise"
          :style="{ '--mp-rise-delay': `${0.05 + gi * 0.06}s` }"
        >
          <div
            v-for="item in group.items"
            :key="item.key"
            class="mp-cell"
            @click="router.push(`/settings/${item.key}`)"
          >
            <span class="cell-icon" :style="{ background: item.gradient }">
              <i :class="item.icon"></i>
            </span>
            <div class="cell-main">
              <div class="cell-title">{{ item.label }}</div>
              <div class="cell-sub">{{ item.sub }}</div>
            </div>
            <i class="mgc_right_line cell-arrow"></i>
          </div>
        </div>

        <div class="version mp-rise" :style="{ '--mp-rise-delay': `${0.05 + groups.length * 0.06}s` }">
          SuchMusic for Android · v0.2.0
        </div>
        <div class="mp-bottom-space"></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.header-row {
  display: flex;
  align-items: center;
  gap: 12px;
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
  flex-shrink: 0;
  transition:
    transform 0.15s cubic-bezier(0.32, 0.72, 0.35, 1),
    background 0.15s ease;
}

.back-btn:active {
  transform: scale(0.88);
  background: var(--mp-fill-strong);
}

.version {
  text-align: center;
  color: var(--mp-text-3);
  font-size: var(--mp-font-caption);
  padding: 28px 0 10px;
}

/* 横屏：列表限宽居中，避免在大屏上过度拉伸 */
@media (orientation: landscape) {
  .settings-list {
    max-width: 720px;
    margin: 0 auto;
  }
}
</style>
