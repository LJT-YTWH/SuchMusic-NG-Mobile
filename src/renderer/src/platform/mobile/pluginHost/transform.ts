// 落雪插件转换器（WebView 移植版）
// 与 src/plugin/utils/snowdrop-transform.ts 行为一致：
// - vm.runInNewContext -> runPluginSandbox
// - process.hrtime -> performance.now
import convertEventDrivenPlugin from './converter'
import { runPluginSandbox } from './sandbox'

export type SnowdropPluginType = 'event-driven' | 'suchmusic' | 'legacy' | 'unknown'

export interface SnowdropPluginMeta {
  name: string
  version: string
  author: string
  description?: string
  homepage?: string
}

export interface SnowdropTransformOptions {
  sourceType?: 'lx' | 'cr'
}

export interface SnowdropTransformStats {
  durationMs: number
}

export interface SnowdropSourceSummary {
  id: string
  name: string
  qualities: string[]
}

export interface SnowdropTransformResult {
  meta: SnowdropPluginMeta
  type: SnowdropPluginType
  transformedCode: string
  logs: string[]
  warnings: string[]
  errors: string[]
  stats: SnowdropTransformStats
  sources?: SnowdropSourceSummary[]
  runtimeLogs?: string[]
}

export interface SnowdropBenchmarkResult {
  count: number
  durationMs: number
  averageMs: number
}

function extractMeta(originalCode: string): SnowdropPluginMeta {
  const pick = (pattern: RegExp, fallback: string): string => {
    const m = originalCode.match(pattern)
    return m && m[1] ? m[1].trim() : fallback
  }
  return {
    name: pick(/@name\s+(.+)/, '未知插件'),
    version: pick(/@version\s+(.+)/, '1.0.0'),
    author: pick(/@author\s+(.+)/, 'Unknown'),
    description: pick(/@description\s+(.+)/, '落雪音源插件'),
    homepage: (() => {
      const m = originalCode.match(/@homepage\s+(.+)/)
      return m && m[1] ? m[1].trim() : undefined
    })()
  }
}

function extractSourcesSummary(transformedCode: string): {
  sources: SnowdropSourceSummary[]
  runtimeLogs: string[]
} {
  try {
    const runtimeLogs: string[] = []
    const pushLog = (level: string, args: unknown[]): void => {
      const parts = args.map((v) => {
        if (typeof v === 'string') return v
        try {
          return JSON.stringify(v)
        } catch {
          return String(v)
        }
      })
      runtimeLogs.push(`[${level}] ${parts.join(' ')}`)
    }

    const stubApi = {
      // 回调式调用必须通过回调返回错误：若直接返回被拒绝的 Promise，
      // 插件只注册回调不消费返回值，会产生未处理的 Promise 拒绝
      request: (...args: unknown[]) => {
        const err = new Error('suchmusic.request is disabled in Snowdrop summary')
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

    const exported = runPluginSandbox(transformedCode, {
      suchmusic: stubApi,
      logger: {
        log: (...args: unknown[]) => pushLog('log', args),
        warn: (...args: unknown[]) => pushLog('warn', args),
        error: (...args: unknown[]) => pushLog('error', args),
        info: (...args: unknown[]) => pushLog('log', args)
      },
      processEnv: { NODE_ENV: 'production', SNOWDROP_SUMMARY: '1' }
    })

    if (!exported || typeof exported !== 'object') {
      return { sources: [], runtimeLogs }
    }

    const pluginObj = exported as { sources?: unknown; musicUrl?: unknown }
    if (!pluginObj.sources || typeof pluginObj.sources !== 'object') {
      return { sources: [], runtimeLogs }
    }

    const sourcesRecord = pluginObj.sources as Record<string, unknown>
    const result: SnowdropSourceSummary[] = []

    for (const [id, src] of Object.entries(sourcesRecord)) {
      if (!src || typeof src !== 'object') continue
      const srcObj = src as { name?: unknown; qualitys?: unknown }
      const rawName = typeof srcObj.name === 'string' ? srcObj.name.trim() : ''
      const qualities: string[] = []
      if (Array.isArray(srcObj.qualitys)) {
        for (const q of srcObj.qualitys) {
          if (typeof q === 'string') {
            const s = q.trim()
            if (s) qualities.push(s)
          }
        }
      }
      result.push({ id, name: rawName || id, qualities })
    }

    // 尝试调用一次 musicUrl 以触发插件内部日志
    try {
      if (typeof pluginObj.musicUrl === 'function') {
        const testSource = Object.keys(sourcesRecord)[0]
        if (testSource) {
          const fakeMusicInfo = {
            id: 'snowdrop-test',
            name: 'Snowdrop Test Song',
            singer: 'Snowdrop',
            songmid: 'snowdrop-test',
            songId: 'snowdrop-test',
            mid: 'snowdrop-test'
          }
          // 概要阶段网络被禁用，musicUrl 必然拒绝，吞掉避免未处理的 Promise 拒绝
          void (pluginObj.musicUrl as (s: string, m: unknown, q: string) => Promise<unknown>)(
            testSource,
            fakeMusicInfo,
            '128k'
          ).catch(() => {})
        }
      }
    } catch {
      // 尽力而为
    }

    return { sources: result, runtimeLogs }
  } catch {
    return { sources: [], runtimeLogs: [] }
  }
}

function detectPluginType(originalCode: string): SnowdropPluginType {
  const lower = originalCode.toLowerCase()

  if (lower.includes('module.exports') && lower.includes('plugininfo')) {
    return 'suchmusic'
  }

  if (
    lower.includes('lx.event_names') ||
    /lx\.on\s*\(\s*['"`]request['"`]/i.test(originalCode) ||
    /lx\.send\s*\(\s*['"`]inited['"`]/i.test(originalCode)
  ) {
    return 'event-driven'
  }

  const hasGlobalLx = /globalThis\.lx/i.test(originalCode) || /global\.lx/i.test(originalCode)
  const hasEventNamesRequest = /EVENT_NAMES\.request/.test(originalCode)
  const hasEventNamesInited = /EVENT_NAMES\.inited/.test(originalCode)
  const hasOnCall = /\bon\s*\(/.test(originalCode)
  const hasSendCall = /\bsend\s*\(/.test(originalCode)

  if (hasGlobalLx && hasEventNamesRequest && hasEventNamesInited && hasOnCall && hasSendCall) {
    return 'event-driven'
  }

  if (lower.includes('lx')) {
    return 'legacy'
  }

  return 'unknown'
}

function createFallbackCode(meta: SnowdropPluginMeta, reason: string): string {
  const safeReason = reason.replace(/\r?\n/g, ' ')
  return `const pluginInfo = {
  name: ${JSON.stringify(meta.name)},
  version: ${JSON.stringify(meta.version)},
  author: ${JSON.stringify(meta.author)},
  description: ${JSON.stringify(meta.description || '')}
};

const sources = {};

async function musicUrl() {
  throw new Error(${JSON.stringify(`[SnowdropTransform] 不支持的落雪音源插件格式: ${safeReason}`)});
}

module.exports = { pluginInfo, sources, musicUrl };`
}

export function transformSnowdropPlugin(
  originalCode: string,
  options: SnowdropTransformOptions = {}
): SnowdropTransformResult {
  const logs: string[] = []
  const warnings: string[] = []
  const errors: string[] = []

  const meta = extractMeta(originalCode)
  const type = detectPluginType(originalCode)
  const sourceLabel = options.sourceType ?? 'unknown'

  logs.push(`[SnowdropTransform] 检测到插件类型: ${type} (source=${sourceLabel})`)

  const start = performance.now()
  let transformedCode = originalCode

  try {
    if (type === 'event-driven') {
      transformedCode = convertEventDrivenPlugin(originalCode)
      logs.push('[SnowdropTransform] 已按事件驱动落雪插件路径完成转换')
    } else if (type === 'suchmusic') {
      warnings.push('[SnowdropTransform] 检测到已是 SuchMusic 插件，跳过转换')
      transformedCode = originalCode
    } else {
      const reason =
        type === 'legacy' ? '检测到 lx 相关调用但缺少事件驱动特征' : '未检测到落雪插件关键标记'
      warnings.push(`[SnowdropTransform] ${reason}，将生成降级兼容插件`)
      transformedCode = createFallbackCode(meta, reason)
    }
  } catch (error: unknown) {
    let msg = '未知错误'
    if (error instanceof Error && error.message) {
      msg = String(error.message)
    } else if (typeof error === 'string') {
      msg = error
    }
    errors.push(`[SnowdropTransform] 转换失败: ${msg}`)
    warnings.push('[SnowdropTransform] 已回退为安全降级插件')
    transformedCode = createFallbackCode(meta, msg)
  }

  const durationMs = performance.now() - start
  logs.push(`[SnowdropTransform] 转换耗时约 ${durationMs.toFixed(3)} ms`)

  const { sources, runtimeLogs } = extractSourcesSummary(transformedCode)
  if (sources.length) {
    logs.push(`[SnowdropTransform] 已解析到 ${sources.length} 个音源入口`)
  }

  return {
    meta,
    type,
    transformedCode,
    logs,
    warnings,
    errors,
    stats: { durationMs },
    sources,
    runtimeLogs
  }
}

export function benchmarkSnowdropTransform(
  sampleCode: string,
  count = 1000
): SnowdropBenchmarkResult {
  const start = performance.now()
  let success = 0
  for (let i = 0; i < count; i++) {
    const result = transformSnowdropPlugin(sampleCode)
    if (result.errors.length === 0) success++
  }
  const durationMs = performance.now() - start
  return { count: success, durationMs, averageMs: durationMs / count }
}
