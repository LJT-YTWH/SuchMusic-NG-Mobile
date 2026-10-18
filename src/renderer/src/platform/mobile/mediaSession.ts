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
    await MediaSession.updateMetadata(options)
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
