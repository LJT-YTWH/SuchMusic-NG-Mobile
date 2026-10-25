<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { NSpin, NEmpty, useMessage, useDialog } from 'naive-ui'
import { useLocalMusicStore, type LocalSong } from '../../stores/localMusicStore'
import { usePlayerStore, type PlayerSong } from '../../stores/playerStore'
import { usePlaylistStore, type PlaylistTrack } from '../../stores/playlistStore'
import MobileSongRow from '../components/MobileSongRow.vue'
import MobileCoverFlow, { type CoverFlowItem } from '../components/MobileCoverFlow.vue'
import LayoutModeToggle from '../components/LayoutModeToggle.vue'
import { useVirtualRows } from '../composables/useVirtualRows'
import { useLibraryLayout } from '../composables/useLibraryLayout'
import { useLandscape } from '../composables/useLandscape'

const localStore = useLocalMusicStore()
const player = usePlayerStore()
const playlistStore = usePlaylistStore()
const message = useMessage()
const dialog = useDialog()

const filter = ref('')
const scanning = computed(() => localStore.loading)

const songs = computed(() => {
  const kw = filter.value.trim().toLowerCase()
  if (!kw) return localStore.songs
  return localStore.songs.filter(
    (s) =>
      s.name?.toLowerCase().includes(kw) ||
      s.ar?.some((a) => a.name?.toLowerCase().includes(kw)) ||
      s.al?.name?.toLowerCase().includes(kw)
  )
})

function mapSong(s: LocalSong): PlayerSong {
  return {
    id: s.id,
    title: s.name,
    artist: s.ar?.map((a) => a.name).join(' / ') || '本地音乐',
    album: s.al?.name || '',
    cover: s.picUrl || '',
    durationMs: s.dt || 0,
    filePath: s.filePath,
    source: 'local',
    sourceSongId: s.id
  }
}

const playerSongs = computed(() => songs.value.map(mapSong))

// 长列表虚拟滚动：本地曲库可能上千首，仅渲染可视区域
// 横屏下列表是双列网格，虚拟滚动必须按「行」计算（每行 2 首）
const { isLandscape } = useLandscape()
const listColumns = computed(() => (isLandscape.value ? 2 : 1))
const {
  visibleItems: visiblePlayerSongs,
  paddingTop: listPaddingTop,
  paddingBottom: listPaddingBottom,
  onScroll: onListScroll
} = useVirtualRows({ items: playerSongs, columns: listColumns })

async function rescan(): Promise<void> {
  try {
    await localStore.scanMusic()
    if (!localStore.songs.length) {
      message.info('未发现本地音乐，请确认已授予存储权限')
    }
  } catch (e) {
    message.error(e instanceof Error ? e.message : '扫描失败')
  }
}

async function addDir(): Promise<void> {
  try {
    const result = (await window.electron.ipcRenderer.invoke('local-music:choose-scan-dirs')) as {
      canceled: boolean
      dirs: string[]
    }
    if (!result.canceled && result.dirs.length) {
      await localStore.scanMusic()
    }
  } catch (e) {
    console.error(e)
  }
}

const playAt = (song: PlayerSong): void => {
  const list = playerSongs.value
  const idx = list.findIndex((s) => String(s.id) === String(song.id))
  player.setPlaylistForSource('local', list, true)
  player.playSongAtIndex(idx)
  player.setPlayerPageShown(true)
}

// ==================== 批量管理 ====================

const selectMode = ref(false)
const selected = ref<Set<string>>(new Set())

function toggleSelectMode(): void {
  selectMode.value = !selectMode.value
  selected.value = new Set()
}

function isSelected(song: PlayerSong): boolean {
  return selected.value.has(String(song.id))
}

function toggleSelect(song: PlayerSong): void {
  const id = String(song.id)
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

const allSelected = computed(
  () => playerSongs.value.length > 0 && selected.value.size === playerSongs.value.length
)

function toggleSelectAll(): void {
  if (allSelected.value) {
    selected.value = new Set()
  } else {
    selected.value = new Set(playerSongs.value.map((s) => String(s.id)))
  }
}

function onRowClick(song: PlayerSong): void {
  if (selectMode.value) {
    toggleSelect(song)
  } else {
    playAt(song)
  }
}

const selectedSongs = computed(() =>
  playerSongs.value.filter((s) => selected.value.has(String(s.id)))
)

// 批量删除
function removeSelected(): void {
  const list = selectedSongs.value
  if (!list.length) {
    message.info('请先选择歌曲')
    return
  }
  dialog.warning({
    title: '批量删除',
    content: `确定从设备删除选中的 ${list.length} 首歌曲吗？此操作不可恢复。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        const paths = list.map((s) => s.filePath).filter(Boolean) as string[]
        await window.electron.ipcRenderer.invoke('local-music:delete', paths)
        const ids = new Set(list.map((s) => String(s.id)))
        localStore.songs = localStore.songs.filter((s) => !ids.has(String(s.id)))
        selected.value = new Set()
        selectMode.value = false
        message.success(`已删除 ${list.length} 首歌曲`)
      } catch {
        message.error('删除失败')
      }
    }
  })
}

// 批量保存为歌单（新建 或 追加到已有歌单）
const showSavePlaylist = ref(false)
const newPlaylistName = ref('')

function trackOf(song: PlayerSong): PlaylistTrack {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album,
    cover: song.cover,
    filePath: song.filePath,
    durationMs: song.durationMs,
    source: song.source,
    sourceSongId: song.sourceSongId
  }
}

function openSavePlaylist(): void {
  if (!selectedSongs.value.length) {
    message.info('请先选择歌曲')
    return
  }
  // 已有歌单列表可能来自其他页面，打开时重新读一次本地存储
  playlistStore.loadFromStorage()
  newPlaylistName.value = ''
  showSavePlaylist.value = true
}

function finishSavePlaylist(): void {
  showSavePlaylist.value = false
  newPlaylistName.value = ''
  selected.value = new Set()
  selectMode.value = false
}

function confirmSavePlaylist(): void {
  const name = newPlaylistName.value.trim()
  if (!name) {
    message.info('请输入歌单名称')
    return
  }
  try {
    const tracks = selectedSongs.value.map(trackOf)
    playlistStore.createPlaylistFromTracks(name, tracks, tracks[0]?.cover)
    finishSavePlaylist()
    message.success(`已创建歌单「${name}」（${tracks.length} 首）`)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '创建歌单失败')
  }
}

/** 把选中的歌曲追加到已有歌单（自动跳过重复曲目） */
function addSelectedToPlaylist(playlistId: string): void {
  const pl = playlistStore.playlists.find((p) => p.id === playlistId)
  if (!pl) {
    message.error('歌单不存在')
    return
  }
  let added = 0
  let exists = 0
  for (const song of selectedSongs.value) {
    const r = playlistStore.addTrackToPlaylist(playlistId, trackOf(song))
    if (r === 'added') added += 1
    else if (r === 'exists') exists += 1
  }
  if (added > 0) {
    message.success(
      `已添加 ${added} 首到「${pl.name}」${exists ? `（${exists} 首已存在）` : ''}`
    )
  } else {
    message.info(`所选歌曲都已在「${pl.name}」中`)
  }
  finishSavePlaylist()
}

function removeSong(song: PlayerSong): void {
  dialog.warning({
    title: '删除文件',
    content: `确定从设备删除「${song.title}」吗？此操作不可恢复。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await window.electron.ipcRenderer.invoke('local-music:delete', [song.filePath])
        localStore.songs = localStore.songs.filter((s) => String(s.id) !== String(song.id))
        message.success('已删除')
      } catch {
        message.error('删除失败')
      }
    }
  })
}

// ==================== 横屏 Cover Flow（按专辑浏览） ====================

const { useCoverFlowNow } = useLibraryLayout()

interface AlbumGroup {
  key: string
  name: string
  artist: string
  cover: string
  songs: PlayerSong[]
}

/** 按「专辑 + 歌手」聚合本地歌曲：一个专辑一张封面 */
const albums = computed<AlbumGroup[]>(() => {
  const map = new Map<string, AlbumGroup>()
  for (const song of playerSongs.value) {
    const name = (song.album || '').trim() || '未知专辑'
    const key = `${name}__${song.artist}`
    let group = map.get(key)
    if (!group) {
      group = { key, name, artist: song.artist, cover: song.cover, songs: [] }
      map.set(key, group)
    }
    group.songs.push(song)
    if (!group.cover && song.cover) group.cover = song.cover
  }
  return [...map.values()].sort((a, b) => b.songs.length - a.songs.length)
})

const flowItems = computed<CoverFlowItem[]>(() =>
  albums.value.map((album) => ({
    id: album.key,
    title: album.name,
    subtitle: `${album.artist} · ${album.songs.length} 首`,
    cover: album.cover,
    badge: `${album.songs.length} TRACKS`
  }))
)

const flowActive = computed(
  () => useCoverFlowNow.value && !selectMode.value && albums.value.length > 0
)

/** 点击居中的专辑封面：整张专辑加入播放列表并开始播放 */
const onFlowSelect = (item: CoverFlowItem): void => {
  const album = albums.value.find((a) => a.key === item.id)
  if (!album || !album.songs.length) return
  player.setPlaylistForSource('local', album.songs, true)
  player.playSongAtIndex(0)
  player.setPlayerPageShown(true)
}

onMounted(() => {
  if (!localStore.songs.length) {
    void rescan()
  }
})
</script>

<template>
  <div class="mp-page" :class="{ 'cf-mode': flowActive }">
    <div class="mp-header mp-rise">
      <div>
        <div class="mp-title">{{ selectMode ? `已选 ${selected.size} 首` : '本地音乐' }}</div>
        <div class="mp-sub">{{ songs.length }} 首</div>
      </div>
      <div class="header-side">
        <template v-if="selectMode">
          <button class="mp-btn-icon" :class="{ 'check-active': allSelected }" @click="toggleSelectAll">
            <i :class="allSelected ? 'mgc_checkbox_fill' : 'mgc_checkbox_line'"></i>
          </button>
          <button class="mp-btn-icon" @click="toggleSelectMode">
            <i class="mgc_close_line"></i>
          </button>
        </template>
        <template v-else>
          <LayoutModeToggle />
          <button class="mp-btn-icon" title="批量管理" @click="toggleSelectMode">
            <i class="mgc_list_check_2_line"></i>
          </button>
          <button class="mp-btn-icon" @click="rescan">
            <i class="mgc_refresh_2_line"></i>
          </button>
          <button class="mp-btn-icon" @click="addDir">
            <i class="mgc_folder_3_line"></i>
          </button>
        </template>
      </div>
    </div>

    <!-- 横屏 Cover Flow：按专辑浏览本地曲库 -->
    <MobileCoverFlow
      v-if="flowActive"
      :items="flowItems"
      label="本地专辑"
      eyebrow="ALBUMS"
      :start-index="0"
      @select="onFlowSelect"
    />

    <div v-else class="filter-bar mp-rise" style="--mp-rise-delay: 0.05s">
      <div class="mp-input filter-input">
        <i class="mgc_search_line"></i>
        <input v-model="filter" placeholder="搜索本地歌曲" />
      </div>
    </div>

    <div v-if="!flowActive" class="mp-scroll" @scroll.passive="onListScroll">
      <div v-if="scanning" class="scan-loading">
        <n-spin size="medium" />
        <p>正在扫描本地音乐…</p>
      </div>

      <template v-else>
        <div class="mp-list mp-rise" style="--mp-rise-delay: 0.1s" v-if="playerSongs.length">
          <div v-if="listPaddingTop" class="v-spacer" :style="{ height: listPaddingTop + 'px' }"></div>
          <MobileSongRow
            v-for="song in visiblePlayerSongs"
            :key="String(song.id)"
            :song="song"
            show-cover
            :playing="!selectMode && String(player.currentSong?.id) === String(song.id)"
            :class="{ 'row-selected': selectMode && isSelected(song) }"
            @click="onRowClick"
            @action="selectMode ? toggleSelect(song) : removeSong(song)"
          >
            <template #action>
              <i
                v-if="selectMode"
                class="row-check"
                :class="isSelected(song) ? 'mgc_check_circle_fill checked' : 'mgc_circle_line'"
              ></i>
              <i v-else class="mgc_delete_line row-del"></i>
            </template>
          </MobileSongRow>
          <div v-if="listPaddingBottom" class="v-spacer" :style="{ height: listPaddingBottom + 'px' }"></div>
        </div>

        <n-empty v-else description="暂无本地音乐，点击右上角扫描" style="padding: 60px 0" />
      </template>
      <div class="mp-bottom-space" :class="{ 'batch-space': selectMode }"></div>
    </div>

    <!-- 批量操作底栏 -->
    <div v-if="selectMode" class="batch-bar">
      <button class="batch-btn" :disabled="!selected.size" @click="openSavePlaylist">
        <i class="mgc_playlist_2_line"></i>
        <span>存为歌单</span>
      </button>
      <button class="batch-btn danger" :disabled="!selected.size" @click="removeSelected">
        <i class="mgc_delete_line"></i>
        <span>删除 ({{ selected.size }})</span>
      </button>
    </div>

    <!-- 存为歌单弹层 -->
    <div v-if="showSavePlaylist" class="mp-sheet-mask" @click="showSavePlaylist = false"></div>
    <div v-if="showSavePlaylist" class="mp-sheet save-sheet">
      <div class="sheet-grabber"></div>
      <div class="sheet-title">存为歌单（{{ selectedSongs.length }} 首）</div>
      <div class="save-form">
        <div class="mp-input">
          <i class="mgc_edit_2_line"></i>
          <input v-model="newPlaylistName" placeholder="新建歌单名称" maxlength="40" />
        </div>
        <button class="mp-btn-primary save-confirm" @click="confirmSavePlaylist">新建并保存</button>
      </div>

      <div v-if="playlistStore.playlists.length" class="save-existing">
        <div class="save-divider"><span>或添加到已有歌单</span></div>
        <div class="save-pl-list">
          <div
            v-for="pl in playlistStore.playlists"
            :key="pl.id"
            class="save-pl-row"
            @click="addSelectedToPlaylist(pl.id)"
          >
            <i :class="pl.id === 'favorite' ? 'mgc_heart_fill save-pl-heart' : 'mgc_playlist_line'"></i>
            <span class="save-pl-name">{{ pl.name }}</span>
            <span class="save-pl-count">{{ pl.tracks.length }} 首</span>
            <i class="mgc_add_line save-pl-add"></i>
          </div>
        </div>
      </div>
      <div class="sheet-bottom-space"></div>
    </div>
  </div>
</template>

<style scoped>
/* Cover Flow 使用透明背景，直接沿用页面主题色（不再铺深色舞台） */

.filter-bar {
  padding: 4px 20px 8px;
}

.filter-input {
  width: 100%;
}

.scan-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 64px 0;
  gap: 14px;
  color: var(--mp-text-2);
  font-size: var(--mp-font-sub);
}

.row-del {
  color: var(--mp-text-3);
  font-size: 17px;
}

.row-check {
  font-size: 20px;
  color: var(--mp-text-3);
}

.row-check.checked {
  color: var(--mp-primary);
}

.row-selected {
  background: color-mix(in srgb, var(--mp-primary) 8%, transparent);
}

.check-active {
  color: var(--mp-primary);
}

/* ============ 批量操作底栏 ============ */
/* 竖屏需避让底部悬浮栏（迷你播放条 60 + 间隙 8 + 导航胶囊 62 + 底部偏移 12 ≈ 142px） */
.batch-bar {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: calc(96px + var(--sab, 0px));
  display: flex;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--mp-r-lg, 28px);
  background: var(--mp-frosted-bg, rgba(255, 255, 255, 0.68));
  backdrop-filter: var(--mp-frosted-blur, blur(22px) saturate(1.8));
  -webkit-backdrop-filter: var(--mp-frosted-blur, blur(22px) saturate(1.8));
  border: 0.5px solid var(--mp-frosted-border, rgba(255, 255, 255, 0.55));
  box-shadow: var(--mp-shadow-lg, 0 16px 40px rgba(0, 0, 0, 0.14));
  z-index: 120;
}

.batch-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 40px;
  border: none;
  border-radius: 12px;
  background: var(--mp-primary);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  padding: 0;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--mp-primary) 30%, transparent);
}

.batch-btn i {
  font-size: 17px;
}

.batch-btn.danger {
  color: var(--mp-danger, #ff3b30);
  background: color-mix(in srgb, var(--mp-danger, #ff3b30) 12%, transparent);
  box-shadow: none;
}

.batch-btn:disabled {
  opacity: 0.45;
}

/* 选择模式下批量栏抬高，列表底部留白同步加高 */
.batch-space {
  height: 230px !important;
}

/* ============ 存为歌单弹层 ============ */
.save-form {
  padding: 4px 20px 8px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.save-confirm {
  height: 44px;
  font-size: 15px;
}

/* 已有歌单：分割线 + 可滚动列表 */
.save-existing {
  padding: 10px 20px 4px;
  min-height: 0;
}

.save-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  font-size: 11.5px;
  color: var(--mp-text-3);
}

.save-divider::before,
.save-divider::after {
  content: '';
  flex: 1;
  height: 0.5px;
  background: var(--mp-separator);
}

.save-pl-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 38vh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}

.save-pl-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 16px;
  background: var(--mp-fill);
  color: var(--mp-text);
  font-size: 14.5px;
  transition: opacity 0.15s ease;
}

.save-pl-row:active {
  opacity: 0.7;
}

.save-pl-row > i:first-child {
  font-size: 19px;
  color: var(--mp-primary);
}

.save-pl-row > i.save-pl-heart {
  color: #ff375f;
}

.save-pl-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.save-pl-count {
  font-size: 12px;
  color: var(--mp-text-3);
  flex-shrink: 0;
}

.save-pl-add {
  font-size: 18px;
  color: var(--mp-text-3);
  flex-shrink: 0;
}

/* ============ 横屏：过滤栏限宽居中，歌曲列表由全局规则双列 ============ */
@media (orientation: landscape) {
  .filter-bar {
    max-width: 720px;
    width: 100%;
    margin: 0 auto;
    box-sizing: border-box;
  }

  /* 横屏悬浮栏移至左侧，批量栏贴回底部 */
  .batch-bar {
    bottom: calc(12px + var(--sab, 0px));
  }
}
</style>
