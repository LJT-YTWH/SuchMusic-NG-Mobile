import request from '../../../utils/request'

export interface OnlinePlaylistDetail {
  id: number
  name: string
  coverImgUrl: string
  description?: string
  playCount?: number
  trackCount?: number
  creator?: { nickname?: string; avatarUrl?: string }
}

interface PlaylistDetailResponse {
  code: number
  playlist?: OnlinePlaylistDetail
}

interface PlaylistTrackAllResponse {
  code: number
  songs?: unknown[]
}

/** 获取在线歌单详情（网易云） */
export async function fetchPlaylistDetail(id: number | string): Promise<OnlinePlaylistDetail | null> {
  try {
    const data = await request<PlaylistDetailResponse>('/playlist/detail', { id })
    if (data.code !== 200 || !data.playlist) return null
    return data.playlist
  } catch (e) {
    console.error('[PlaylistDetail] 获取歌单详情失败', e)
    return null
  }
}

/** 获取歌单全部曲目 */
export async function fetchPlaylistTracks<T = unknown>(
  id: number | string,
  limit = 500,
  offset = 0
): Promise<T[]> {
  try {
    const data = await request<PlaylistTrackAllResponse>('/playlist/track/all', { id, limit, offset })
    if (!Array.isArray(data.songs)) return []
    return data.songs as T[]
  } catch (e) {
    console.error('[PlaylistDetail] 获取歌单曲目失败', e)
    return []
  }
}
