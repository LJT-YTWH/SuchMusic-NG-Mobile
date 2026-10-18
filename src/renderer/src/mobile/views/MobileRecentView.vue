<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { NEmpty } from 'naive-ui'
import { usePlayerStore, recordKind, type PlayerSong, type PlayRecord } from '../../stores/playerStore'
import MobileSongRow from '../components/MobileSongRow.vue'

const player = usePlayerStore()

const songs = ref<PlayerSong[]>([])
// 与 songs 平行的记录类型缓存（用于展示本地/在线标签）
const kinds = ref<Array<'local' | 'online'>>([])

// 已补全的封面缓存（避免重建列表时丢失 / 重复读取文件）
const coverCache = new Map<string, string>()

function buildSongs(): void {
  kinds.value = player.playHistory.map((r: PlayRecord) => recordKind(r))
  songs.value = player.playHistory.map((r: PlayRecord) => {
    const key = String(r.songId)
    return {
      id: r.songId,
      title: r.title,
      artist: r.artist,
      album: r.album || '',
      cover: r.cover || coverCache.get(key) || '',
      durationMs: r.durationMs || 0,
      filePath: r.filePath,
      source: r.source || (r.filePath ? 'local' : 'netease'),
      sourceSongId: r.source && r.source !== 'local' ? r.songId : undefined
    }
  })
}

// 为缺失封面的本地音乐读取 MP3 内嵌封面
async function fillMissingCovers(): Promise<void> {
  const ipc = window.electron?.ipcRenderer
  if (!ipc) return
  const targets = songs.value.filter((s) => !s.cover && s.filePath)
  if (!targets.length) return

  await Promise.all(
    targets.map(async (song) => {
      try {
        const result = (await ipc.invoke('local-music:get-meta', song.filePath)) as {
          cover?: { mimeType: string; base64: string }
        }
        if (result?.cover?.base64) {
          const url = `data:${result.cover.mimeType || 'image/jpeg'};base64,${result.cover.base64}`
          coverCache.set(String(song.id), url)
          song.cover = url
        }
      } catch (e) {
        console.error('读取本地音乐封面失败:', e)
      }
    })
  )
}

watch(
  () => player.playHistory,
  () => {
    buildSongs()
    void fillMissingCovers()
  },
  { deep: true }
)

onMounted(() => {
  player.loadHistory()
  buildSongs()
  void fillMissingCovers()
})

const playAt = (index: number): void => {
  player.setPlaylistForSource('recent', songs.value, true)
  player.playSongAtIndex(index)
  player.setPlayerPageShown(true)
}

const playAll = (): void => {
  if (!songs.value.length) return
  player.setPlaylistForSource('recent', songs.value, true)
  player.playSongAtIndex(0)
  player.setPlayerPageShown(true)
}
</script>

<template>
  <div class="mp-page">
    <div class="mp-header mp-rise">
      <div>
        <div class="mp-title">最近播放</div>
        <div class="mp-sub">{{ songs.length }} 首</div>
      </div>
      <div class="header-side">
        <button v-if="songs.length" class="mp-btn-primary play-all" @click="playAll">
          <i class="mgc_play_fill"></i>
          <span>播放全部</span>
        </button>
      </div>
    </div>

    <div class="mp-scroll">
      <div class="mp-list mp-rise" style="--mp-rise-delay: 0.05s" v-if="songs.length">
        <MobileSongRow
          v-for="(song, i) in songs"
          :key="`${kinds[i]}-${song.id}-${i}`"
          :song="song"
          :index="i"
          show-index
          show-cover
          :tag="kinds[i] === 'local' ? '本地' : '在线'"
          :tag-type="kinds[i]"
          :playing="String(player.currentSong?.id) === String(song.id)"
          @click="playAt(i)"
        >
          <template #action><span></span></template>
        </MobileSongRow>
      </div>
      <n-empty v-if="!songs.length" description="还没有播放记录" style="padding: 60px 0" />
      <div class="mp-bottom-space"></div>
    </div>
  </div>
</template>

<style scoped>
.play-all {
  height: 38px;
  padding: 0 18px;
  font-size: 13.5px;
}
</style>
