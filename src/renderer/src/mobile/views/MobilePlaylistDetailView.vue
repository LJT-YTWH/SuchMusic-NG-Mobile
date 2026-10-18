<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NEmpty, useMessage } from 'naive-ui'
import { usePlaylistStore, type PlaylistTrack } from '../../stores/playlistStore'
import { usePlayerStore, type PlayerSong } from '../../stores/playerStore'
import { useLocalMusicStore, type LocalSong } from '../../stores/localMusicStore'
import MobileSongRow from '../components/MobileSongRow.vue'
import MobileCover from '../components/MobileCover.vue'
import defaultCover from '@renderer/assets/icon.png'

const route = useRoute()
const router = useRouter()
const playlistStore = usePlaylistStore()
const player = usePlayerStore()
const localStore = useLocalMusicStore()
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
  if (idx < 0) return
  player.setPlaylist(songs.value)
  player.playSongAtIndex(idx)
  player.setPlayerPageShown(true)
}

function trackOf(s: PlayerSong): PlaylistTrack {
  return {
    id: s.id,
    title: s.title,
    artist: s.artist,
    album: s.album,
    cover: s.cover,
    filePath: s.filePath,
    durationMs: s.durationMs,
    source: s.source,
    sourceSongId: s.sourceSongId
  }
}

// ==================== 添加歌曲 ====================

const showAddSongs = ref(false)
const songFilter = ref('')

const localSongs = computed<PlayerSong[]>(() => {
  const kw = songFilter.value.trim().toLowerCase()
  return localStore.songs
    .filter(
      (s: LocalSong) =>
        !kw ||
        s.name?.toLowerCase().includes(kw) ||
        s.ar?.some((a) => a.name?.toLowerCase().includes(kw)) ||
        s.al?.name?.toLowerCase().includes(kw)
    )
    .map((s: LocalSong) => ({
      id: s.id,
      title: s.name,
      artist: s.ar?.map((a) => a.name).join(' / ') || '未知歌手',
      album: s.al?.name || '',
      cover: s.picUrl || '',
      durationMs: s.dt || 0,
      filePath: s.filePath,
      source: 'local',
      sourceSongId: s.id
    }))
})

function openAddSongs(): void {
  if (!localStore.songs.length) void localStore.scanMusic()
  songFilter.value = ''
  showAddSongs.value = true
}

function isInPlaylist(s: PlayerSong): boolean {
  if (!playlist.value) return false
  return playlistStore.isTrackInPlaylist(playlist.value.id, trackOf(s))
}

function addSong(s: PlayerSong): void {
  if (!playlist.value) return
  const r = playlistStore.addTrackToPlaylist(playlist.value.id, trackOf(s))
  if (r === 'added') message.success(`已添加「${s.title}」`)
  else if (r === 'exists') message.info('这首歌已在歌单中')
}

// ==================== 行操作：移动 / 移除 ====================

const rowActionSong = ref<PlayerSong | null>(null)
const showMovePicker = ref(false)

const otherPlaylists = computed(() =>
  playlistStore.playlists.filter((p) => p.id !== playlist.value?.id)
)

function openRowAction(song: PlayerSong): void {
  rowActionSong.value = song
}

function removeTrack(): void {
  const s = rowActionSong.value
  if (!s || !playlist.value) return
  playlistStore.removeTrackFromPlaylist(playlist.value.id, trackOf(s))
  rowActionSong.value = null
  message.success('已从歌单移除')
}

function moveTo(targetId: string): void {
  const s = rowActionSong.value
  if (!s || !playlist.value) return
  const target = playlistStore.playlists.find((p) => p.id === targetId)
  const r = playlistStore.moveTrackToPlaylist(trackOf(s), playlist.value.id, targetId)
  if (r === 'moved') message.success(`已移动到「${target?.name || '歌单'}」`)
  else if (r === 'exists') message.info('目标歌单中已有这首歌')
  else message.error('移动失败')
  showMovePicker.value = false
  rowActionSong.value = null
}
</script>

<template>
  <!-- 单一根节点：<Transition mode="out-in"> 要求元素根，否则页面切换会卡住变空白 -->
  <div class="mp-page detail-page">
    <template v-if="playlist">
      <!-- 头部：封面全幅拉伸 + 毛玻璃模糊（与歌单广场详情一致） -->
      <div class="header">
        <img :src="bgCover" class="header-bg" alt="" />
        <div class="header-mask"></div>
        <button class="back-btn" @click="router.back()">
          <i class="mgc_arrow_left_line"></i>
        </button>
        <button class="add-btn" aria-label="添加歌曲" @click="openAddSongs">
          <i class="mgc_add_line"></i>
        </button>
        <div class="header-content">
          <MobileCover :src="cover" class="cover" radius="var(--mp-r-lg, 28px)" />
          <div class="meta">
            <div class="name">{{ playlist.name }}</div>
            <div class="sub">{{ playlist.tracks.length }} 首 · 本地歌单</div>
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
            @action="openRowAction"
          >
            <template #action>
              <i class="mgc_more_2_line row-more"></i>
            </template>
          </MobileSongRow>
        </div>
        <n-empty
          v-if="!songs.length"
          description="歌单还没有歌曲"
          style="padding: 60px 0"
        />
        <div class="bottom-pad"></div>
      </div>
    </template>

    <div v-else class="not-found">
      <n-empty description="未找到歌单" />
      <span class="back-link" @click="router.push('/playlist')">返回我的歌单</span>
    </div>

    <!-- 弹层：行操作 / 移动到歌单 / 添加歌曲 -->
    <Teleport to="body">
    <div v-if="rowActionSong && !showMovePicker" class="mp-sheet-mask" @click="rowActionSong = null"></div>
    <div v-if="rowActionSong && !showMovePicker" class="mp-sheet">
      <div class="sheet-grabber"></div>
      <div class="sheet-title">{{ rowActionSong.title }}</div>
      <div class="action-list">
        <div class="action-item" @click="showMovePicker = true">
          <i class="mgc_transfer_line"></i>
          <span>移动到其他歌单</span>
        </div>
        <div class="action-item" @click="removeTrack">
          <i class="mgc_delete_2_line danger-icon"></i>
          <span class="danger-text">从歌单移除</span>
        </div>
        <div class="action-item cancel" @click="rowActionSong = null">
          <span>取消</span>
        </div>
      </div>
    </div>

    <div v-if="showMovePicker" class="mp-sheet-mask" @click="showMovePicker = false"></div>
    <div v-if="showMovePicker" class="mp-sheet">
      <div class="sheet-grabber"></div>
      <div class="sheet-title">移动到歌单</div>
      <div class="action-list">
        <div v-for="pl in otherPlaylists" :key="pl.id" class="action-item" @click="moveTo(pl.id)">
          <i :class="pl.id === 'favorite' ? 'mgc_heart_fill' : 'mgc_playlist_line'"></i>
          <span class="action-flex">{{ pl.name }}</span>
          <span class="pl-count">{{ pl.tracks.length }} 首</span>
        </div>
        <div v-if="!otherPlaylists.length" class="sheet-tip">还没有其他歌单</div>
        <div class="action-item cancel" @click="showMovePicker = false">
          <span>取消</span>
        </div>
      </div>
    </div>

    <div v-if="showAddSongs" class="mp-sheet-mask" @click="showAddSongs = false"></div>
    <div v-if="showAddSongs" class="mp-sheet add-songs-sheet">
      <div class="sheet-grabber"></div>
      <div class="sheet-title">添加歌曲</div>
      <div class="add-filter">
        <i class="mgc_search_line"></i>
        <input v-model="songFilter" placeholder="搜索本地歌曲" />
      </div>
      <div class="add-song-list">
        <div v-for="s in localSongs" :key="String(s.id)" class="add-song-row" @click="addSong(s)">
          <MobileCover :src="s.cover" class="add-cover" radius="10px" />
          <div class="add-main">
            <div class="add-title">{{ s.title }}</div>
            <div class="add-sub">{{ s.artist }}</div>
          </div>
          <i v-if="isInPlaylist(s)" class="mgc_check_fill add-done"></i>
          <i v-else class="mgc_add_line add-icon"></i>
        </div>
        <n-empty v-if="!localSongs.length" description="暂无本地歌曲" style="padding: 40px 0" />
      </div>
    </div>
    </Teleport>
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

.row-more {
  color: var(--mp-text-3);
  font-size: 18px;
}

/* 沉浸式页（底栏隐藏）底部仅避让安全区 */
.bottom-pad {
  height: calc(20px + var(--sab, 0px));
  flex-shrink: 0;
}

.not-found {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px 0;
}

.back-link {
  color: var(--mp-primary);
  font-size: 14px;
  font-weight: 600;
}

/* ===== 弹层通用（与播放页更多菜单一致） ===== */
.action-list {
  padding: 0 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}

.action-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border-radius: var(--mp-r-md, 20px);
  background: var(--mp-fill);
  color: var(--mp-text);
  font-size: 15px;
}

.action-item i {
  font-size: 20px;
  color: var(--mp-primary);
}

.action-item:active {
  opacity: 0.7;
}

.action-item.cancel {
  justify-content: center;
  font-weight: 600;
  margin-top: 4px;
}

.action-item .action-flex {
  flex: 1;
}

.sheet-tip {
  font-size: 11.5px;
  color: var(--mp-text-3);
  padding: 2px 6px;
}

/* ===== 头部：添加歌曲 ===== */
.add-btn {
  position: absolute;
  top: calc(10px + var(--sat, 0px));
  right: 12px;
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
}

.add-btn:active {
  transform: scale(0.88);
  opacity: 0.8;
}

/* ===== 歌单弹层通用 ===== */
.pl-count {
  font-size: 12px;
  color: var(--mp-text-3);
  margin-left: auto;
}

.danger-text {
  color: var(--mp-danger, #ff453a);
}

.action-item .danger-icon {
  color: var(--mp-danger, #ff453a);
}

/* ===== 添加歌曲 ===== */
.add-filter {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 18px 10px;
  padding: 0 14px;
  height: 42px;
  border-radius: 14px;
  background: var(--mp-fill);
  color: var(--mp-text-3);
  font-size: 17px;
}

.add-filter input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 14px;
  color: var(--mp-text);
}

.add-song-list {
  max-height: 46vh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  padding: 0 12px 16px;
}

/* ===== 横屏：弹层变为右侧抽屉（height:100%），列表必须撑满剩余高度并独立滚动 ===== */
@media (orientation: landscape) {
  /* 横屏头部内边距是固定 14px，按钮顶部与之对齐（不叠状态栏高度） */
  .add-btn {
    top: 12px;
  }

  /* 覆盖全局抽屉的 overflow-y，避免"外层滚动 + 内层滚动"嵌套导致列表被压扁 */
  body.is-mobile .mp-sheet.add-songs-sheet {
    overflow: hidden;
  }

  .add-songs-sheet .add-song-list {
    flex: 1;
    min-height: 0;
    max-height: none;
    padding-bottom: calc(16px + var(--sab, 0px));
  }

  /* 抽屉内左右留白略收窄，窄条下多留一点内容宽度 */
  .add-songs-sheet .add-filter {
    margin: 0 14px 10px;
  }

  .add-songs-sheet .add-song-list {
    padding-left: 8px;
    padding-right: 8px;
  }

  .add-song-row {
    padding: 7px 4px;
  }
}

.add-song-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 6px;
  border-radius: 12px;
}

.add-song-row:active {
  background: var(--mp-fill);
}

.add-cover {
  width: 42px;
  height: 42px;
  flex-shrink: 0;
}

.add-main {
  flex: 1;
  min-width: 0;
}

.add-title {
  font-size: 14.5px;
  font-weight: 500;
  color: var(--mp-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.add-sub {
  font-size: 12px;
  color: var(--mp-text-2);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.add-icon {
  color: var(--mp-text-3);
  font-size: 20px;
  flex-shrink: 0;
}

.add-done {
  color: var(--mp-success, #30d158);
  font-size: 20px;
  flex-shrink: 0;
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
