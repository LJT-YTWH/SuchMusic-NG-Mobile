// 逐字歌词服务：切歌监听、自动/手动生成、应用与清空
// - 开启「逐字歌词」后，每首歌（有本地音频文件）优先使用已生成的逐字歌词；
//   未生成则按偏好自动生成（边播放边生成 / 等生成完后再播放）
// - 生成结果持久化于 karaokeStorage（应用私有目录，可设置页管理）
import { reactive, watch } from 'vue'
import { usePlayerStore } from '../../stores/playerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { webAudioEngine } from '../../audio/audio-engine'
import { isNativeMobile } from '../../platform'
import { readTextFile } from '../../platform/mobile/fsUtils'
import { decodeToMono, runKaraokeWorker, type KaraokeJob } from './karaokeEngine'
import { loadKaraokeFor, saveKaraokeFor, deleteKaraokeFor, hasKaraokeFor } from './karaokeStorage'
import type { KaraokeAlgo } from './aligner'

const WORD_TAG_RE = /<\d{1,2}:\d{2}(?:[.:]\d{1,3})?>/

/** 内容是否已是逐字（卡拉OK）歌词 */
export function looksKaraoke(content: string): boolean {
  return WORD_TAG_RE.test(content)
}

export const karaokeState = reactive({
  /** 当前歌曲是否有可用的逐字歌词 */
  currentHasKaraoke: false,
  /** 是否有生成任务进行中（全局单任务） */
  generating: false,
  /** 阻塞式生成（全屏转圈遮罩） */
  blocking: false,
  /** 生成遮罩已最小化为顶部悬浮提示 */
  minimized: false,
  /** 当前生成阶段提示 */
  stage: '',
  /** 正在生成的歌曲标题 */
  songTitle: '',
  /** 消息通知（由播放页桥接到 naive-ui message） */
  notice: null as null | { kind: 'success' | 'error' | 'info'; text: string; ts: number },
  /** 「是否生成逐字歌词」询问（开启逐字歌词且自动生成关闭时弹出） */
  prompt: null as null | { songId: string | number | null; filePath: string; title: string },
  /** 正在生成的目标文件路径（用于避免生成期间重复询问/重复触发） */
  generatingFor: null as string | null
})

function notify(kind: 'success' | 'error' | 'info', text: string): void {
  karaokeState.notice = { kind, text, ts: Date.now() }
}

/** 由音频文件路径推导同名 .lrc 歌词路径 */
function lrcPathOf(filePath: string): string {
  return filePath.replace(/\.[^./\\]+$/, '') + '.lrc'
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

let inited = false
let genToken = 0
let appliedFor: string | number | null = null
let appliedContent = ''
let activeJob: KaraokeJob | null = null

export function initKaraokeService(): void {
  if (inited || !isNativeMobile) return
  inited = true
  const player = usePlayerStore()
  const settings = useSettingsStore()

  // 切歌 → 应用或自动生成逐字歌词
  watch(
    () => player.currentSong?.id,
    () => {
      void onSongChange()
    }
  )

  // 开关变化：开启时立即处理当前歌曲；关闭时恢复逐行歌词
  watch(
    () => settings.karaoke.enabled,
    (v) => {
      if (v) void onSongChange()
      else void restoreLineLyrics()
    }
  )

  // 已应用逐字歌词后，若歌词被异步覆盖（如 PlayerBar 的 meta/在线歌词回写），重新应用
  watch(
    () => player.currentSong?.lyrics,
    (lrc) => {
      if (
        appliedFor !== null &&
        player.currentSong?.id === appliedFor &&
        lrc &&
        lrc !== appliedContent &&
        !looksKaraoke(lrc)
      ) {
        player.setLyrics(appliedContent)
      }
    }
  )
}

/** 关闭逐字歌词时恢复当前歌曲的逐行歌词 */
async function restoreLineLyrics(): Promise<void> {
  const player = usePlayerStore()
  karaokeState.prompt = null
  if (appliedFor === null) return
  appliedFor = null
  const song = player.currentSong
  if (!song?.filePath) return
  const line = await resolveLineLyrics(song)
  player.setLyrics(line || '')
}

/** 取消当前正在进行的生成任务 */
export function cancelGeneration(): void {
  if (!karaokeState.generating) return
  genToken++ // 作废旧任务结果
  activeJob?.cancel()
}

async function onSongChange(): Promise<void> {
  const player = usePlayerStore()
  const settings = useSettingsStore()
  const song = player.currentSong
  karaokeState.currentHasKaraoke = false
  karaokeState.prompt = null
  appliedFor = null
  // 切歌时把阻塞遮罩降级（旧任务在后台继续，结果仍落盘缓存）
  if (karaokeState.blocking) karaokeState.blocking = false
  const token = ++genToken
  if (!song || !song.filePath) return

  try {
    karaokeState.currentHasKaraoke = await hasKaraokeFor(song.filePath)
    if (!settings.karaoke.enabled) return
    // 正在为该歌曲生成：不要重复询问/重复触发，生成完成后会自动应用
    if (karaokeState.generatingFor === song.filePath) return
    const existing = karaokeState.currentHasKaraoke
      ? await loadKaraokeFor(song.filePath)
      : null
    if (token !== genToken) return
    if (existing) {
      applyKaraoke(song.id, existing)
      return
    }
    // 若当前歌词本身已是逐字格式（如用户自备 karaoke lrc），直接使用
    if (song.lyrics && looksKaraoke(song.lyrics)) return
    // 自动生成关闭：询问用户是否立即生成
    if (!settings.karaoke.autoGenerate) {
      karaokeState.prompt = {
        songId: song.id,
        filePath: song.filePath,
        title: song.title || ''
      }
      return
    }
    await autoGenerate(song.filePath, song.id, song.title || '', song.artist || '', token)
  } catch (e) {
    console.warn('[karaoke] 切歌处理失败', e)
  }
}

/** 用户确认生成（来自「是否生成逐字歌词」询问） */
export function acceptKaraokePrompt(): void {
  const prompt = karaokeState.prompt
  if (!prompt) return
  karaokeState.prompt = null
  const player = usePlayerStore()
  // 以文件路径为准判断是否仍是同一首歌（id 可能因缓存回写而变化）
  if (player.currentSong?.filePath !== prompt.filePath) return
  void generateForCurrentSong(useSettingsStore().karaoke.lastAlgo)
}

/** 用户拒绝生成（来自「是否生成逐字歌词」询问） */
export function dismissKaraokePrompt(): void {
  karaokeState.prompt = null
}

function applyKaraoke(songId: string | number | null, content: string): void {
  const player = usePlayerStore()
  if (player.currentSong?.id !== songId) return
  appliedFor = songId
  appliedContent = content
  player.setLyrics(content)
}

/** 解析当前可用的逐行歌词：优先内存中非逐字歌词，其次旁挂 .lrc 文件 */
async function resolveLineLyrics(song: {
  filePath?: string
  lyrics?: string
}): Promise<string | null> {
  const cur = song.lyrics
  if (cur && !looksKaraoke(cur)) return cur
  if (song.filePath) {
    const side = await readTextFile(lrcPathOf(song.filePath))
    if (side && !looksKaraoke(side)) return side
  }
  return null
}

/** 等待当前歌曲的逐行歌词就绪（PlayerBar 异步加载旁挂/在线歌词） */
async function waitLineLyrics(songId: string | number | null, timeoutMs: number): Promise<string | null> {
  const player = usePlayerStore()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const cur = player.currentSong
    if (!cur || cur.id !== songId) return null
    const lrc = await resolveLineLyrics(cur)
    if (lrc) return lrc
    await sleep(500)
  }
  return null
}

/** 等待当前歌曲加载（下载缓存）完成 */
async function waitLoaded(timeoutMs: number): Promise<void> {
  const player = usePlayerStore()
  const deadline = Date.now() + timeoutMs
  while (player.isLoading && Date.now() < deadline) {
    await sleep(300)
  }
}

async function autoGenerate(
  filePath: string,
  songId: string | number | null,
  title: string,
  artist: string,
  token: number
): Promise<void> {
  const settings = useSettingsStore()
  if (karaokeState.generating) return // 全局单任务
  const lrc = await waitLineLyrics(songId, 20000)
  if (token !== genToken || !lrc) return
  if (settings.karaoke.genMode === 'afterDone') {
    // 等生成完再播放：先暂停，生成应用后从头播放
    const player = usePlayerStore()
    await waitLoaded(30000)
    if (token !== genToken) return
    const wasPlaying = player.isPlaying
    if (wasPlaying) {
      await webAudioEngine.pause()
      player.setPlaying(false)
    }
    const ok = await generateAndSave(filePath, title, artist, settings.karaoke.lastAlgo, true, token)
    if (token !== genToken) return
    if (wasPlaying) {
      // 生成成功且偏好「从头播放」时才回到 0；「接着播放」/生成失败/取消均从暂停处继续
      if (ok && settings.karaoke.afterGenPlay === 'restart') {
        webAudioEngine.seek(0)
        player.setPosition(0)
      }
      const played = await webAudioEngine.play()
      if (played) player.setPlaying(true)
    }
  } else {
    // 边播放边生成：后台静默生成
    notify('info', '正在后台生成逐字歌词…')
    await generateAndSave(filePath, title, artist, settings.karaoke.lastAlgo, false, token)
  }
}

/** 手动生成当前歌曲逐字歌词（菜单入口，弹全屏转圈遮罩） */
export async function generateForCurrentSong(algo: KaraokeAlgo): Promise<boolean> {
  const player = usePlayerStore()
  const settings = useSettingsStore()
  karaokeState.prompt = null
  const song = player.currentSong
  if (!song?.filePath) {
    notify('info', '当前不是本地歌曲')
    return false
  }
  if (karaokeState.generating) {
    notify('info', '正在生成中，请稍候')
    return false
  }
  const existing = await resolveLineLyrics(song)
  if (!existing) {
    notify('info', '当前歌曲没有逐行歌词，无法生成逐字歌词')
    return false
  }
  settings.karaoke.lastAlgo = algo
  const token = ++genToken
  return generateAndSave(song.filePath, song.title || '', song.artist || '', algo, true, token)
}

async function generateAndSave(
  filePath: string,
  title: string,
  artist: string,
  algo: KaraokeAlgo,
  blocking: boolean,
  token: number
): Promise<boolean> {
  const player = usePlayerStore()
  karaokeState.generating = true
  karaokeState.generatingFor = filePath
  karaokeState.blocking = blocking
  karaokeState.minimized = false
  karaokeState.stage = '解码音频'
  karaokeState.songTitle = title
  karaokeState.prompt = null
  try {
    const pcm = await decodeToMono(filePath)
    if (token !== genToken) return false
    const lrc = await resolveLineLyrics(player.currentSong?.filePath === filePath ? player.currentSong : { filePath })
    if (!lrc) {
      notify('info', '未找到可用的逐行歌词')
      return false
    }
    const job = runKaraokeWorker(pcm, lrc, algo, (s) => {
      karaokeState.stage = s
    })
    activeJob = job
    const out = await job.promise
    if (!out) {
      notify('info', '歌词内容为空，无法生成逐字歌词')
      return false
    }
    await saveKaraokeFor(filePath, title, artist, algo, out)
    // 生成完成：清掉可能被并发切歌流程重新设置的询问弹窗
    karaokeState.prompt = null
    // 以文件路径判断是否仍是当前歌曲（id 可能因缓存回写/对象重建而变化）
    if (player.currentSong?.filePath === filePath) {
      karaokeState.currentHasKaraoke = true
      applyKaraoke(player.currentSong.id, out)
      notify('success', '逐字歌词已生成并应用')
    } else {
      notify('success', '逐字歌词已生成')
    }
    return true
  } catch (e) {
    if (e instanceof Error && e.message === 'CANCELLED') {
      notify('info', '已取消生成')
      return false
    }
    console.error('[karaoke] 生成失败', e)
    notify('error', '逐字歌词生成失败，请重试')
    return false
  } finally {
    activeJob = null
    karaokeState.generating = false
    karaokeState.generatingFor = null
    karaokeState.blocking = false
    karaokeState.minimized = false
    karaokeState.stage = ''
  }
}

/** 清空当前歌曲的逐字歌词（删除生成文件并恢复逐行歌词） */
export async function clearCurrentKaraoke(): Promise<boolean> {
  const player = usePlayerStore()
  const song = player.currentSong
  if (!song?.filePath) return false
  await deleteKaraokeFor(song.filePath)
  karaokeState.currentHasKaraoke = false
  if (player.currentSong?.id === song.id) {
    appliedFor = null
    const side = await readTextFile(lrcPathOf(song.filePath))
    player.setLyrics(side || '')
  }
  notify('success', '已清空逐字歌词')
  return true
}

/** 检查指定歌曲是否已有逐字歌词（供界面查询） */
export { loadKaraokeFor, looksKaraoke as isKaraokeContent }
