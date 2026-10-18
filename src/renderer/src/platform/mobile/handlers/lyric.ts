import { FloatingLyric, type FloatingLyricLine } from '../native'
import { emitChannel } from '../emitter'

// 桌面歌词 -> full 悬浮窗；任务栏歌词 -> mini 悬浮窗
type LyricMode = 'full' | 'mini'

const openState: Record<LyricMode, boolean> = { full: false, mini: false }

function modeOf(channelPrefix: string): LyricMode {
  return channelPrefix === 'desktop-lyric' ? 'full' : 'mini'
}

// 将 AMLL LyricLine[] 转换为原生悬浮窗需要的简化结构
interface AmllWord {
  word?: string
  startTime?: number
}
interface AmllLine {
  words?: AmllWord[]
  translatedLyric?: string
}

function convertLyrics(raw: unknown): FloatingLyricLine[] {
  if (!Array.isArray(raw)) return []
  return (raw as AmllLine[]).map((line) => {
    const words = Array.isArray(line?.words) ? line.words : []
    const startMs = words.length ? (words[0]?.startTime ?? 0) : 0
    return {
      time: startMs / 1000,
      text: words.map((w) => w?.word ?? '').join(''),
      ttext: line?.translatedLyric || undefined
    }
  })
}

// 初始化原生事件转发（控制按钮 -> player:control）
let eventsBound = false
export function bindLyricEvents(): void {
  if (eventsBound) return
  eventsBound = true
  void FloatingLyric.addListener('control', ({ action, mode }) => {
    if (action === 'close') {
      // 悬浮窗上的关闭按钮：原生已隐藏，仅同步状态
      openState[mode === 'mini' ? 'mini' : 'full'] = false
      return
    }
    emitChannel('player:control', action)
  })
}

export async function lyricOpen(prefix: string): Promise<void> {
  const mode = modeOf(prefix)
  // 权限检查与设置页跳转由原生插件处理
  await FloatingLyric.open({ mode })
  openState[mode] = true
}

export async function lyricClose(prefix: string): Promise<void> {
  const mode = modeOf(prefix)
  await FloatingLyric.close({ mode })
  openState[mode] = false
}

export async function lyricToggle(prefix: string): Promise<boolean> {
  const mode = modeOf(prefix)
  if (openState[mode]) {
    await lyricClose(prefix)
  } else {
    await lyricOpen(prefix)
  }
  return openState[mode]
}

export async function lyricIsOpen(prefix: string): Promise<boolean> {
  const mode = modeOf(prefix)
  try {
    const r = await FloatingLyric.isOpen({ mode })
    openState[mode] = r.open
  } catch {
    // 使用本地状态
  }
  return openState[mode]
}

// send 语义的消息分发
export function lyricSend(prefix: string, channel: string, payload: unknown): void {
  const mode = modeOf(prefix)
  if (!openState[mode] && !channel.endsWith(':ready')) return
  switch (channel) {
    case `${prefix}:set-lyrics`:
      void FloatingLyric.updateLyrics({ mode, lines: convertLyrics(payload) })
      break
    case `${prefix}:time-update`:
      void FloatingLyric.updateTime({ mode, time: Number(payload) || 0 })
      break
    case `${prefix}:set-playing`:
      void FloatingLyric.updatePlaying({ mode, playing: !!payload })
      break
    case `${prefix}:set-info`: {
      const info = (payload || {}) as { title?: string; artist?: string }
      void FloatingLyric.updateInfo({ mode, title: info.title || '', artist: info.artist || '' })
      break
    }
    case `${prefix}:set-settings`: {
      const s = (payload || {}) as Record<string, unknown>
      void FloatingLyric.updateSettings({
        mode,
        fontSize: s.fontSize as number | undefined,
        fontColor: s.fontColor as string | undefined,
        highlightColor: s.highlightColor as string | undefined,
        opacity: s.opacity as number | undefined,
        showNextLine: s.showNextLine as boolean | undefined,
        align: s.align as string | undefined,
        locked: s.locked as boolean | undefined
      })
      break
    }
    case `${prefix}:control`:
      // 与桌面端一致：控制动作转发到主窗口 player:control
      emitChannel('player:control', payload)
      break
    case `${prefix}:move`:
      // 原生悬浮窗自行处理拖动
      break
    default:
      break
  }
}
