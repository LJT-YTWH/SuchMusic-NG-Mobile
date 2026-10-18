import axios, { type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { CapacitorHttp } from '@capacitor/core'

// 将 axios 请求转发到 Capacitor 原生 HTTP 栈，绕开 WebView CORS 限制
// （桌面端依赖主进程 webRequest 注入 CORS 头，移动端无此机制）

function buildFullUrl(config: InternalAxiosRequestConfig): string {
  const base = config.baseURL || ''
  const url = config.url || ''
  let full = /^https?:\/\//i.test(url) ? url : base.replace(/\/+$/, '') + '/' + url.replace(/^\/+/, '')

  // 拼接 query 参数
  const params = config.params
  if (params && typeof params === 'object') {
    const usp = new URLSearchParams()
    for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
      if (v === undefined || v === null) continue
      if (Array.isArray(v)) {
        for (const item of v) usp.append(k, String(item))
      } else {
        usp.append(k, String(v))
      }
    }
    const qs = usp.toString()
    if (qs) full += (full.includes('?') ? '&' : '?') + qs
  }
  return full
}

export const capacitorAxiosAdapter: AxiosAdapter = async (config) => {
  const url = buildFullUrl(config)
  const method = (config.method || 'get').toUpperCase()

  // 请求头（AxiosHeaders 转普通对象）
  const headers: Record<string, string> = {}
  if (config.headers) {
    const h = config.headers as { toJSON?: () => Record<string, unknown> }
    const plain = typeof h.toJSON === 'function' ? h.toJSON() : (config.headers as Record<string, unknown>)
    for (const [k, v] of Object.entries(plain)) {
      if (v === undefined || v === null) continue
      headers[k] = String(v)
    }
  }

  let data: unknown = config.data
  if (data && typeof data === 'object' && !(data instanceof FormData)) {
    // axios 默认 transformRequest 已把对象序列化为 JSON 字符串；这里兜底
    if (headers['Content-Type']?.includes('application/json') && typeof data !== 'string') {
      data = JSON.stringify(data)
    }
  }

  const responseType =
    config.responseType === 'arraybuffer' || config.responseType === 'blob'
      ? ('arraybuffer' as const)
      : ('text' as const)

  const timeout = typeof config.timeout === 'number' && config.timeout > 0 ? config.timeout : 30000

  const res = await CapacitorHttp.request({
    url,
    method,
    headers,
    data: data as never,
    responseType,
    connectTimeout: timeout,
    readTimeout: timeout
  })

  let resData: unknown = res.data
  // 模拟 axios 默认 transformResponse：文本尝试解析为 JSON
  if (responseType === 'text' && typeof resData === 'string') {
    const requested = config.transitional as { silentJSONParsing?: boolean } | undefined
    void requested
    try {
      resData = JSON.parse(resData)
    } catch {
      // 保持文本
    }
  }

  const response: AxiosResponse = {
    data: resData,
    status: res.status,
    statusText: '',
    headers: res.headers || {},
    config,
    request: null
  }

  // 模拟 axios validateStatus（默认 200-299）
  const validate = config.validateStatus
  const ok = validate ? validate(res.status) : res.status >= 200 && res.status < 300
  if (!ok) {
    const err = new Error(`Request failed with status code ${res.status}`) as Error & {
      response?: AxiosResponse
      config?: unknown
      isAxiosError?: boolean
    }
    err.response = response
    err.config = config
    err.isAxiosError = true
    throw err
  }

  return response
}

/** 全局替换 axios 适配器（移动端启动时同步调用，先于任何 axios 实例创建） */
export function patchAxiosForMobile(): void {
  axios.defaults.adapter = capacitorAxiosAdapter
}
