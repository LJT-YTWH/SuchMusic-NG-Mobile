<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NSpin } from 'naive-ui'
import {
  fetchPlaylistDetail,
  fetchPlaylistTracks,
  type OnlinePlaylistDetail
} from '../../apis/netease/playlist/detail'
import { mapNeteaseTrack, playSongs, formatPlayCount, type NeteaseTrack } from '../helpers'
import type { PlayerSong } from '../../stores/playerStore'
import { usePlayerStore } from '../../stores/playerStore'
import MobileSongRow from '../components/MobileSongRow.vue'
import MobileCover from '../components/MobileCover.vue'
import defaultCover from '@renderer/assets/icon.png'

const route = useRoute()
const router = useRouter()
const player = usePlayerStore()

const loading = ref(true)
const detail = ref<OnlinePlaylistDetail | null>(null)
const songs = ref<PlayerSong[]>([])

const playlistId = computed(() => String(route.params.id || ''))

onMounted(async () => {
  try {
    const [d, tracks] = await Promise.all([
      fetchPlaylistDetail(playlistId.value),
      fetchPlaylistTracks<NeteaseTrack>(playlistId.value, 500)
    ])
    detail.value = d
    songs.value = tracks.map(mapNeteaseTrack)
  } finally {
    loading.value = false
  }
})

const playAll = (): void => {
  playSongs(songs.value, 0, 'search')
}

const playAt = (song: PlayerSong): void => {
  const idx = songs.value.findIndex((s) => s.id === song.id)
  playSongs(songs.value, idx, 'search')
}
</script>

<template>
  <div class="mp-page detail-page">
    <!-- 头部：封面全幅拉伸 + 毛玻璃模糊 -->
    <div class="header">
      <img :src="detail?.coverImgUrl || defaultCover" class="header-bg" alt="" />
      <div class="header-mask"></div>
      <button class="back-btn" @click="router.back()">
        <i class="mgc_arrow_left_line"></i>
      </button>
      <div class="header-content">
        <MobileCover :src="detail?.coverImgUrl" class="cover" radius="var(--mp-r-lg, 28px)" />
        <div class="meta">
          <div class="name">{{ detail?.name || '歌单' }}</div>
          <div class="sub">
            <span v-if="detail?.creator?.nickname">{{ detail.creator.nickname }}</span>
            <span v-if="detail?.playCount"> · {{ formatPlayCount(detail.playCount) }}次播放</span>
          </div>
          <div v-if="detail?.trackCount" class="sub">{{ detail.trackCount }} 首</div>
        </div>
      </div>
    </div>

    <!-- 播放全部 -->
    <div class="play-all mp-press" @click="playAll">
      <span class="play-icon"><i class="mgc_play_fill"></i></span>
      <span class="play-text">播放全部</span>
      <span class="play-count">({{ songs.length }})</span>
    </div>

    <div v-if="loading" class="mp-loading"><n-spin size="medium" /></div>

    <div v-else class="mp-scroll">
      <div class="mp-list list-card" v-if="songs.length">
        <MobileSongRow
          v-for="(song, i) in songs"
          :key="song.id ?? i"
          :song="song"
          :index="i"
          show-index
          :playing="player.currentSong?.id === song.id"
          @click="playAt"
        >
          <template #action><span></span></template>
        </MobileSongRow>
      </div>
      <div class="bottom-pad"></div>
    </div>
  </div>
</template>

<style scoped>
.detail-page {
  background: var(--mp-bg);
}

.header {
  position: relative;
  overflow: hidden;
  padding: 12px 20px 26px;
  padding-top: calc(48px + var(--sat, 0px));
}

.header-bg {
  position: absolute;
  inset: -40px;
  width: calc(100% + 80px);
  height: calc(100% + 80px);
  object-fit: cover;
  filter: blur(40px) saturate(1.5) brightness(0.8);
  -webkit-filter: blur(40px) saturate(1.5) brightness(0.8);
  transform: translateZ(0);
}

.header-mask {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(10, 10, 14, 0.42), rgba(10, 10, 14, 0.56));
}

.back-btn {
  position: absolute;
  top: calc(10px + var(--sat, 0px));
  left: 12px;
  z-index: 2;
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: rgba(255, 255, 255, 0.16);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-radius: 50%;
  color: #fff;
  font-size: 19px;
  padding: 0;
  transition:
    transform 0.15s cubic-bezier(0.32, 0.72, 0.35, 1),
    opacity 0.15s ease;
}

.back-btn:active {
  transform: scale(0.88);
  opacity: 0.8;
}

.header-content {
  position: relative;
  z-index: 1;
  display: flex;
  gap: 16px;
  align-items: center;
}

.cover {
  width: 116px;
  height: 116px;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.1);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
}

.meta {
  flex: 1;
  min-width: 0;
}

.name {
  color: #fff;
  font-size: 17px;
  font-weight: 700;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.25);
}

.sub {
  color: rgba(255, 255, 255, 0.72);
  font-size: 12px;
  margin-top: 6px;
}

.play-all {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 13px 20px;
  background: var(--mp-bg);
  border-bottom: 0.5px solid var(--mp-separator);
}

.play-icon {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--mp-primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  box-shadow: 0 4px 10px color-mix(in srgb, var(--mp-primary) 32%, transparent);
}

.play-text {
  font-size: var(--mp-font-body);
  font-weight: 600;
  color: var(--mp-text);
}

.play-count {
  font-size: var(--mp-font-sub);
  color: var(--mp-text-3);
}

.list-card {
  margin-top: 12px;
}

/* 沉浸式页（底栏隐藏）底部仅避让安全区 */
.bottom-pad {
  height: calc(20px + var(--sab, 0px));
  flex-shrink: 0;
}
</style>
