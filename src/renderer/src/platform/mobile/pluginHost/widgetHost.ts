// CeruPlugins（window.source）UI 组件插件宿主（移动端）
// 桌面端由原生窗口渲染 uiSchema；移动端由 PluginWidgetSheet 组件渲染，
// 本类负责：沙箱加载、setProps 桥接、suchmusic API、以及把 ncmdump-go
// 外部程序调用重定向到内置纯 JS 解密引擎（Android 无法运行原生二进制）。
import { Filesystem, Encoding } from '@capacitor/filesystem'
import { CapacitorHttp } from '@capacitor/core'
import { runPluginSandbox, type SandboxLogger } from './sandbox'
import {
  createCapacitorFetch,
  createPluginApiUtils,
  readPluginConfigStorage,
  writePluginConfigStorage
} from './host'
import { dumpNcmDirectory, dumpNcmFile } from './ncmdump'
import { readFileBytes, writeFileBytes, readTextFile, fsExists } from '../fsUtils'
import { getMusicDir, chooseScanDirs } from '../handlers/localMusic'
import { SuchLocalMusic } from '../native'

// ==================== 类型 ====================

export interface UiSchemaField {
  type: string
  key?: string
  label?: string
  placeholder?: string
  readonly?: boolean
  action?: string
  [key: string]: unknown
}

export interface UiSchemaAction {
  type: string
  label?: string
  method?: string
  variant?: string
  [key: string]: unknown
}

export interface UiSchemaSection {
  title?: string
  fields?: UiSchemaField[]
  actions?: UiSchemaAction[]
  [key: string]: unknown
}

export interface UiSchema {
  sections: UiSchemaSection[]
  [key: string]: unknown
}

export interface UiWidgetInfo {
  name: string
  version: string
  author: string
  description?: string
  [key: string]: unknown
}

export interface WidgetHostOptions {
  logger?: SandboxLogger
  /** window.notify 回调（接入 UI 提示） */
  notify?: (message: string, type?: string) => void
  /** setProps 写入目标（通常为 Vue reactive 对象） */
  propsTarget?: Record<string, unknown>
}

// ==================== 工具 ====================

/** 桌面插件使用 Windows 路径分隔符，统一规整为 Android 路径 */
export function normalizeMobilePath(p: string): string {
  return String(p).replace(/\\/g, '/').replace(/\/{2,}/g, '/')
}

function baseName(p: string): string {
  const n = normalizeMobilePath(p)
  return n.slice(n.lastIndexOf('/') + 1)
}

function dirName(p: string): string {
  const n = normalizeMobilePath(p)
  const idx = n.lastIndexOf('/')
  return idx > 0 ? n.slice(0, idx) : n
}

/** 从 shell 命令中提取 -x "值" 或 -x 值 形式的参数 */
function extractFlag(cmd: string, flag: string): string {
  const quoted = new RegExp(`${flag}\\s+"([^"]+)"`).exec(cmd)
  if (quoted) return quoted[1]
  const bare = new RegExp(`${flag}\\s+([^\\s]+)`).exec(cmd)
  return bare ? bare[1] : ''
}

async function ensureStoragePermission(): Promise<void> {
  try {
    const perm = await SuchLocalMusic.checkStoragePermission()
    if (!perm.granted) {
      const r = await SuchLocalMusic.requestStoragePermission()
      if (!r.granted) throw new Error('未授予存储访问权限')
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('存储')) throw e
    // 权限插件不可用时静默继续（部分私有目录无需权限）
  }
}

// ==================== 插件探测（供管理器使用） ====================

const noopLogger: SandboxLogger = {
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined
}

/**
 * 探测插件代码是否为 UI 组件插件（window.source + uiSchema/isUIWidget，且无音源字段）。
 * 仅执行顶层代码，不调用任何插件方法。
 */
export function inspectUiWidgetPlugin(code: string): { info: UiWidgetInfo } | null {
  try {
    const result = runPluginSandbox(code, {
      suchmusic: {},
      logger: noopLogger,
      mode: 'uiWidget'
    })
    const src = result.source as Record<string, unknown> | undefined
    if (!src || typeof src !== 'object') return null
    // 含音源字段的按音源插件处理
    if (src.sources !== undefined || typeof src.musicUrl === 'function') return null
    if (src.uiSchema === undefined && src.isUIWidget !== true) return null
    return {
      info: {
        name: typeof src.name === 'string' ? src.name : '未命名组件',
        version: typeof src.version === 'string' ? src.version : '1.0.0',
        author: typeof src.author === 'string' ? src.author : '未知',
        description: typeof src.description === 'string' ? src.description : undefined
      }
    }
  } catch {
    return null
  }
}

// ==================== Widget 宿主 ====================

export class MobileUiWidgetHost {
  private pluginCode = ''
  private source: Record<string, any> | null = null
  private musicFolder = ''
  private disposed = false

  readonly info: UiWidgetInfo = { name: '', version: '', author: '' }
  uiSchema: UiSchema | null = null

  private readonly logger: SandboxLogger
  private readonly notifyFn: (message: string, type?: string) => void
  private readonly propsTarget: Record<string, unknown>

  constructor(options: WidgetHostOptions = {}) {
    this.logger = options.logger ?? noopLogger
    this.notifyFn =
      options.notify ??
      ((msg, type) => this.logger.log(`[notify:${type ?? 'info'}]`, msg))
    this.propsTarget = options.propsTarget ?? {}
  }

  /** 加载插件代码并初始化（渲染 uiSchema 前调用） */
  async load(code: string): Promise<void> {
    this.pluginCode = code

    // getSetting 是同步 API，音乐目录需提前异步解析
    try {
      this.musicFolder = await getMusicDir()
    } catch {
      this.musicFolder = ''
    }

    const result = runPluginSandbox(code, {
      suchmusic: this.createSuchmusicApi(),
      logger: this.logger,
      mode: 'uiWidget',
      notify: (msg, type) =>
        this.notifyFn(String(msg), typeof type === 'string' ? type : 'info')
    })

    const src = result.source as Record<string, any> | undefined
    if (!src || typeof src !== 'object') {
      throw new Error('插件未通过 window.source 注册 UI 组件')
    }
    this.source = src

    this.info.name = typeof src.name === 'string' ? src.name : '未命名组件'
    this.info.version = typeof src.version === 'string' ? src.version : ''
    this.info.author = typeof src.author === 'string' ? src.author : ''
    this.info.description = typeof src.description === 'string' ? src.description : undefined

    if (src.uiSchema && Array.isArray(src.uiSchema.sections)) {
      this.uiSchema = src.uiSchema as UiSchema
    }

    // setProps 由宿主提供：合并到渲染层绑定的响应式对象
    src.setProps = (props: Record<string, unknown>): void => {
      if (props && typeof props === 'object') {
        Object.assign(this.propsTarget, props)
      }
    }

    // Android 无法运行 ncmdump-go 原生二进制：
    // 将依赖外部解密器的插件方法适配到内置纯 JS 解密引擎
    this.adaptNcmdumpMethods()

    // 与桌面端一致：打开面板后调用 initialization()
    if (typeof src.initialization === 'function') {
      await src.initialization()
    }
  }

  /** 触发 uiSchema 中的按钮动作 */
  async callAction(method: string): Promise<unknown> {
    this.ensureAlive()
    const fn = this.source![method]
    if (typeof fn !== 'function') {
      throw new Error(`插件未实现方法: ${method}`)
    }
    return await fn.call(this.source)
  }

  /**
   * 输入框值变更：按桌面端约定调用 set<Key>(value)，
   * 无对应 setter 时仅更新展示属性
   */
  async onFieldChange(key: string, value: string): Promise<void> {
    if (this.disposed || !this.source) return
    const setter = `set${key.charAt(0).toUpperCase()}${key.slice(1)}`
    if (typeof this.source[setter] === 'function') {
      await this.source[setter](value)
    }
    this.propsTarget[key] = value
  }

  /** 输入框 action 按钮（browse / browseDir） */
  async browseField(key: string, action: string): Promise<void> {
    if (action === 'browseDir') {
      const r = await chooseScanDirs()
      if (!r.canceled && r.dirs.length) {
        await this.onFieldChange(key, r.dirs[0])
      }
      return
    }
    // 可执行文件选择对移动端无意义（内置引擎），提示手动输入
    this.notifyFn('移动端无需选择可执行文件，可直接使用内置解密引擎', 'info')
  }

  dispose(): void {
    this.disposed = true
    this.source = null
  }

  private ensureAlive(): void {
    if (this.disposed || !this.source) throw new Error('组件已关闭')
  }

  // ==================== ncmdump 方法适配 ====================

  private adaptNcmdumpMethods(): void {
    const src = this.source!
    const isNcmWidget = /ncmdump|\.ncm/i.test(this.pluginCode)
    if (!isNcmWidget) return

    // 下载解密器：桌面端流程为下载 Windows 二进制 + PowerShell 解压，
    // 移动端用内置引擎替代，保持插件其余逻辑与 UI 状态流不变
    if (typeof src.downloadDecryptor === 'function') {
      const host = this
      src.downloadDecryptor = async function (this: Record<string, any>) {
        // 注：路径必须包含 "ncmdump" 字样，后续 startDecrypt 拼出的命令
        // 才会被 execTerminal/execProgram 拦截器路由到内置引擎
        const builtinPath = '<内置 ncmdump 引擎>'
        if (typeof this.setDecryptorPath === 'function') {
          this.setDecryptorPath(builtinPath)
        } else {
          this._decryptorPath = builtinPath
        }
        this._isDecryptorValid = true
        if (typeof this.setProps === 'function') {
          this.setProps({
            decryptorPath: builtinPath,
            statusText: '就绪',
            isDecryptorValid: true,
            decryptorStatusText: '内置引擎就绪',
            outputLog: '移动端使用内置纯 JS 解密引擎，无需下载外部程序。\n'
          })
        }
        host.notifyFn('内置 ncmdump 解密引擎已就绪，无需下载', 'success')
        return { code: true }
      }
    }
  }

  // ==================== suchmusic API ====================

  private createSuchmusicApi(): Record<string, unknown> {
    return {
      env: 'android',
      version: '1.0.3',
      // 与音源宿主一致的工具接口（buffer/crypto），避免组件插件调用缺失
      utils: createPluginApiUtils(),
      fetch: createCapacitorFetch(),
      request: this.createRequestFn(),
      getSetting: (key: string) => this.getSetting(key),
      // 歌单能力：映射到当前实例的 playlistStore
      createPlaylist: (name: string, entries: unknown[]) => this.createPlaylist(name, entries),
      getPlaylists: () => this.getPlaylists(),
      addToPlaylist: (playlistId: string, entries: unknown[]) =>
        this.addToPlaylist(playlistId, entries),
      removePlaylist: (playlistId: string) => this.removePlaylist(playlistId),
      // 插件配置持久化（兼容 getPluginConfig(key) 与 getPluginConfig(pluginId, key) 两种签名）
      getPluginConfig: (a: string, b?: string) => this.getPluginConfig(a, b),
      setPluginConfig: (a: string, b: unknown, c?: unknown) => this.setPluginConfig(a, b, c),
      downloadFile: (url: string, path: string) => this.downloadFile(url, path),
      fileOp: (op: string, ...args: unknown[]) => this.fileOp(op, ...args),
      execProgram: (program: string, args?: string[]) => this.execProgram(program, args),
      execTerminal: (command: string) => this.execTerminal(command),
      openPanel: () => {
        this.notifyFn('移动端组件已在面板中打开', 'info')
      },
      NoticeCenter: (type: string, data: unknown) => {
        this.logger.log(`[WidgetNotice:${type}]`, data)
      }
    }
  }

  // ==================== 应用设置 / 插件配置 ====================

  private getSetting(key: string): unknown {
    switch (key) {
      case 'musicFolder':
      case 'downloadDir':
        return this.musicFolder || undefined
      case 'platform':
      case 'env':
        return 'android'
      case 'appName':
        return 'SuchMusic'
      default:
        return undefined
    }
  }

  /** 当前插件的配置命名空间（优先插件 id，其次名称） */
  private get pluginConfigId(): string {
    const src = this.source
    const id = src && typeof src.id === 'string' && src.id ? src.id : this.info.name
    return id || 'unknown-widget'
  }

  private getPluginConfig(a: string, b?: string): Promise<unknown> {
    // 两个参数时按 (pluginId, key) 解析，单参数按 (key) 解析
    const [pluginId, key] = b === undefined ? [this.pluginConfigId, a] : [a, b]
    return Promise.resolve(readPluginConfigStorage(pluginId)[key])
  }

  private setPluginConfig(a: string, b: unknown, c?: unknown): Promise<void> {
    const [pluginId, key, value] = c === undefined ? [this.pluginConfigId, a, b] : [a, b as string, c]
    const cfg = readPluginConfigStorage(String(pluginId))
    cfg[String(key)] = value
    writePluginConfigStorage(String(pluginId), cfg)
    return Promise.resolve()
  }

  // ==================== 歌单能力（映射到 playlistStore） ====================

  private async getPlaylistStore() {
    const mod = await import('../../../stores/playlistStore')
    return mod.usePlaylistStore()
  }

  /** 兼容插件传入的各种字段命名，规整为 PlaylistTrack */
  private normalizeTrackEntry(raw: unknown): Record<string, unknown> {
    const e = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const pick = (...keys: string[]): unknown => {
      for (const k of keys) {
        const v = e[k]
        if (v !== undefined && v !== null && v !== '') return v
      }
      return undefined
    }
    const track: Record<string, unknown> = {
      id: pick('id', 'songId') ?? null,
      title: String(pick('title', 'name', 'songName') ?? '未知歌曲'),
      artist: String(pick('artist', 'singer', 'artists') ?? '未知歌手'),
      album: pick('album', 'albumName'),
      cover: pick('cover', 'picUrl', 'coverUrl', 'pic'),
      filePath: pick('filePath', 'path', 'url', 'localPath'),
      durationMs: Number(pick('durationMs', 'duration', 'dt') ?? 0) || 0,
      source: pick('source'),
      sourceSongId: pick('sourceSongId')
    }
    return track
  }

  private async createPlaylist(
    name: string,
    entries: unknown[]
  ): Promise<{ id: string; name: string; trackCount: number; cover?: string }> {
    const store = await this.getPlaylistStore()
    const tracks = (Array.isArray(entries) ? entries : []).map((e) => this.normalizeTrackEntry(e))
    const playlistName = String(name || '').trim() || '导入的歌单'
    const cover = tracks.find((t) => typeof t.cover === 'string' && t.cover)?.cover as
      | string
      | undefined
    const pl = store.createPlaylistFromTracks(
      playlistName,
      tracks as unknown as import('../../../stores/playlistStore').PlaylistTrack[],
      cover
    )
    return { id: pl.id, name: pl.name, trackCount: pl.tracks.length, cover: pl.cover }
  }

  private async getPlaylists(): Promise<
    Array<{ id: string; name: string; trackCount: number; cover?: string }>
  > {
    const store = await this.getPlaylistStore()
    return store.playlists.map((p) => ({
      id: p.id,
      name: p.name,
      trackCount: p.tracks.length,
      cover: p.cover
    }))
  }

  private async addToPlaylist(
    playlistId: string,
    entries: unknown[]
  ): Promise<{ success: boolean; added: number }> {
    const store = await this.getPlaylistStore()
    const pl = store.playlists.find((p) => p.id === playlistId)
    if (!pl) throw new Error(`歌单不存在: ${playlistId}`)
    const tracks = (Array.isArray(entries) ? entries : []).map((e) => this.normalizeTrackEntry(e))
    // 按 id / filePath 去重，避免重复添加
    const exists = new Set(pl.tracks.map((t) => String(t.id ?? '')).filter(Boolean))
    const existsPath = new Set(pl.tracks.map((t) => String(t.filePath ?? '')).filter(Boolean))
    let added = 0
    for (const t of tracks) {
      const id = String(t.id ?? '')
      const fp = String(t.filePath ?? '')
      if ((id && exists.has(id)) || (fp && existsPath.has(fp))) continue
      pl.tracks.push(t as unknown as import('../../../stores/playlistStore').PlaylistTrack)
      if (id) exists.add(id)
      if (fp) existsPath.add(fp)
      added++
    }
    pl.updatedAt = Date.now()
    store.saveToStorage()
    return { success: true, added }
  }

  private async removePlaylist(playlistId: string): Promise<{ success: boolean }> {
    const store = await this.getPlaylistStore()
    store.removePlaylist(playlistId)
    return { success: true }
  }

  private createRequestFn() {
    return async (url: string, options?: { method?: string; headers?: Record<string, string>; body?: unknown }) => {
      const response = await CapacitorHttp.request({
        url,
        method: (options?.method || 'GET').toUpperCase(),
        headers: options?.headers,
        data: options?.body,
        responseType: 'text',
        connectTimeout: 15000,
        readTimeout: 15000
      })
      let body: unknown = response.data
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body)
        } catch {
          // 保持文本
        }
      }
      return { body, statusCode: response.status, headers: response.headers || {} }
    }
  }

  private async downloadFile(url: string, path: string): Promise<{ success: boolean; path: string }> {
    const target = normalizeMobilePath(path)
    const response = await CapacitorHttp.get({
      url,
      responseType: 'arraybuffer',
      connectTimeout: 30000,
      readTimeout: 120000
    })
    if (response.status !== 200 || !response.data) {
      throw new Error(`下载失败: HTTP ${response.status}`)
    }
    // arraybuffer 响应经桥接为 base64 字符串
    const base64 = typeof response.data === 'string' ? response.data : ''
    await Filesystem.writeFile({ path: target, data: base64, recursive: true })
    return { success: true, path: target }
  }

  private async fileOp(op: string, ...args: unknown[]): Promise<unknown> {
    const p0 = normalizeMobilePath(String(args[0] ?? ''))
    switch (op) {
      case 'listDir': {
        const r = await Filesystem.readdir({ path: p0 })
        return r.files.map((f) => f.name)
      }
      case 'copy': {
        const dest = normalizeMobilePath(String(args[1] ?? ''))
        const bytes = await readFileBytes(p0)
        await writeFileBytes(dest, bytes)
        return { success: true }
      }
      case 'move':
      case 'rename': {
        const dest = normalizeMobilePath(String(args[1] ?? ''))
        const bytes = await readFileBytes(p0)
        await writeFileBytes(dest, bytes)
        await Filesystem.deleteFile({ path: p0 })
        return { success: true }
      }
      case 'delete': {
        await Filesystem.deleteFile({ path: p0 })
        return { success: true }
      }
      case 'exists':
        return fsExists(p0)
      case 'mkdir': {
        await Filesystem.mkdir({ path: p0, recursive: true })
        return { success: true }
      }
      case 'read':
      case 'readText':
        return readTextFile(p0)
      case 'write':
      case 'writeText': {
        // 文本写入必须显式指定 UTF8：v8 原生层默认按 Base64 解码 data，文本会解码失败
        await Filesystem.writeFile({
          path: p0,
          data: String(args[1] ?? ''),
          encoding: Encoding.UTF8,
          recursive: true
        })
        return { success: true }
      }
      default:
        throw new Error(`不支持的文件操作: ${op}`)
    }
  }

  // ==================== 外部程序/终端 → 内置引擎重定向 ====================

  private isNcmdumpBinary(p: string): boolean {
    return /ncmdump/i.test(baseName(p))
  }

  private async execProgram(
    program: string,
    args: string[] = []
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    if (this.isNcmdumpBinary(program)) {
      if (args.some((a) => /^--?v(ersion)?$/i.test(a))) {
        return { code: 0, stdout: 'ncmdump (SuchMusic 内置纯 JS 引擎)', stderr: '' }
      }
      // ncmdump <file> / ncmdump -d dir -o out：直接走内置解密
      const input = extractFlag(args.join(' '), '-d') || args.find((a) => !a.startsWith('-')) || ''
      const out = extractFlag(args.join(' '), '-o')
      const log = await this.runBuiltinDump(input, out, args.includes('-r'))
      return { code: 0, stdout: log, stderr: '' }
    }
    throw new Error(`移动端不支持执行外部程序: ${baseName(program)}（ncmdump 已由内置引擎接管）`)
  }

  private async execTerminal(command: string): Promise<string> {
    const cmd = String(command)
    if (/ncmdump/i.test(cmd)) {
      const input = extractFlag(cmd, '-d') || this.extractPositionalTarget(cmd)
      const out = extractFlag(cmd, '-o')
      const recursive = /(^|\s)-r(\s|$)/.test(cmd)
      return await this.runBuiltinDump(input, out, recursive)
    }
    throw new Error('移动端不支持执行终端命令')
  }

  /** 提取命令中 ncmdump 之后的裸参数（文件/目录路径） */
  private extractPositionalTarget(cmd: string): string {
    const m = /ncmdump[^\s"']*"?\s+"([^"]+)"/i.exec(cmd)
    return m ? m[1] : ''
  }

  private async runBuiltinDump(input: string, outDir: string, recursive: boolean): Promise<string> {
    if (!input) throw new Error('未指定 NCM 文件或目录')
    const srcPath = normalizeMobilePath(input)
    const targetDir = normalizeMobilePath(outDir || this.musicFolder || dirName(srcPath))
    await ensureStoragePermission()

    const appendLog = (line: string): void => {
      const prev = (this.propsTarget.outputLog as string) || ''
      this.propsTarget.outputLog = prev ? `${prev}\n${line}` : line
    }

    if (!(await fsExists(srcPath))) throw new Error(`路径不存在: ${srcPath}`)

    let isDir = false
    try {
      const stat = await Filesystem.stat({ path: srcPath })
      isDir = stat.type === 'directory'
    } catch {
      isDir = !/\.ncm$/i.test(srcPath)
    }
    if (isDir) {
      const summary = await dumpNcmDirectory(srcPath, targetDir, recursive, appendLog)
      return summary.logs.join('\n')
    }
    const outPath = await dumpNcmFile(srcPath, targetDir)
    const line = `[成功] ${baseName(srcPath)} -> ${baseName(outPath)}`
    appendLog(line)
    return line
  }
}
