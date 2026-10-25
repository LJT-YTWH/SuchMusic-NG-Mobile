<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import PlayerBar from '../components/layout/PlayerBar.vue'
import PlayerDock from '../mobile/components/PlayerDock.vue'
import LandscapeDock from '../mobile/components/LandscapeDock.vue'
import { useLandscape } from '../mobile/composables/useLandscape'
import { usePlayerStore } from '../stores/playerStore'
import '../mobile/theme.css'

const route = useRoute()
const router = useRouter()
const player = usePlayerStore()

const onOpenSettings = (e: Event): void => {
  const section = (e as CustomEvent<{ section?: string }>).detail?.section
  // 设置页是路由页，层级低于播放页覆盖层：跳转前先收起播放页，避免遮挡
  if (player.isPlayerPageShown) player.setPlayerPageShown(false)
  router.push(section ? `/settings/${section}` : '/settings')
}

onMounted(() => {
  document.body.classList.add('is-mobile')
  // 接管 open-settings 事件：移动端一律路由到自研设置页（不再弹出桌面设置弹窗）
  window.addEventListener('open-settings', onOpenSettings)

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

// 沉浸式页面（歌单详情、设置子页）隐藏底栏，内容全屏
// 本地歌单详情与在线歌单详情保持一致的全屏排版（否则会多叠一层状态栏安全区）
const immersiveRoutes = ['online-playlist', 'playlist-detail', 'settings-section']
const isImmersive = computed(() => immersiveRoutes.includes(route.name as string))

// 竖屏用「毛玻璃胶囊 + 中央封面」的底栏；
// 横屏用同款图标胶囊侧栏 + 独立圆形封面（点击从右侧滑出音乐控制条）
const { isLandscape } = useLandscape()
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

    <!-- 竖屏：毛玻璃胶囊底栏（中央封面可展开音乐控制面板） -->
    <PlayerDock v-if="!isImmersive && !isLandscape" />

    <!-- 横屏：左侧图标胶囊导航坞 + 独立圆形封面（点击自左向右展开音乐控制胶囊） -->
    <LandscapeDock v-if="!isImmersive && isLandscape" />
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

/* 页面切换动画（缩短时长：out-in 模式下每次跳转要串行等待两段） */
.page-fade-enter-active,
.page-fade-leave-active {
  transition: opacity 0.16s ease;
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
