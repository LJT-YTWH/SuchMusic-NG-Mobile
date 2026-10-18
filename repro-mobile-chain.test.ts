// 临时复现测试：验证 render_api.js 音源在移动端宿主链路（WebView 沙箱 + CapacitorHttp）下能否取到播放链接
import { describe, it, vi } from 'vitest'
import fs from 'fs'

// 用 Node fetch 模拟 CapacitorHttp 原生网络栈
vi.mock('@capacitor/core', () => {
  const doRequest = async (opts: {
    url: string
    method?: string
    headers?: Record<string, string>
    data?: unknown
  }) => {
    const resp = await fetch(opts.url, {
      method: (opts.method || 'GET').toUpperCase(),
      headers: opts.headers,
      body: opts.data as BodyInit
    })
    const text = await resp.text()
    const headers: Record<string, string> = {}
    resp.headers.forEach((v, k) => (headers[k] = v))
    return { status: resp.status, data: text, headers }
  }
  return {
    CapacitorHttp: {
      request: doRequest,
      get: (opts: { url: string; headers?: Record<string, string> }) =>
        doRequest({ ...opts, method: 'GET' })
    }
  }
})

import SuchMusicPluginHost from './src/renderer/src/platform/mobile/pluginHost/host'
import { transformSnowdropPlugin } from './src/renderer/src/platform/mobile/pluginHost/transform'

describe('render_api.js 移动端链路复现', () => {
  it('转换(transform) + 加载(host) + 取链(musicUrl)', async () => {
    const code = fs.readFileSync('/tmp/render_api.js', 'utf8')

    // 1. 模拟导入流程的转换
    const t = transformSnowdropPlugin(code, { sourceType: 'lx' })
    console.log('=== [mobile] transform type:', t.type, 'errors:', t.errors)
    console.log('=== [mobile] transform sources:', JSON.stringify(t.sources))

    // 2. 模拟播放链路的宿主加载（loadPlugin 内部会再次检测并转换）
    const host = new SuchMusicPluginHost()
    await host.loadPlugin(code)
    console.log('=== [mobile] pluginInfo:', JSON.stringify(host.getPluginInfo()))
    console.log('=== [mobile] sources:', JSON.stringify(host.getSupportedSources()))

    // 3. 模拟播放取链（与 snowdropGetMusicUrl 相同入参）
    const musicInfo = {
      id: '347230',
      name: '海阔天空',
      singer: 'Beyond',
      albumName: '乐与怒',
      pic: '',
      songmid: '347230',
      mediaId: '347230'
    }
    const url = await host.getMusicUrl('wy', musicInfo as never, '128k')
    console.log('=== [mobile] GOT URL:', url)
  }, 90000)

  it('网络失败时应抛出真实错误原因而非 unknow error', async () => {
    const code = fs.readFileSync('/tmp/render_api.js', 'utf8')
    const host = new SuchMusicPluginHost()
    await host.loadPlugin(code)

    // 请求一个不可达的地址模拟网络失败：把脚本的 API_URL 换成本地不可达端口
    const brokenCode = code.replace(
      'https://lxmusicapi.onrender.com',
      'http://127.0.0.1:1'
    )
    const brokenHost = new SuchMusicPluginHost()
    await brokenHost.loadPlugin(brokenCode)

    const musicInfo = { id: '347230', songmid: '347230' }
    const err = await brokenHost
      .getMusicUrl('wy', musicInfo as never, '128k')
      .then(() => null)
      .catch((e: Error) => e)
    console.log('=== [mobile] 网络失败错误信息:', err?.message)
    if (!err) throw new Error('预期应失败但却成功了')
    if (err.message.includes('unknow error')) {
      throw new Error(`错误信息仍被吞掉: ${err.message}`)
    }
  }, 60000)
})
