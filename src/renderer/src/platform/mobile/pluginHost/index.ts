// WebView 音源插件宿主（plugin:* / snowdrop:* 的移动端实现）
// 在沙箱 todo 中实现完整逻辑，此处先提供可注入的注册点

export interface PluginHost {
  invoke(channel: string, args: unknown[]): Promise<unknown>
}

let host: PluginHost | null = null

export function setPluginHost(h: PluginHost): void {
  host = h
}

export function getPluginHost(): PluginHost | null {
  return host
}
