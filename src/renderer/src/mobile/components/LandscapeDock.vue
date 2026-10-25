<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePlayerStore } from '../../stores/playerStore'
import { webAudioEngine } from '../../audio/audio-engine'
import MarqueeText from './MarqueeText.vue'
import MobileCover from './MobileCover.vue'
import DockProgressRing from './DockProgressRing.vue'
import defaultCover from '@renderer/assets/icon.png'

/**
 * 横屏左侧导航坞
 *
 * 界面结构与竖屏底栏保持一致（胶囊 + 图标，无文字），但把竖屏底栏中央的
 * 圆形歌曲封面单独拿出来放在最底部（原来横屏迷你播放条封面所在位置）。
 * 点击这枚封面 → 与竖屏一致的「胶囊」音乐控制条从封面处自左向右展开；
 * 点击胶囊本体 → 打开播放页。
 */
const route = useRoute()
const router = useRouter()
const player = usePlayerStore()

const tabs = [
  { key: 'home', label: '首页', icon: 'mgc_home_3_line', path: '/' },
  { key: 'playlist-square', label: '广场', icon: 'mgc_compass_line', path: '/playlist-square' },
  { key: 'search', label: '搜索', icon: 'mgc_search_line', path: '/search' },
  { key: 'recent', label: '最近播放', icon: 'mgc_history_line', path: '/recent' },
  { key: 'local', label: '本地', icon: 'mgc_folder_2_line', path: '/local' },
  { key: 'playlist', label: '我的', icon: 'mgc_music_2_line', path: '/playlist' }
]

const activeKey = computed(() => {
  if (
    route.name === 'playlist-detail' ||
    route.name === 'settings' ||
    route.name === 'settings-section'
  ) {
    return 'playlist'
  }
  return (route.name as string) || 'home'
})

// ==================== 音乐控制胶囊 ====================

const open = ref(false)

function toggleDrawer(): void {
  open.value = !open.value
}

function closeDrawer(): void {
  open.value = false
}

// 切页面时自动收起，避免胶囊停在旧页面上
watch(
  () => route.fullPath,
  () => closeDrawer()
)

const onKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape' && open.value) closeDrawer()
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))

// ==================== 当前播放 ====================

const coverUrl = computed(() => player.currentSong?.cover || defaultCover)
const title = computed(() => player.currentSong?.title || '未在播放')
const artist = computed(() => {
  const s = player.currentSong
  if (!s) return '选择一首歌开始'
  return s.album ? `${s.artist} · ${s.album}` : s.artist || 'SuchMusic'
})

async function togglePlay(): Promise<void> {
  if (!player.currentSong) return
  if (player.isLoading) return
  if (player.isPlaying) {
    await webAudioEngine.pause()
    player.setPlaying(false)
  } else {
    const ok = await webAudioEngine.play()
    if (ok) player.setPlaying(true)
    else window.dispatchEvent(new CustomEvent('player:replay-current'))
  }
}

/** 点击胶囊本体：打开播放页（胶囊保持展开，返回时仍在原位） */
function openPlayerPage(): void {
  player.setPlayerPageShown(true)
}
</script>

<template>
  <div class="lsd">
    <nav class="lsd-nav" aria-label="主导航">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="lsd-item"
        :class="{ active: activeKey === t.key }"
        type="button"
        :aria-label="t.label"
        @click="router.push(t.path)"
      >
        <i :class="t.icon"></i>
      </button>
    </nav>

    <div class="lsd-spacer"></div>

    <!-- 竖屏底栏中央的圆形封面，横屏时单独放在这里 -->
    <button class="lsd-cover" type="button" aria-label="打开音乐控制" @click="toggleDrawer">
      <MobileCover :src="coverUrl" round class="lsd-cover-art" />
      <DockProgressRing :size="54" />
    </button>
  </div>

  <Teleport to="body">
    <!-- 透明点击层：点空白处收起胶囊（不压暗画面，保持轻盈） -->
    <div class="lsd-scrim" :class="{ open }" @click="closeDrawer"></div>

    <!-- 扁胶囊：与竖屏版同款，但展开方向为自左向右 -->
    <section
      class="lsd-capsule"
      :class="{ open }"
      role="button"
      tabindex="0"
      aria-label="打开播放页"
      @click="openPlayerPage"
      @keydown.enter="openPlayerPage"
    >
      <span class="lsd-cap-art">
        <img
          :src="coverUrl"
          alt=""
          @error="($event.target as HTMLImageElement).src = defaultCover"
        />
      </span>

      <div class="lsd-cap-copy">
        <MarqueeText class="lsd-cap-title" :text="title" />
        <span class="lsd-cap-sub">{{ artist }}</span>
      </div>

      <div class="lsd-cap-actions">
        <button
          class="lsd-cap-btn"
          type="button"
          :aria-label="player.isPlaying ? '暂停' : '播放'"
          @click.stop="togglePlay"
        >
          <i
            :class="
              player.isLoading
                ? 'mgc_refresh_2_line lsd-spin'
                : player.isPlaying
                  ? 'mgc_pause_fill'
                  : 'mgc_play_fill'
            "
          ></i>
        </button>
        <button class="lsd-cap-btn" type="button" aria-label="下一首" @click.stop="player.playNext()">
          <i class="mgc_skip_forward_fill"></i>
        </button>
      </div>
    </section>
  </Teleport>
</template>

<style scoped>
/* ==================== 左侧导航坞 ==================== */
.lsd {
  /* 6 枚按钮 + 底部封面必须落在横屏高度内：按屏高反算按钮尺寸
     （162px 为上下内边距、两处 gap、封面与导航内边距之和，含少量余量），
     常规手机横屏约 38px，高屏/平板回落到最大 46px */
  --lsd-btn: clamp(24px, calc((100vh - 162px) / 6), 46px);
  width: calc(78px + var(--sal, 0px));
  height: 100%;
  flex-shrink: 0;
  box-sizing: border-box;
  padding: 12px 8px calc(40px + var(--sab, 0px)) calc(8px + var(--sal, 0px));
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.lsd-nav {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 6px 4px;
  border-radius: 999px;
  background: var(--mp-bg-elevated);
  border: 0.5px solid var(--mp-separator);
  box-shadow: var(--mp-shadow-sm);
}

.lsd-item {
  width: var(--lsd-btn);
  height: var(--lsd-btn);
  padding: 0;
  border: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: transparent;
  color: var(--mp-text-2);
  font-size: calc(var(--lsd-btn) * 0.5);
  transition:
    color 0.2s ease,
    background 0.2s ease,
    transform 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}

.lsd-item i {
  display: block;
  line-height: 1;
}

.lsd-item.active {
  color: var(--mp-primary);
  background: color-mix(in srgb, var(--mp-primary) 12%, transparent);
}

.lsd-item:active {
  transform: scale(0.9);
}

.lsd-spacer {
  flex: 1;
  min-height: 6px;
}

/* 圆形封面：45px，底距由 .lsd 的 padding-bottom（40px）控制，已整体上移 */
.lsd-cover {
  position: relative;
  width: 45px;
  height: 45px;
  flex-shrink: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  transition: transform 0.2s cubic-bezier(0.32, 0.72, 0.35, 1);
  -webkit-tap-highlight-color: transparent;
}

.lsd-cover:active {
  transform: scale(0.94);
}

.lsd-cover-art {
  width: 45px;
  height: 45px;
  border-radius: 50%;
  overflow: hidden;
  box-shadow: var(--mp-shadow-sm);
}

/* ==================== 音乐控制胶囊 ==================== */
.lsd-scrim {
  position: fixed;
  inset: 0;
  z-index: 1180;
  background: transparent;
  pointer-events: none;
}

.lsd-scrim.open {
  pointer-events: auto;
}

/* 关闭态：宽度为 0 的细条，贴在圆形封面右侧；打开时向右生长
   高度 60px，底边比封面底边再低 3px（未与封面完全齐平） */
.lsd-capsule {
  position: fixed;
  left: calc(78px + var(--sal, 0px));
  bottom: calc(37px + var(--sab, 0px));
  z-index: 1181;
  display: flex;
  align-items: center;
  width: 0;
  height: 60px;
  box-sizing: border-box;
  overflow: hidden;
  border-radius: 30px;
  border: 0.5px solid var(--mp-separator);
  background: var(--mp-bg-elevated);
  color: var(--mp-text);
  opacity: 0;
  pointer-events: none;
  box-shadow: 0 0 0 rgba(0, 0, 0, 0);
  /* 收起：先缩宽，再淡出 */
  transition:
    width 260ms cubic-bezier(0.32, 0.72, 0.35, 1),
    opacity 120ms ease 180ms,
    box-shadow 220ms ease;
  will-change: width;
}

.lsd-capsule.open {
  width: min(352px, calc(100vw - 78px - var(--sal, 0px) - 14px));
  opacity: 1;
  pointer-events: auto;
  box-shadow:
    0 26px 48px -28px rgba(0, 0, 0, 0.42),
    0 10px 22px -16px rgba(0, 0, 0, 0.24),
    var(--mp-shadow-sm);
  /* 展开：宽度一路向右铺开，内容稍后浮现 */
  transition:
    width 340ms cubic-bezier(0.16, 1, 0.3, 1),
    opacity 90ms linear,
    box-shadow 300ms ease 60ms;
}

.lsd-cap-art {
  display: block;
  flex: 0 0 auto;
  width: 40px;
  height: 40px;
  margin-left: 8px;
  overflow: hidden;
  /* 与左侧圆形封面一致：始终为圆形（展开后也不再变成圆角方形） */
  border-radius: 50%;
  background: var(--mp-bg-secondary, #ececf1);
  opacity: 0;
  transform: scale(0.9);
  transition:
    opacity 130ms ease,
    transform 260ms cubic-bezier(0.22, 1, 0.36, 1);
}

.lsd-cap-art img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.lsd-capsule.open .lsd-cap-art {
  opacity: 1;
  transform: scale(1);
  transition:
    opacity 200ms ease 140ms,
    transform 380ms cubic-bezier(0.22, 1, 0.36, 1) 120ms;
}

.lsd-cap-copy {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  min-width: 0;
  margin-left: 12px;
  overflow: hidden;
}

.lsd-cap-title,
.lsd-cap-sub {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  opacity: 0;
  transform: translateX(-6px);
  transition:
    opacity 120ms ease,
    transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.lsd-cap-title {
  font-size: 15.5px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.15;
  color: var(--mp-text);
}

.lsd-cap-sub {
  font-size: 10.5px;
  line-height: 1.2;
  color: var(--mp-text-3);
}

.lsd-capsule.open .lsd-cap-title {
  opacity: 1;
  transform: translateX(0);
  transition:
    opacity 220ms ease 200ms,
    transform 340ms cubic-bezier(0.22, 1, 0.36, 1) 180ms;
}

.lsd-capsule.open .lsd-cap-sub {
  opacity: 1;
  transform: translateX(0);
  transition:
    opacity 220ms ease 240ms,
    transform 340ms cubic-bezier(0.22, 1, 0.36, 1) 220ms;
}

.lsd-cap-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 2px;
  margin-right: 4px;
  margin-left: 2px;
  opacity: 0;
  transform: translateX(8px);
  transition:
    opacity 120ms ease,
    transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.lsd-capsule.open .lsd-cap-actions {
  opacity: 1;
  transform: translateX(0);
  transition:
    opacity 220ms ease 280ms,
    transform 340ms cubic-bezier(0.22, 1, 0.36, 1) 260ms;
}

.lsd-cap-btn {
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: transparent;
  color: var(--mp-text);
  font-size: 21px;
  transition: transform 0.16s ease;
  -webkit-tap-highlight-color: transparent;
}

.lsd-cap-btn:active {
  transform: scale(0.9);
}

.lsd-capsule:active .lsd-cap-art {
  transform: scale(0.97);
}

.lsd-spin {
  display: inline-block;
  animation: lsd-spin-rotate 1s linear infinite;
}

@keyframes lsd-spin-rotate {
  to {
    transform: rotate(360deg);
  }
}

/* 极矮的横屏（老机型 / 分屏）：回收一点高度，避免封面被挤出屏幕
   （胶囊底边始终与封面底边对齐，这里同步下移量） */
@media (max-height: 360px) {
  .lsd {
    --lsd-btn: clamp(24px, calc((100vh - 131px) / 6), 40px);
    padding-bottom: calc(24px + var(--sab, 0px));
    gap: 8px;
  }

  .lsd-nav {
    gap: 3px;
    padding: 5px 4px;
  }

  .lsd-capsule {
    bottom: calc(21px + var(--sab, 0px));
  }
}

@media (prefers-reduced-motion: reduce) {
  .lsd-capsule,
  .lsd-capsule.open,
  .lsd-cap-art,
  .lsd-capsule.open .lsd-cap-art,
  .lsd-cap-title,
  .lsd-cap-sub,
  .lsd-capsule.open .lsd-cap-title,
  .lsd-capsule.open .lsd-cap-sub,
  .lsd-cap-actions,
  .lsd-capsule.open .lsd-cap-actions {
    transition-duration: 1ms !important;
    transition-delay: 0ms !important;
  }
}
</style>
