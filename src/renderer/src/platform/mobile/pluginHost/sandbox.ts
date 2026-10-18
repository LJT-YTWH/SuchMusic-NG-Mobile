// WebView 沙箱执行辅助：替代 Node vm.createContext/runInContext
// 将插件代码包装为函数体，通过参数注入受限全局对象
import { Buffer as BufferPolyfill } from 'buffer'

export interface SandboxLogger {
  log: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  info?: (...args: unknown[]) => void
}

const SANDBOX_PARAMS = [
  'module',
  'exports',
  'suchmusic',
  'console',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'Buffer',
  'JSON',
  'require',
  'process',
  'global',
  'globalThis',
  'window',
  // 以下 WebView 真实全局在 Node vm 沙箱中不存在，统一遮蔽为 undefined，
  // 避免插件按 typeof fetch/document 等判断环境时走入与桌面端不同的分支
  'document',
  'navigator',
  'location',
  'self',
  'fetch',
  'XMLHttpRequest',
  'localStorage',
  'sessionStorage',
  'indexedDB'
] as const

// 插件可能挂到全局对象上的导出字段（vm 中全局对象即 sandbox，部分插件只挂全局）
const EXPORT_KEYS = ['pluginInfo', 'sources', 'musicUrl', 'getPic', 'getLyric', 'configUI'] as const

// 无需输出、仅需避免插件报错的 console 方法
const CONSOLE_NOOP_METHODS = new Set(['groupEnd', 'timeEnd', 'countReset', 'clear', 'timeStamp'])

/**
 * 将传入的 logger 包装为完整 console：
 * 洛雪系音源脚本常调用 console.group/table/time 等方法（尤其 env != 'mobile' 分支），
 * 而插件宿主上报的 env 为 nodejs，logger 又只保证 log/warn/error，
 * 缺失的方法会让插件直接抛 "console.xxx is not a function"。
 * 这里对缺失方法做降级：有对应方法则透传，结束类方法静默忽略，其余回退为 log。
 */
export function makeSafeConsole(logger: SandboxLogger): Record<string, unknown> {
  const fallback = (...args: unknown[]): void => logger.log(...args)
  const noop = (): void => undefined
  const target: Record<string, unknown> = {}
  return new Proxy(target, {
    get(_t, prop: string | symbol): unknown {
      if (typeof prop !== 'string') return undefined
      const real = (logger as unknown as Record<string, unknown>)[prop]
      if (typeof real === 'function') {
        return (real as (...a: unknown[]) => void).bind(logger)
      }
      if (CONSOLE_NOOP_METHODS.has(prop)) return noop
      return fallback
    }
  })
}

/**
 * CeruPlugins（window.source）格式插件的判定与适配：
 * 新版桌面端插件通过 window.source = {...} 注册，不写 module.exports。
 * 若为音源插件（含 sources/musicUrl），适配为 v1 导出结构；
 * 若为 UI 组件插件，抛出明确的错误提示。
 */
function adaptWindowSource(
  src: unknown,
  exports: Record<string, unknown>
): void {
  if (!src || typeof src !== 'object') return
  const srcObj = src as Record<string, unknown>
  const hasMusicSourceFields =
    srcObj.sources !== undefined || typeof srcObj.musicUrl === 'function'
  if (!hasMusicSourceFields) {
    const name = typeof srcObj.name === 'string' ? srcObj.name : '未知'
    throw new Error(
      `检测到 CeruPlugins(window.source) 格式的 UI 组件插件「${name}」，该类型插件依赖桌面端 UI 能力，移动端暂不支持。请使用音源插件（v1 / 洛雪 lx 格式）。`
    )
  }

  if (exports.pluginInfo === undefined) {
    exports.pluginInfo = {
      name: srcObj.name,
      version: srcObj.version,
      author: srcObj.author,
      description: srcObj.description,
      homepage: srcObj.homepage
    }
  }
  if (exports.sources === undefined && srcObj.sources !== undefined) {
    exports.sources = srcObj.sources
  }
  // 方法需绑定到 window.source 对象，插件内部可能通过 this 访问其它字段
  for (const method of ['musicUrl', 'getPic', 'getLyric'] as const) {
    if (exports[method] === undefined && typeof srcObj[method] === 'function') {
      exports[method] = (srcObj[method] as (...args: unknown[]) => unknown).bind(srcObj)
    }
  }
  if (exports.configUI === undefined && Array.isArray(srcObj.configUI)) {
    exports.configUI = srcObj.configUI
  }
}

/**
 * 在受限环境中执行插件代码，返回 module.exports
 * 与 Node vm 语义对齐：global/globalThis/window 指向同一个沙箱对象
 */
export function runPluginSandbox(
  code: string,
  options: {
    suchmusic: unknown
    logger: SandboxLogger
    processEnv?: Record<string, string>
    /**
     * source（默认）：按音源插件解析，UI 组件插件抛错；
     * uiWidget：按 UI 组件插件解析，直接返回 { source }，不做音源适配
     */
    mode?: 'source' | 'uiWidget'
    /** 自定义 window.notify 行为（默认仅写日志），UI 组件插件可接入真实提示 */
    notify?: (message: unknown, type?: unknown) => void
  }
): Record<string, unknown> {
  const moduleObj: { exports: Record<string, unknown> } = { exports: {} }
  const sandboxGlobal: Record<string, unknown> = {}

  // 生产构建下 globalThis.Buffer 可能不存在（polyfill 插件不挂全局），回退到直接引入的 polyfill
  const BufferCtor = (globalThis as { Buffer?: unknown }).Buffer ?? BufferPolyfill

  // 与 Node vm 语义对齐：注入的全局在沙箱全局对象上同样可访问
  //（插件可能通过 window.suchmusic / globalThis.Buffer 等方式引用）
  const processStub = { env: options.processEnv ?? {} }
  const safeConsole = makeSafeConsole(options.logger)
  const notifyStub = (message: unknown, type?: unknown): void => {
    if (options.notify) {
      try {
        options.notify(message, type)
      } catch {
        // 通知回调异常不影响插件执行
      }
    }
    options.logger.log(`[PluginNotify:${typeof type === 'string' ? type : 'info'}]`, message)
  }
  Object.assign(sandboxGlobal, {
    module: moduleObj,
    exports: moduleObj.exports,
    suchmusic: options.suchmusic,
    console: safeConsole,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Buffer: BufferCtor,
    JSON,
    process: processStub,
    global: sandboxGlobal,
    globalThis: sandboxGlobal,
    window: sandboxGlobal,
    notify: notifyStub
  })

  // 快照真实全局：插件中未声明的赋值（如 source = {...}，非严格模式）
  // 会泄漏到 WebView 真实 globalThis，执行后需要兜底回收这些导出
  const globalKeysBefore = new Set(Object.getOwnPropertyNames(globalThis))

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function(...SANDBOX_PARAMS, code) as (...args: unknown[]) => void

  fn.call(
    sandboxGlobal,
    moduleObj,
    moduleObj.exports,
    options.suchmusic,
    safeConsole,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    BufferCtor,
    JSON,
    () => ({}),
    processStub,
    sandboxGlobal,
    sandboxGlobal,
    sandboxGlobal,
    undefined, // document
    undefined, // navigator
    undefined, // location
    undefined, // self
    undefined, // fetch
    undefined, // XMLHttpRequest
    undefined, // localStorage
    undefined, // sessionStorage
    undefined // indexedDB
  )

  // 回收泄漏到真实全局的导出（非严格模式下未声明的赋值，如 source = {...}）
  // 回收后即从真实全局删除，避免污染后续插件的执行环境
  const realGlobal = globalThis as Record<string, unknown>
  for (const key of Object.getOwnPropertyNames(globalThis)) {
    if (globalKeysBefore.has(key)) continue
    if (key === 'source' || (EXPORT_KEYS as readonly string[]).includes(key)) {
      if (sandboxGlobal[key] === undefined) sandboxGlobal[key] = realGlobal[key]
      delete realGlobal[key]
    } else if (key === 'module') {
      // 插件以 module = { exports: ... }（无声明）方式导出
      const leakedModule = realGlobal[key] as { exports?: unknown } | undefined
      if (
        leakedModule &&
        typeof leakedModule === 'object' &&
        leakedModule.exports &&
        typeof leakedModule.exports === 'object' &&
        Object.keys(moduleObj.exports).length === 0
      ) {
        moduleObj.exports = leakedModule.exports as Record<string, unknown>
        sandboxGlobal.exports = moduleObj.exports
      }
      delete realGlobal[key]
    }
  }

  // UI 组件模式：不做音源导出适配，直接返回 window.source 供 Widget 宿主接管
  if (options.mode === 'uiWidget') {
    return { source: sandboxGlobal.source, exports: moduleObj.exports }
  }

  const result = moduleObj.exports
  if (result && typeof result === 'object') {
    // 兜底 1：部分插件（或打包器产物）将导出挂在 default 上（ESM 互操作）
    const candidate = result as Record<string, unknown>
    const dft = candidate.default as Record<string, unknown> | undefined
    if (
      dft &&
      typeof dft === 'object' &&
      (candidate.pluginInfo === undefined || candidate.musicUrl === undefined) &&
      dft.pluginInfo !== undefined
    ) {
      for (const key of EXPORT_KEYS) {
        if (candidate[key] === undefined && dft[key] !== undefined) candidate[key] = dft[key]
      }
    }
    // 兜底 2：插件把字段挂到全局对象（globalThis/window）而未写 module.exports
    for (const key of EXPORT_KEYS) {
      if (candidate[key] === undefined && sandboxGlobal[key] !== undefined) {
        candidate[key] = sandboxGlobal[key]
      }
    }
    // 兜底 3：CeruPlugins(window.source) 格式适配为 v1 导出结构；
    // 若为 UI 组件插件（无音源字段），抛出明确的错误提示
    if (candidate.pluginInfo === undefined || candidate.musicUrl === undefined) {
      adaptWindowSource(sandboxGlobal.source, candidate)
    }
  }

  return result
}
