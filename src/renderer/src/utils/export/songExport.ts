/**
 * 歌曲文件导出：
 *  - 音频：复制本地音频（或在线缓存文件），并把标题/歌手/专辑/封面写入音频标签
 *  - 歌词：导出干净的逐行 LRC（去掉逐字标签与译文）
 *  - AI 翻译：导出包含译文的合并 LRC
 *  - 逐字歌词：导出增强 LRC（含逐字时间轴）
 *
 * 保存目录由原生 FileExport 插件弹出系统目录选择器，用户可自由选择。
 */
import { Filesystem, Directory } from '@capacitor/filesystem'
import type { PlayerSong } from '../../stores/playerStore'
import { isNativeMobile } from '../../platform'
import { FileExport, type FileExportItem } from '../../platform/mobile/native'
import { readFileBytes, writeFileBytes, uint8ArrayToBase64 } from '../../platform/mobile/fsUtils'
import { aiSongKeyOf, loadAiLyric } from '../aiLyric/aiLyricStorage'
import { hasKaraokeFor, loadKaraokeFor } from '../karaoke/karaokeStorage'
import { buildMergedLrc, parseMainLyricLines } from '../aiLyric/aiLyricService'

export interface SongExportOptions {
  audio: boolean
  lyrics: boolean
  ai: boolean
  karaoke: boolean
}

export interface SongExportAvailability extends SongExportOptions {
  /** 音频扩展名（如 .mp3），无本地文件时为空 */
  audioExt: string
}

export interface SongExportResult {
  canceled: boolean
  count: number
  failed: number
  location?: string
}

/** 查询当前歌曲可导出的内容 */
export async function getSongExportAvailability(
  song: PlayerSong
): Promise<SongExportAvailability> {
  const audioExt = song.filePath ? extOf(song.filePath) : ''
  let ai = false
  try {
    ai = !!(await loadAiLyric(aiSongKeyOf(song)))
  } catch {
    ai = false
  }
  let karaoke = false
  if (song.filePath) {
    try {
      karaoke = await hasKaraokeFor(song.filePath)
    } catch {
      karaoke = false
    }
  }
  return {
    audio: !!song.filePath,
    lyrics: !!song.lyrics?.trim(),
    ai,
    karaoke,
    audioExt
  }
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || '未命名歌曲'
}

function extOf(path: string): string {
  const m = /\.([a-zA-Z0-9]{1,5})(?:[?#].*)?$/.exec(path)
  return m ? `.${m[1].toLowerCase()}` : ''
}

function mimeOf(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.mp3':
      return 'audio/mpeg'
    case '.flac':
      return 'audio/flac'
    case '.m4a':
      return 'audio/mp4'
    case '.aac':
      return 'audio/aac'
    case '.wav':
      return 'audio/wav'
    case '.ogg':
      return 'audio/ogg'
    case '.opus':
      return 'audio/opus'
    default:
      return 'application/octet-stream'
  }
}

function stripFileScheme(path: string): string {
  return path.replace(/^file:\/\//, '')
}

/** 支持写入标签的音频格式（与 writeLocalMeta 保持一致） */
const TAGGABLE_EXTS = new Set(['.mp3', '.flac', '.wav'])

/** 简单校验文件头，避免把扩展名与实际内容不符的文件写坏 */
function looksLikeAudio(bytes: Uint8Array, ext: string): boolean {
  if (bytes.length < 4) return false
  if (ext === '.mp3') {
    const id3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33
    return id3 || bytes[0] === 0xff
  }
  if (ext === '.flac') {
    return bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43
  }
  if (ext === '.wav') {
    return bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
  }
  return false
}

/** 解析封面：data URL / 网络地址 / 本地文件 */
async function resolveCoverImage(
  cover?: string
): Promise<{ base64: string; mime: string } | null> {
  if (!cover) return null

  if (cover.startsWith('data:')) {
    const m = /^data:([^;,]+)?;base64,(.*)$/s.exec(cover)
    if (!m) return null
    return { mime: m[1] || 'image/jpeg', base64: m[2] }
  }

  if (/^https?:/i.test(cover)) {
    try {
      const { CapacitorHttp } = await import('@capacitor/core')
      const res = await CapacitorHttp.get({
        url: cover,
        responseType: 'arraybuffer',
        connectTimeout: 8000,
        readTimeout: 8000
      })
      if (res.status !== 200 || !res.data) return null
      const base64 =
        typeof res.data === 'string'
          ? res.data
          : uint8ArrayToBase64(new Uint8Array(res.data as ArrayBuffer))
      const headers = (res.headers || {}) as Record<string, string>
      const mime = (headers['content-type'] || headers['Content-Type'] || 'image/jpeg')
        .split(';')[0]
        .trim()
      return { base64, mime: mime || 'image/jpeg' }
    } catch {
      return null
    }
  }

  if (cover.startsWith('/') || cover.startsWith('file://')) {
    try {
      const bytes = await readFileBytes(stripFileScheme(cover))
      return { base64: uint8ArrayToBase64(bytes), mime: 'image/jpeg' }
    } catch {
      return null
    }
  }

  return null
}

/**
 * 复制一份音频到应用缓存并写入标题/歌手/专辑/封面标签。
 * 失败时返回 null，调用方回退为导出原始文件。
 */
async function createTaggedAudioCopy(
  song: PlayerSong,
  ext: string
): Promise<{ absPath: string; relPath: string } | null> {
  if (!song.filePath || !TAGGABLE_EXTS.has(ext)) return null

  const relPath = `export-tmp/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
  try {
    const { uri } = await Filesystem.getUri({ path: relPath, directory: Directory.Cache })
    const absPath = stripFileScheme(uri)

    const bytes = await readFileBytes(stripFileScheme(song.filePath))
    await writeFileBytes(absPath, bytes)

    const cover = await resolveCoverImage(song.cover)
    const { writeLocalMeta } = await import('../../platform/mobile/handlers/localMusic')
    const ok = await writeLocalMeta(absPath, {
      ...(song.title ? { title: song.title } : {}),
      ...(song.artist ? { artist: song.artist } : {}),
      ...(song.album ? { album: song.album } : {}),
      ...(cover
        ? { image: { imageBuffer: cover.base64, mime: cover.mime, description: '' } }
        : {})
    })
    if (!ok) throw new Error('写入标签失败')
    return { absPath, relPath }
  } catch (e) {
    console.warn('[导出] 音频标签写入失败，回退为原始文件:', e)
    await Filesystem.deleteFile({ path: relPath, directory: Directory.Cache }).catch(
      () => undefined
    )
    return null
  }
}

/** 生成干净的逐行 LRC：保留元数据行，去掉逐字标签与译文 */
function buildPlainLyrics(lyrics: string): string {
  const lines = parseMainLyricLines(lyrics)
  if (!lines.length) return lyrics
  const meta = lyrics
    .split(/\r?\n/)
    .map((r) => r.trim())
    .filter((r) => /^\[[a-zA-Z#]+:[^\]]*\]$/.test(r))
  return [...meta, ...buildMergedLrc(lines, []).split('\n')].join('\n') + '\n'
}

/** 导出所选内容；返回写入结果 */
export async function exportSongFiles(
  song: PlayerSong,
  options: SongExportOptions
): Promise<SongExportResult> {
  if (!isNativeMobile) {
    throw new Error('仅支持在安卓应用内导出')
  }

  const base = sanitizeFileName(
    [song.title || '未知歌曲', song.artist || '未知歌手'].filter(Boolean).join(' - ')
  )
  const files: FileExportItem[] = []
  let tempRelPath: string | null = null

  try {
    if (options.audio && song.filePath) {
      const ext = extOf(song.filePath) || '.mp3'
      let sourcePath = song.filePath

      const tagged = await createTaggedAudioCopy(song, ext)
      if (tagged) {
        sourcePath = tagged.absPath
        tempRelPath = tagged.relPath
      }

      files.push({
        name: base + ext,
        mimeType: mimeOf(ext),
        sourcePath
      })
    }

    if (options.lyrics && song.lyrics?.trim()) {
      files.push({
        name: base + '.lrc',
        mimeType: 'text/x-lrc',
        text: buildPlainLyrics(song.lyrics)
      })
    }

    if (options.ai) {
      const payload = await loadAiLyric(aiSongKeyOf(song))
      if (payload?.mergedLrc?.trim()) {
        files.push({
          name: base + '.AI.lrc',
          mimeType: 'text/x-lrc',
          text: payload.mergedLrc
        })
      }
    }

    if (options.karaoke && song.filePath) {
      const karaoke = await loadKaraokeFor(song.filePath)
      if (karaoke?.trim()) {
        files.push({
          name: base + '.逐字.lrc',
          mimeType: 'text/x-lrc',
          text: karaoke
        })
      }
    }

    if (!files.length) {
      throw new Error('没有可导出的内容')
    }

    const res = await FileExport.saveFiles({ files })
    return {
      canceled: !!res.canceled,
      count: res.count ?? 0,
      failed: res.failed ?? 0,
      location: res.location
    }
  } finally {
    if (tempRelPath) {
      await Filesystem.deleteFile({ path: tempRelPath, directory: Directory.Cache }).catch(
        () => undefined
      )
    }
  }
}
