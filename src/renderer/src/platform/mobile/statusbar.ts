import { StatusBar, Style } from '@capacitor/status-bar'

// 沉浸式状态栏：透明 + WebView 延伸到状态栏下方
export async function initImmersiveStatusBar(): Promise<void> {
  try {
    await StatusBar.setOverlaysWebView({ overlay: true })
    await StatusBar.setBackgroundColor({ color: '#00000000' })
  } catch (e) {
    console.warn('StatusBar init failed', e)
  }
}

// 根据主题同步状态栏图标颜色（深色背景用浅色图标）
export async function syncStatusBarStyle(isDark: boolean): Promise<void> {
  try {
    await StatusBar.setStyle({ style: isDark ? Style.Light : Style.Dark })
  } catch {
    // 忽略
  }
}

// 监听 <html data-theme> 变化自动同步
export function watchThemeForStatusBar(): void {
  const apply = (): void => {
    const theme = document.documentElement.dataset.theme
    void syncStatusBarStyle(theme === 'dark')
  }
  apply()
  const observer = new MutationObserver(apply)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme']
  })
}

// 注意：横屏隐藏状态栏由原生 MainActivity 以「粘性沉浸」实现
// （BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE，下滑仅短暂显示并自动隐藏）。
// 不要在此用 StatusBar.hide() —— 它是非粘性的，下滑唤出后会常驻，
// 导致注入的 --sat 跳变并挤压页面布局。
