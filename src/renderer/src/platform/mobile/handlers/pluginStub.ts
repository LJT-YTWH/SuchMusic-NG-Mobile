// 音源插件系统入口：懒加载 WebView 插件宿主（避免启动时加载 node-forge 等大依赖）
import { getPluginHost, setPluginHost, type PluginHost } from '../pluginHost'

let loadingPromise: Promise<PluginHost> | null = null

async function ensureHost(): Promise<PluginHost> {
  const existing = getPluginHost()
  if (existing) return existing
  if (!loadingPromise) {
    loadingPromise = import('../pluginHost/manager').then((m) => {
      const host = new m.MobilePluginHostManager()
      setPluginHost(host)
      return host
    })
  }
  return loadingPromise
}

export async function pluginInvoke(channel: string, args: unknown[]): Promise<unknown> {
  try {
    const host = await ensureHost()
    return await host.invoke(channel, args)
  } catch (error) {
    console.error(`[pluginHost] ${channel} 调用失败:`, error)
    throw error
  }
}
