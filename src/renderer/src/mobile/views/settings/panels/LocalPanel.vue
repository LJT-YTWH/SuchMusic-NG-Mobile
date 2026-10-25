<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { NSpin, NEmpty, useMessage, useDialog } from 'naive-ui'
import { useSettingsStore } from '../../../../stores/settingsStore'
import { useLocalMusicStore } from '../../../../stores/localMusicStore'
import {
  listKaraoke,
  deleteKaraokeEntries,
  type KaraokeEntry
} from '../../../../utils/karaoke/karaokeStorage'
import {
  aiSongKeyOf,
  listAiLyrics,
  type AiLyricEntry
} from '../../../../utils/aiLyric/aiLyricStorage'
import {
  clearAiLyricByEntry,
  isKaraokeContent,
  removeTranslationsFromLrc
} from '../../../../utils/aiLyric/aiLyricService'
import { usePlayerStore } from '../../../../stores/playerStore'
import { syncAppliedKaraokeContent } from '../../../../utils/karaoke/karaokeService'

// 本地与缓存：扫描目录 + 播放缓存 + 逐字歌词管理
const settingsStore = useSettingsStore()
const localStore = useLocalMusicStore()
const player = usePlayerStore()
const message = useMessage()
const dialog = useDialog()

const cacheInfo = ref<{ dir: string; sizeBytes: number; fileCount: number } | null>(null)

async function refreshCacheInfo(): Promise<void> {
  try {
    cacheInfo.value = (await window.electron.ipcRenderer.invoke(
      'online-cache:get-info',
      null
    )) as typeof cacheInfo.value
  } catch {
    cacheInfo.value = null
  }
}

const formatSize = (bytes: number): string => {
  if (bytes >= 1 << 30) return `${(bytes / (1 << 30)).toFixed(2)} GB`
  if (bytes >= 1 << 20) return `${(bytes / (1 << 20)).toFixed(1)} MB`
  if (bytes >= 1 << 10) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

async function clearCache(): Promise<void> {
  await window.electron.ipcRenderer.invoke('online-cache:clear', null)
  message.success('缓存已清空')
  await refreshCacheInfo()
}

async function addScanDir(): Promise<void> {
  const result = (await window.electron.ipcRenderer.invoke('local-music:choose-scan-dirs')) as {
    canceled: boolean
    dirs: string[]
  }
  if (!result.canceled && result.dirs.length) {
    settingsStore.local.scanDirs = [...new Set([...settingsStore.local.scanDirs, ...result.dirs])]
    message.success('已添加扫描目录')
  }
}

function removeScanDir(dir: string): void {
  settingsStore.local.scanDirs = settingsStore.local.scanDirs.filter((d) => d !== dir)
}

async function rescanNow(): Promise<void> {
  message.info('开始扫描…')
  try {
    await localStore.scanMusic()
    message.success(`扫描完成，共 ${localStore.songs.length} 首`)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '扫描失败')
  }
}

// ==================== 逐字歌词管理 ====================

const karaokeList = ref<KaraokeEntry[]>([])
const karaokeChecked = ref<string[]>([])

async function refreshKaraoke(): Promise<void> {
  try {
    karaokeList.value = await listKaraoke()
  } catch {
    karaokeList.value = []
  }
}

function toggleKaraoke(key: string): void {
  const idx = karaokeChecked.value.indexOf(key)
  if (idx >= 0) karaokeChecked.value.splice(idx, 1)
  else karaokeChecked.value.push(key)
}

function deleteSelectedKaraoke(): void {
  const count = karaokeChecked.value.length
  if (!count) return
  dialog.warning({
    title: '删除逐字歌词',
    content: `将删除所选 ${count} 首歌曲的逐字歌词文件，确定继续吗？`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      const n = await deleteKaraokeEntries([...karaokeChecked.value])
      karaokeChecked.value = []
      await refreshKaraoke()
      message.success(`已删除 ${n} 首歌曲的逐字歌词`)
    }
  })
}

const formatDate = (ts: number): string => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ==================== AI 翻译歌词管理 ====================

const aiLyricList = ref<AiLyricEntry[]>([])
const aiLyricChecked = ref<string[]>([])

const aiLyricTotalSize = computed(() =>
  aiLyricList.value.reduce((sum, e) => sum + (e.sizeBytes || 0), 0)
)

async function refreshAiLyrics(): Promise<void> {
  try {
    aiLyricList.value = await listAiLyrics()
  } catch {
    aiLyricList.value = []
  }
}

function toggleAiLyric(key: string): void {
  const idx = aiLyricChecked.value.indexOf(key)
  if (idx >= 0) aiLyricChecked.value.splice(idx, 1)
  else aiLyricChecked.value.push(key)
}

function deleteSelectedAiLyrics(): void {
  const count = aiLyricChecked.value.length
  if (!count) return
  dialog.warning({
    title: '删除 AI 翻译歌词',
    content: `将删除所选 ${count} 首歌曲的 AI 翻译文件，并移除已写入逐字歌词中的 AI 译文，确定继续吗？`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      const selected = aiLyricList.value.filter((e) => aiLyricChecked.value.includes(e.key))
      for (const entry of selected) {
        const res = await clearAiLyricByEntry(entry)
        const cur = player.currentSong
        if (!cur) continue
        // 当前正在播放这首歌：同步移除界面上的译文
        if (res.karaokeContent && res.filePath && cur.filePath === res.filePath) {
          player.setLyrics(res.karaokeContent)
          syncAppliedKaraokeContent(cur.id, res.karaokeContent)
        } else if (
          aiSongKeyOf(cur) === entry.songKey &&
          cur.lyrics &&
          !isKaraokeContent(cur.lyrics)
        ) {
          const cleaned = removeTranslationsFromLrc(cur.lyrics)
          player.setLyrics(cleaned)
          syncAppliedKaraokeContent(cur.id, cleaned)
        }
      }
      const n = selected.length
      aiLyricChecked.value = []
      await refreshAiLyrics()
      message.success(`已删除 ${n} 首歌曲的 AI 翻译`)
    }
  })
}

onMounted(() => {
  void refreshCacheInfo()
  void refreshKaraoke()
  void refreshAiLyrics()
})
</script>

<template>
  <div class="sp-panel">
    <div class="mp-section-title">扫描目录</div>
    <div class="mp-list setting-list">
      <div class="setting-row">
        <span class="row-label">默认（全设备音频）</span>
        <span class="row-value">MediaStore</span>
      </div>
      <div v-for="dir in settingsStore.local.scanDirs" :key="dir" class="setting-row">
        <span class="row-label dir-label">{{ dir }}</span>
        <i class="mgc_close_line row-del" @click="removeScanDir(dir)"></i>
      </div>
      <div class="setting-row" @click="addScanDir">
        <span class="row-label primary"><i class="mgc_add_circle_line row-ic"></i>添加目录</span>
      </div>
      <div class="setting-row" @click="rescanNow">
        <span class="row-label primary"><i class="mgc_refresh_2_line row-ic"></i>立即扫描</span>
        <span class="row-value">{{ localStore.songs.length }} 首</span>
      </div>
    </div>

    <div class="mp-section-title">播放缓存</div>
    <div class="mp-list setting-list">
      <div class="setting-row">
        <span class="row-label">缓存大小</span>
        <span v-if="cacheInfo" class="row-value">
          {{ formatSize(cacheInfo.sizeBytes) }}（{{ cacheInfo.fileCount }} 个文件）
        </span>
        <n-spin v-else size="small" />
      </div>
      <div class="setting-row" @click="clearCache">
        <span class="row-label danger"><i class="mgc_delete_line row-ic"></i>清空缓存</span>
      </div>
    </div>

    <div class="mp-section-title">逐字歌词</div>
    <div class="mp-list setting-list">
      <div class="setting-row">
        <span class="row-label">已生成</span>
        <span class="row-value">{{ karaokeList.length }} 首</span>
      </div>
      <template v-if="karaokeList.length">
        <div
          v-for="entry in karaokeList"
          :key="entry.key"
          class="setting-row karaoke-row"
          @click="toggleKaraoke(entry.key)"
        >
          <i
            class="karaoke-check"
            :class="
              karaokeChecked.includes(entry.key) ? 'mgc_check_circle_fill checked' : 'mgc_round_line'
            "
          ></i>
          <span class="karaoke-main">
            <span class="karaoke-title">{{ entry.title }}</span>
            <span class="karaoke-sub">
              {{ entry.artist }} · {{ entry.algo.toUpperCase() }} · {{ formatDate(entry.createdAt) }}
            </span>
          </span>
        </div>
        <div
          class="setting-row"
          :class="{ 'row-disabled': !karaokeChecked.length }"
          @click="deleteSelectedKaraoke"
        >
          <span class="row-label danger">
            <i class="mgc_delete_line row-ic"></i>删除所选逐字歌词
            <template v-if="karaokeChecked.length">（{{ karaokeChecked.length }}）</template>
          </span>
        </div>
      </template>
      <n-empty
        v-else
        description="暂无逐字歌词，可在播放页「更多 → 歌词 → 本地逐字歌词」中生成"
        style="padding: 20px 0"
      />
    </div>

    <div class="mp-section-title">AI 翻译歌词</div>
    <div class="mp-list setting-list">
      <div class="setting-row">
        <span class="row-label">已生成</span>
        <span class="row-value">
          {{ aiLyricList.length }} 首<template v-if="aiLyricTotalSize">（{{ formatSize(aiLyricTotalSize) }}）</template>
        </span>
      </div>
      <template v-if="aiLyricList.length">
        <div
          v-for="entry in aiLyricList"
          :key="entry.key"
          class="setting-row karaoke-row"
          @click="toggleAiLyric(entry.key)"
        >
          <i
            class="karaoke-check"
            :class="
              aiLyricChecked.includes(entry.key) ? 'mgc_check_circle_fill checked' : 'mgc_round_line'
            "
          ></i>
          <span class="karaoke-main">
            <span class="karaoke-title">{{ entry.title }}</span>
            <span class="karaoke-sub">
              {{ entry.artist }} · {{ entry.lineCount }} 行 · {{ entry.model }} ·
              {{ formatDate(entry.createdAt) }}
            </span>
          </span>
        </div>
        <div
          class="setting-row"
          :class="{ 'row-disabled': !aiLyricChecked.length }"
          @click="deleteSelectedAiLyrics"
        >
          <span class="row-label danger">
            <i class="mgc_delete_line row-ic"></i>删除所选 AI 翻译
            <template v-if="aiLyricChecked.length">（{{ aiLyricChecked.length }}）</template>
          </span>
        </div>
      </template>
      <n-empty
        v-else
        description="暂无 AI 翻译，可在播放页「更多 → 歌词 → AI 歌词翻译」中生成"
        style="padding: 20px 0"
      />
    </div>
  </div>
</template>

<style scoped>
.karaoke-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.karaoke-check {
  font-size: 20px;
  color: var(--mp-text-3, rgba(60, 60, 67, 0.33));
  flex-shrink: 0;
}

.karaoke-check.checked {
  color: var(--mp-primary, #2c8efd);
}

.karaoke-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.karaoke-title {
  font-size: 14px;
  color: var(--mp-text, #1c1c1e);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.karaoke-sub {
  font-size: 11.5px;
  color: var(--mp-text-3, rgba(60, 60, 67, 0.33));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-disabled {
  opacity: 0.45;
}
</style>
