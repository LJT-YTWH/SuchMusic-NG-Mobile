import { Capacitor } from '@capacitor/core'
import { installMobileIpc } from './mobile/ipc'
import { bindMediaSessionEvents } from './mobile/mediaSession'
import { patchAxiosForMobile } from './mobile/httpAdapter'
import { initImmersiveStatusBar, watchThemeForStatusBar } from './mobile/statusbar'

// 平台检测
export const isNativeMobile = Capacitor.isNativePlatform()
export const platform: 'mobile' | 'desktop' = isNativeMobile ? 'mobile' : 'desktop'

// 关键：本模块必须在所有使用 window.electron 的模块之前被导入（main.ts 第一行）
// 在 Capacitor 原生环境中同步安装 window.electron 兼容层
if (isNativeMobile) {
  installMobileIpc()
  bindMediaSessionEvents()
  // 将 axios 全局切换到原生 HTTP 栈（绕开 WebView CORS）
  patchAxiosForMobile()
  // 沉浸式透明状态栏 + 主题跟随（横屏隐藏状态栏由原生 MainActivity 粘性沉浸实现）
  void initImmersiveStatusBar()
  watchThemeForStatusBar()
}
