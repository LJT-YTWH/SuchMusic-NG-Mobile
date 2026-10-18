// 原 GMA 聚合搜索服务（gma.api.enzymeym.top）已不可用（502），
// 本模块已切换到内置网易云 API（api.enzymeym.top，与电脑版一致的内置接口），
// 保持原有导出签名不变，调用方无需修改。
import { cloudSearch } from './netease/search/cloudsearch'
import { fetchNewLyric } from './netease/lyric'
import type { SearchSong } from './netease/search/cloudsearch'

export interface GMASong {
  id: string
  name: string
  artist: string
  album: string
  cover: string
  duration: number // seconds
  source: string
  url: string
  size?: number
  ext?: string
  is_invalid?: boolean
  link?: string
}

export interface GMAResponse<T> {
  code: number
  msg: string
  data: T
}

export interface GMAPlaylist {
  id: string
  name: string
  cover: string
  link: string
  source: string
  author?: {
    name: string
    avatar?: string
  }
  playCount?: number
  trackCount?: number
}

export interface GMASearchResult {
  songs: GMASong[]
  playlists: GMAPlaylist[]
}

// 内置接口仅提供网易云数据；判断所选平台是否包含网易云
const includesNetease = (sources?: string[]): boolean =>
  !sources || sources.length === 0 || sources.some((s) => s === 'wy' || s === 'netease')

const mapSong = (song: SearchSong): GMASong => ({
  id: String(song.id),
  name: song.name,
  artist: (song.ar || []).map((a) => a.name).join('/'),
  album: song.al?.name || '',
  cover: song.al?.picUrl ? `${song.al.picUrl}?param=300y300` : '',
  duration: Math.round((song.dt || 0) / 1000),
  source: 'wy',
  url: '',
  // st === -200 表示无版权
  is_invalid: song.privilege?.st === -200,
  link: `https://music.163.com/song?id=${song.id}`
})

interface NeteasePlaylistRaw {
  id: number
  name: string
  coverImgUrl?: string
  trackCount?: number
  playCount?: number
  creator?: { nickname?: string; avatarUrl?: string }
}

const mapPlaylist = (pl: NeteasePlaylistRaw): GMAPlaylist => ({
  id: String(pl.id),
  name: pl.name,
  cover: pl.coverImgUrl ? `${pl.coverImgUrl}?param=300y300` : '',
  link: `https://music.163.com/playlist?id=${pl.id}`,
  source: 'wy',
  author: pl.creator ? { name: pl.creator.nickname || '', avatar: pl.creator.avatarUrl } : undefined,
  playCount: pl.playCount,
  trackCount: pl.trackCount
})

export const searchMusic = async (
  keyword: string,
  page: number = 1,
  limit: number = 30,
  sources?: string[],
  type: 'song' | 'playlist' = 'song'
): Promise<GMASearchResult> => {
  const result: GMASearchResult = { songs: [], playlists: [] }
  if (!includesNetease(sources)) return result

  const offset = Math.max(0, (page - 1) * limit)
  const data = await cloudSearch(keyword, type === 'song' ? 1 : 1000, limit, offset)

  if (data && data.code === 200 && data.result) {
    if (type === 'song' && Array.isArray(data.result.songs)) {
      result.songs = data.result.songs.map(mapSong)
    }
    if (type === 'playlist' && Array.isArray(data.result.playlists)) {
      result.playlists = (data.result.playlists as NeteasePlaylistRaw[]).map(mapPlaylist)
    }
  }
  return result
}

/**
 * 获取歌词（内置网易云歌词接口）
 * @param id 音乐 ID
 * @param source 平台
 */
export const fetchGMALyric = async (id: string, source: string): Promise<string> => {
  try {
    if (source !== 'wy' && source !== 'netease') return ''
    const data = await fetchNewLyric(id)
    if (data && data.code === 200) {
      return data.lrc?.lyric || data.klyric?.lyric || ''
    }
    return ''
  } catch (error) {
    console.error('Failed to fetch lyric:', error)
    return ''
  }
}
