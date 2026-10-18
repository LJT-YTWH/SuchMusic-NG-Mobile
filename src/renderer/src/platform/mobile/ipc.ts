import {
  addListener,
  addOnceListener,
  removeListener,
  removeAllListeners,
  emitChannel,
  type IpcListener
} from './emitter'
import { SuchLocalMusic } from './native'
import { fsExists } from './fsUtils'
import * as localMusic from './handlers/localMusic'
import { proxyRequest } from './handlers/proxy'
import * as audio from './handlers/audio'
import * as lyric from './handlers/lyric'
import { pluginInvoke } from './handlers/pluginStub'

// invoke 语义的分发表
const invokeHandlers: Record<string, (...args: unknown[]) => Promise<unknown>> = {
  // ---- 系统 ----
  'system:fs-exists': async (filePath) => fsExists(String(filePath)),
  'system:get-fonts': async () => [] as string[],
  'system:get-music-dir': async () => localMusic.getMusicDir(),
  'system:is-mac': async () => false,

  // ---- 网络代理 ----
  'proxy:request': async (opts) => proxyRequest(opts as never),

  // ---- 音频 ----
  'audio:decode': async (filePath) => audio.audioDecode(String(filePath)),
  'audio:load-file': async (filePath) => audio.audioLoadFile(String(filePath)),

  // ---- 本地音乐 ----
  'local-music:scan': async (dirs) => localMusic.scanLocalMusic(dirs as string[] | undefined),
  'local-music:get-meta': async (filePath) => localMusic.getLocalMeta(String(filePath)),
  'local-music:write-meta': async (filePath, tags) =>
    localMusic.writeLocalMeta(String(filePath), tags as never),
  'local-music:choose-scan-dirs': async () => localMusic.chooseScanDirs(),
  'local-music:delete': async (filePaths) => localMusic.deleteLocalFiles(filePaths as string[]),

  // ---- 在线缓存 ----
  'online-cache:get-info': async (dir) => localMusic.onlineCacheGetInfo(dir as string | null),
  'online-cache:choose-dir': async () => localMusic.onlineCacheChooseDir(),
  'online-cache:clear': async (dir) => localMusic.onlineCacheClear(dir as string | null),
  'online-cache:check': async (opts) => localMusic.onlineCacheCheck(opts as never),
  'online-cache:prepare': async (opts) => localMusic.onlineCachePrepare(opts as never),

  // ---- 桌面歌词（悬浮窗） ----
  'desktop-lyric:open': async () => lyric.lyricOpen('desktop-lyric'),
  'desktop-lyric:close': async () => lyric.lyricClose('desktop-lyric'),
  'desktop-lyric:toggle': async () => lyric.lyricToggle('desktop-lyric'),
  'desktop-lyric:is-open': async () => lyric.lyricIsOpen('desktop-lyric'),
  'desktop-lyric:ready': async () => null,

  // ---- 任务栏歌词（迷你悬浮窗） ----
  'taskbar-lyric:open': async () => lyric.lyricOpen('taskbar-lyric'),
  'taskbar-lyric:close': async () => lyric.lyricClose('taskbar-lyric'),
  'taskbar-lyric:toggle': async () => lyric.lyricToggle('taskbar-lyric'),
  'taskbar-lyric:is-open': async () => lyric.lyricIsOpen('taskbar-lyric'),
  'taskbar-lyric:ready': async () => null
}

// 插件系统通道前缀
const PLUGIN_PREFIXES = ['plugin:', 'snowdrop:']

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  if (PLUGIN_PREFIXES.some((p) => channel.startsWith(p))) {
    return pluginInvoke(channel, args)
  }
  const handler = invokeHandlers[channel]
  if (handler) return handler(...args)
  console.warn(`[mobile-ipc] 未处理的 invoke 通道: ${channel}`)
  return null
}

function send(channel: string, ...args: unknown[]): void {
  // 歌词窗口消息
  if (channel.startsWith('desktop-lyric:') || channel.startsWith('taskbar-lyric:')) {
    const prefix = channel.startsWith('desktop-lyric:') ? 'desktop-lyric' : 'taskbar-lyric'
    lyric.lyricSend(prefix, channel, args[0])
    return
  }

  switch (channel) {
    case 'audio:decode-stream:start':
      audio.audioDecodeStreamStart(String(args[0]))
      break
    case 'audio:decode-stream:stop':
      audio.audioDecodeStreamStop()
      break
    case 'winAction':
    case 'player:taskbarProgress':
    case 'toMain':
    case 'ping':
      // 桌面专属能力，移动端忽略
      break
    default:
      console.warn(`[mobile-ipc] 未处理的 send 通道: ${channel}`)
  }
}

/** 安装 window.electron 兼容层 */
export function installMobileIpc(): void {
  lyric.bindLyricEvents()

  const ipcRenderer = {
    invoke,
    send,
    on: (channel: string, listener: IpcListener) => {
      addListener(channel, listener)
      return ipcRenderer
    },
    once: (channel: string, listener: IpcListener) => {
      addOnceListener(channel, listener)
      return ipcRenderer
    },
    removeListener,
    removeAllListeners,
    // Electron IpcRenderer 的其他少量方法
    sendTo: () => undefined,
    postMessage: () => undefined
  }

  ;(window as unknown as { electron: unknown }).electron = {
    ipcRenderer,
    process: {
      platform: 'android',
      versions: {}
    }
  }
  ;(window as unknown as { api: unknown }).api = {}

  // 存储权限预检查（提前触发授权流程）
  void SuchLocalMusic.checkStoragePermission().catch(() => undefined)
}

export { emitChannel }
