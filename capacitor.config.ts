import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.suchmusic.app',
  appName: 'SuchMusic',
  webDir: 'dist-mobile',
  android: {
    allowMixedContent: true
  },
  server: {
    androidScheme: 'http'
  },
  plugins: {
    // 禁用 Capacitor 自带的 insets 内边距处理（否则页面无法延伸到系统栏区域），
    // 安全区由 MainActivity 原生注入为 CSS 变量（--safe-area-inset-*）
    SystemBars: {
      insetsHandling: 'disable'
    }
  }
}

export default config
