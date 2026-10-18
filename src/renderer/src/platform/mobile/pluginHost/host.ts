// SuchMusic 插件宿主（WebView 移植版）
// 与 src/plugin/manager/SuchMusicPluginHost.ts 保持行为一致：
// - vm 沙箱 -> new Function 受限执行
// - Node crypto -> node-forge
// - Node fetch -> CapacitorHttp（原生网络栈，绕开 WebView CORS）
import { CapacitorHttp } from '@capacitor/core'
import forge from 'node-forge'
import { Buffer as BufferPolyfill } from 'buffer'
import { runPluginSandbox, type SandboxLogger } from './sandbox'
import { transformSnowdropPlugin } from './transform'

// vite-plugin-node-polyfills 在 build 模式下仅替换模块内的 Buffer 标识符，
// 不会挂载 globalThis.Buffer；插件沙箱与加解密依赖全局对象，这里显式安装。
const globalRef = globalThis as { Buffer?: typeof Buffer }
if (!globalRef.Buffer) {
  globalRef.Buffer = BufferPolyfill as unknown as typeof Buffer
}

const CONSTANTS = {
  // 20s：部分洛雪音源托管在 Render 等免费平台，冷启动可达数十秒，
  // 10s 超时会让首次取链几乎必败；配合播放链路自带的重试可覆盖冷启动窗口
  DEFAULT_TIMEOUT: 20000,
  API_VERSION: '1.0.3',
  ENVIRONMENT: 'nodejs',
  NOTICE_DELAY: 100,
  LOG_PREFIX: '[SuchMusic]'
} as const

// 判断是否为洛雪格式插件代码（与桌面端一致）
export function isLxStylePluginCode(code: string): boolean {
  const lower = code.toLowerCase()

  if (lower.includes('module.exports') && lower.includes('plugininfo')) {
    return false
  }

  if (
    lower.includes('lx.event_names') ||
    /lx\.on\s*\(\s*['"`]request['"`]/i.test(code) ||
    /lx\.send\s*\(\s*['"`]inited['"`]/i.test(code)
  ) {
    return true
  }

  const hasGlobalLx = /globalThis\.lx/i.test(code) || /global\.lx/i.test(code)
  const hasEventNamesRequest = /EVENT_NAMES\.request/.test(code)
  const hasEventNamesInited = /EVENT_NAMES\.inited/.test(code)
  const hasOnCall = /\bon\s*\(/.test(code)
  const hasSendCall = /\bsend\s*\(/.test(code)

  if (hasGlobalLx && hasEventNamesRequest && hasEventNamesInited && hasOnCall && hasSendCall) {
    return true
  }

  if (lower.includes('lx')) {
    return true
  }

  return false
}

export interface PluginInfo {
  name: string
  version: string
  author: string
  description?: string
  [key: string]: unknown
}

export interface PluginSource {
  name: string
  qualities: string[]
  [key: string]: unknown
}

export interface MusicItem {
  id: number | string
  name: string
  singer: string
  source: string
  interval: string | null
  metaData: unknown
  quality?: unknown
  [key: string]: unknown
}

interface SuchMusicPlugin {
  pluginInfo: PluginInfo
  sources: PluginSource[] | Record<string, PluginSource>
  musicUrl: (source: string, musicInfo: MusicItem, quality: string) => Promise<string>
  getPic?: (source: string, musicInfo: MusicItem) => Promise<string>
  getLyric?: (source: string, musicInfo: MusicItem) => Promise<string>
}

interface RequestResult {
  body: unknown
  statusCode: number
  headers: Record<string, string>
}

type RequestOptions = {
  method?: string
  headers?: Record<string, string>
  body?: unknown
  timeout?: number
  [key: string]: unknown
}

type RequestCallback = (error: Error | null, result: RequestResult | null) => void

type PluginMethodName = 'musicUrl' | 'getPic' | 'getLyric'

class PluginError extends Error {
  constructor(
    message: string,
    public readonly method?: string
  ) {
    super(message)
    this.name = 'PluginError'
  }
}

function getBuffer(): typeof Buffer {
  return ((globalThis as { Buffer?: typeof Buffer }).Buffer ??
    BufferPolyfill) as unknown as typeof Buffer
}

// Buffer -> forge 字节串
function bufferToBytes(data: Buffer | string): string {
  if (typeof data === 'string') return forge.util.encodeUtf8(data)
  const u8 = new Uint8Array(data as unknown as ArrayBuffer)
  let s = ''
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i])
  return s
}

function bytesToBuffer(bytes: string): Buffer {
  const BufferCtor = getBuffer()
  const u8 = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) u8[i] = bytes.charCodeAt(i)
  return BufferCtor.from(u8)
}

/**
 * CeruPlugins 文档标准化的 fetch API（Response 风格对象），
 * 走 CapacitorHttp 原生网络栈绕开 WebView CORS。
 * 独立导出供音源宿主与 UI 组件宿主共用。
 */
// ==================== 插件配置持久化（getPluginConfig/setPluginConfig） ====================

const PLUGIN_CONFIG_PREFIX = 'plugin_runtime_config:'

export function readPluginConfigStorage(pluginId: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(PLUGIN_CONFIG_PREFIX + pluginId)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
    }
  } catch {
    // 忽略损坏数据
  }
  return {}
}

export function writePluginConfigStorage(pluginId: string, cfg: Record<string, unknown>): void {
  try {
    localStorage.setItem(PLUGIN_CONFIG_PREFIX + pluginId, JSON.stringify(cfg))
  } catch {
    // 存储满等异常静默
  }
}

/**
 * suchmusic.utils（buffer/crypto）构建，音源宿主与 UI 组件宿主共用，
 * 保证两类插件拿到的工具接口行为一致。
 */
export function createPluginApiUtils() {
  const BufferCtor = getBuffer()

  const validateEncoding = (encoding?: BufferEncoding): BufferEncoding => {
    const supported = ['base64', 'hex', 'utf8']
    if (encoding && !supported.includes(encoding)) {
      throw new Error(`Unsupported encoding: ${encoding}. Only ${supported.join(', ')} are supported.`)
    }
    return encoding || 'utf8'
  }

  return {
    buffer: {
      from: (data: string | Buffer | ArrayBuffer, encoding?: BufferEncoding): Buffer => {
        if (typeof data === 'string') {
          return BufferCtor.from(data, validateEncoding(encoding))
        } else if (data instanceof ArrayBuffer) {
          return BufferCtor.from(new Uint8Array(data))
        }
        return data as Buffer
      },
      bufToString: (buffer: Buffer, encoding?: BufferEncoding): string => {
        return buffer.toString(validateEncoding(encoding))
      }
    },
    crypto: {
      aesEncrypt: (data: unknown, mode: string, key: string | Buffer, iv?: string | Buffer): Buffer => {
        const supportedModes: Record<string, string> = {
          'aes-128-cbc': 'AES-CBC',
          'aes-128-ecb': 'AES-ECB'
        }
        const forgeMode = supportedModes[mode]
        if (!forgeMode) {
          throw new Error(`Unsupported AES mode: ${mode}. Only aes-128-cbc, aes-128-ecb are supported.`)
        }
        const keyBytes = bufferToBytes(key).slice(0, 16)
        const ivBytes = forgeMode === 'AES-ECB' ? '' : iv ? bufferToBytes(iv).slice(0, 16) : '\0'.repeat(16)
        const cipher = forge.cipher.createCipher(forgeMode, keyBytes)
        cipher.start({ iv: ivBytes })
        const dataBytes =
          typeof data === 'string'
            ? forge.util.encodeUtf8(data)
            : bufferToBytes(data as Buffer)
        cipher.update(forge.util.createBuffer(dataBytes))
        cipher.finish()
        return bytesToBuffer(cipher.output.getBytes())
      },
      md5: (str: string): string => {
        return forge.md.md5.create().update(str, 'utf8').digest().toHex()
      },
      randomBytes: (size: number): Buffer => {
        return bytesToBuffer(forge.random.getBytesSync(size))
      },
      rsaEncrypt: (data: string, key: string): string => {
        const publicKey = forge.pki.publicKeyFromPem(key)
        const encrypted = publicKey.encrypt(forge.util.encodeUtf8(data), 'RSAES-PKCS1-V1_5')
        return forge.util.encode64(encrypted)
      }
    }
  }
}

export function createCapacitorFetch() {
  return async (
    url: string,
    options?: { method?: string; headers?: Record<string, string>; body?: unknown }
  ) => {
    const response = await CapacitorHttp.request({
      url,
      method: (options?.method || 'GET').toUpperCase(),
      headers: options?.headers,
      data: options?.body,
      responseType: 'text',
      connectTimeout: CONSTANTS.DEFAULT_TIMEOUT,
      readTimeout: CONSTANTS.DEFAULT_TIMEOUT
    })
    const text =
      typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? '')
    const status = response.status
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: (response.headers || {}) as Record<string, string>,
      text: async () => text,
      json: async () => JSON.parse(text)
    }
  }
}

export default class SuchMusicPluginHost {
  private pluginCode: string | null
  private plugin: SuchMusicPlugin | null

  constructor(pluginCode: string | null = null, logger: SandboxLogger = console) {
    this.pluginCode = pluginCode
    this.plugin = null
    if (pluginCode) {
      this.initialize(logger)
    }
  }

  /** 从代码字符串加载插件（自动识别并转换洛雪格式） */
  async loadPlugin(code: string, logger: SandboxLogger = console): Promise<SuchMusicPlugin> {
    try {
      let processed = code
      if (isLxStylePluginCode(code)) {
        const result = transformSnowdropPlugin(code, { sourceType: 'lx' })
        if (result.logs.length) logger.log(`${CONSTANTS.LOG_PREFIX} Snowdrop logs:`, ...result.logs)
        if (result.warnings.length)
          logger.warn(`${CONSTANTS.LOG_PREFIX} Snowdrop warnings:`, ...result.warnings)
        if (result.errors.length)
          logger.error(`${CONSTANTS.LOG_PREFIX} Snowdrop errors:`, ...result.errors)
        processed = result.transformedCode
      }
      this.pluginCode = processed
      this.initialize(logger)
      return this.plugin as SuchMusicPlugin
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      throw new PluginError(`无法加载插件: ${msg}`)
    }
  }

  getPluginInfo(): PluginInfo {
    this.ensureInitialized()
    return this.plugin!.pluginInfo
  }

  getPluginCode(): string | null {
    return this.pluginCode
  }

  getSupportedSources(): PluginSource[] | Record<string, PluginSource> {
    this.ensureInitialized()
    return this.plugin!.sources
  }

  async getMusicUrl(source: string, musicInfo: MusicItem, quality: string): Promise<string> {
    return this.callPluginMethod('musicUrl', source, musicInfo, quality)
  }

  async getPic(source: string, musicInfo: MusicItem): Promise<string> {
    return this.callPluginMethod('getPic', source, musicInfo)
  }

  async getLyric(source: string, musicInfo: MusicItem): Promise<string> {
    return this.callPluginMethod('getLyric', source, musicInfo)
  }

  // ==================== 内部实现 ====================

  private initialize(logger: SandboxLogger): void {
    if (!this.pluginCode) {
      throw new PluginError('No plugin code provided.')
    }
    try {
      const exports = runPluginSandbox(this.pluginCode, {
        suchmusic: this.getSuchmusicApi(),
        logger
      })
      this.plugin = exports as unknown as SuchMusicPlugin

      if (!this.plugin?.pluginInfo || !this.plugin.sources || !this.plugin.musicUrl) {
        // 澜音 v2 格式（manifest + activate）与 v1 运行时不兼容，给出明确提示
        const manifest = (exports as Record<string, unknown>).manifest as
          | { manifestVersion?: unknown }
          | undefined
        if (manifest && typeof manifest === 'object' && manifest.manifestVersion) {
          throw new PluginError(
            '检测到澜音 v2 格式插件，当前版本暂不支持，请使用 v1 或洛雪(lx)格式插件。'
          )
        }
        const keys =
          exports && typeof exports === 'object' ? Object.keys(exports).join(', ') : '(无导出)'
        throw new PluginError(
          `Invalid plugin structure. Required fields: pluginInfo, sources, musicUrl. (实际导出: ${keys})`
        )
      }
      logger.log(`${CONSTANTS.LOG_PREFIX} Plugin "${this.plugin.pluginInfo.name}" loaded.`)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      logger.error(`${CONSTANTS.LOG_PREFIX} Error executing plugin code:`, error)
      throw new PluginError('无法初始化Such插件,可能是插件格式不正确.' + msg)
    }
  }

  private ensureInitialized(): void {
    if (!this.plugin) throw new PluginError('Plugin not initialized')
  }

  private async callPluginMethod(
    methodName: PluginMethodName,
    ...args: readonly unknown[]
  ): Promise<string> {
    this.ensureInitialized()
    const method = this.plugin![methodName] as
      | ((...a: unknown[]) => Promise<string>)
      | undefined
    if (typeof method !== 'function') {
      throw new PluginError(`Action "${methodName}" is not implemented in plugin.`, methodName)
    }
    try {
      const result = await method.call(
        { suchmusic: this.getSuchmusicApi() } as unknown as SuchMusicPlugin[typeof methodName],
        ...args
      )
      return result
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      throw new PluginError(`Plugin ${methodName} failed: ${msg}`, methodName)
    }
  }

  private getSuchmusicApi() {
    return {
      env: CONSTANTS.ENVIRONMENT,
      version: CONSTANTS.API_VERSION,
      utils: createPluginApiUtils(),
      request: this.createRequestFunction(),
      // 新版（CeruPlugins）插件文档标准化的 fetch API，返回 Response 风格对象
      fetch: this.createFetchFunction(),
      getSetting: () => undefined,
      getPluginConfig: (pluginId: string, key: string) =>
        Promise.resolve(readPluginConfigStorage(pluginId)[key]),
      setPluginConfig: (pluginId: string, key: string, value: unknown) => {
        const cfg = readPluginConfigStorage(pluginId)
        cfg[key] = value
        writePluginConfigStorage(pluginId, cfg)
        return Promise.resolve()
      },
      NoticeCenter: this.createNoticeCenter()
    }
  }

  private createFetchFunction() {
    return createCapacitorFetch()
  }

  private createRequestFunction() {
    return (url: string, options?: RequestOptions | RequestCallback, callback?: RequestCallback) => {
      if (typeof options === 'function') {
        callback = options as RequestCallback
        options = { method: 'GET' }
      }
      const requestOptions = (options || {}) as RequestOptions
      const makeRequest = () => this.makeHttpRequest(url, requestOptions)

      if (callback) {
        makeRequest()
          .then((result) => callback(null, result))
          .catch((error) => callback(error, this.createErrorResult(error, url)))
        return undefined
      }
      return makeRequest()
    }
  }

  private async makeHttpRequest(url: string, options: RequestOptions): Promise<RequestResult> {
    const timeout = options.timeout || CONSTANTS.DEFAULT_TIMEOUT
    try {
      const response = await CapacitorHttp.request({
        url,
        method: (options.method || 'GET').toUpperCase(),
        headers: options.headers as Record<string, string> | undefined,
        data: options.body,
        responseType: 'text',
        connectTimeout: timeout,
        readTimeout: timeout
      })

      let body: unknown = response.data
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body)
        } catch {
          // 保持文本
        }
      }

      return {
        body,
        statusCode: response.status,
        headers: (response.headers || {}) as Record<string, string>
      }
    } catch (error) {
      console.error(`${CONSTANTS.LOG_PREFIX} 请求失败:`, error)
      return this.createErrorResult(error, url)
    }
  }

  private createErrorResult(error: unknown, url: string): RequestResult {
    const err = error instanceof Error ? error : new Error(String(error))
    return {
      body: {
        error: err.name || 'RequestError',
        message: err.message,
        // 洛雪系脚本普遍以 body.code 判断成败并在失败时抛出 body.msg，
        // 补齐这两个字段以便把真实网络错误（超时/DNS/连接被拒）透传给用户，
        // 而不是笼统的 "unknow error"
        code: -1,
        msg: `请求失败: ${err.message}`,
        url
      },
      statusCode: 500,
      headers: {}
    }
  }

  private createNoticeCenter() {
    return (type: string, data: unknown) => {
      console.log(`[PluginNotice:${type}]`, data)
    }
  }
}
