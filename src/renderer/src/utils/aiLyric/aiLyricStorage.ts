// AI 翻译歌词持久化：应用私有数据目录下的 ai-lyrics/ 文件夹（非临时目录）
//   ai-lyrics/<key>.json     —— 每首歌的 AI 翻译结果（逐行时间 + 译文 + 合并后的 LRC）
//   ai-lyrics/index.json     —— 清单（歌曲信息、模型、时间、大小）
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import type { PlayerSong } from '../../stores/playerStore'

const AI_LYRIC_DIR = 'ai-lyrics'
const MANIFEST_PATH = `${AI_LYRIC_DIR}/index.json`

/** 一条翻译（timeMs 与原歌词行起始时间一致） */
export interface AiLyricLine {
  timeMs: number
  text: string
}

/** 单曲 AI 翻译文件内容 */
export interface AiLyricPayload {
  /** 逐行译文（timeMs 对齐原歌词） */
  lines: AiLyricLine[]
  /** 合并翻译后的逐行 LRC（用于非逐字歌词场景直接应用） */
  mergedLrc: string
  /** 用户填写的翻译要求 / 歌曲背景 */
  requirement?: string
}

export interface AiLyricEntry {
  /** 存储文件主键（songKey 哈希） */
  key: string
  /** 歌曲唯一标识：本地 file:<path>，在线 online:<source>:<id> */
  songKey: string
  title: string
  artist: string
  /** 生成所用模型 */
  model: string
  createdAt: number
  sizeBytes: number
  lineCount: number
}

/** cyrb53 风格字符串哈希 → 16 位十六进制 */
export function aiLyricKeyOf(songKey: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < songKey.length; i++) {
    const ch = songKey.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')
}

/**
 * 歌曲唯一标识。
 *
 * 在线歌曲播放后 filePath 可能被写成缓存文件路径（每次缓存地址可能变化），
 * 因此带平台来源的曲目优先用「平台 + 平台歌曲 id」，只有本地歌曲才用文件路径。
 */
export function aiSongKeyOf(song: {
  filePath?: string
  source?: string
  sourceSongId?: string | number
  id?: string | number | null
}): string {
  const source = song.source || ''
  const onlineId = song.sourceSongId ?? song.id ?? ''
  const isLocal = !source || source === 'local'
  if (!isLocal && onlineId !== '') return `online:${source}:${onlineId}`
  if (song.filePath) return `file:${song.filePath}`
  return `online:${source || 'unknown'}:${onlineId}`
}

function payloadPathOf(key: string): string {
  return `${AI_LYRIC_DIR}/${key}.json`
}

async function ensureDir(): Promise<void> {
  try {
    await Filesystem.mkdir({ path: AI_LYRIC_DIR, directory: Directory.Data, recursive: true })
  } catch {
    // 已存在
  }
}

async function readText(path: string): Promise<string | null> {
  try {
    const r = await Filesystem.readFile({ path, directory: Directory.Data, encoding: Encoding.UTF8 })
    return typeof r.data === 'string' ? r.data : await (r.data as Blob).text()
  } catch {
    return null
  }
}

export async function listAiLyrics(): Promise<AiLyricEntry[]> {
  const text = await readText(MANIFEST_PATH)
  if (!text) return []
  try {
    const list = JSON.parse(text)
    return Array.isArray(list) ? (list as AiLyricEntry[]) : []
  } catch {
    return []
  }
}

async function saveManifest(list: AiLyricEntry[]): Promise<void> {
  await ensureDir()
  await Filesystem.writeFile({
    path: MANIFEST_PATH,
    directory: Directory.Data,
    data: JSON.stringify(list),
    encoding: Encoding.UTF8,
    recursive: true
  })
}

/** 读取某首歌的 AI 翻译（按 songKey 精确匹配） */
export async function loadAiLyric(songKey: string): Promise<AiLyricPayload | null> {
  const key = aiLyricKeyOf(songKey)
  const text = await readText(payloadPathOf(key))
  if (!text) return null
  try {
    const payload = JSON.parse(text) as AiLyricPayload
    if (!payload || !Array.isArray(payload.lines)) return null
    return payload
  } catch {
    return null
  }
}

export async function hasAiLyric(songKey: string): Promise<boolean> {
  return (await loadAiLyric(songKey)) !== null
}

/** 保存/覆盖一首歌的 AI 翻译 */
export async function saveAiLyric(
  song: PlayerSong,
  payload: AiLyricPayload,
  model: string
): Promise<AiLyricEntry> {
  await ensureDir()
  const songKey = aiSongKeyOf(song)
  const key = aiLyricKeyOf(songKey)
  const content = JSON.stringify(payload)
  await Filesystem.writeFile({
    path: payloadPathOf(key),
    directory: Directory.Data,
    data: content,
    encoding: Encoding.UTF8,
    recursive: true
  })

  const entry: AiLyricEntry = {
    key,
    songKey,
    title: song.title || '未知歌曲',
    artist: song.artist || '未知歌手',
    model,
    createdAt: Date.now(),
    sizeBytes: new Blob([content]).size,
    lineCount: payload.lines.filter((l) => l.text.trim()).length
  }
  const list = await listAiLyrics()
  const idx = list.findIndex((e) => e.key === key)
  if (idx >= 0) list[idx] = entry
  else list.push(entry)
  await saveManifest(list)
  return entry
}

/** 按主键批量删除，返回删除数量 */
export async function deleteAiLyricEntries(keys: string[]): Promise<number> {
  const keySet = new Set(keys)
  const list = await listAiLyrics()
  const removed = list.filter((e) => keySet.has(e.key))
  for (const e of removed) {
    try {
      await Filesystem.deleteFile({
        path: payloadPathOf(e.key),
        directory: Directory.Data
      })
    } catch {
      // 文件可能已不存在
    }
  }
  await saveManifest(list.filter((e) => !keySet.has(e.key)))
  return removed.length
}

/** AI 翻译与逐字歌词文件的关联标记（删除逐字歌词时不影响 AI 翻译） */
export function isAiLyricEntry(value: unknown): value is AiLyricEntry {
  return !!value && typeof value === 'object' && typeof (value as AiLyricEntry).key === 'string'
}
