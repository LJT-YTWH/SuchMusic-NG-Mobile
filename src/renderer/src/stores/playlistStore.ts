import { defineStore } from 'pinia'

export interface PlaylistTrack {
  id: string | number | null
  title: string
  artist: string
  album?: string
  cover?: string
  filePath?: string
  durationMs?: number
  source?: string
  sourceSongId?: string | number
}

export interface UserPlaylist {
  id: string
  name: string
  cover?: string
  tracks: PlaylistTrack[]
  createdAt: number
  updatedAt: number
  description?: string
  // 新增外观设置
  coverStyle?: 'square' | 'landscape' | 'wide' | 'adaptive' | 'full'
  titleFontWeight?: 'light' | 'regular' | 'bold' | 'heavy'
  titleFontFamily?: 'default' | 'serif'
}

interface PlaylistState {
  playlists: UserPlaylist[]
}

const STORAGE_KEY = 'user_playlists'

/** 判断两条歌单曲目是否为同一首歌（id 或 平台+平台ID 匹配） */
function sameTrack(a: PlaylistTrack, b: PlaylistTrack): boolean {
  if (a.id && b.id && String(a.id) === String(b.id)) return true
  if (
    a.source &&
    b.source === a.source &&
    a.sourceSongId &&
    b.sourceSongId &&
    String(a.sourceSongId) === String(b.sourceSongId)
  ) {
    return true
  }
  return false
}

export const usePlaylistStore = defineStore('playlist', {
  state: (): PlaylistState => ({
    playlists: []
  }),
  actions: {
    loadFromStorage(): void {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        try {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed)) {
            this.playlists = parsed
          }
        } catch (e) {
          console.error('Failed to load playlists from storage', e)
        }
      }

      // 确保“我喜爱的音乐”歌单存在
      let favoriteIndex = this.playlists.findIndex((p) => p.id === 'favorite')
      if (favoriteIndex === -1) {
        const now = Date.now()
        const favorite: UserPlaylist = {
          id: 'favorite',
          name: '我喜爱的音乐',
          cover: undefined, 
          tracks: [],
          createdAt: now,
          updatedAt: now,
          coverStyle: 'full',
          titleFontWeight: 'bold',
          titleFontFamily: 'serif'
        }
        // 插入到最前面
        this.playlists.unshift(favorite)
        this.saveToStorage()
      } else {
        // 确保它在第一个
        if (favoriteIndex !== 0) {
           const fav = this.playlists.splice(favoriteIndex, 1)[0]
           this.playlists.unshift(fav)
           this.saveToStorage()
        }
      }
    },
    saveToStorage(): void {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.playlists))
      } catch (e) {
        console.error('Failed to save playlists to storage', e)
      }
    },
    createPlaylistFromTracks(name: string, tracks: PlaylistTrack[], cover?: string): UserPlaylist {
      if (name === '我喜爱的音乐') {
        throw new Error('无法创建名为“我喜爱的音乐”的歌单，因为它是系统保留名称')
      }
      const now = Date.now()
      const playlist: UserPlaylist = {
        id: `pl-${now.toString(16)}-${Math.floor(Math.random() * 0xffff).toString(16)}`,
        name,
        cover,
        tracks: [...tracks],
        createdAt: now,
        updatedAt: now
      }
      this.playlists.unshift(playlist)
      this.saveToStorage()
      return playlist
    },
    updatePlaylist(playlist: UserPlaylist): void {
      // 保护“我喜爱的音乐”不被重命名或修改ID
      if (playlist.id === 'favorite' && playlist.name !== '我喜爱的音乐') {
        // 如果尝试修改名称，静默恢复或抛出错误。这里选择仅恢复名称，允许修改其他属性
        playlist.name = '我喜爱的音乐'
      }
      // 防止其他歌单重命名为“我喜爱的音乐”
      if (playlist.id !== 'favorite' && playlist.name === '我喜爱的音乐') {
         throw new Error('无法将歌单重命名为“我喜爱的音乐”，因为它是系统保留名称')
      }

      const index = this.playlists.findIndex((p) => p.id === playlist.id)
      if (index !== -1) {
        this.playlists.splice(index, 1, { ...playlist, updatedAt: Date.now() })
        this.saveToStorage()
      }
    },
    removePlaylist(id: string): void {
      if (id === 'favorite') return // 保护我喜爱的音乐歌单
      const index = this.playlists.findIndex((p) => p.id === id)
      if (index !== -1) {
        this.playlists.splice(index, 1)
        this.saveToStorage()
      }
    },
    /** 曲目是否已在指定歌单中 */
    isTrackInPlaylist(playlistId: string, track: PlaylistTrack): boolean {
      const pl = this.playlists.find((p) => p.id === playlistId)
      if (!pl) return false
      return pl.tracks.some((t) => sameTrack(t, track))
    },

    /** 添加歌曲到指定歌单（去重）；返回 added / exists / notfound */
    addTrackToPlaylist(
      playlistId: string,
      track: PlaylistTrack
    ): 'added' | 'exists' | 'notfound' {
      const pl = this.playlists.find((p) => p.id === playlistId)
      if (!pl) return 'notfound'
      if (pl.tracks.some((t) => sameTrack(t, track))) return 'exists'
      pl.tracks.unshift(track)
      if (!pl.cover && track.cover) pl.cover = track.cover
      pl.updatedAt = Date.now()
      this.saveToStorage()
      return 'added'
    },

    /** 从指定歌单移除歌曲；返回是否真的移除 */
    removeTrackFromPlaylist(playlistId: string, track: PlaylistTrack): boolean {
      const pl = this.playlists.find((p) => p.id === playlistId)
      if (!pl) return false
      const before = pl.tracks.length
      pl.tracks = pl.tracks.filter((t) => !sameTrack(t, track))
      if (pl.tracks.length === before) return false
      pl.updatedAt = Date.now()
      this.saveToStorage()
      return true
    },

    /** 把歌曲从一个歌单移动到另一个歌单；返回 moved / exists / notfound */
    moveTrackToPlaylist(
      track: PlaylistTrack,
      fromPlaylistId: string,
      toPlaylistId: string
    ): 'moved' | 'exists' | 'notfound' {
      if (fromPlaylistId === toPlaylistId) return 'exists'
      const from = this.playlists.find((p) => p.id === fromPlaylistId)
      const to = this.playlists.find((p) => p.id === toPlaylistId)
      if (!from || !to) return 'notfound'
      if (to.tracks.some((t) => sameTrack(t, track))) return 'exists'
      from.tracks = from.tracks.filter((t) => !sameTrack(t, track))
      to.tracks.unshift(track)
      if (!to.cover && track.cover) to.cover = track.cover
      const now = Date.now()
      from.updatedAt = now
      to.updatedAt = now
      this.saveToStorage()
      return 'moved'
    },

    toggleFavorite(track: PlaylistTrack): boolean {
      const fav = this.playlists.find((p) => p.id === 'favorite')
      if (!fav) return false

      const isMatch = (t: PlaylistTrack) => {
        // 1. 尝试通过 ID 匹配（转为字符串比较）
        if (t.id && track.id && String(t.id) === String(track.id)) {
          return true
        }
        // 2. 尝试通过 source + sourceSongId 匹配
        if (
          track.source &&
          t.source === track.source &&
          track.sourceSongId &&
          t.sourceSongId &&
          String(t.sourceSongId) === String(track.sourceSongId)
        ) {
          return true
        }
        return false
      }

      const hasMatch = fav.tracks.some(isMatch)

      if (hasMatch) {
        // 移除所有匹配的歌曲（防止出现重复造成的“一直取消收藏”问题）
        fav.tracks = fav.tracks.filter((t) => !isMatch(t))
        this.saveToStorage()
        return false
      } else {
        fav.tracks.unshift(track)
        // 更新封面
        if (!fav.cover && track.cover) {
          fav.cover = track.cover
        }
        this.saveToStorage()
        return true
      }
    },
    isFavorite(track: PlaylistTrack): boolean {
      const fav = this.playlists.find((p) => p.id === 'favorite')
      if (!fav) return false
      
      return fav.tracks.some((t) => {
        if (t.id && track.id && String(t.id) === String(track.id)) {
          return true
        }
        if (
          track.source &&
          t.source === track.source &&
          track.sourceSongId &&
          t.sourceSongId &&
          String(t.sourceSongId) === String(track.sourceSongId)
        ) {
          return true
        }
        return false
      })
    }
  }
})

