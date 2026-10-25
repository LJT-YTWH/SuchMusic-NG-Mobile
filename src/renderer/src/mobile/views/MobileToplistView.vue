<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { NSpin } from 'naive-ui'
import { fetchToplists, type ToplistItem } from '../../apis/netease/playlist/toplist'
import MobileCover from '../components/MobileCover.vue'
import MobileCoverFlow, { type CoverFlowItem } from '../components/MobileCoverFlow.vue'
import LayoutModeToggle from '../components/LayoutModeToggle.vue'
import { useLibraryLayout } from '../composables/useLibraryLayout'

const router = useRouter()
const loading = ref(true)
const official = ref<ToplistItem[]>([])
const others = ref<ToplistItem[]>([])

// 横屏 Cover Flow 模式
const { useCoverFlowNow } = useLibraryLayout()

const flowItems = computed<CoverFlowItem[]>(() =>
  [...official.value, ...others.value].map((item) => ({
    id: item.id,
    title: item.name,
    subtitle: item.updateFrequency || '每日更新',
    cover: item.coverImgUrl,
    badge: item.updateFrequency || ''
  }))
)

const flowActive = computed(() => useCoverFlowNow.value && !loading.value && flowItems.value.length > 0)

const onFlowSelect = (item: CoverFlowItem): void => {
  open(Number(item.id))
}

onMounted(async () => {
  try {
    const list = await fetchToplists()
    official.value = list.slice(0, 4)
    others.value = list.slice(4)
  } finally {
    loading.value = false
  }
})

const open = (id: number): void => {
  router.push(`/online-playlist/${id}`)
}
</script>

<template>
  <div class="mp-page" :class="{ 'cf-mode': flowActive }">
    <div class="mp-header mp-rise">
      <div>
        <div class="mp-title">排行榜</div>
        <div class="mp-sub">官方榜单一手掌握</div>
      </div>
      <div class="header-side">
        <LayoutModeToggle />
      </div>
    </div>

    <!-- 横屏 Cover Flow：3D 封面流浏览榜单 -->
    <MobileCoverFlow
      v-if="flowActive"
      :items="flowItems"
      label="排行榜"
      eyebrow="TOP LIST"
      :start-index="2"
      @select="onFlowSelect"
    />

    <div v-else-if="loading" class="mp-loading"><n-spin size="medium" /></div>

    <div v-else class="mp-scroll">
      <!-- 官方榜：大圆角分组卡片 -->
      <div class="mp-section mp-rise" style="--mp-rise-delay: 0.05s">
        <span class="mp-section-title">官方榜</span>
      </div>
      <div class="mp-list official-list mp-rise" style="--mp-rise-delay: 0.1s">
        <div
          v-for="item in official"
          :key="item.id"
          class="official-item mp-press"
          @click="open(item.id)"
        >
          <MobileCover :src="item.coverImgUrl" class="official-cover" />
          <div class="official-info">
            <div class="official-name">{{ item.name }}</div>
            <div class="official-freq">{{ item.updateFrequency || '每日更新' }}</div>
          </div>
          <i class="mgc_right_line official-arrow"></i>
        </div>
      </div>

      <!-- 精选榜 -->
      <div class="mp-section mp-rise" style="--mp-rise-delay: 0.15s">
        <span class="mp-section-title">精选榜</span>
      </div>
      <div class="mp-grid mp-rise" style="--mp-rise-delay: 0.2s">
        <div v-for="item in others" :key="item.id" class="mp-imgcard" @click="open(item.id)">
          <div class="img-wrap">
            <MobileCover :src="item.coverImgUrl" radius="0" />
            <span v-if="item.updateFrequency" class="img-badge img-badge-bl">{{ item.updateFrequency }}</span>
          </div>
          <div class="img-name">{{ item.name }}</div>
        </div>
      </div>
      <div class="mp-bottom-space"></div>
    </div>
  </div>
</template>

<style scoped>
/* Cover Flow 使用透明背景，直接沿用页面主题色（不再铺深色舞台） */

.official-list {
  display: flex;
  flex-direction: column;
  padding: 4px;
}

.official-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--mp-r-md);
}

.official-cover {
  width: 64px;
  height: 64px;
  flex-shrink: 0;
  box-shadow: var(--mp-shadow-sm);
}

.official-info {
  flex: 1;
  min-width: 0;
}

.official-name {
  font-size: var(--mp-font-body);
  font-weight: 600;
  color: var(--mp-text);
}

.official-freq {
  font-size: 12px;
  color: var(--mp-text-2);
  margin-top: 3px;
}

.official-arrow {
  color: var(--mp-text-3);
  font-size: 15px;
}
</style>
