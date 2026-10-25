<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { NSpin } from 'naive-ui'
import {
  fetchTopPlaylists,
  fetchPlaylistCategories,
  type TopPlaylistItem,
  type PlaylistCategory
} from '../../apis/netease/playlist/top-playlist'
import { formatPlayCount } from '../helpers'
import MobileCover from '../components/MobileCover.vue'
import MobileCoverFlow, { type CoverFlowItem } from '../components/MobileCoverFlow.vue'
import LayoutModeToggle from '../components/LayoutModeToggle.vue'
import { useLibraryLayout } from '../composables/useLibraryLayout'

const router = useRouter()
const PAGE_SIZE = 30

const categories = ref<PlaylistCategory[]>([])
const activeCat = ref('全部')
const playlists = ref<TopPlaylistItem[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const hasMore = ref(true)

// 横屏 Cover Flow 模式
const { useCoverFlowNow } = useLibraryLayout()

const flowItems = computed<CoverFlowItem[]>(() =>
  playlists.value.map((item) => ({
    id: item.id,
    title: item.name,
    subtitle: item.playCount ? `${formatPlayCount(item.playCount)} 次播放` : '歌单广场',
    cover: item.coverImgUrl,
    badge: formatPlayCount(item.playCount || 0)
  }))
)

const flowActive = computed(() => useCoverFlowNow.value && !loading.value && flowItems.value.length > 0)

const onFlowSelect = (item: CoverFlowItem): void => {
  router.push(`/online-playlist/${item.id}`)
}

const HOT_CATS = ['全部', '华语', '欧美', '日语', '韩语', '粤语', '流行', '摇滚', '民谣', '电子', '古风', '说唱', '轻音乐']

async function load(reset: boolean): Promise<void> {
  if (reset) {
    loading.value = true
    playlists.value = []
    hasMore.value = true
  } else {
    loadingMore.value = true
  }
  try {
    const offset = reset ? 0 : playlists.value.length
    const list = await fetchTopPlaylists(activeCat.value, PAGE_SIZE, offset)
    if (reset) {
      playlists.value = list
    } else {
      playlists.value = [...playlists.value, ...list]
    }
    hasMore.value = list.length >= PAGE_SIZE
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

function selectCat(cat: string): void {
  if (cat === activeCat.value) return
  activeCat.value = cat
  void load(true)
}

function onScroll(e: Event): void {
  const el = e.target as HTMLElement
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 400 && hasMore.value && !loadingMore.value && !loading.value) {
    void load(false)
  }
}

onMounted(async () => {
  void load(true)
  const res = await fetchPlaylistCategories()
  if (res?.sub) {
    const hot = res.sub.filter((c) => c.hot).slice(0, 14)
    categories.value = hot.length ? hot : []
  }
})
</script>

<template>
  <div class="mp-page" :class="{ 'cf-mode': flowActive }">
    <div class="mp-header mp-rise">
      <div>
        <div class="mp-title">歌单广场</div>
        <div class="mp-sub">发现你的下一张心动歌单</div>
      </div>
      <div class="header-side">
        <!-- 底栏改为 5 槽位（中间是封面）后，搜索入口在广场头部保留一个 -->
        <button class="mp-btn-icon" aria-label="搜索" @click="router.push('/search')">
          <i class="mgc_search_line"></i>
        </button>
        <LayoutModeToggle />
      </div>
    </div>

    <!-- 横屏 Cover Flow：3D 封面流逛歌单 -->
    <MobileCoverFlow
      v-if="flowActive"
      :items="flowItems"
      label="歌单广场"
      eyebrow="PLAYLIST"
      :start-index="1"
      @select="onFlowSelect"
    />

    <!-- Cover Flow 数据加载中 -->
    <div v-else-if="useCoverFlowNow" class="mp-loading"><n-spin size="medium" /></div>

    <!-- 分类栏（列表模式） -->
    <div v-else class="mp-chipbar">
      <span
        v-for="cat in categories.length ? categories.map((c) => c.name) : HOT_CATS"
        :key="cat"
        class="mp-chip"
        :class="{ active: activeCat === cat }"
        @click="selectCat(cat)"
      >
        {{ cat }}
      </span>
    </div>

    <div v-if="!useCoverFlowNow" class="mp-scroll" @scroll="onScroll">
      <div v-if="loading" class="mp-loading"><n-spin size="medium" /></div>
      <div v-else class="mp-grid">
        <div
          v-for="item in playlists"
          :key="item.id"
          class="mp-imgcard"
          @click="router.push(`/online-playlist/${item.id}`)"
        >
          <div class="img-wrap">
            <MobileCover :src="item.coverImgUrl" radius="0" />
            <span v-if="item.playCount" class="img-badge">
              <i class="mgc_play_line"></i>{{ formatPlayCount(item.playCount) }}
            </span>
          </div>
          <div class="img-name">{{ item.name }}</div>
        </div>
      </div>
      <div v-if="loadingMore" class="more-loading"><n-spin size="small" /></div>
      <div v-else-if="!hasMore && playlists.length" class="no-more">没有更多了</div>
      <div class="mp-bottom-space"></div>
    </div>
  </div>
</template>

<style scoped>
/* Cover Flow 使用透明背景，直接沿用页面主题色（不再铺深色舞台） */

.more-loading {
  display: flex;
  justify-content: center;
  padding: 16px;
}

.no-more {
  text-align: center;
  color: var(--mp-text-3);
  font-size: 12px;
  padding: 20px 0 10px;
}
</style>
