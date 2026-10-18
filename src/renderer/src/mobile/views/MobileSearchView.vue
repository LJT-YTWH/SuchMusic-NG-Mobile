<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NSpin, NEmpty } from 'naive-ui'
import { searchMusic, type GMASong, type GMAPlaylist } from '../../apis/gma'
import { useSettingsStore } from '../../stores/settingsStore'
import { usePlayerStore } from '../../stores/playerStore'
import { mapGmaSong, playSongs, platformLabel, formatPlayCount } from '../helpers'
import type { PlayerSong } from '../../stores/playerStore'
import MobileSongRow from '../components/MobileSongRow.vue'
import MobileCover from '../components/MobileCover.vue'

const route = useRoute()
const router = useRouter()
const settingsStore = useSettingsStore()
const player = usePlayerStore()

const keyword = ref(String(route.query.q || ''))
const searching = ref(false)
const searched = ref(false)
const activeTab = ref<'song' | 'playlist'>('song')
const songs = ref<PlayerSong[]>([])
const playlists = ref<GMAPlaylist[]>([])

const platforms = [
  { label: '全部', value: 'all' },
  { label: '网易云', value: 'wy' }
]
const activePlatform = ref('all')

async function doSearch(): Promise<void> {
  const kw = keyword.value.trim()
  if (!kw) return
  searching.value = true
  searched.value = true
  try {
    // 内置接口仅提供网易云数据，"全部"与"网易云"均按网易云检索
    const sources = ['wy']

    if (activeTab.value === 'song') {
      const res = await searchMusic(kw, 1, 30, sources, 'song')
      const mapped = res.songs
        .filter((s: GMASong) => !s.is_invalid)
        .map(mapGmaSong)
      const order = settingsStore.general.searchResultOrder || []
      if (order.length) {
        mapped.sort((a, b) => {
          const ia = order.indexOf(a.source || '')
          const ib = order.indexOf(b.source || '')
          return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
        })
      }
      songs.value = mapped
    } else {
      const res = await searchMusic(kw, 1, 30, sources, 'playlist')
      playlists.value = res.playlists
    }
  } catch (e) {
    console.error('搜索失败', e)
  } finally {
    searching.value = false
  }
}

function switchTab(tab: 'song' | 'playlist'): void {
  activeTab.value = tab
  if (keyword.value.trim()) void doSearch()
}

function selectPlatform(p: string): void {
  activePlatform.value = p
  if (keyword.value.trim()) void doSearch()
}

const playAt = (song: PlayerSong): void => {
  const idx = songs.value.findIndex((s) => String(s.id) === String(song.id))
  playSongs(songs.value, idx, 'search')
}

function openPlaylist(pl: GMAPlaylist): void {
  if (pl.source === 'wy' || pl.source === 'netease') {
    router.push(`/online-playlist/${pl.id}`)
  }
}

watch(
  () => route.query.q,
  (q) => {
    if (q && String(q) !== keyword.value) {
      keyword.value = String(q)
      void doSearch()
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="mp-page">
    <!-- 大标题 -->
    <div class="mp-header mp-rise">
      <div class="mp-title">搜索</div>
    </div>

    <!-- 搜索栏 -->
    <div class="search-head mp-rise" style="--mp-rise-delay: 0.05s">
      <div class="mp-input search-input">
        <i class="mgc_search_line"></i>
        <input
          v-model="keyword"
          placeholder="搜索歌曲、歌单"
          enterkeyhint="search"
          @keyup.enter="doSearch"
        />
        <i v-if="keyword" class="mgc_close_line clear" @click="keyword = ''"></i>
      </div>
      <span class="search-btn mp-press" @click="doSearch">搜索</span>
    </div>

    <!-- 平台筛选 -->
    <div class="mp-chipbar mp-rise" style="--mp-rise-delay: 0.1s">
      <span
        v-for="p in platforms"
        :key="p.value"
        class="mp-chip"
        :class="{ active: activePlatform === p.value }"
        @click="selectPlatform(p.value)"
      >
        {{ p.label }}
      </span>
    </div>

    <!-- 类型分段控制 -->
    <div class="mp-segment mp-rise" style="--mp-rise-delay: 0.14s">
      <span class="seg-item" :class="{ active: activeTab === 'song' }" @click="switchTab('song')">单曲</span>
      <span class="seg-item" :class="{ active: activeTab === 'playlist' }" @click="switchTab('playlist')">歌单</span>
    </div>

    <div class="mp-scroll">
      <div v-if="searching" class="mp-loading"><n-spin size="medium" /></div>

      <template v-else-if="activeTab === 'song'">
        <div class="mp-list" v-if="songs.length">
          <MobileSongRow
            v-for="(song, i) in songs"
            :key="`${song.source}-${song.id}-${i}`"
            :song="song"
            show-cover
            :playing="String(player.currentSong?.id) === String(song.id)"
            @click="playAt"
          >
            <template #action>
              <span class="source-tag">{{ platformLabel(song.source) }}</span>
            </template>
          </MobileSongRow>
        </div>
        <n-empty v-if="searched && !songs.length" description="没有找到相关歌曲" style="padding: 60px 0" />
      </template>

      <template v-else>
        <div class="mp-list" v-if="playlists.length">
          <div
            v-for="pl in playlists"
            :key="`${pl.source}-${pl.id}`"
            class="pl-row"
            @click="openPlaylist(pl)"
          >
            <MobileCover :src="pl.cover" class="pl-cover" />
            <div class="pl-main">
              <div class="pl-name">{{ pl.name }}</div>
              <div class="pl-sub">
                <span class="source-tag">{{ platformLabel(pl.source) }}</span>
                <span v-if="pl.trackCount">{{ pl.trackCount }}首</span>
                <span v-else-if="pl.playCount">{{ formatPlayCount(pl.playCount) }}次播放</span>
                <span v-if="pl.author?.name"> · {{ pl.author.name }}</span>
              </div>
            </div>
            <i class="mgc_right_line pl-arrow"></i>
          </div>
        </div>
        <n-empty v-if="searched && !playlists.length" description="没有找到相关歌单" style="padding: 60px 0" />
      </template>

      <n-empty v-if="!searched" description="输入关键词开始搜索" style="padding: 60px 0" />
      <div class="mp-bottom-space"></div>
    </div>
  </div>
</template>

<style scoped>
.search-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 20px 4px;
}

.search-input {
  flex: 1;
}

.search-input .clear {
  color: var(--mp-text-3);
  font-size: 16px;
}

.search-btn {
  color: var(--mp-primary);
  font-size: var(--mp-font-body);
  font-weight: 600;
  flex-shrink: 0;
}

.source-tag {
  font-size: 10px;
  color: var(--mp-text-2);
  background: var(--mp-fill);
  border-radius: 6px;
  padding: 2px 7px;
  flex-shrink: 0;
}

.pl-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 0.5px solid var(--mp-separator);
  transition: background 0.15s ease;
}

.pl-row:last-child {
  border-bottom: none;
}

.pl-row:active {
  background: var(--mp-fill);
}

.pl-cover {
  width: 54px;
  height: 54px;
  flex-shrink: 0;
  box-shadow: var(--mp-shadow-sm);
}

.pl-main {
  flex: 1;
  min-width: 0;
}

.pl-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--mp-text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.pl-sub {
  font-size: 12px;
  color: var(--mp-text-2);
  margin-top: 3px;
  display: flex;
  align-items: center;
  gap: 5px;
}

.pl-arrow {
  color: var(--mp-text-3);
  font-size: 15px;
  flex-shrink: 0;
}

/* ============ 横屏：搜索区限宽居中，结果列表由全局规则双列 ============ */
@media (orientation: landscape) {
  .search-head {
    max-width: 680px;
    width: 100%;
    margin: 0 auto;
    box-sizing: border-box;
  }
}
</style>
