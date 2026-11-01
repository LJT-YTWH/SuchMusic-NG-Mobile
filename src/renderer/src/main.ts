// 平台桥接必须在所有模块之前安装（移动端注入 window.electron 兼容层）
import './platform'
import { isNativeMobile } from './platform'
import './styles/main.css'

if (isNativeMobile) {
  await import('./styles/mobile.css')
  document.body.classList.add('is-mobile')
  // 安卓电视 / 遥控器支持：识别电视环境后启用方向键空间导航与焦点框
  const { initTvSupport } = await import('./mobile/tv/remoteControl')
  initTvSupport()
}
import 'mingcute_icon/font/Mingcute.css'

import { createApp } from 'vue'
import App from './App.vue'
import naive from 'naive-ui'
import router from './router'
import { createPinia } from 'pinia'

// 创建应用并挂载 Pinia
const app = createApp(App)
const pinia = createPinia()

app.use(pinia).use(naive).use(router).mount('#app')
