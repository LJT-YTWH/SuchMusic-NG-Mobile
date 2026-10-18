import { CapacitorHttp, type HttpResponse } from '@capacitor/core'

// 与主进程 proxy:request 返回结构保持一致
export async function proxyRequest(options: {
  url: string
  method?: string
  params?: Record<string, string>
  data?: unknown
  headers?: Record<string, string>
  responseType?: 'arraybuffer' | 'blob' | 'json' | 'text'
}): Promise<{
  success: boolean
  data?: unknown
  status?: number
  headers?: Record<string, string>
  error?: string
}> {
  const { url, method = 'GET', params, data, headers, responseType } = options
  try {
    const response: HttpResponse = await CapacitorHttp.request({
      url,
      method: method.toUpperCase(),
      params,
      data,
      headers,
      responseType: responseType === 'blob' ? 'arraybuffer' : responseType,
      connectTimeout: 30000,
      readTimeout: 30000
    })
    return {
      success: true,
      data: response.data,
      status: response.status,
      headers: response.headers as Record<string, string>
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Proxy request failed:', message)
    return { success: false, error: message }
  }
}
