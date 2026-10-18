// 插件管理器（移动端）：移植主进程 pluginManager.ts / plugin.ts / pluginConfig.ts 的全部契约
// 持久化使用 Capacitor Filesystem（应用私有目录）
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { CapacitorHttp } from '@capacitor/core'
import SuchMusicPluginHost, {
  isLxStylePluginCode,
  type PluginInfo,
  type PluginSource
} from './host'
import {
  transformSnowdropPlugin,
  benchmarkSnowdropTransform,
  type SnowdropTransformResult
} from './transform'
import { runPluginSandbox } from './sandbox'
import { inspectUiWidgetPlugin } from './widgetHost'
import { SuchLocalMusic } from '../native'
import type { PluginHost } from './index'

// ==================== 持久化辅助 ====================

const PLUGINS_DIR = 'plugins'
const CONFIG_DIR = 'plugin-configs'
const SNOWDROP_CONFIG_FILE = 'plugin-config.json'

async function ensureDir(path: string): Promise<void> {
  try {
    await Filesystem.mkdir({ path, directory: Directory.Data, recursive: true })
  } catch {
    // 已存在
  }
}

// 注意：@capacitor/filesystem v8 原生层不传 encoding 时默认把 data 当 Base64 解码，
// 文本内容会因解码失败抛 IllegalArgumentException（报错 "input parameters aren't valid"），
// 因此文本读写必须显式指定 Encoding.UTF8。
async function writeText(path: string, content: string): Promise<void> {
  await Filesystem.writeFile({
    path,
    directory: Directory.Data,
    data: content,
    encoding: Encoding.UTF8,
    recursive: true
  })
}

async function readText(path: string): Promise<string> {
  const r = await Filesystem.readFile({ path, directory: Directory.Data, encoding: Encoding.UTF8 })
  if (typeof r.data === 'string') return r.data
  return new TextDecoder().decode(await (r.data as Blob).arrayBuffer())
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readText(path)) as T
  } catch {
    return fallback
  }
}

async function deleteFile(path: string): Promise<void> {
  try {
    await Filesystem.deleteFile({ path, directory: Directory.Data })
  } catch {
    // 不存在则忽略
  }
}

async function listPluginIds(): Promise<string[]> {
  await ensureDir(PLUGINS_DIR)
  try {
    const r = await Filesystem.readdir({ path: PLUGINS_DIR, directory: Directory.Data })
    return r.files
      .filter((f) => f.name.endsWith('.js'))
      .map((f) => f.name.replace(/\.js$/, ''))
  } catch {
    return []
  }
}

// ==================== 落雪插件路径配置（pluginConfig.ts 移植） ====================

interface SnowdropConfig {
  pluginPaths: string[]
  activePluginPath: string | null
}

async function getSnowdropConfig(): Promise<SnowdropConfig> {
  const config = await readJson<Record<string, unknown>>(SNOWDROP_CONFIG_FILE, {})
  const pluginPaths = Array.isArray(config.pluginPaths) ? (config.pluginPaths as string[]) : []
  const activePluginPath =
    typeof config.activePluginPath === 'string' ? (config.activePluginPath as string) : null
  return { pluginPaths, activePluginPath }
}

async function saveSnowdropConfig(config: SnowdropConfig): Promise<void> {
  await writeText(SNOWDROP_CONFIG_FILE, JSON.stringify(config, null, 2))
}

async function addPluginPaths(newPaths: string[]): Promise<void> {
  const config = await getSnowdropConfig()
  const set = new Set(config.pluginPaths)
  for (const p of newPaths) set.add(p)
  config.pluginPaths = set.size ? Array.from(set) : []
  await saveSnowdropConfig(config)
}

async function removePluginPath(pathToRemove: string): Promise<void> {
  const config = await getSnowdropConfig()
  config.pluginPaths = config.pluginPaths.filter((p) => p !== pathToRemove)
  if (config.activePluginPath === pathToRemove) config.activePluginPath = null
  await saveSnowdropConfig(config)
  musicUrlHostCache = null
  await deleteFile(pathToRemove)
}

// ==================== 插件解析 ====================

interface ParsedPlugin {
  info: PluginInfo
  sources: PluginSource[]
  configUI: Record<string, unknown>[]
  /** CeruPlugins(window.source) UI 组件插件标记 */
  isUIWidget?: boolean
}

function parsePlugin(code: string): ParsedPlugin {
  // 先按 UI 组件插件探测（音源宿主对 UI 组件会抛错，探测前置可给出正确分类）
  const widget = inspectUiWidgetPlugin(code)
  if (widget) {
    return { info: widget.info, sources: [], configUI: [], isUIWidget: true }
  }

  const host = new SuchMusicPluginHost(code)
  const rawInfo = host.getPluginInfo()
  const info: PluginInfo = {
    name: rawInfo.name,
    version: rawInfo.version,
    author: rawInfo.author,
    description: rawInfo.description,
    homepage: rawInfo.homepage as string | undefined
  }

  const rawSources = host.getSupportedSources()
  let sources: PluginSource[] = []
  if (Array.isArray(rawSources)) {
    sources = rawSources.map((s) => ({
      id: (s.id || s.name) as string,
      name: s.name,
      qualities: s.qualities || []
    }))
  } else if (typeof rawSources === 'object' && rawSources !== null) {
    sources = Object.entries(rawSources).map(([id, s]) => ({
      id,
      name: (s.name as string) || id,
      qualities: (s.qualities || s.qualitys || []) as string[]
    }))
  }

  // 提取 configUI（如有）
  // 注意：必须提供最小可用的 suchmusic API 桩。
  // 转换后的洛雪插件在模块加载时就会初始化并读取 suchmusic.utils，
  // 传空对象会在初始化阶段直接抛 TypeError，导致探测永远失败
  let configUI: Record<string, unknown>[] = []
  try {
    const probeApi = {
      // 同 transform 概要阶段：回调式调用必须通过回调返回错误，避免未处理的 Promise 拒绝
      request: (...args: unknown[]) => {
        const err = new Error('suchmusic.request is disabled in configUI probe')
        const cb = args.find((a) => typeof a === 'function') as
          | ((e: Error, r: null) => void)
          | undefined
        if (cb) {
          cb(err, null)
          return undefined
        }
        return Promise.reject(err)
      },
      utils: {
        buffer: {},
        crypto: {
          aesEncrypt: (data: unknown) => data,
          md5: (str: unknown) => String(str),
          randomBytes: (size: number) => new Uint8Array(size),
          rsaEncrypt: (data: unknown) => data
        }
      },
      NoticeCenter: () => {}
    }
    const exports = runPluginSandbox(code, {
      suchmusic: probeApi,
      logger: console
    })
    if (Array.isArray(exports.configUI)) {
      configUI = JSON.parse(JSON.stringify(exports.configUI))
    }
  } catch {
    // 无 configUI
  }

  return { info, sources, configUI }
}

// ==================== 插件文件/配置存取 ====================

const generatePluginId = (): string => crypto.randomUUID().replace(/-/g, '')

async function savePluginFile(pluginId: string, code: string): Promise<void> {
  await ensureDir(PLUGINS_DIR)
  await writeText(`${PLUGINS_DIR}/${pluginId}.js`, code)
}

async function loadPluginCode(pluginId: string): Promise<string> {
  return readText(`${PLUGINS_DIR}/${pluginId}.js`)
}

async function savePluginConfig(pluginId: string, config: Record<string, unknown>): Promise<void> {
  await ensureDir(CONFIG_DIR)
  await writeText(`${CONFIG_DIR}/${pluginId}.json`, JSON.stringify(config, null, 2))
}

async function loadPluginConfig(pluginId: string): Promise<Record<string, unknown>> {
  return readJson<Record<string, unknown>>(`${CONFIG_DIR}/${pluginId}.json`, {})
}

async function getPluginStatus(pluginId: string): Promise<string> {
  const config = await loadPluginConfig(pluginId)
  return (config._status as string) || 'uninitialized'
}

const pluginInstances = new Map<string, SuchMusicPluginHost>()

// 播放链路（snowdrop:plugin:get-music-url）的宿主缓存，
// 避免每次切歌都重新读文件并重新加载插件
let musicUrlHostCache: { path: string; host: SuchMusicPluginHost } | null = null

function pluginIdToFilePath(pluginId: string): string {
  return `${PLUGINS_DIR}/${pluginId}.js`
}

// 设置/解除播放链路的音源提供者（snowdrop:plugin:get-music-url 只认 activePluginPath）
async function setSnowdropActivePath(filePath: string | null): Promise<void> {
  const config = await getSnowdropConfig()
  if (filePath) {
    const set = new Set(config.pluginPaths)
    set.add(filePath)
    config.pluginPaths = Array.from(set)
    config.activePluginPath = filePath
  } else {
    config.activePluginPath = null
  }
  await saveSnowdropConfig(config)
  musicUrlHostCache = null
}

function importPluginFromCode(code: string): {
  plugin: Record<string, unknown>
  processedCode: string
} {
  let processedCode = code
  // 与 host.loadPlugin 使用同一判定，避免 URL/文本中偶然包含 "lx" 的插件被误转换
  if (isLxStylePluginCode(code)) {
    processedCode = transformSnowdropPlugin(code, { sourceType: 'lx' }).transformedCode
  }
  const { info, sources, configUI, isUIWidget } = parsePlugin(processedCode)
  return {
    processedCode,
    plugin: { id: '', info, sources, configUI, isUIWidget: !!isUIWidget, status: 'uninitialized' }
  }
}

// ==================== 落雪文件处理（processPluginFile 移植） ====================

interface ProcessResult {
  canceled: boolean
  filePath: string
  originalCodePreview: string
  meta: unknown
  type: string
  stats: Record<string, number>
  sources: unknown[]
  logs: string[]
  warnings: string[]
  errors: string[]
  runtimeLogs: string[]
  transformedCodePreview: string
  transformedCode?: string
}

function processPluginCode(filePath: string, originalCode: string): ProcessResult {
  const isSuchMusic = originalCode.includes('cerumusic') && !originalCode.includes('lx.on(')

  let single: SnowdropTransformResult
  if (isSuchMusic) {
    const host = new SuchMusicPluginHost(originalCode)
    const info = host.getPluginInfo()
    const rawSources = host.getSupportedSources()
    let sources: Record<string, unknown>[] = []
    if (Array.isArray(rawSources)) {
      sources = rawSources
    } else if (typeof rawSources === 'object' && rawSources !== null) {
      sources = Object.entries(rawSources).map(([k, v]) => ({ id: k, ...v }))
    }
    single = {
      transformedCode: originalCode,
      meta: {
        name: info.name,
        version: info.version,
        author: info.author,
        description: info.description
      },
      type: 'suchmusic',
      sources: sources.map((s, i) => ({
        id: (s.id as string) ?? `src_${i}`,
        name: s.name as string,
        qualities: (s.qualities as string[]) || []
      })),
      logs: [],
      warnings: [],
      errors: [],
      runtimeLogs: [],
      stats: { durationMs: 0 }
    }
  } else {
    single = transformSnowdropPlugin(originalCode, { sourceType: 'lx' })
  }

  return {
    canceled: false,
    filePath,
    originalCodePreview: originalCode.slice(0, 2000),
    meta: single.meta,
    type: single.type,
    stats: {
      singleDurationMs: single.stats.durationMs,
      batchDurationMs: single.stats.durationMs,
      averageMs: single.stats.durationMs,
      count: 1,
      estimatedMemoryDeltaMb: 0
    },
    sources: single.sources ?? [],
    logs: single.logs,
    warnings: single.warnings,
    errors: single.errors,
    runtimeLogs: single.runtimeLogs ?? [],
    transformedCodePreview: single.transformedCode.slice(0, 2000),
    transformedCode: single.transformedCode
  }
}

// ==================== 主调度器 ====================

export class MobilePluginHostManager implements PluginHost {
  async invoke(channel: string, args: unknown[]): Promise<unknown> {
    switch (channel) {
      // ---------- Such 插件管理 ----------
      case 'plugin:import:file':
        return this.importFromFile()
      case 'plugin:import:url':
        return this.importFromUrl(String(args[0]))
      case 'plugin:validate':
        return this.validate(String(args[1]))
      case 'plugin:config:save':
        return this.configSave(String(args[0]), args[1] as Record<string, unknown>)
      case 'plugin:config:get':
        return this.configGet(String(args[0]))
      case 'plugin:activate':
        return this.activate(String(args[0]))
      case 'plugin:deactivate':
        return this.deactivate(String(args[0]))
      case 'plugin:uninstall':
        return this.uninstall(String(args[0]))
      case 'plugin:get':
        return this.getPlugin(String(args[0]))
      case 'plugin:list:uninitialized':
        return this.listUninitialized()
      case 'plugin:list:all':
        return this.listAll()
      case 'plugin:call':
        return this.callPlugin(String(args[0]), String(args[1]), args.slice(2))

      // ---------- 落雪插件 ----------
      case 'snowdrop:transform:open-file':
        return this.snowdropOpenFile()
      case 'snowdrop:transform:download-url':
        return this.snowdropDownloadUrl(String(args[0]))
      case 'snowdrop:plugin:load-all':
        return this.snowdropLoadAll()
      case 'snowdrop:plugin:remove':
        await removePluginPath(String(args[0]))
        return { success: true }
      case 'snowdrop:plugin:set-active':
        return this.snowdropSetActive(args[0] as string | null)
      case 'snowdrop:transform:test':
        return this.snowdropTest()
      case 'snowdrop:plugin:get-music-url':
        return this.snowdropGetMusicUrl(String(args[0]), args[1], String(args[2]))
      default:
        console.warn(`[pluginHost] 未处理通道: ${channel}`)
        return null
    }
  }

  // ---------- Such 插件实现 ----------

  private async importFromFile(): Promise<unknown> {
    try {
      const picked = await SuchLocalMusic.pickTextFiles()
      if (picked.canceled || !picked.files.length) return { canceled: true }

      const code = picked.files[0].content
      const { plugin, processedCode } = importPluginFromCode(code)

      const pluginId = generatePluginId()
      await savePluginFile(pluginId, processedCode)
      await savePluginConfig(pluginId, {
        _status: 'uninitialized',
        _originalName: (plugin.info as PluginInfo).name
      })
      plugin.id = pluginId
      return { plugin }
    } catch (error) {
      return { error: error instanceof Error ? error.message : '导入插件失败' }
    }
  }

  private async importFromUrl(url: string): Promise<unknown> {
    try {
      const response = await CapacitorHttp.get({
        url,
        responseType: 'text',
        connectTimeout: 30000,
        readTimeout: 30000,
        headers: { 'User-Agent': 'SuchMusic/PluginManager' }
      })
      if (response.status !== 200 || !response.data) return { error: '下载插件失败' }

      const code = String(response.data)
      const { plugin, processedCode } = importPluginFromCode(code)

      const pluginId = generatePluginId()
      await savePluginFile(pluginId, processedCode)
      await savePluginConfig(pluginId, {
        _status: 'uninitialized',
        _originalName: (plugin.info as PluginInfo).name
      })
      plugin.id = pluginId
      return { plugin }
    } catch (error) {
      return { error: error instanceof Error ? error.message : '从 URL 导入插件失败' }
    }
  }

  private validate(code: string): unknown {
    try {
      const widget = inspectUiWidgetPlugin(code)
      if (widget) {
        if (!widget.info.name) {
          return { valid: false, error: '组件插件缺少名称' }
        }
        return { valid: true, info: widget.info, sources: [], isUIWidget: true }
      }

      const host = new SuchMusicPluginHost(code)
      const info = host.getPluginInfo()
      const rawSources = host.getSupportedSources()

      if (!info.name || !info.version || !info.author) {
        return { valid: false, error: '插件信息不完整，必须包含名称、版本和作者' }
      }

      let sources: unknown[] = []
      if (Array.isArray(rawSources)) {
        sources = rawSources
      } else if (typeof rawSources === 'object' && rawSources !== null) {
        sources = Object.entries(rawSources).map(([id, s]) => ({
          id,
          name: (s.name as string) || id,
          qualities: (s.qualities || s.qualitys || []) as string[]
        }))
      }
      if (!sources.length) return { valid: false, error: '插件未定义任何音源' }
      return { valid: true, info, sources }
    } catch (error) {
      return { valid: false, error: error instanceof Error ? error.message : '插件验证失败' }
    }
  }

  private async configSave(pluginId: string, config: Record<string, unknown>): Promise<unknown> {
    try {
      await savePluginConfig(pluginId, config)
      return { success: true }
    } catch (error) {
      return { error: error instanceof Error ? error.message : '保存配置失败' }
    }
  }

  private async configGet(pluginId: string): Promise<unknown> {
    try {
      return { config: await loadPluginConfig(pluginId) }
    } catch (error) {
      return { error: error instanceof Error ? error.message : '获取配置失败' }
    }
  }

  private async activate(pluginId: string): Promise<unknown> {
    try {
      const code = await loadPluginCode(pluginId)

      // UI 组件插件没有音源能力（音源宿主校验会抛错），仅标记激活，不参与播放链路
      if (!inspectUiWidgetPlugin(code)) {
        const host = new SuchMusicPluginHost()
        await host.loadPlugin(code)
        pluginInstances.set(pluginId, host)

        // 单激活语义：停用其他音源插件，保证「已激活」与播放链路提供者唯一对应
        const ids = await listPluginIds()
        for (const id of ids) {
          if (id === pluginId) continue
          if ((await getPluginStatus(id)) !== 'active') continue
          pluginInstances.delete(id)
          const otherConfig = await loadPluginConfig(id)
          otherConfig._status = 'inactive'
          await savePluginConfig(id, otherConfig)
        }

        // 关键：把激活的音源插件接入播放链路
        // （snowdrop:plugin:get-music-url 只读 activePluginPath，此前移动端无任何入口设置它，
        //   导致激活的插件永远不会被播放流程调用）
        await setSnowdropActivePath(pluginIdToFilePath(pluginId))
      }

      const config = await loadPluginConfig(pluginId)
      config._status = 'active'
      await savePluginConfig(pluginId, config)
      return { success: true }
    } catch (error) {
      return { error: error instanceof Error ? error.message : '激活插件失败' }
    }
  }

  private async deactivate(pluginId: string): Promise<unknown> {
    try {
      pluginInstances.delete(pluginId)
      const config = await loadPluginConfig(pluginId)
      config._status = 'inactive'
      await savePluginConfig(pluginId, config)

      // 若该插件正作为播放链路的音源提供者，同步解除绑定
      const snowdrop = await getSnowdropConfig()
      if (snowdrop.activePluginPath === pluginIdToFilePath(pluginId)) {
        await setSnowdropActivePath(null)
      }
      return { success: true }
    } catch (error) {
      return { error: error instanceof Error ? error.message : '停用插件失败' }
    }
  }

  private async uninstall(pluginId: string): Promise<unknown> {
    try {
      pluginInstances.delete(pluginId)
      const filePath = pluginIdToFilePath(pluginId)
      await deleteFile(filePath)
      await deleteFile(`${CONFIG_DIR}/${pluginId}.json`)

      // 同步清理落雪配置中的引用（含播放链路的激活指针）
      const snowdrop = await getSnowdropConfig()
      if (snowdrop.pluginPaths.includes(filePath) || snowdrop.activePluginPath === filePath) {
        snowdrop.pluginPaths = snowdrop.pluginPaths.filter((p) => p !== filePath)
        if (snowdrop.activePluginPath === filePath) snowdrop.activePluginPath = null
        await saveSnowdropConfig(snowdrop)
        musicUrlHostCache = null
      }
      return { success: true }
    } catch (error) {
      return { error: error instanceof Error ? error.message : '卸载插件失败' }
    }
  }

  private async getPlugin(pluginId: string): Promise<unknown> {
    try {
      const code = await loadPluginCode(pluginId)
      const { info, sources, configUI, isUIWidget } = parsePlugin(code)
      const status = await getPluginStatus(pluginId)
      const config = await loadPluginConfig(pluginId)
      return { plugin: { id: pluginId, info, sources, configUI, isUIWidget, status, config } }
    } catch (error) {
      return { error: error instanceof Error ? error.message : '获取插件失败' }
    }
  }

  private async listUninitialized(): Promise<unknown> {
    try {
      const ids = await listPluginIds()
      const plugins: Record<string, unknown>[] = []
      for (const id of ids) {
        const status = await getPluginStatus(id)
        if (status !== 'uninitialized') continue
        try {
          const code = await loadPluginCode(id)
          const { info, sources, configUI, isUIWidget } = parsePlugin(code)
          plugins.push({ id, info, sources, configUI, isUIWidget, status })
        } catch (e) {
          console.error(`加载插件 ${id} 失败:`, e)
        }
      }
      return { plugins }
    } catch (error) {
      return { error: error instanceof Error ? error.message : '获取未初始化插件列表失败' }
    }
  }

  private async listAll(): Promise<unknown> {
    try {
      const ids = await listPluginIds()
      const plugins: Record<string, unknown>[] = []
      let activePluginId: string | null = null
      for (const id of ids) {
        try {
          const code = await loadPluginCode(id)
          const { info, sources, configUI, isUIWidget } = parsePlugin(code)
          const status = await getPluginStatus(id)
          const config = await loadPluginConfig(id)
          if (status === 'active') activePluginId = id
          plugins.push({ id, info, sources, configUI, isUIWidget, status, config })
        } catch (e) {
          console.error(`加载插件 ${id} 失败:`, e)
        }
      }
      return { plugins, activePluginId }
    } catch (error) {
      return { error: error instanceof Error ? error.message : '获取插件列表失败' }
    }
  }

  private async callPlugin(pluginId: string, method: string, args: unknown[]): Promise<unknown> {
    try {
      let host = pluginInstances.get(pluginId)
      if (!host) {
        const code = await loadPluginCode(pluginId)
        host = new SuchMusicPluginHost()
        await host.loadPlugin(code)
        pluginInstances.set(pluginId, host)
      }

      let result: unknown
      switch (method) {
        case 'musicUrl':
          result = await host.getMusicUrl(args[0] as string, args[1] as never, args[2] as string)
          break
        case 'getPic':
          result = await host.getPic(args[0] as string, args[1] as never)
          break
        case 'getLyric':
          result = await host.getLyric(args[0] as string, args[1] as never)
          break
        default: {
          const anyHost = host as unknown as Record<string, unknown>
          if (typeof anyHost[method] === 'function') {
            result = await (anyHost[method] as (...a: unknown[]) => unknown)(...args)
          } else {
            throw new Error(`插件方法 ${method} 不存在`)
          }
        }
      }
      return { result: method === 'musicUrl' ? { url: result } : result }
    } catch (error) {
      return { error: error instanceof Error ? error.message : '调用插件方法失败' }
    }
  }

  // ---------- 落雪插件实现 ----------

  private async saveSnowdropResults(results: ProcessResult[]): Promise<string[]> {
    const savedPaths: string[] = []
    await ensureDir(PLUGINS_DIR)
    for (const res of results) {
      if (res.transformedCode) {
        const fileName = `plugin-${Date.now()}-${Math.random().toString(16).slice(2, 10)}.js`
        const savePath = `${PLUGINS_DIR}/${fileName}`
        await writeText(savePath, res.transformedCode)
        savedPaths.push(savePath)
        res.filePath = savePath
      } else {
        savedPaths.push(res.filePath)
      }
    }
    await addPluginPaths(savedPaths)
    return savedPaths
  }

  private async snowdropOpenFile(): Promise<unknown> {
    const picked = await SuchLocalMusic.pickTextFiles()
    if (picked.canceled || !picked.files.length) return { canceled: true }

    const results: ProcessResult[] = []
    const errors: string[] = []
    for (const f of picked.files) {
      try {
        results.push(processPluginCode(f.name, f.content))
      } catch (err) {
        errors.push(String(err))
      }
    }
    if (results.length) await this.saveSnowdropResults(results)
    return { canceled: false, results, errors }
  }

  private async snowdropDownloadUrl(url: string): Promise<unknown> {
    if (!url || typeof url !== 'string') {
      return { canceled: true, results: [], errors: ['无效的 URL 地址'] }
    }
    const errors: string[] = []
    try {
      const response = await CapacitorHttp.get({
        url,
        responseType: 'text',
        connectTimeout: 30000,
        readTimeout: 30000,
        headers: { 'User-Agent': 'SuchMusic/SnowdropPlugin' }
      })
      if (response.status !== 200) {
        errors.push(`下载失败: HTTP ${response.status}`)
      } else if (!response.data || !String(response.data).trim()) {
        errors.push('下载的文件内容为空')
      }
      if (errors.length) return { canceled: false, results: [], errors }

      const code = String(response.data)
      const result = processPluginCode(url.split('/').pop() || 'snowdrop-plugin.js', code)
      await this.saveSnowdropResults([result])
      return { canceled: false, results: [result], errors }
    } catch (err) {
      errors.push(`下载或解析失败: ${String(err)}`)
      return { canceled: false, results: [], errors }
    }
  }

  private async snowdropLoadAll(): Promise<unknown> {
    const config = await getSnowdropConfig()
    if (!config.pluginPaths.length) {
      return { canceled: true, reason: 'no-paths', results: [] }
    }

    const results: ProcessResult[] = []
    const errors: string[] = []
    for (const fp of config.pluginPaths) {
      try {
        const code = await readText(fp)
        results.push(processPluginCode(fp, code))
      } catch (err) {
        errors.push(`File ${fp}: ${String(err)}`)
      }
    }
    return {
      canceled: false,
      results,
      errors,
      activeFilePath: config.activePluginPath ?? null
    }
  }

  private async snowdropSetActive(filePath: string | null): Promise<unknown> {
    const config = await getSnowdropConfig()
    let nextActive: string | null = null
    if (filePath && config.pluginPaths.includes(filePath)) {
      nextActive = filePath
    }
    config.activePluginPath = nextActive
    await saveSnowdropConfig(config)
    musicUrlHostCache = null
    return { success: true, activePluginPath: nextActive }
  }

  private snowdropTest(): unknown {
    const sampleCode = `
/**
 * @name 示例落雪音源插件
 * @version 1.0.0
 * @author test
 * @description 用于测试的事件驱动落雪插件
 */

lx.on(lx.EVENT_NAMES.request, async (data) => {
  if (data.action === 'musicUrl') {
    return 'https://example.com/test-' + data.source
  }
})

lx.send(lx.EVENT_NAMES.inited, {
  sources: {
    kw: { type: 'music', qualitys: ['128k', '320k'] }
  }
})
`
    const single = transformSnowdropPlugin(sampleCode, { sourceType: 'lx' })
    const bench = benchmarkSnowdropTransform(sampleCode, 1000)
    return {
      ...single,
      stats: {
        singleDurationMs: single.stats.durationMs,
        batchDurationMs: bench.durationMs,
        averageMs: bench.averageMs,
        count: bench.count,
        estimatedMemoryDeltaMb: 0
      }
    }
  }

  private async snowdropGetMusicUrl(
    source: string,
    musicInfo: unknown,
    quality: string
  ): Promise<unknown> {
    const config = await getSnowdropConfig()
    if (!config.activePluginPath) {
      throw new Error('未设置激活的音源插件')
    }
    const activePath = config.activePluginPath
    try {
      // 优先复用已加载的插件实例，避免每次切歌都重新读文件并加载：
      // 1) plugin:* 体系的文件命名为 plugins/<id>.js，激活时已缓存实例
      // 2) 其余路径使用单项缓存（重启后首次播放时加载一次）
      const pluginId = activePath.startsWith(`${PLUGINS_DIR}/`)
        ? activePath.slice(PLUGINS_DIR.length + 1, -3)
        : null
      let host = (pluginId && pluginInstances.get(pluginId)) || null
      if (!host && musicUrlHostCache?.path === activePath) {
        host = musicUrlHostCache.host
      }
      if (!host) {
        const code = await readText(activePath)
        host = new SuchMusicPluginHost()
        await host.loadPlugin(code)
        musicUrlHostCache = { path: activePath, host }
      }
      const url = await host.getMusicUrl(source, musicInfo as never, quality)
      return { url }
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : '获取播放链接失败')
    }
  }
}
