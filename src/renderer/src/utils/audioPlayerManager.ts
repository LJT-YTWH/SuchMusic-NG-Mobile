import { webAudioEngine } from '../audio/audio-engine'
import { usePlayerStore } from '../stores/playerStore'
import { isNativeMobile } from '../platform'

interface PlayAudioOptions {
  url?: string
  filePath?: string
  volume?: number
}

export class AudioPlayerManager {
  /**
   * 统一播放入口
   * 优先尝试播放本地文件/缓存文件，如果失败或无文件则尝试播放 URL
   */
  static async play(options: PlayAudioOptions): Promise<void> {
    await this.handleAudio(options, true)
  }

  /**
   * 加载音频但不播放
   */
  static async load(options: PlayAudioOptions): Promise<void> {
    await this.handleAudio(options, false)
  }

  private static async handleAudio(options: PlayAudioOptions, autoPlay: boolean): Promise<void> {
    const { url, filePath, volume } = options
    const playerStore = usePlayerStore()
    
    // 设置音量（如果未提供，使用 store 中的音量）
    const vol = volume ?? playerStore.volume
    webAudioEngine.setVolume(vol)

    // 1. 尝试本地文件（filePath）
    if (filePath && window.electron && window.electron.ipcRenderer) {
      try {
        // 先检查文件是否存在
        const exists = await window.electron.ipcRenderer.invoke('system:fs-exists', filePath)
        if (exists) {
          console.log(`[AudioPlayerManager] ${autoPlay ? 'Playing' : 'Loading'} from local file:`, filePath)

          // 移动端：经 Capacitor 文件桥流式播放（不整文件解码，避免切歌卡顿）
          if (isNativeMobile) {
            if (autoPlay) {
              await webAudioEngine.playFromFilePath(filePath)
            } else {
              const { Capacitor } = await import('@capacitor/core')
              await webAudioEngine.loadFromUrl(Capacitor.convertFileSrc(filePath))
            }
            return
          }

          const data = (await window.electron.ipcRenderer.invoke(
            'audio:load-file',
            filePath
          )) as ArrayBuffer

          if (autoPlay) {
            await webAudioEngine.playFromFileData(data)
          } else {
            await webAudioEngine.loadFromFileData(data)
          }
          return
        } else {
          console.warn('[AudioPlayerManager] Local file not found:', filePath)
        }
      } catch (e) {
        console.error('[AudioPlayerManager] Failed to handle local file, fallback to URL:', e)
        // 失败后继续尝试 URL
      }
    }

    // 2. 尝试在线 URL
    if (url) {
      console.log(`[AudioPlayerManager] ${autoPlay ? 'Playing' : 'Loading'} from URL:`, url)
      
      try {
        if (autoPlay) {
          await webAudioEngine.playFromUrl(url)
        } else {
          await webAudioEngine.loadFromUrl(url)
        }
      } catch (e) {
        console.error('[AudioPlayerManager] Failed to handle URL:', e)
        throw e
      }
    } else {
      throw new Error('[AudioPlayerManager] No valid source (filePath or url) provided')
    }
  }
}
