<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NEmpty, useMessage } from 'naive-ui'
import { usePlaylistStore, type PlaylistTrack } from '../../stores/playlistStore'
import { usePlayerStore, type PlayerSong } from '../../stores/playerStore'
import MobileSongRow from '../components/MobileSongRow.vue'
import MobileCover from '../components/MobileCover.vue'
import defaultCover from '@renderer/assets/icon.png'

const route = useRoute()
const router = useRouter()
const playlistStore = usePlaylistStore()
const player = usePlayerStore()
const message = useMessage()

onMounted(() => {
  playlistStore.loadFromStorage()
})

const playlist = computed(() =>
  playlistStore.playlists.find((p) => p.id === String(route.params.id))
)

const cover = computed(() => {
  if (!playlist.value) return ''
  return playlist.value.cover || playlist.value.tracks[0]?.cover || ''
})

const bgCover = computed(() => cover.value || defaultCover)

function mapTrack(t: PlaylistTrack): PlayerSong {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist || '未知歌手',
    album: t.album || '',
    cover: t.cover || '',
    durationMs: t.durationMs || 0,
    filePath: t.filePath,
    source: t.source,
    sourceSongId: t.sourceSongId
  }
}

const songs = computed<PlayerSong[]>(() => (playlist.value?.tracks || []).map(mapTrack))

const playAll = (): void => {
  if (!songs.value.length) return
  player.setPlaylist(songs.value)
  player.playSongAtIndex(0)
  player.setPlayerPageShown(true)
}

const playAt = (song: PlayerSong): void => {
  const idx = songs.value.findIndex((s) => String(s.id) === String(song.id))
  player.setPlaylist(songs.value)
  player.playSongAtIndex(idx)
  player.setPlayerPageShown(true)
}

function removeTrack(song: PlayerSong): void {
  if (!playlist.value) return
  playlistStore.updatePlaylist({
    ...playlist.value,
    tracks: playlist.value.tracks.filter((t) => String(t.id) !== String(song.id))
  })
  message.success('已移除')
}
</script>

<template>
  <div v-if="playlist" class="mp-page detail-page">
    <!-- 头部：封面拉伸 + 毛玻璃 -->
    <div class="header">
      <img :src="bgCover" class="header-bg" alt="" />
      <div class="header-mask"></div>
      <button class="back-btn" @click="router.back()">
        <i class="mgc_arrow_left_line"></i>
      </button>
      <div class="header-content">
        <div class="cover-wrap" :class="{ favorite: playlist.id === 'favorite' }">
          <i v-if="playlist.id === 'favorite'" class="mgc_heart_fill fav-icon"></i>
          <MobileCover v-else :src="cover" radius="0" />
        </div>
        <div class="meta">
          <div class="name">{{ playlist.name }}</div>
          <div class="sub">{{ playlist.tracks.length }} 首</div>
        </div>
      </div>
    </div>

    <!-- 播放全部 -->
    <div class="play-all mp-press" @click="playAll">
      <span class="play-icon"><i class="mgc_play_fill"></i></span>
      <span class="play-text">播放全部</span>
      <span class="play-count">({{ songs.length }})</span>
    </div>

    <div class="mp-scroll">
      <div class="mp-list list-card" v-if="songs.length">
        <MobileSongRow
          v-for="(song, i) in songs"
          :key="`${song.id}-${i}`"
          :song="song"
          :index="i"
          show-index
          :playing="String(player.currentSong?.id) === String(song.id)"
          @click="playAt"
          @action="removeTrack"
        >
          <template #action>
            <i class="mgc_close_line row-del"></i>
          </template>
        </MobileSongRow>
      </div>
      <n-empty v-if="!songs.length" description="歌单还没有歌曲" style="padding: 60px 0" />
      <div class="mp-bottom-space"></div>
    </div>
  </div>

  <div v-else class="not-found">
    <n-empty description="未找到歌单" />
    <span class="back-link" @click="router.push('/playlist')">返回我的歌单</span>
  </div>
</template>

<style scoped>
.detail-page {
  background: var(--mp-bg);
}

.header {
  position: relative;
  overflow: hidden;
  padding: 12px 20px 24px;
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
  background: linear-gradient(180deg, rgba(10, 10, 14, 0.42), rgba(10, 10, 14, 0.54));
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

.cover-wrap {
  width: 108px;
  height: 108px;
  border-radius: var(--mp-r-lg);
  overflow: hidden;
  background: rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
}

.cover-wrap.favorite {
  background: linear-gradient(135deg, #ff7eb3, #ff375f);
}

.cover {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.fav-icon {
  color: #fff;
  font-size: 38px;
}

.meta {
  flex: 1;
  min-width: 0;
}

.name {
  color: #fff;
  font-size: 18px;
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

.row-del {
  color: var(--mp-text-3);
  font-size: 16px;
}

.not-found {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.back-link {
  color: var(--mp-primary);
  font-size: 14px;
}
</style>
