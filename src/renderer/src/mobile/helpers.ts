import { usePlayerStore, type PlayerSong, type PlaylistSource } from '../stores/playerStore'
import type { GMASong } from '../apis/gma'

// 播放量格式化
export function formatPlayCount(count?: number): string {
  if (!count) return ''
  if (count >= 100000000) return `${(count / 100000000).toFixed(1)}亿`
  if (count >= 10000) return `${Math.round(count / 10000)}万`
  return String(count)
}

// 时长格式化（毫秒 -> mm:ss）
export function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return ''
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// GMA 搜索结果 -> PlayerSong
export function mapGmaSong(s: GMASong): PlayerSong {
  return {
    id: s.id,
    title: s.name,
    artist: s.artist || '未知歌手',
    album: s.album || '',
    cover: s.cover || '',
    durationMs: (s.duration || 0) * 1000,
    source: s.source,
    sourceSongId: s.id
  }
}

// 网易云曲目（playlist/track/all 返回结构）-> PlayerSong
export interface NeteaseTrack {
  id: number
  name: string
  ar?: { name: string }[]
  al?: { name?: string; picUrl?: string }
  dt?: number
}

export function mapNeteaseTrack(t: NeteaseTrack): PlayerSong {
  return {
    id: t.id,
    title: t.name,
    artist: t.ar?.map((a) => a.name).join(' / ') || '未知歌手',
    album: t.al?.name || '',
    cover: t.al?.picUrl || '',
    durationMs: t.dt || 0,
    source: 'wy',
    sourceSongId: t.id
  }
}

/**
 * 统一的播放入口：设置播放列表并从指定索引开始播放
 * 实际的 URL 解析/缓存/歌词获取由 PlayerBar 的 watcher 完成
 * 点歌后自动上滑打开播放页
 */
export function playSongs(songs: PlayerSong[], index: number, source: PlaylistSource = 'search'): void {
  if (!songs.length || index < 0 || index >= songs.length) return
  const player = usePlayerStore()
  player.setPlaylistForSource(source, songs, true)
  player.playSongAtIndex(index)
  player.setPlayerPageShown(true)
}

// 平台元数据
export const PLATFORM_META: Record<string, { label: string; color: string }> = {
  wy: { label: '网易云', color: '#e60026' },
  tx: { label: 'QQ音乐', color: '#31c27c' },
  kg: { label: '酷狗', color: '#2ba2fd' },
  kw: { label: '酷我', color: '#ff9d2e' },
  mg: { label: '咪咕', color: '#7c5cff' },
  netease: { label: '网易云', color: '#e60026' },
  local: { label: '本地', color: '#888' }
}

export function platformLabel(source?: string): string {
  return PLATFORM_META[source || '']?.label || source || ''
}
