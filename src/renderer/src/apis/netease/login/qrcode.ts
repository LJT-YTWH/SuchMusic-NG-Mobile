// 网易云扫码登录（内置 NetEaseCloudMusicApi 新版 /login/qr/* 路由）
// 说明：本模块使用独立的 axios 实例，不经过 utils/request 的响应拦截器，
// 因为扫码状态轮询会返回 800/801/802 等非 200 业务码，需要原样读取。
import axios from 'axios'

const BASE_URL = 'https://api.enzymeym.top'
const COOKIE_KEY = 'netease_music_cookie'

// 独立实例：继承全局默认配置（移动端启动时已替换 adapter 为 CapacitorHttp）
const http = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  withCredentials: true
})

// 附加已保存的登录 Cookie：
// 移动端经 CapacitorHttp 原生栈发送（自定义头不受限）；
// 桌面端 Chromium 会静默丢弃该受限头，由浏览器 Cookie 罐维持会话
http.interceptors.request.use((config) => {
  try {
    const cookie = localStorage.getItem(COOKIE_KEY)
    if (cookie) {
      ;(config.headers as Record<string, string>)['Cookie'] = cookie
    }
  } catch {
    // ignore
  }
  return config
})

export const saveLoginCookie = (cookie: string): void => {
  try {
    localStorage.setItem(COOKIE_KEY, cookie)
  } catch {
    // ignore
  }
}

export const getLoginCookie = (): string => {
  try {
    return localStorage.getItem(COOKIE_KEY) || ''
  } catch {
    return ''
  }
}

export const clearLoginCookie = (): void => {
  try {
    localStorage.removeItem(COOKIE_KEY)
  } catch {
    // ignore
  }
}

export interface QrKeyResponse {
  code: number
  data?: { unikey?: string }
}

export interface QrCreateResponse {
  code: number
  data?: { qrurl?: string; qrimg?: string }
}

// 800: 二维码过期 801: 等待扫码 802: 待确认 803: 登录成功
export interface QrCheckResponse {
  code: number
  message?: string
  cookie?: string
  nickname?: string
  avatarUrl?: string
}

export interface NeteaseProfile {
  userId: number
  nickname: string
  avatarUrl: string
}

export interface LoginStatusResponse {
  data?: {
    code?: number
    account?: { id?: number } | null
    profile?: (NeteaseProfile & { avatarUrl?: string }) | null
  }
}

/** 获取二维码 unikey */
export async function fetchQrKey(): Promise<string> {
  const res = await http.get<QrKeyResponse>('/login/qr/key', {
    params: { timestamp: Date.now() }
  })
  const key = res.data?.data?.unikey
  if (!key) throw new Error('获取登录二维码失败')
  return key
}

/** 生成二维码图片（base64 data URL） */
export async function fetchQrImage(key: string): Promise<string> {
  const res = await http.get<QrCreateResponse>('/login/qr/create', {
    params: { key, qrimg: true, timestamp: Date.now() }
  })
  const img = res.data?.data?.qrimg
  if (!img) throw new Error('生成登录二维码失败')
  return img
}

/** 轮询扫码状态 */
export async function checkQrStatus(key: string): Promise<QrCheckResponse> {
  const res = await http.get<QrCheckResponse>('/login/qr/check', {
    params: { key, timestamp: Date.now() }
  })
  return res.data
}

/** 查询当前登录状态（携带 Cookie） */
export async function fetchLoginProfile(): Promise<NeteaseProfile | null> {
  const res = await http.get<LoginStatusResponse>('/login/status', {
    params: { timestamp: Date.now() }
  })
  const profile = res.data?.data?.profile
  if (!profile || !profile.userId) return null
  return {
    userId: profile.userId,
    nickname: profile.nickname,
    avatarUrl: profile.avatarUrl || ''
  }
}

/** 退出登录 */
export async function logoutNetease(): Promise<void> {
  try {
    await http.get('/logout', { params: { timestamp: Date.now() } })
  } catch {
    // 即使接口失败也清除本地凭据
  }
  clearLoginCookie()
}
