<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePlayerStore } from '../../stores/playerStore'
import { webAudioEngine } from '../../audio/audio-engine'
import { rememberMorphOrigin } from '../composables/useMorphOrigin'
import MarqueeText from './MarqueeText.vue'
import DockProgressRing from './DockProgressRing.vue'
import defaultCover from '@renderer/assets/icon.png'

const route = useRoute()
const router = useRouter()
const player = usePlayerStore()

// 5 个槽位：左右各两枚图标，中间是歌曲封面（点击弹出音乐控制面板）
const navs = [
  { key: 'home', label: '首页', icon: 'mgc_home_3_line', path: '/' },
  { key: 'playlist-square', label: '广场', icon: 'mgc_compass_line', path: '/playlist-square' },
  { key: 'local', label: '本地', icon: 'mgc_folder_2_line', path: '/local' },
  { key: 'playlist', label: '我的', icon: 'mgc_music_2_line', path: '/playlist' }
]
const leftNavs = navs.slice(0, 2)
const rightNavs = navs.slice(2)

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

const cover = computed(() => player.currentSong?.cover || defaultCover)
const title = computed(() => player.currentSong?.title || '未在播放')
const sub = computed(() => {
  const s = player.currentSong
  if (!s) return '选择一首歌开始'
  return s.album ? `${s.artist} · ${s.album}` : s.artist || 'SuchMusic'
})

const coverUrl = computed(() => player.currentSong?.cover || defaultCover)

// ==================== 弹出面板 ====================

const panelOpen = ref(false)
const panelRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLElement | null>(null)

// 播放页由控制栏打开时：收起动画结束后控制栏必须仍在原位展示，
// 因此在收起过程结束前锁住面板，任何「点击外部 / 路由变化」都不能把它关掉。
let panelLockUntil = 0
let openedFromPanel = false

const togglePanel = (): void => {
  if (performance.now() < panelLockUntil) return
  panelOpen.value = !panelOpen.value
}

const closePanel = (force = false): void => {
  if (!force && performance.now() < panelLockUntil) return
  panelOpen.value = false
}

/**
 * 面板 →（卡片展开动画）→ 播放页。
 * 面板保持打开：播放页收起时动画正好落在面板上，收起结束后音乐控制栏依然在。
 */
const openPlayerPage = (): void => {
  rememberMorphOrigin(panelRef.value)
  openedFromPanel = true
  panelOpen.value = true
  player.setPlayerPageShown(true)
}

watch(
  () => player.isPlayerPageShown,
  (shown) => {
    if (shown) return
    if (!openedFromPanel) return
    openedFromPanel = false
    // 收起动画 560ms + 少量余量：这段时间内面板保持打开且不响应误触
    panelLockUntil = performance.now() + 900
    panelOpen.value = true
  }
)

const togglePlay = async (): Promise<void> => {
  if (!player.currentSong) {
    openPlayerPage()
    return
  }
  if (player.isPlaying) {
    await webAudioEngine.pause()
    player.setPlaying(false)
  } else {
    const ok = await webAudioEngine.play()
    if (ok) player.setPlaying(true)
    else window.dispatchEvent(new CustomEvent('player:replay-current'))
  }
}

const onDocPointerDown = (event: PointerEvent): void => {
  if (!panelOpen.value) return
  // 播放页打开期间不收面板：否则播放页收起后控制栏会「闪现消失」
  if (player.isPlayerPageShown) return
  // 播放页收起动画期间同样不收面板
  if (performance.now() < panelLockUntil) return
  const target = event.target as Node | null
  if (!target) return
  if (panelRef.value?.contains(target) || triggerRef.value?.contains(target)) return
  closePanel()
}

const onKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape' && panelOpen.value) closePanel()
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerDown, true)
  document.addEventListener('keydown', onKeydown)
})

// 路由切换时收起面板，避免悬浮面板停在旧页面上（显式导航，强制关闭）
const removeRouteHook = router.afterEach(() => closePanel(true))

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  document.removeEventListener('keydown', onKeydown)
  removeRouteHook()
})
</script>

<template>
  <div class="pdock">
    <!-- 独立面板：先从一条细线向上弹出，再横向展开 -->
    <section
      ref="panelRef"
      class="pdock-panel"
      :class="{ 'is-open': panelOpen }"
      :aria-hidden="!panelOpen"
      aria-label="音乐控制"
      @click="openPlayerPage"
    >
      <span class="pdock-panel-art">
        <img :src="cover" alt="" @error="($event.target as HTMLImageElement).src = defaultCover" />
      </span>

      <div class="pdock-panel-copy">
        <!-- 歌名过长时横向滚动；歌手信息保持单行省略 -->
        <MarqueeText class="pdock-title" :text="title" />
        <span class="pdock-sub">{{ sub }}</span>
      </div>

      <div class="pdock-panel-controls">
        <button
          class="pdock-ctl"
          type="button"
          :aria-label="player.isPlaying ? '暂停' : '播放'"
          @click.stop="togglePlay"
        >
          <i :class="player.isPlaying ? 'mgc_pause_fill' : 'mgc_play_fill'"></i>
        </button>
        <button class="pdock-ctl" type="button" aria-label="下一首" @click.stop="player.playNext()">
          <i class="mgc_skip_forward_fill"></i>
        </button>
      </div>
    </section>

    <nav class="pdock-bar" aria-label="底部导航">
      <button
        v-for="t in leftNavs"
        :key="t.key"
        class="pdock-item"
        :class="{ active: activeKey === t.key }"
        type="button"
        :aria-label="t.label"
        @click="router.push(t.path)"
      >
        <span class="pdock-icon"><i :class="t.icon"></i></span>
      </button>

      <button
        ref="triggerRef"
        class="pdock-item pdock-player"
        type="button"
        :aria-expanded="panelOpen"
        :aria-label="panelOpen ? '收起音乐控制' : '展开音乐控制'"
        @click="togglePanel"
      >
        <span class="pdock-cover" :class="{ playing: player.isPlaying }">
          <img :src="coverUrl" alt="" @error="($event.target as HTMLImageElement).src = defaultCover" />
        </span>
        <!-- 封面外圈：播放进度（淡灰色为未播放部分） -->
        <DockProgressRing />
      </button>

      <button
        v-for="t in rightNavs"
        :key="t.key"
        class="pdock-item"
        :class="{ active: activeKey === t.key }"
        type="button"
        :aria-label="t.label"
        @click="router.push(t.path)"
      >
        <span class="pdock-icon"><i :class="t.icon"></i></span>
      </button>
    </nav>
  </div>
</template>

<style scoped>
.pdock {
  position: fixed;
  left: 50%;
  bottom: calc(10px + var(--sab, 0px));
  z-index: 120;
  width: min(400px, calc(100vw - 24px));
  transform: translateX(-50%);
  /* 面板从底栏背后生长出来，容器不能裁剪 */
  pointer-events: none;
}

.pdock > * {
  pointer-events: auto;
}

/* ==================== 底栏（毛玻璃胶囊） ==================== */

.pdock-bar {
  position: relative;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  align-items: center;
  width: 100%;
  height: 72px;
  padding: 0 4px;
  border-radius: 999px;
  /* 性能优先：底栏固定在内容之上，backdrop-filter 会在每次滚动时重算整块模糊，
     是低端安卓 WebView 掉帧的主因之一；这里改用高不透明度的毛玻璃质感渐变，
     视觉几乎一致，滚动明显更顺。 */
  background:
    radial-gradient(120% 160% at 6% -20%, rgba(255, 255, 255, 0.14), transparent 52%),
    linear-gradient(155deg, rgba(40, 42, 48, 0.94) 0%, rgba(20, 21, 25, 0.96) 56%, rgba(12, 13, 16, 0.97) 100%);
  border: 0.5px solid rgba(255, 255, 255, 0.16);
  box-shadow:
    0 20px 40px -24px rgba(0, 0, 0, 0.55),
    0 6px 14px -10px rgba(0, 0, 0, 0.32),
    inset 0 1px 0 rgba(255, 255, 255, 0.16),
    inset 0 0 0 1px rgba(255, 255, 255, 0.04);
}

.pdock-item {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.66);
  transition: color 0.24s ease;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}

.pdock-icon {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  transition: transform 0.32s cubic-bezier(0.32, 0.72, 0, 1);
}

.pdock-icon i {
  font-size: 28px;
}

.pdock-item:active .pdock-icon {
  transform: scale(0.86);
}

.pdock-item.active {
  color: var(--mp-primary, #3b9bff);
}

.pdock-item.active .pdock-icon {
  transform: translateY(-1px) scale(1.06);
}

/* 中央封面：这是唯一的「播放」入口 */
.pdock-player {
  position: relative;
  color: #fff;
  cursor: pointer;
}

.pdock-cover {
  display: block;
  width: 44px;
  height: 44px;
  overflow: hidden;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.14);
  box-shadow:
    0 6px 14px -8px rgba(0, 0, 0, 0.6),
    0 1px 3px -1px rgba(0, 0, 0, 0.4),
    inset 0 0 0 1px rgba(255, 255, 255, 0.18);
  transition:
    transform 0.32s cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 0.32s ease;
}

.pdock-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.pdock-player:active .pdock-cover {
  transform: scale(0.94);
}

/* 播放中：静态外圈高亮
   （之前用无限 box-shadow 动画，box-shadow 无法合成、每帧重绘，是底栏卡顿的主因） */
.pdock-cover.playing {
  /* 外圈进度由 DockProgressRing 负责，这里只保留投影，避免双圈 */
  box-shadow: 0 8px 18px -8px rgba(0, 0, 0, 0.6);
}

/* ==================== 弹出面板 ==================== */

.pdock-panel {
  position: absolute;
  left: 50%;
  bottom: calc(72px + 14px);
  z-index: 2;
  display: flex;
  align-items: center;
  width: 4px;
  height: 0;
  padding: 0;
  overflow: hidden;
  border-radius: 30px;
  /* 面板会逐帧改变宽高：backdrop-filter 在此处每帧重算模糊，代价极高，
     故改为高不透明度毛玻璃质感渐变（视觉几乎一致，动画明显更顺） */
  background:
    radial-gradient(110% 160% at 6% 30%, rgba(59, 155, 255, 0.16), transparent 58%),
    linear-gradient(152deg, rgba(42, 44, 50, 0.9) 0%, rgba(23, 24, 28, 0.94) 52%, rgba(13, 14, 17, 0.96) 100%);
  border: 0.5px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 0 0 rgba(0, 0, 0, 0);
  color: #fff;
  opacity: 0;
  pointer-events: none;
  transform: translateX(-50%);
  /* 关闭：先收成竖线，再下沉淡出 */
  transition:
    width 280ms cubic-bezier(0.22, 1, 0.36, 1),
    height 90ms cubic-bezier(0.22, 1, 0.36, 1) 240ms,
    opacity 120ms ease 300ms,
    box-shadow 300ms ease;
  will-change: width, height;
}

/* 打开三拍：细线升起 → 横向展开 → 内容依次浮现 */
.pdock-panel.is-open {
  width: min(432px, calc(100vw - 24px));
  height: 92px;
  opacity: 1;
  pointer-events: auto;
  box-shadow:
    0 48px 80px -42px rgba(0, 0, 0, 0.6),
    0 18px 34px -24px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.12),
    inset 0 0 0 1px rgba(255, 255, 255, 0.05);
  transition:
    width 340ms cubic-bezier(0.16, 1, 0.3, 1) 160ms,
    height 100ms cubic-bezier(0.16, 1, 0.3, 1),
    opacity 70ms linear,
    box-shadow 320ms ease 140ms;
}

.pdock-panel-art {
  display: block;
  flex: 0 0 auto;
  width: 56px;
  height: 56px;
  margin-left: 16px;
  overflow: hidden;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  opacity: 0;
  transform: scale(0.9);
  transition:
    opacity 160ms ease,
    transform 300ms cubic-bezier(0.22, 1, 0.36, 1),
    border-radius 420ms cubic-bezier(0.16, 1, 0.3, 1);
}

.pdock-panel-art img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.pdock-panel.is-open .pdock-panel-art {
  border-radius: 16px;
  opacity: 1;
  transform: scale(1);
  transition:
    opacity 300ms ease 220ms,
    transform 500ms cubic-bezier(0.22, 1, 0.36, 1) 200ms,
    border-radius 500ms cubic-bezier(0.16, 1, 0.3, 1) 200ms;
}

.pdock-panel-copy {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  min-width: 0;
  margin-left: 14px;
  overflow: hidden;
}

.pdock-title,
.pdock-sub {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  opacity: 0;
  transform: translateY(6px);
  transition:
    opacity 150ms ease,
    transform 280ms cubic-bezier(0.22, 1, 0.36, 1);
}

.pdock-title {
  color: #f6f5f1;
  font-size: 21px;
  font-weight: 600;
  letter-spacing: -0.015em;
  line-height: 1.1;
}

.pdock-sub {
  color: rgba(255, 255, 255, 0.5);
  font-size: 12px;
  letter-spacing: 0.01em;
  line-height: 1.2;
}

.pdock-panel.is-open .pdock-title {
  opacity: 1;
  transform: translateY(0);
  transition:
    opacity 300ms ease 300ms,
    transform 460ms cubic-bezier(0.22, 1, 0.36, 1) 280ms;
}

.pdock-panel.is-open .pdock-sub {
  opacity: 1;
  transform: translateY(0);
  transition:
    opacity 300ms ease 340ms,
    transform 460ms cubic-bezier(0.22, 1, 0.36, 1) 320ms;
}

.pdock-panel-controls {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 2px;
  margin-right: 12px;
  margin-left: 6px;
  opacity: 0;
  transform: translateX(10px);
  transition:
    opacity 150ms ease,
    transform 280ms cubic-bezier(0.22, 1, 0.36, 1);
}

.pdock-panel.is-open .pdock-panel-controls {
  opacity: 1;
  transform: translateX(0);
  transition:
    opacity 300ms ease 380ms,
    transform 440ms cubic-bezier(0.22, 1, 0.36, 1) 360ms;
}

.pdock-ctl {
  display: grid;
  width: 44px;
  height: 44px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #f7f6f2;
  cursor: pointer;
  transition:
    background-color 220ms ease,
    transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
}

.pdock-ctl i {
  font-size: 24px;
}

.pdock-ctl:active {
  transform: scale(0.9);
}

@media (max-width: 360px) {
  .pdock-panel.is-open {
    height: 86px;
  }

  .pdock-panel-art {
    width: 50px;
    height: 50px;
  }

  .pdock-title {
    font-size: 18px;
  }

  .pdock-sub {
    font-size: 11px;
  }

  .pdock-ctl {
    width: 40px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .pdock-panel,
  .pdock-panel.is-open,
  .pdock-panel-art,
  .pdock-panel.is-open .pdock-panel-art,
  .pdock-title,
  .pdock-sub,
  .pdock-panel.is-open .pdock-title,
  .pdock-panel.is-open .pdock-sub,
  .pdock-panel-controls,
  .pdock-panel.is-open .pdock-panel-controls,
  .pdock-ctl,
  .pdock-cover,
  .pdock-icon {
    transition-duration: 1ms !important;
    transition-delay: 0ms !important;
  }

  .pdock-cover.playing {
    animation: none;
  }
}

/* ==================== 浅色模式适配 ====================
   底栏与控制面板默认是深色玻璃；浅色主题下改为白色玻璃 + 深色文字，
   避免在浅色页面底部出现一整块突兀的黑条。 */
html[data-theme='light'] .pdock-bar {
  background:
    radial-gradient(120% 160% at 6% -20%, rgba(255, 255, 255, 0.95), transparent 52%),
    linear-gradient(155deg, rgba(255, 255, 255, 0.97) 0%, rgba(248, 248, 250, 0.98) 56%, rgba(241, 241, 245, 0.99) 100%);
  border-color: rgba(0, 0, 0, 0.08);
  box-shadow:
    0 18px 36px -24px rgba(0, 0, 0, 0.26),
    0 6px 14px -10px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.95),
    inset 0 0 0 1px rgba(255, 255, 255, 0.5);
}

html[data-theme='light'] .pdock-item {
  color: rgba(60, 60, 67, 0.62);
}

/* 关键：上面的浅色规则特异性高于 .pdock-item.active，
   会把「当前页」图标压成灰色；这里补回主题色。 */
html[data-theme='light'] .pdock-item.active {
  color: var(--mp-primary, #3b9bff);
}

html[data-theme='light'] .pdock-player {
  color: #1c1c1e;
}

html[data-theme='light'] .pdock-cover {
  background: rgba(0, 0, 0, 0.06);
  box-shadow:
    0 6px 14px -8px rgba(0, 0, 0, 0.26),
    0 1px 3px -1px rgba(0, 0, 0, 0.14),
    inset 0 0 0 1px rgba(0, 0, 0, 0.08);
}

html[data-theme='light'] .pdock-cover.playing {
  box-shadow: 0 8px 18px -8px rgba(0, 0, 0, 0.26);
}

html[data-theme='light'] .pdock-panel {
  background:
    radial-gradient(110% 160% at 6% 30%, rgba(44, 142, 253, 0.12), transparent 58%),
    linear-gradient(152deg, rgba(255, 255, 255, 0.98) 0%, rgba(249, 249, 251, 0.98) 52%, rgba(243, 243, 247, 0.99) 100%);
  border-color: rgba(0, 0, 0, 0.07);
  color: #1c1c1e;
}

html[data-theme='light'] .pdock-panel.is-open {
  box-shadow:
    0 40px 70px -40px rgba(0, 0, 0, 0.28),
    0 16px 30px -24px rgba(0, 0, 0, 0.16),
    inset 0 1px 0 rgba(255, 255, 255, 0.95),
    inset 0 0 0 1px rgba(255, 255, 255, 0.5);
}

html[data-theme='light'] .pdock-panel-art {
  background: rgba(0, 0, 0, 0.06);
}

html[data-theme='light'] .pdock-title {
  color: #1c1c1e;
}

html[data-theme='light'] .pdock-sub {
  color: rgba(60, 60, 67, 0.58);
}

html[data-theme='light'] .pdock-ctl {
  color: #1c1c1e;
}
</style>
