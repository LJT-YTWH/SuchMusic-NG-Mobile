<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import PlayerBar from '../components/layout/PlayerBar.vue'
import MobilePlayerBar from '../components/layout/MobilePlayerBar.vue'
import { usePlayerStore } from '../stores/playerStore'
import '../mobile/theme.css'

const route = useRoute()
const router = useRouter()
const player = usePlayerStore()

onMounted(() => {
  document.body.classList.add('is-mobile')
  // 接管 open-settings 事件：移动端一律路由到自研设置页（不再弹出桌面设置弹窗）
  window.addEventListener('open-settings', ((e: CustomEvent) => {
    const section = e?.detail?.section
    // 设置页是路由页，层级低于播放页覆盖层：跳转前先收起播放页，避免遮挡
    if (player.isPlayerPageShown) player.setPlayerPageShown(false)
    router.push(section ? `/settings/${section}` : '/settings')
  }) as EventListener)

  // 安卓返回键 / 侧边返回手势：播放页优先收起，其次路由后退，首页则最小化保持后台播放
  if (Capacitor.isNativePlatform()) {
    void App.addListener('backButton', () => {
      if (player.isPlayerPageShown) {
        player.setPlayerPageShown(false)
        return
      }
      if (route.name && route.name !== 'home') {
        router.back()
        return
      }
      void App.minimizeApp()
    })
  }
})

// 5 个主导航按钮
const tabs = [
  { key: 'home', label: '首页', icon: 'mgc_home_3_line', path: '/' },
  { key: 'playlist-square', label: '广场', icon: 'mgc_compass_line', path: '/playlist-square' },
  { key: 'search', label: '搜索', icon: 'mgc_search_line', path: '/search' },
  { key: 'local', label: '本地', icon: 'mgc_folder_2_line', path: '/local' },
  { key: 'playlist', label: '我的', icon: 'mgc_music_2_line', path: '/playlist' }
]

const activeKey = computed(() => {
  if (
    route.name === 'playlist-detail' ||
    route.name === 'recent' ||
    route.name === 'settings' ||
    route.name === 'settings-section'
  ) {
    return 'playlist'
  }
  return (route.name as string) || 'home'
})

// 沉浸式页面（歌单详情、设置子页）隐藏底栏，内容全屏
// 本地歌单详情与在线歌单详情保持一致的全屏排版（否则会多叠一层状态栏安全区）
const immersiveRoutes = ['online-playlist', 'playlist-detail', 'settings-section']
const isImmersive = computed(() => immersiveRoutes.includes(route.name as string))
</script>

<template>
  <div class="mobile-layout">
    <div class="mobile-content" :class="{ immersive: isImmersive }">
      <router-view v-slot="{ Component }">
        <transition name="page-fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </div>

    <!-- 桌面 PlayerBar 在移动端仅提供播放逻辑与播放页，不渲染 UI -->
    <PlayerBar />

    <!-- 悬浮式底栏：迷你播放条 + 椭圆导航胶囊 -->
    <div v-if="!isImmersive" class="mp-dock">
      <div class="mp-minibar mp-frosted">
        <MobilePlayerBar />
      </div>
      <nav class="mp-tabpill mp-frosted">
        <div
          v-for="t in tabs"
          :key="t.key"
          class="tab"
          :class="{ active: activeKey === t.key }"
          @click="router.push(t.path)"
        >
          <i :class="t.icon"></i>
          <span>{{ t.label }}</span>
        </div>
      </nav>
    </div>
  </div>
</template>

<style scoped>
.mobile-layout {
  height: 100vh;
  height: 100dvh;
  width: 100vw;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--mp-bg, #f5f5f7);
}

.mobile-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
  /* 避让状态栏（edge-to-edge） */
  padding-top: var(--sat, 24px);
}

/* 沉浸式页面不避让状态栏（自带头部处理） */
.mobile-content.immersive {
  padding-top: 0;
}

/* 页面切换动画 */
.page-fade-enter-active,
.page-fade-leave-active {
  transition: opacity 0.22s ease;
}

.page-fade-enter-from,
.page-fade-leave-to {
  opacity: 0;
}

/* ============ 横屏：左导航栏 + 右内容的左右布局 ============ */
@media (orientation: landscape) {
  .mobile-layout {
    flex-direction: row;
  }

  .mobile-content {
    /* 左侧导航栏（.mp-dock，见 theme.css）在 DOM 中位于其后，
       flex order 默认 0 会排在内容前，形成左栏右内容 */
    order: 2;
    /* 横屏状态栏由原生粘性沉浸隐藏；固定小边距，
       不用 --sat，避免下拉短暂唤出状态栏时布局跳动 */
    padding-top: 10px;
  }

  .mobile-content.immersive {
    padding-top: 0;
  }
}
</style>
