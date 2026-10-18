<script setup lang="ts">
import { ref, onMounted } from 'vue'
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

const router = useRouter()
const PAGE_SIZE = 30

const categories = ref<PlaylistCategory[]>([])
const activeCat = ref('全部')
const playlists = ref<TopPlaylistItem[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const hasMore = ref(true)

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
  <div class="mp-page">
    <div class="mp-header mp-rise">
      <div>
        <div class="mp-title">歌单广场</div>
        <div class="mp-sub">发现你的下一张心动歌单</div>
      </div>
    </div>

    <!-- 分类栏 -->
    <div class="mp-chipbar">
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

    <div class="mp-scroll" @scroll="onScroll">
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
