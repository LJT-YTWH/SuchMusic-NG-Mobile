<script setup lang="ts">
import { ref, h, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { NEmpty, NSpin, useMessage, useDialog } from 'naive-ui'
import { usePlaylistStore } from '../../stores/playlistStore'
import {
  fetchQrKey,
  fetchQrImage,
  checkQrStatus,
  fetchLoginProfile,
  logoutNetease,
  saveLoginCookie,
  getLoginCookie,
  type NeteaseProfile
} from '../../apis/netease/login/qrcode'
import MobileCover from '../components/MobileCover.vue'

const router = useRouter()
const playlistStore = usePlaylistStore()
const message = useMessage()
const dialog = useDialog()

const showCreate = ref(false)
const newName = ref('')

// ==================== 网易云登录状态 ====================
const profile = ref<NeteaseProfile | null>(null)
const showLogin = ref(false)
const qrImg = ref('')
const qrScanned = ref(false)
const qrStatusText = ref('正在获取二维码...')
let qrTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  playlistStore.loadFromStorage()
  // 已有登录凭据时恢复登录状态
  if (getLoginCookie()) {
    fetchLoginProfile()
      .then((p) => {
        profile.value = p
        if (!p) message.warning('网易云登录已失效，请重新扫码')
      })
      .catch(() => {})
  }
})

onBeforeUnmount(stopQrPolling)

function stopQrPolling(): void {
  if (qrTimer !== null) {
    clearInterval(qrTimer)
    qrTimer = null
  }
}

async function openLogin(): Promise<void> {
  if (profile.value) {
    message.info(`已登录：${profile.value.nickname}`)
    return
  }
  showLogin.value = true
  await startQr()
}

async function startQr(): Promise<void> {
  stopQrPolling()
  qrImg.value = ''
  qrScanned.value = false
  qrStatusText.value = '正在获取二维码...'
  try {
    const key = await fetchQrKey()
    qrImg.value = await fetchQrImage(key)
    qrStatusText.value = '请使用网易云音乐 App 扫码'
    qrTimer = setInterval(() => void pollQr(key), 2000)
  } catch (e) {
    qrStatusText.value = e instanceof Error ? e.message : '获取二维码失败，请稍后重试'
  }
}

async function pollQr(key: string): Promise<void> {
  try {
    const st = await checkQrStatus(key)
    switch (st.code) {
      case 800:
        qrStatusText.value = '二维码已过期，正在刷新...'
        await startQr()
        break
      case 801:
        qrScanned.value = false
        qrStatusText.value = '等待扫码'
        break
      case 802:
        qrScanned.value = true
        qrStatusText.value = '已扫码，请在手机上确认登录'
        break
      case 803: {
        stopQrPolling()
        const cookie = st.cookie || ''
        if (cookie) saveLoginCookie(cookie)
        qrStatusText.value = '登录成功'
        try {
          profile.value = await fetchLoginProfile()
        } catch {
          // 资料获取失败不阻断登录
        }
        message.success(`欢迎，${st.nickname || profile.value?.nickname || '网易云用户'}`)
        showLogin.value = false
        break
      }
      default:
        break
    }
  } catch {
    // 轮询网络抖动忽略，等待下一次
  }
}

function closeLogin(): void {
  stopQrPolling()
  showLogin.value = false
}

function onUserCardClick(): void {
  if (profile.value) {
    showCookie()
  } else {
    void openLogin()
  }
}

// 登录后点击用户卡片：弹窗展示个人网易云 Cookie
function showCookie(): void {
  const cookie = getLoginCookie()
  if (!cookie) {
    message.warning('未找到登录 Cookie，请重新扫码登录')
    return
  }
  dialog.info({
    title: '我的网易云 Cookie',
    content: () =>
      h(
        'div',
        {
          style:
            'word-break: break-all; max-height: 40vh; overflow-y: auto; font-size: 12px; line-height: 1.6; user-select: all; -webkit-user-select: all;'
        },
        cookie
      ),
    positiveText: '复制',
    negativeText: '关闭',
    onPositiveClick: () => {
      navigator.clipboard
        .writeText(cookie)
        .then(() => message.success('Cookie 已复制'))
        .catch(() => message.error('复制失败，请长按文本手动复制'))
    }
  })
}

function onLogout(): void {
  dialog.warning({
    title: '退出登录',
    content: '确定退出网易云音乐账号吗？',
    positiveText: '退出',
    negativeText: '取消',
    onPositiveClick: async () => {
      await logoutNetease()
      profile.value = null
      message.success('已退出登录')
    }
  })
}

// ==================== 歌单 ====================

function create(): void {
  const name = newName.value.trim()
  if (!name) return
  try {
    const pl = playlistStore.createPlaylistFromTracks(name, [])
    showCreate.value = false
    newName.value = ''
    message.success('歌单已创建')
    router.push(`/playlist/${pl.id}`)
  } catch (e) {
    message.error(e instanceof Error ? e.message : '创建失败')
  }
}

function remove(id: string, name: string): void {
  dialog.warning({
    title: '删除歌单',
    content: `确定删除歌单「${name}」吗？`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: () => {
      playlistStore.removePlaylist(id)
      message.success('已删除')
    }
  })
}

const coverOf = (pl: { cover?: string; tracks: { cover?: string }[] }): string => {
  return pl.cover || pl.tracks[0]?.cover || ''
}
</script>

<template>
  <div class="mp-page">
    <div class="mp-header mp-rise">
      <div>
        <div class="mp-title">我的</div>
        <div class="mp-sub">收藏与自建歌单</div>
      </div>
      <div class="header-side">
        <button class="mp-btn-icon" aria-label="网易云登录" @click="openLogin">
          <i class="mgc_qrcode_line"></i>
        </button>
        <button class="mp-btn-icon settings-btn" aria-label="设置" @click="router.push('/settings')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3.2" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.24.6.83 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </div>

    <div class="mp-scroll">
      <!-- 用户卡片 -->
      <div class="user-card mp-rise mp-press" style="--mp-rise-delay: 0.05s" @click="onUserCardClick">
        <div class="user-avatar">
          <img v-if="profile?.avatarUrl" :src="profile.avatarUrl" alt="" />
          <i v-else class="mgc_user_3_line"></i>
        </div>
        <div class="user-main">
          <div class="user-name">{{ profile ? profile.nickname : '未登录' }}</div>
          <div class="user-sub">{{ profile ? '网易云音乐 · 已连接' : '登录后点击即可查看个人网易云Cookie' }}</div>
        </div>
        <span v-if="!profile" class="user-action">扫码登录</span>
        <span v-else class="user-action logout" @click.stop="onLogout">退出</span>
      </div>

      <!-- 我的歌单 -->
      <div class="mp-section mp-rise" style="--mp-rise-delay: 0.1s">
        <span class="mp-section-title">我的歌单</span>
        <span class="mp-section-more" @click="showCreate = true">
          <i class="mgc_add_line"></i> 新建
        </span>
      </div>

      <div class="mp-list mp-rise" style="--mp-rise-delay: 0.14s" v-if="playlistStore.playlists.length">
        <div
          v-for="pl in playlistStore.playlists"
          :key="pl.id"
          class="pl-row"
          @click="router.push(`/playlist/${pl.id}`)"
        >
          <div class="pl-cover-wrap" :class="{ favorite: pl.id === 'favorite' }">
            <i v-if="pl.id === 'favorite'" class="mgc_heart_fill fav-icon"></i>
            <MobileCover v-else :src="coverOf(pl)" radius="0" />
          </div>
          <div class="pl-main">
            <div class="pl-name">{{ pl.name }}</div>
            <div class="pl-sub">{{ pl.tracks.length }} 首</div>
          </div>
          <i
            v-if="pl.id !== 'favorite'"
            class="mgc_delete_line pl-del"
            @click.stop="remove(pl.id, pl.name)"
          ></i>
          <i v-else class="mgc_right_line pl-arrow"></i>
        </div>
      </div>

      <n-empty v-if="!playlistStore.playlists.length" description="还没有歌单，点击上方新建" style="padding: 60px 0" />
      <div class="mp-bottom-space"></div>
    </div>

    <!-- 新建歌单弹层 -->
    <Teleport to="body">
      <div v-if="showCreate" class="mp-sheet-mask" @click="showCreate = false"></div>
      <div v-if="showCreate" class="mp-sheet create-sheet">
        <div class="sheet-grabber"></div>
        <div class="sheet-title">新建歌单</div>
        <div class="create-body">
          <div class="mp-input">
            <i class="mgc_music_2_line"></i>
            <input
              v-model="newName"
              placeholder="请输入歌单名称"
              @keyup.enter="create"
            />
          </div>
          <div class="create-actions">
            <button class="sheet-btn cancel" @click="showCreate = false">取消</button>
            <button class="mp-btn-primary confirm" @click="create">创建</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 网易云扫码登录弹窗（屏幕中央） -->
    <Teleport to="body">
      <div v-if="showLogin" class="login-mask" @click="closeLogin"></div>
      <div v-if="showLogin" class="login-modal">
        <div class="login-title">网易云扫码登录</div>
        <i class="mgc_close_line login-close" @click="closeLogin"></i>
        <div class="qr-wrap">
          <img v-if="qrImg" :src="qrImg" class="qr-img" alt="登录二维码" />
          <n-spin v-else size="medium" />
          <div v-if="qrScanned" class="qr-overlay">
            <i class="mgc_check_fill"></i>
          </div>
        </div>
        <div class="login-status">{{ qrStatusText }}</div>
        <div class="login-tip">打开网易云音乐 App「扫一扫」确认登录</div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* ==================== 用户卡片 ==================== */
.user-card {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 8px 16px 4px;
  padding: 16px;
  background: var(--mp-bg-elevated);
  border-radius: var(--mp-r-lg, 28px);
  box-shadow: var(--mp-shadow-sm);
  transition: transform 0.15s cubic-bezier(0.32, 0.72, 0.35, 1);
}

.user-avatar {
  width: 54px;
  height: 54px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--mp-fill-strong);
  color: var(--mp-text-2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  flex-shrink: 0;
}

.user-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.user-main {
  flex: 1;
  min-width: 0;
}

.user-name {
  font-size: 16px;
  font-weight: 700;
  color: var(--mp-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-sub {
  font-size: 12px;
  color: var(--mp-text-2);
  margin-top: 4px;
}

.user-action {
  flex-shrink: 0;
  padding: 7px 16px;
  border-radius: var(--mp-r-pill);
  background: var(--mp-primary);
  color: #fff;
  font-size: 12.5px;
  font-weight: 600;
}

.user-action.logout {
  background: var(--mp-fill);
  color: var(--mp-text-2);
}

/* ==================== 歌单列表 ==================== */
.pl-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 0.5px solid var(--mp-separator);
  transition: background 0.15s ease;
}

.pl-row:last-child {
  border-bottom: none;
}

.pl-row:active {
  background: var(--mp-fill);
}

.pl-cover-wrap {
  width: 58px;
  height: 58px;
  border-radius: var(--mp-r-md);
  overflow: hidden;
  background: var(--mp-bg-secondary);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--mp-shadow-sm);
}

.pl-cover-wrap.favorite {
  background: linear-gradient(135deg, #ff7eb3, #ff375f);
}

.fav-icon {
  color: #fff;
  font-size: 26px;
}

.pl-main {
  flex: 1;
  min-width: 0;
}

.pl-name {
  font-size: var(--mp-font-body);
  font-weight: 500;
  color: var(--mp-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pl-sub {
  font-size: 12px;
  color: var(--mp-text-2);
  margin-top: 3px;
}

.pl-del {
  color: var(--mp-text-3);
  font-size: 18px;
  padding: 8px;
  transition: transform 0.15s cubic-bezier(0.32, 0.72, 0.35, 1);
}

.pl-del:active {
  transform: scale(0.85);
}

.pl-arrow {
  color: var(--mp-text-3);
  font-size: 15px;
}

/* ==================== 新建歌单弹层 ==================== */
.create-sheet {
  max-height: none;
}

.create-body {
  padding: 4px 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.create-actions {
  display: flex;
  gap: 12px;
}

.sheet-btn.cancel {
  flex: 1;
  height: 46px;
  border: none;
  border-radius: var(--mp-r-pill);
  background: var(--mp-fill);
  color: var(--mp-text);
  font-size: var(--mp-font-body);
  font-weight: 600;
  transition:
    transform 0.15s cubic-bezier(0.32, 0.72, 0.35, 1),
    opacity 0.15s ease;
}

.sheet-btn.cancel:active {
  transform: scale(0.96);
  opacity: 0.85;
}

.mp-btn-primary.confirm {
  flex: 1;
}

.settings-btn svg {
  width: 21px;
  height: 21px;
}

/* ==================== 扫码登录弹窗（屏幕中央） ==================== */
.login-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 2100;
  animation: login-fade 0.22s ease;
}

.login-modal {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 2101;
  width: min(320px, 84vw);
  background: var(--mp-bg-elevated);
  border-radius: var(--mp-r-xl, 32px);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
  padding: 22px 22px 26px;
  display: flex;
  flex-direction: column;
  align-items: center;
  animation: login-pop 0.28s cubic-bezier(0.32, 0.72, 0.35, 1.1);
}

.login-title {
  font-size: var(--mp-font-headline);
  font-weight: 700;
  color: var(--mp-text);
  margin-bottom: 16px;
}

.login-close {
  position: absolute;
  top: 14px;
  right: 14px;
  font-size: 19px;
  color: var(--mp-text-3);
  padding: 6px;
}

.qr-wrap {
  position: relative;
  width: 196px;
  height: 196px;
  border-radius: var(--mp-r-md);
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  box-shadow: inset 0 0 0 0.5px var(--mp-separator);
}

.qr-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.qr-overlay {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.86);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 54px;
  color: #34c759;
}

.login-status {
  margin-top: 16px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--mp-text);
  text-align: center;
}

.login-tip {
  margin-top: 6px;
  font-size: 11.5px;
  color: var(--mp-text-3);
  text-align: center;
}

@keyframes login-fade {
  from {
    opacity: 0;
  }
}

@keyframes login-pop {
  from {
    opacity: 0;
    transform: translate(-50%, -46%) scale(0.92);
  }
}

/* ============ 横屏：歌单双列（全局规则），箭头/删除按钮始终贴右缘 ============ */
@media (orientation: landscape) {
  .pl-row {
    width: 100%;
    box-sizing: border-box;
  }

  .pl-arrow,
  .pl-del {
    margin-left: auto;
    flex-shrink: 0;
  }

  .user-card {
    max-width: 560px;
    margin-left: auto;
    margin-right: auto;
  }
}
</style>
