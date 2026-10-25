/**
 * AI 歌词翻译
 *
 * 流程：解析当前歌词 → 分块调用星火（关闭思考）→ 逐行译文对齐时间轴
 *      → 保存到 ai-lyrics/ → 若该曲已有逐字歌词，把译文插回逐字歌词文件。
 *
 * 翻译结果以「同一时间戳追加一行」的方式表示，这与应用现有 LRC 解析器
 * （ParseLrc：同时间戳第二行 = 翻译）以及逐字歌词生成器（buildKaraokeLrc）一致。
 */
import { sparkChat, SPARK_MODEL } from '../../apis/spark'
import type { PlayerSong } from '../../stores/playerStore'
import {
  loadKaraokeFor,
  hasKaraokeFor,
  updateKaraokeContent
} from '../karaoke/karaokeStorage'
import {
  aiLyricKeyOf,
  aiSongKeyOf,
  deleteAiLyricEntries,
  loadAiLyric,
  saveAiLyric,
  type AiLyricEntry,
  type AiLyricLine,
  type AiLyricPayload
} from './aiLyricStorage'
import { parseLyricsToCore } from '../lyric/lyricParser'

/** 解析出的主歌词行 */
export interface LyricLineLite {
  timeMs: number
  text: string
}

const TIME_TAG_RE = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
const WORD_TAG_RE = /<\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?>/g
/** 单次请求的歌词行数（1.7B 小模型上下文与稳定性折中） */
const CHUNK_SIZE = 40

function msToLrcTime(ms: number): string {
  const total = Math.max(0, Math.round(ms))
  const m = Math.floor(total / 60000)
  const s = Math.floor((total % 60000) / 1000)
  const cs = Math.floor((total % 1000) / 10)
  return `[${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}]`
}

/** 是否为逐字（增强）歌词文本 */
export function isKaraokeContent(content: string): boolean {
  return /<\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?>/.test(content)
}

function tagToMs(min: string, sec: string, frac?: string): number {
  const f = (frac || '0').padEnd(3, '0').slice(0, 3)
  return Number(min) * 60000 + Number(sec) * 1000 + Number(f)
}

/**
 * 解析主歌词行：去掉时间标签与逐字标签，同一时间戳只保留第一条
 * （第二条起通常是翻译/音译，避免把译文再翻译一遍）。
 */
export function parseMainLyricLines(content: string): LyricLineLite[] {
  if (!content) return []
  const found: Array<{ timeMs: number; text: string; order: number }> = []
  let order = 0

  for (const row of content.split(/\r?\n/)) {
    const times: number[] = []
    let m: RegExpExecArray | null
    TIME_TAG_RE.lastIndex = 0
    while ((m = TIME_TAG_RE.exec(row)) !== null) {
      times.push(tagToMs(m[1], m[2], m[3]))
    }
    if (!times.length) continue

    const text = row.replace(TIME_TAG_RE, '').replace(WORD_TAG_RE, '').trim()
    if (!text) continue

    for (const timeMs of times) {
      found.push({ timeMs, text, order: order++ })
    }
  }

  found.sort((a, b) => a.timeMs - b.timeMs || a.order - b.order)

  // 同一时间戳只保留第一条（翻译/音译行丢弃）
  const result: LyricLineLite[] = []
  for (const item of found) {
    if (result.some((r) => Math.abs(r.timeMs - item.timeMs) < 10)) continue
    result.push({ timeMs: item.timeMs, text: item.text })
  }

  // YRC / QRC / TTML 等非标准 LRC：交给应用现有的解析器取行级时间轴
  if (!result.length) {
    try {
      const core = parseLyricsToCore(content)
      const fallback: LyricLineLite[] = []
      for (const line of core) {
        const text = (line.words || []).map((w) => w.word).join('').trim()
        if (!text) continue
        const timeMs = Number(line.startTime) || 0
        if (fallback.some((r) => Math.abs(r.timeMs - timeMs) < 10)) continue
        fallback.push({ timeMs, text })
      }
      return fallback
    } catch {
      return []
    }
  }

  return result
}

/** 合并为逐行 LRC（原文行 + 同时间戳译文行） */
export function buildMergedLrc(lines: LyricLineLite[], translations: AiLyricLine[]): string {
  const map = new Map<number, string>()
  for (const t of translations) {
    if (t.text.trim()) map.set(t.timeMs, t.text.trim())
  }
  const rows: string[] = []
  for (const line of lines) {
    const tag = msToLrcTime(line.timeMs)
    rows.push(`${tag}${line.text}`)
    const tr = map.get(line.timeMs)
    if (tr) rows.push(`${tag}${tr}`)
  }
  return rows.join('\n')
}

/**
 * 把译文插入逐字歌词：每个主行后追加一条同时间戳的翻译行。
 * 旧的翻译行会被替换（重新生成时不会累积）。
 */
export function injectTranslationsIntoKaraoke(
  karaoke: string,
  translations: AiLyricLine[]
): string {
  const map = new Map<number, string>()
  for (const t of translations) {
    if (t.text.trim()) map.set(Math.round(t.timeMs / 10) * 10, t.text.trim())
  }

  const rows = karaoke.split(/\r?\n/)
  const out: string[] = []
  let matched = 0

  for (const row of rows) {
    if (!row.trim()) continue
    const m = /^\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\](.*)$/.exec(row)
    if (!m) {
      // 元数据行（[ti:]、[offset:] 等）原样保留
      out.push(row)
      continue
    }
    const body = m[4]
    // 没有逐字标签的行是翻译/音译行：丢弃旧内容，稍后按 AI 结果重建
    if (!body.includes('<')) continue

    const timeMs = tagToMs(m[1], m[2], m[3])
    out.push(row)
    const tr = map.get(Math.round(timeMs / 10) * 10)
    if (tr) {
      out.push(`${msToLrcTime(timeMs)}${tr}`)
      matched += 1
    }
  }

  // 时间轴完全对不上（歌词源不同）：保持原文件不变，避免把原有翻译清空
  if (!matched) return karaoke
  return out.join('\n') + '\n'
}

/** 判断当前歌词里是否已经包含这批译文（避免重复应用导致行数膨胀） */
function alreadyHasTranslation(content: string, translations: AiLyricLine[]): boolean {
  const sample = translations.find((t) => t.text.trim())
  if (!sample) return true
  const tag = msToLrcTime(sample.timeMs)
  return content.split(/\r?\n/).some((row) => row.startsWith(tag) && row.includes(sample.text.trim()))
}

// ==================== 模型调用 ====================

function buildMessages(
  song: PlayerSong,
  lines: LyricLineLite[],
  requirement: string
): Array<{ role: 'system' | 'user'; content: string }> {
  const numbered = lines.map((l, i) => `${i + 1}|||${l.text}`).join('\n')
  const background = requirement.trim() || '无（按歌词本身判断语气与语境）'

  return [
    {
      role: 'system',
      content:
        '你是专业的歌词翻译器。用户会给出带编号的歌词，请逐行翻译。\n' +
        '硬性要求：\n' +
        '1. 输出格式严格为「编号|||译文」，一行一条，编号必须与输入一一对应；\n' +
        '2. 只输出译文行，不要输出原文、说明、空行、Markdown 代码块；\n' +
        '3. 默认翻译为简体中文；若原文已是中文，则翻译为英文；\n' +
        '4. 保留原歌词的语气、押韵意图、意象与人称，不要合并或拆分句子；\n' +
        '5. 若某行是语气词或重复句，也必须给出对应译文，不能省略；\n' +
        '6. 除人名、地名、品牌等专有名词外，不要保留未翻译的外文单词。'
    },
    {
      role: 'user',
      content:
        `【歌曲】${song.title || '未知歌曲'} - ${song.artist || '未知歌手'}\n` +
        `【背景/翻译要求】${background}\n` +
        `【歌词】\n${numbered}`
    }
  ]
}

/** 解析模型输出为按序号的译文数组 */
function parseTranslationOutput(text: string, count: number): string[] {
  const result = new Array<string>(count).fill('')

  // 兼容模型偶尔输出 JSON 数组的情况
  const trimmed = text.trim()
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const data = JSON.parse(trimmed) as unknown
      const arr = Array.isArray(data)
        ? data
        : (data as { translations?: unknown }).translations
      if (Array.isArray(arr)) {
        arr.slice(0, count).forEach((v, i) => {
          if (typeof v === 'string') result[i] = v.trim()
        })
        if (result.filter(Boolean).length) return result
      }
    } catch {
      // 继续按行解析
    }
  }

  for (const row of text.split(/\r?\n/)) {
    const m = /^\s*(\d{1,3})\s*(?:\|\|\||\|\||\||｜｜｜|｜|[:：.、])\s*(.*)$/.exec(row)
    if (!m) continue
    const idx = Number(m[1]) - 1
    if (idx < 0 || idx >= count) continue
    const value = m[2].trim()
    if (value) result[idx] = value
  }
  return result
}

async function translateChunk(
  song: PlayerSong,
  lines: LyricLineLite[],
  requirement: string
): Promise<string[]> {
  const messages = buildMessages(song, lines, requirement)
  const maxTokens = Math.min(4096, Math.max(512, lines.length * 96))

  let output = await sparkChat(messages, {
    temperature: 0.3,
    maxTokens,
    disableThinking: true
  })
  let parsed = parseTranslationOutput(output, lines.length)

  // 命中率过低时重试一次（小模型偶发不按格式输出）
  if (parsed.filter(Boolean).length < Math.ceil(lines.length * 0.6)) {
    output = await sparkChat(
      [
        ...messages,
        {
          role: 'user',
          content: '请严格按「编号|||译文」重新输出，不要遗漏任何编号，不要输出其它内容。'
        }
      ],
      { temperature: 0.2, maxTokens, disableThinking: true }
    )
    parsed = parseTranslationOutput(output, lines.length)
  }

  return parsed
}

export interface TranslateProgress {
  stage: string
  done: number
  total: number
}

export interface TranslateResult {
  /** 合并译文后的逐行 LRC */
  mergedLrc: string
  /** 实际得到译文的行数 */
  translatedCount: number
  /** 当前歌曲是否已有逐字歌词（由调用方决定是否重新生成） */
  hasKaraoke: boolean
}

/**
 * 为当前歌曲生成 AI 翻译
 * @param song 当前歌曲
 * @param lyrics 当前歌词内容（逐行或逐字均可）
 * @param requirement 用户填写的翻译要求/歌曲背景
 */
export async function translateSongLyrics(options: {
  song: PlayerSong
  lyrics: string
  requirement: string
  onProgress?: (p: TranslateProgress) => void
}): Promise<TranslateResult> {
  const { song, lyrics, requirement, onProgress } = options
  if (!lyrics.trim()) throw new Error('当前歌曲没有可用歌词，无法翻译')

  const lines = parseMainLyricLines(lyrics)
  if (!lines.length) throw new Error('歌词中没有可识别的时间轴行')

  const total = Math.ceil(lines.length / CHUNK_SIZE)
  const translated: string[] = []

  for (let i = 0; i < total; i++) {
    const slice = lines.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
    onProgress?.({ stage: `正在翻译第 ${i + 1}/${total} 段…`, done: i, total })
    const part = await translateChunk(song, slice, requirement)
    translated.push(...part)
  }

  const aiLines: AiLyricLine[] = lines.map((line, i) => ({
    timeMs: line.timeMs,
    text: (translated[i] || '').trim()
  }))
  const translatedCount = aiLines.filter((l) => l.text).length
  if (!translatedCount) throw new Error('模型没有返回可用的译文，请重试')

  const mergedLrc = buildMergedLrc(lines, aiLines)
  const payload: AiLyricPayload = {
    lines: aiLines,
    mergedLrc,
    requirement: requirement.trim() || undefined
  }
  await saveAiLyric(song, payload, SPARK_MODEL)

  // 是否已有逐字歌词：交给界面询问「是否重新生成逐字歌词」
  let hasKaraoke = false
  if (song.filePath) {
    hasKaraoke = (await hasKaraokeFor(song.filePath)) === true
    if (hasKaraoke) {
      const karaoke = await loadKaraokeFor(song.filePath)
      hasKaraoke = !!karaoke && isKaraokeContent(karaoke)
    }
  }

  onProgress?.({ stage: '完成', done: total, total })
  return { mergedLrc, translatedCount, hasKaraoke }
}

/**
 * 保留现有逐字歌词：把已保存的 AI 译文插入逐字歌词文件。
 * 返回插入后的逐字歌词（失败时返回 null）。
 */
export async function applyAiLyricToKaraoke(song: PlayerSong): Promise<string | null> {
  if (!song.filePath) return null
  const payload = await loadAiLyric(aiSongKeyOf(song))
  if (!payload?.lines.length) return null
  const karaoke = await loadKaraokeFor(song.filePath)
  if (!karaoke || !isKaraokeContent(karaoke)) return null
  const next = injectTranslationsIntoKaraoke(karaoke, payload.lines)
  if (next === karaoke) return karaoke
  await updateKaraokeContent(song.filePath, next)
  return next
}

/**
 * 播放时自动套用已保存的 AI 翻译（存在则合并；已包含则返回 null）
 */
export async function applySavedAiLyric(
  song: PlayerSong,
  currentLyrics: string
): Promise<string | null> {
  if (!currentLyrics.trim()) return null
  const payload = await loadAiLyric(aiSongKeyOf(song))
  if (!payload || !payload.lines.length) return null
  if (alreadyHasTranslation(currentLyrics, payload.lines)) return null

  if (isKaraokeContent(currentLyrics)) {
    const merged = injectTranslationsIntoKaraoke(currentLyrics, payload.lines)
    if (merged === currentLyrics) return null
    // 逐字歌词文件同步写入，避免下次重新加载时丢失译文
    if (song.filePath) {
      await updateKaraokeContent(song.filePath, merged).catch(() => undefined)
    }
    return merged
  }

  const lines = parseMainLyricLines(currentLyrics)
  if (!lines.length) return null
  const merged = buildMergedLrc(lines, payload.lines)
  return merged === currentLyrics ? null : merged
}

// ==================== 清空 AI 翻译 ====================

function translationKey(timeMs: number, text: string): string {
  return `${Math.round(timeMs / 10) * 10}|${text.trim()}`
}

/**
 * 从逐字歌词中移除这批 AI 译文。
 * 只删除「时间戳 + 文本」都与 AI 结果一致的行，其它翻译行保持原样。
 */
export function removeTranslationsFromKaraoke(
  karaoke: string,
  translations: AiLyricLine[]
): string {
  const targets = new Set(
    translations.filter((t) => t.text.trim()).map((t) => translationKey(t.timeMs, t.text))
  )
  if (!targets.size) return karaoke

  const out: string[] = []
  for (const row of karaoke.split(/\r?\n/)) {
    if (!row.trim()) continue
    const m = /^\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\](.*)$/.exec(row)
    if (!m) {
      out.push(row)
      continue
    }
    const body = m[4]
    // 主行（含逐字标签）永远保留
    if (body.includes('<')) {
      out.push(row)
      continue
    }
    const timeMs = tagToMs(m[1], m[2], m[3])
    if (targets.has(translationKey(timeMs, body))) continue
    out.push(row)
  }
  return out.join('\n') + '\n'
}

/** 从普通逐行歌词中移除翻译行（只保留主歌词行） */
export function removeTranslationsFromLrc(lyrics: string): string {
  const lines = parseMainLyricLines(lyrics)
  if (!lines.length) return lyrics
  return buildMergedLrc(lines, [])
}

export interface ClearAiLyricResult {
  /** 是否确实存在并删除了 AI 翻译 */
  removed: boolean
  /** 更新后的逐字歌词（存在且被清理时） */
  karaokeContent?: string
  /** 清理后的逐行歌词（当前歌词不是逐字歌词时） */
  plainLyrics?: string
  karaokeUpdated: boolean
  lines: AiLyricLine[]
}

/**
 * 清空当前歌曲的 AI 翻译：
 * 删除 ai-lyrics 存储，并把之前写进逐字歌词文件的中文译文移除。
 */
export async function clearAiLyricForSong(song: PlayerSong): Promise<ClearAiLyricResult> {
  const songKey = aiSongKeyOf(song)
  const payload = await loadAiLyric(songKey)
  if (!payload) {
    return { removed: false, karaokeUpdated: false, lines: [] }
  }

  let karaokeContent: string | undefined
  let karaokeUpdated = false

  if (song.filePath && (await hasKaraokeFor(song.filePath))) {
    const karaoke = await loadKaraokeFor(song.filePath)
    if (karaoke && isKaraokeContent(karaoke)) {
      const next = removeTranslationsFromKaraoke(karaoke, payload.lines)
      karaokeContent = next
      if (next !== karaoke) {
        await updateKaraokeContent(song.filePath, next)
        karaokeUpdated = true
      }
    }
  }

  const plainLyrics =
    song.lyrics && !isKaraokeContent(song.lyrics)
      ? removeTranslationsFromLrc(song.lyrics)
      : undefined

  await deleteAiLyricEntries([aiLyricKeyOf(songKey)])
  return { removed: true, karaokeContent, plainLyrics, karaokeUpdated, lines: payload.lines }
}

/**
 * 按存储条目清空（设置页批量删除用）：删除存储 + 清理对应逐字歌词。
 * 返回清理后的逐字歌词与文件路径，便于调用方同步当前播放。
 */
export async function clearAiLyricByEntry(entry: AiLyricEntry): Promise<{
  karaokeContent?: string
  filePath?: string
  lines: AiLyricLine[]
}> {
  const payload = await loadAiLyric(entry.songKey)
  const lines = payload?.lines ?? []
  let karaokeContent: string | undefined
  let filePath: string | undefined

  if (lines.length && entry.songKey.startsWith('file:')) {
    filePath = entry.songKey.slice(5)
    if (await hasKaraokeFor(filePath)) {
      const karaoke = await loadKaraokeFor(filePath)
      if (karaoke && isKaraokeContent(karaoke)) {
        const next = removeTranslationsFromKaraoke(karaoke, lines)
        if (next !== karaoke) {
          await updateKaraokeContent(filePath, next)
          karaokeContent = next
        }
      }
    }
  }

  await deleteAiLyricEntries([entry.key])
  return { karaokeContent, filePath, lines }
}
