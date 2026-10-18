<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { NSpin } from 'naive-ui'
import { fetchTopPlaylists, type TopPlaylistItem } from '../../apis/netease/playlist/top-playlist'
import { fetchToplists, type ToplistItem } from '../../apis/netease/playlist/toplist'
import { formatPlayCount } from '../helpers'
import MobileCover from '../components/MobileCover.vue'
import { useLandscape } from '../composables/useLandscape'

const router = useRouter()
const { isLandscape } = useLandscape()
const loading = ref(true)
const playlists = ref<TopPlaylistItem[]>([])
const toplists = ref<ToplistItem[]>([])

const greeting = (): string => {
  const h = new Date().getHours()
  if (h < 6) return '夜深了'
  if (h < 12) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

// 功能入口（鸿蒙风格：圆形单色图标 + 文字，无卡片背景）
const entries = [
  { label: '最近播放', icon: 'mgc_history_line', path: '/recent' },
  { label: '本地音乐', icon: 'mgc_folder_2_line', path: '/local' },
  { label: '我的收藏', icon: 'mgc_heart_fill', path: '/playlist/favorite' },
  { label: '歌单广场', icon: 'mgc_compass_line', path: '/playlist-square' }
]

onMounted(async () => {
  try {
    const [pl, tl] = await Promise.all([
      fetchTopPlaylists('全部', 20).catch(() => []),
      fetchToplists().catch(() => [])
    ])
    playlists.value = pl
    toplists.value = tl
  } finally {
    loading.value = false
  }
})

const openPlaylist = (id: number): void => {
  router.push(`/online-playlist/${id}`)
}
</script>

<template>
  <!-- ==================== 竖屏：单列纵向流 ==================== -->
  <div v-if="!isLandscape" class="mp-page">
    <div class="mp-scroll">
      <!-- 问候头部 -->
      <div class="home-head mp-rise">
        <div class="home-hello">{{ greeting() }}</div>
        <div class="home-sub">今天想听点什么？</div>
      </div>

      <!-- 搜索胶囊 -->
      <div class="search-pill mp-rise mp-press" style="--mp-rise-delay: 0.04s" @click="router.push('/search')">
        <i class="mgc_search_line"></i>
        <span>搜索歌曲、歌手、歌单</span>
      </div>

      <!-- 功能入口 -->
      <div class="entries mp-rise" style="--mp-rise-delay: 0.08s">
        <div
          v-for="e in entries"
          :key="e.path"
          class="entry mp-press"
          @click="router.push(e.path)"
        >
          <span class="entry-icon">
            <i :class="e.icon"></i>
          </span>
          <span class="entry-label">{{ e.label }}</span>
        </div>
      </div>

      <div v-if="loading" class="mp-loading"><n-spin size="medium" /></div>

      <template v-else>
        <!-- 推荐歌单 -->
        <div class="mp-section mp-rise" style="--mp-rise-delay: 0.12s">
          <span class="mp-section-title">推荐歌单</span>
          <span class="mp-section-more" @click="router.push('/playlist-square')">
            更多 <i class="mgc_right_line"></i>
          </span>
        </div>
        <div class="mp-hscroll mp-rise" style="--mp-rise-delay: 0.16s">
          <div
            v-for="item in playlists"
            :key="item.id"
            class="pl-card mp-press"
            @click="openPlaylist(item.id)"
          >
            <div class="pl-cover">
              <MobileCover :src="item.coverImgUrl" radius="0" />
              <span v-if="item.playCount" class="pl-badge">
                <i class="mgc_play_line"></i>{{ formatPlayCount(item.playCount) }}
              </span>
            </div>
            <div class="pl-name">{{ item.name }}</div>
          </div>
        </div>

        <!-- 排行榜 -->
        <div class="mp-section mp-rise" style="--mp-rise-delay: 0.2s">
          <span class="mp-section-title">排行榜</span>
          <span class="mp-section-more" @click="router.push('/toplist')">
            更多 <i class="mgc_right_line"></i>
          </span>
        </div>
        <div class="mp-hscroll mp-rise" style="--mp-rise-delay: 0.24s">
          <div
            v-for="item in toplists.slice(0, 12)"
            :key="item.id"
            class="pl-card mp-press"
            @click="openPlaylist(item.id)"
          >
            <div class="pl-cover">
              <MobileCover :src="item.coverImgUrl" radius="0" />
              <span v-if="item.updateFrequency" class="pl-badge pl-badge-bl">{{ item.updateFrequency }}</span>
            </div>
            <div class="pl-name">{{ item.name }}</div>
          </div>
        </div>

        <div class="mp-bottom-space"></div>
      </template>
    </div>
  </div>

  <!-- ==================== 横屏：通栏流式布局 ==================== -->
  <div v-else class="mp-page home-land">
    <div class="land-scroll">
      <!-- 问候头部 -->
      <div class="home-head">
        <div class="home-hello">{{ greeting() }}</div>
        <div class="home-sub">今天想听点什么？</div>
      </div>

      <!-- 功能入口：横向胶囊按钮 -->
      <div class="entries-land">
        <div
          v-for="e in entries"
          :key="e.path"
          class="entry-pill mp-press"
          @click="router.push(e.path)"
        >
          <span class="entry-icon">
            <i :class="e.icon"></i>
          </span>
          <span class="entry-label">{{ e.label }}</span>
        </div>
      </div>

      <div v-if="loading" class="mp-loading"><n-spin size="medium" /></div>

      <template v-else>
        <!-- 推荐歌单 -->
        <div class="mp-section">
          <span class="mp-section-title">推荐歌单</span>
          <span class="mp-section-more" @click="router.push('/playlist-square')">
            更多 <i class="mgc_right_line"></i>
          </span>
        </div>
        <div class="pl-grid">
          <div
            v-for="item in playlists.slice(0, 12)"
            :key="item.id"
            class="pl-card mp-press"
            @click="openPlaylist(item.id)"
          >
            <div class="pl-cover">
              <MobileCover :src="item.coverImgUrl" radius="0" />
              <span v-if="item.playCount" class="pl-badge">
                <i class="mgc_play_line"></i>{{ formatPlayCount(item.playCount) }}
              </span>
            </div>
            <div class="pl-name">{{ item.name }}</div>
          </div>
        </div>

        <!-- 排行榜 -->
        <div class="mp-section">
          <span class="mp-section-title">排行榜</span>
          <span class="mp-section-more" @click="router.push('/toplist')">
            更多 <i class="mgc_right_line"></i>
          </span>
        </div>
        <div class="pl-grid">
          <div
            v-for="item in toplists.slice(0, 12)"
            :key="item.id"
            class="pl-card mp-press"
            @click="openPlaylist(item.id)"
          >
            <div class="pl-cover">
              <MobileCover :src="item.coverImgUrl" radius="0" />
              <span v-if="item.updateFrequency" class="pl-badge pl-badge-bl">{{ item.updateFrequency }}</span>
            </div>
            <div class="pl-name">{{ item.name }}</div>
          </div>
        </div>

        <div class="mp-bottom-space"></div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* ==================== 问候头部 ==================== */
.home-head {
  padding: calc(20px + var(--sat, 0px)) 22px 0;
}

.home-hello {
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.4px;
  color: var(--mp-text);
}

.home-sub {
  font-size: 14px;
  color: var(--mp-text-2);
  margin-top: 5px;
}

/* ==================== 搜索胶囊 ==================== */
.search-pill {
  margin: 16px 20px 0;
  height: 44px;
  border-radius: 22px;
  background: var(--mp-fill);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  color: var(--mp-text-3);
  font-size: 14px;
  transition: background 0.15s ease;
}

.search-pill:active {
  background: var(--mp-fill-strong);
}

.search-pill i {
  font-size: 17px;
  /* 放大镜字形视觉重心偏右，微调居中 */
  transform: translateX(-0.5px);
}

/* ==================== 功能入口（竖屏横排 1×4） ==================== */
.entries {
  display: flex;
  justify-content: space-around;
  padding: 20px 12px 4px;
}

.entry {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: 68px;
}

.entry-icon {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 黑白灰单色：浅灰底 + 深色图标，深浅色主题自适应 */
  background: var(--mp-fill-strong);
  color: var(--mp-text);
  font-size: 23px;
}

.entry-icon i {
  display: block;
  width: 1em;
  text-align: center;
}

.entry-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--mp-text-2);
}

/* ==================== 歌单卡片 ==================== */
.pl-card {
  width: 128px;
  flex-shrink: 0;
}

.pl-cover {
  position: relative;
  border-radius: 18px;
  overflow: hidden;
  aspect-ratio: 1;
  background: var(--mp-fill);
}

.pl-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 3px 8px;
  border-radius: var(--mp-r-pill);
  background: rgba(0, 0, 0, 0.42);
  backdrop-filter: blur(8px);
  color: #fff;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}

.pl-badge i {
  font-size: 10px;
}

.pl-badge-bl {
  top: auto;
  right: auto;
  bottom: 6px;
  left: 6px;
}

.pl-name {
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.4;
  color: var(--mp-text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ==================== 横屏：通栏流式布局 ==================== */
.mp-page.home-land {
  overflow: hidden;
}

.land-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.home-land .home-head {
  padding-top: calc(16px + var(--sat, 0px));
}

/* 功能入口：2×2 网格胶囊按钮（圆角方形图标 + 文字） */
.entries-land {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
  padding: 18px 22px 0;
}

.entry-pill {
  min-width: 0;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 0 14px;
  background: var(--mp-bg-elevated);
  border-radius: var(--mp-r-pill);
  box-shadow: var(--mp-shadow-sm);
}

.entry-pill .entry-icon {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  font-size: 17px;
  flex-shrink: 0;
}

.entry-pill .entry-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--mp-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.home-land .mp-section {
  padding-top: 18px;
}

/* 横屏网格卡片：按可用宽度自适应列数，窄屏（手机横屏）不挤压 */
.pl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: 16px 12px;
  padding: 4px 18px 0;
}

.pl-grid .pl-card {
  width: auto;
  flex-shrink: 1;
}
</style>
