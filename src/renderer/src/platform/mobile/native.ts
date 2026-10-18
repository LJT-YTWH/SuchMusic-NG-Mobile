import { registerPlugin } from '@capacitor/core'

// ==================== 本地音乐原生插件 ====================

export interface NativeLocalTrack {
  id: string
  name: string
  filePath: string
  artist: string
  album: string
  durationMs?: number
}

export interface SuchLocalMusicPlugin {
  getMusicDir(): Promise<{ path: string }>
  checkStoragePermission(): Promise<{ granted: boolean }>
  requestStoragePermission(): Promise<{ granted: boolean }>
  scan(options: { dirs?: string[] }): Promise<{
    rootDir: string
    rootDirs: string[]
    tracks: NativeLocalTrack[]
  }>
  chooseDirs(): Promise<{ canceled: boolean; dirs: string[] }>
  deleteFiles(options: {
    paths: string[]
  }): Promise<{ deletedCount: number; failedCount: number }>
  fsExists(options: { path: string }): Promise<{ exists: boolean }>
  getMeta(options: { path: string }): Promise<{
    title?: string
    artist?: string
    album?: string
    durationMs?: number
    bitrate?: number
    coverBase64?: string
    coverMime?: string
  }>
  pickTextFiles(): Promise<{
    canceled: boolean
    files: Array<{ name: string; content: string }>
  }>
}

// ==================== 媒体会话/后台播放插件 ====================

export interface MediaSessionPlugin {
  start(): Promise<void>
  stop(): Promise<void>
  updateMetadata(options: {
    title: string
    artist: string
    album?: string
    coverUrl?: string
    durationMs?: number
  }): Promise<void>
  updatePlayback(options: {
    playing: boolean
    positionMs: number
    durationMs?: number
  }): Promise<void>
  addListener(
    eventName: 'control',
    listenerFunc: (data: { action: string; positionMs?: number }) => void
  ): Promise<{ remove: () => void }>
}

// ==================== 悬浮窗歌词插件 ====================

export interface FloatingLyricLine {
  time: number // 秒
  text: string
  ttext?: string // 翻译
}

export interface FloatingLyricPlugin {
  open(options: { mode: 'full' | 'mini' }): Promise<void>
  close(options: { mode: 'full' | 'mini' }): Promise<void>
  isOpen(options: { mode: 'full' | 'mini' }): Promise<{ open: boolean }>
  updateLyrics(options: { mode: string; lines: FloatingLyricLine[] }): Promise<void>
  updateTime(options: { mode: string; time: number }): Promise<void>
  updatePlaying(options: { mode: string; playing: boolean }): Promise<void>
  updateInfo(options: { mode: string; title: string; artist: string }): Promise<void>
  updateSettings(options: {
    mode: string
    fontSize?: number
    fontColor?: string
    highlightColor?: string
    opacity?: number
    showNextLine?: boolean
    align?: string
    locked?: boolean
  }): Promise<void>
  checkOverlayPermission(): Promise<{ granted: boolean }>
  addListener(
    eventName: 'control',
    listenerFunc: (data: { action: string; mode: string }) => void
  ): Promise<{ remove: () => void }>
}

// ==================== 应用偏好插件（屏幕方向等） ====================

export interface AppPrefsPlugin {
  /** 设置屏幕方向：auto（跟随系统）/ portrait（竖屏）/ landscape（横屏） */
  setOrientation(options: { mode: 'auto' | 'portrait' | 'landscape' }): Promise<void>
}

export const SuchLocalMusic = registerPlugin<SuchLocalMusicPlugin>('SuchLocalMusic')
export const MediaSession = registerPlugin<MediaSessionPlugin>('MediaSession')
export const FloatingLyric = registerPlugin<FloatingLyricPlugin>('FloatingLyric')
export const AppPrefs = registerPlugin<AppPrefsPlugin>('AppPrefs')
