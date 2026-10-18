import { MediaSession } from './native'
import { emitChannel } from './emitter'

let bound = false
let serviceStarted = false

/** 绑定媒体通知控制事件（play/pause/next/prev -> player:control） */
export function bindMediaSessionEvents(): void {
  if (bound) return
  bound = true
  void MediaSession.addListener('control', ({ action, positionMs }) => {
    // 原生通知按钮动作映射到 App.vue 已监听的 player:control
    if (action === 'seekto') {
      emitChannel('player:control', `seekto:${positionMs ?? 0}`)
    } else {
      emitChannel('player:control', action)
    }
  })
}

/** data URL 超过该长度就压缩（Intent extra 有 ~1MB 上限，超大封面会崩溃） */
const MAX_COVER_DATA_URL = 160_000

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('cover load failed'))
    img.src = src
  })
}

/**
 * 缩略内嵌封面（data URL）：本地歌曲封面是 base64 原图，可能上 MB。
 * 状态栏媒体胶囊只需要 ~512px，压缩后既保证显示，也避免 Intent 传输过大。
 */
async function shrinkCover(url?: string): Promise<string> {
  if (!url) return ''
  if (!url.startsWith('data:image') || url.length <= MAX_COVER_DATA_URL) return url
  try {
    const img = await loadImageElement(url)
    const srcW = img.naturalWidth || img.width
    const srcH = img.naturalHeight || img.height
    if (!srcW || !srcH) return url
    const max = 512
    const scale = Math.min(1, max / Math.max(srcW, srcH))
    const w = Math.max(1, Math.round(srcW * scale))
    const h = Math.max(1, Math.round(srcH * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return url
    ctx.drawImage(img, 0, 0, w, h)
    const out = canvas.toDataURL('image/jpeg', 0.86)
    return out.length < url.length ? out : url
  } catch {
    return url
  }
}

/** 更新媒体通知元数据（切歌时调用） */
export async function updateMediaMetadata(options: {
  title: string
  artist: string
  album?: string
  coverUrl?: string
  durationMs?: number
}): Promise<void> {
  try {
    if (!serviceStarted) {
      await MediaSession.start()
      serviceStarted = true
    }
    await MediaSession.updateMetadata({
      ...options,
      coverUrl: await shrinkCover(options.coverUrl)
    })
  } catch (e) {
    console.error('updateMediaMetadata failed', e)
  }
}

/** 更新播放状态（播放/暂停/进度） */
export async function updateMediaPlayback(options: {
  playing: boolean
  positionMs: number
  durationMs?: number
}): Promise<void> {
  try {
    if (!serviceStarted) {
      await MediaSession.start()
      serviceStarted = true
    }
    await MediaSession.updatePlayback(options)
  } catch (e) {
    console.error('updateMediaPlayback failed', e)
  }
}

export async function stopMediaSession(): Promise<void> {
  try {
    await MediaSession.stop()
    serviceStarted = false
  } catch {
    // ignore
  }
}
