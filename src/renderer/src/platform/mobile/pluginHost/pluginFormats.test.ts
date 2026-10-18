// 插件格式兼容性测试：v1(module.exports) / window.source(CeruPlugins) / lx(洛雪)
import { describe, it, expect } from 'vitest'
import SuchMusicPluginHost from './host'
import type { SandboxLogger } from './sandbox'

const logger: SandboxLogger = { log: () => {}, warn: () => {}, error: () => {} }

describe('插件格式兼容', () => {
  it('v1 module.exports 插件正常加载', async () => {
    const code = `
module.exports = {
  pluginInfo: { name: 'V1 插件', version: '1.0.0', author: 'test' },
  sources: { kw: { name: '酷我', qualities: ['128k'] } },
  async musicUrl(source, info, quality) {
    return 'https://example.com/' + source + '/' + quality
  }
}`
    const host = new SuchMusicPluginHost(code, logger)
    expect(host.getPluginInfo().name).toBe('V1 插件')
    await expect(host.getMusicUrl('kw', {} as never, '128k')).resolves.toBe(
      'https://example.com/kw/128k'
    )
  })

  it('window.source(CeruPlugins) 音源插件适配加载', async () => {
    const code = `
window.source = {
  id: 'SUCH_TEST_SOURCE',
  name: '新版音源',
  version: '2.0.0',
  author: 'tester',
  description: 'window.source 音源插件',
  sources: { wy: { name: '网易云', qualitys: ['320k'] } },
  prefix: 'https://music.example.com/',
  async musicUrl(source, info, quality) {
    return this.prefix + source + '/' + quality
  }
}`
    const host = new SuchMusicPluginHost(code, logger)
    expect(host.getPluginInfo().name).toBe('新版音源')
    expect(host.getPluginInfo().version).toBe('2.0.0')
    // this 需绑定到 window.source 对象（读取 this.prefix）
    await expect(host.getMusicUrl('wy', {} as never, '320k')).resolves.toBe(
      'https://music.example.com/wy/320k'
    )
  })

  it('window.suchmusic 与 window.notify 可访问', async () => {
    const code = `
window.notify('插件启动', 'success')
window.source = {
  name: 'API 检测音源', version: '1.0.0', author: 'a',
  sources: { t: { name: '测试' } },
  async musicUrl() {
    return typeof window.suchmusic.request === 'function' ? 'api-ok' : 'api-missing'
  }
}`
    const host = new SuchMusicPluginHost(code, logger)
    await expect(host.getMusicUrl('t', {} as never, '128k')).resolves.toBe('api-ok')
  })

  it('window.source UI 组件插件给出明确错误', () => {
    const code = `
window.source = {
  id: 'SUCH_WIDGET', name: 'NCM 解析器', version: '1.0.0', author: 'a',
  isUIWidget: true,
  initialization() {}
}`
    expect(() => new SuchMusicPluginHost(code, logger)).toThrowError(/UI 组件插件/)
  })

  it('未声明赋值（source = {...}）泄漏到真实全局也能识别，且不污染环境', () => {
    const code = `
source = {
  name: '泄漏音源', version: '1.0.0', author: 'a',
  sources: { kg: { name: '酷狗' } },
  async musicUrl() { return 'leak-ok' }
}`
    const host = new SuchMusicPluginHost(code, logger)
    expect(host.getPluginInfo().name).toBe('泄漏音源')
    expect((globalThis as Record<string, unknown>).source).toBeUndefined()
  })

  it('澜音 v2(manifest + activate) 插件给出明确错误', () => {
    const code = `
exports.manifest = { manifestVersion: 2, name: 'v2 插件' }
exports.activate = function () {}`
    expect(() => new SuchMusicPluginHost(code, logger)).toThrowError(/v2/)
  })

  it('lx 事件驱动插件自动转换后可用', async () => {
    const code = `
/**
 * @name 示例落雪音源插件
 * @version 1.0.0
 * @author test
 * @description 用于测试的事件驱动落雪插件
 */
lx.on(lx.EVENT_NAMES.request, ({ action, source }) => {
  if (action === 'musicUrl') {
    return Promise.resolve('https://lx.example.com/' + source)
  }
})
lx.send(lx.EVENT_NAMES.inited, {
  sources: { kw: { name: '酷我', qualitys: ['128k', '320k'] } }
})
`
    const host = new SuchMusicPluginHost()
    await host.loadPlugin(code, logger)
    expect(host.getPluginInfo().name).toBe('示例落雪音源插件')
    await expect(host.getMusicUrl('kw', {} as never, '128k')).resolves.toBe(
      'https://lx.example.com/kw'
    )
  })
})
