// 临时复现测试：验证 render_api.js 音源在桌面端转换+宿主链路下能否取到播放链接
import { describe, it, vi } from 'vitest'
import fs from 'fs'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' }
}))

import { transformSnowdropPlugin } from './src/plugin/utils/snowdrop-transform'
import SuchMusicPluginHost from './src/plugin/manager/SuchMusicPluginHost'

describe('render_api.js 复现', () => {
  it('转换 + 加载 + 取链', async () => {
    const code = fs.readFileSync('/tmp/render_api.js', 'utf8')

    const result = transformSnowdropPlugin(code, { sourceType: 'lx' })
    console.log('=== transform type:', result.type)
    console.log('=== transform errors:', result.errors)
    console.log('=== transform warnings:', result.warnings)
    console.log('=== transform sources:', JSON.stringify(result.sources))
    console.log('=== runtimeLogs:', result.runtimeLogs)

    const host = new SuchMusicPluginHost(result.transformedCode)
    console.log('=== pluginInfo:', JSON.stringify(host.getPluginInfo()))
    console.log('=== sources:', JSON.stringify(host.getSupportedSources()))

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
    console.log('=== GOT URL:', url)
  }, 90000)
})
