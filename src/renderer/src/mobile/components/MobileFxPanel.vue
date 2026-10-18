<script setup lang="ts">
import { ref, computed } from 'vue'
import { NSwitch, NSlider } from 'naive-ui'
import { useSettingsStore } from '../../stores/settingsStore'
import { FX_FEATURES, useAdvancedFx, type FxFeatureId } from '../../composables/useAdvancedFx'

// 高级音效面板：功能列表 → 单项详细配置，含恢复默认
// inSheet：置于播放页底部弹层（竖屏需限高防溢出）；设置页/横屏抽屉由外层滚动，不限高
withDefaults(defineProps<{ inSheet?: boolean }>(), { inSheet: false })

const settingsStore = useSettingsStore()
const { isEnabled, toggleFeature, statusText, confirmReset } = useAdvancedFx()

// 当前进入详细配置的功能（null = 功能列表）
const activeFeature = ref<FxFeatureId | null>(null)

const activeMeta = computed(() => FX_FEATURES.find((f) => f.id === activeFeature.value) || null)

const openDetail = (id: FxFeatureId): void => {
  activeFeature.value = id
}

const backToList = (): void => {
  activeFeature.value = null
}
</script>

<template>
  <div class="fx-panel" :class="{ 'in-sheet': inSheet }">
    <!-- ============ 功能列表 ============ -->
    <template v-if="!activeFeature">
      <div class="fx-head">
        <span class="fx-title">高级音效</span>
        <span class="fx-reset" @click="confirmReset">恢复默认</span>
      </div>
      <div class="fx-tip">开启任意功能后，在线音乐将先下载到缓存再播放</div>
      <div class="fx-list">
        <div
          v-for="f in FX_FEATURES"
          :key="f.id"
          class="fx-row"
          @click="openDetail(f.id)"
        >
          <span class="fx-row-icon"><i :class="f.icon"></i></span>
          <span class="fx-row-name">{{ f.name }}</span>
          <span class="fx-row-status" :class="{ on: statusText(f.id) !== '关闭' }">
            {{ statusText(f.id) }}
          </span>
          <i class="mgc_right_line fx-row-arrow"></i>
        </div>
      </div>
    </template>

    <!-- ============ 单项详细配置 ============ -->
    <template v-else-if="activeMeta">
      <div class="fx-head">
        <button class="fx-back" @click="backToList">
          <i class="mgc_left_line"></i>
        </button>
        <span class="fx-title">{{ activeMeta.name }}</span>
        <n-switch
          :value="isEnabled(activeMeta.id)"
          @update:value="toggleFeature(activeMeta.id, $event)"
        />
      </div>
      <div class="fx-desc">{{ activeMeta.desc }}</div>

      <div class="fx-detail-body" :class="{ off: statusText(activeMeta.id) === '关闭' }">
        <!-- 变速播放 -->
        <template v-if="activeMeta.id === 'rate'">
          <div class="fx-slider-row">
            <span class="fx-slider-label">播放速度</span>
            <span class="fx-slider-value">{{ settingsStore.advancedFx.playbackRate.toFixed(2) }}×</span>
          </div>
          <n-slider
            :value="settingsStore.advancedFx.playbackRate"
            :min="0.5"
            :max="2"
            :step="0.05"
            :tooltip="false"
            @update:value="settingsStore.advancedFx.playbackRate = $event"
          />
          <div class="fx-marks-abs">
            <span style="left: 0">0.5×</span><span style="left: 33.33%">1.0×</span
            ><span style="left: 100%">2.0×</span>
          </div>
          <div class="fx-sub-row">
            <span class="fx-slider-label">保持音调</span>
            <n-switch
              :value="settingsStore.advancedFx.preservePitch"
              size="small"
              @update:value="settingsStore.advancedFx.preservePitch = $event"
            />
          </div>
          <div class="fx-note">保持音调仅对流式播放有效；本地解码播放变速时音调会随之变化</div>
        </template>

        <!-- 响度均衡 -->
        <template v-else-if="activeMeta.id === 'loudness'">
          <div class="fx-slider-row">
            <span class="fx-slider-label">均衡强度</span>
            <span class="fx-slider-value">{{ Math.round(settingsStore.advancedFx.loudnessStrength * 100) }}%</span>
          </div>
          <n-slider
            :value="settingsStore.advancedFx.loudnessStrength * 100"
            :min="0"
            :max="100"
            :step="5"
            :tooltip="false"
            @update:value="settingsStore.advancedFx.loudnessStrength = $event / 100"
          />
        </template>

        <!-- 声像平衡 -->
        <template v-else-if="activeMeta.id === 'balance'">
          <div class="fx-slider-row">
            <span class="fx-slider-label">左右偏移</span>
            <span class="fx-slider-value">{{ statusText('balance') }}</span>
          </div>
          <n-slider
            :value="settingsStore.advancedFx.balance * 100"
            :min="-100"
            :max="100"
            :step="5"
            :tooltip="false"
            @update:value="settingsStore.advancedFx.balance = $event / 100"
          />
          <div class="fx-rate-marks">
            <span>左</span><span>居中</span><span>右</span>
          </div>
        </template>

        <!-- 立体声扩展 -->
        <template v-else-if="activeMeta.id === 'width'">
          <div class="fx-slider-row">
            <span class="fx-slider-label">声场宽度</span>
            <span class="fx-slider-value">{{ Math.round(settingsStore.advancedFx.stereoWidth * 100) }}%</span>
          </div>
          <n-slider
            :value="settingsStore.advancedFx.stereoWidth * 100"
            :min="0"
            :max="200"
            :step="5"
            :tooltip="false"
            @update:value="settingsStore.advancedFx.stereoWidth = $event / 100"
          />
          <div class="fx-rate-marks">
            <span>窄</span><span>原始</span><span>宽</span>
          </div>
        </template>

        <!-- 交叉淡入淡出 -->
        <template v-else-if="activeMeta.id === 'crossfade'">
          <div class="fx-slider-row">
            <span class="fx-slider-label">淡入淡出时长</span>
            <span class="fx-slider-value">{{ settingsStore.advancedFx.crossfadeSeconds }} 秒</span>
          </div>
          <n-slider
            :value="settingsStore.advancedFx.crossfadeSeconds"
            :min="1"
            :max="12"
            :step="1"
            :tooltip="false"
            @update:value="settingsStore.advancedFx.crossfadeSeconds = $event"
          />
          <div class="fx-marks-abs">
            <span style="left: 0">1s</span><span style="left: 45.45%">6s</span
            ><span style="left: 100%">12s</span>
          </div>
        </template>

        <!-- 人声消除 -->
        <template v-else-if="activeMeta.id === 'vocalRemoval'">
          <div class="fx-note">
            开启后自动削弱立体声歌曲中居中的人声，可直接作为伴奏跟唱；对单声道音频无效，部分歌曲可能有轻微残留。
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.fx-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.fx-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 20px 12px;
}

.fx-title {
  flex: 1;
  font-size: var(--mp-font-headline, 17px);
  font-weight: 700;
  color: var(--mp-text, #1c1c1e);
}

.fx-reset {
  font-size: 13px;
  color: var(--mp-danger, #ff3b30);
  padding: 4px 2px;
}

.fx-reset:active {
  opacity: 0.6;
}

.fx-back {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
  background: var(--mp-fill, rgba(120, 120, 128, 0.12));
  color: var(--mp-text, #1c1c1e);
  font-size: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  flex-shrink: 0;
}

.fx-tip {
  padding: 0 20px 10px;
  font-size: 11.5px;
  color: var(--mp-text-3, rgba(60, 60, 67, 0.33));
}

.fx-desc {
  padding: 0 20px 12px;
  font-size: 12px;
  color: var(--mp-text-2, rgba(60, 60, 67, 0.6));
  line-height: 1.5;
}

.fx-list {
  padding: 0 14px 10px;
}

/* 仅「竖屏底部弹层」场景限高：弹层 max-height 78vh 且 overflow hidden，
   不限高会裁掉列表尾部；设置页（页面流）与横屏抽屉由外层容器滚动，不限高 */
.fx-panel.in-sheet .fx-list {
  overflow-y: auto;
  max-height: 52vh;
}

@media (orientation: landscape) {
  .fx-panel.in-sheet .fx-list {
    max-height: none;
    overflow-y: visible;
  }

  /* 横屏抽屉无拖把手柄，标题需更大顶部留白（与 .sheet-title 一致） */
  .fx-panel.in-sheet .fx-head {
    padding-top: 16px;
  }
}

.fx-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 12px;
  border-radius: var(--mp-r-md, 20px);
}

.fx-row:active {
  background: var(--mp-fill, rgba(120, 120, 128, 0.12));
}

.fx-row-icon {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--mp-fill, rgba(120, 120, 128, 0.12));
  color: var(--mp-primary, #2c8efd);
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.fx-row-name {
  flex: 1;
  font-size: 15px;
  color: var(--mp-text, #1c1c1e);
}

.fx-row-status {
  font-size: 12.5px;
  color: var(--mp-text-3, rgba(60, 60, 67, 0.33));
  font-variant-numeric: tabular-nums;
}

.fx-row-status.on {
  color: var(--mp-primary, #2c8efd);
}

.fx-row-arrow {
  font-size: 14px;
  color: var(--mp-text-3, rgba(60, 60, 67, 0.33));
}

.fx-detail-body {
  padding: 0 20px 8px;
  transition: opacity 0.2s ease;
}

.fx-detail-body.off {
  opacity: 0.4;
  pointer-events: none;
}

.fx-slider-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2px;
}

.fx-slider-label {
  font-size: 14px;
  color: var(--mp-text, #1c1c1e);
}

.fx-slider-value {
  font-size: 13px;
  color: var(--mp-primary, #2c8efd);
  font-variant-numeric: tabular-nums;
}

.fx-rate-marks {
  display: flex;
  justify-content: space-between;
  font-size: 10.5px;
  color: var(--mp-text-3, rgba(60, 60, 67, 0.33));
  margin-top: 2px;
}

/* 按数值比例精确定位的刻度（用于刻度点不在轨道中点的滑块，如 0.5-2.0 倍速） */
.fx-marks-abs {
  position: relative;
  height: 14px;
  font-size: 10.5px;
  color: var(--mp-text-3, rgba(60, 60, 67, 0.33));
  margin-top: 2px;
}

.fx-marks-abs span {
  position: absolute;
  transform: translateX(-50%);
  white-space: nowrap;
}

.fx-marks-abs span:first-child {
  transform: none;
}

.fx-marks-abs span:last-child {
  transform: translateX(-100%);
}

.fx-sub-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 14px;
}

.fx-note {
  margin-top: 10px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--mp-text-3, rgba(60, 60, 67, 0.33));
}
</style>
