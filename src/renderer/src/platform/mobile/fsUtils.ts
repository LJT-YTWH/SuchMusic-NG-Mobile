import { Filesystem, Directory } from '@capacitor/filesystem'
import { SuchLocalMusic } from './native'

// ==================== base64 <-> 二进制 ====================

export function base64ToUint8Array(base64: string): Uint8Array {
  // 兼容可能带 data URI 前缀的情况
  const idx = base64.indexOf('base64,')
  const raw = idx >= 0 ? base64.slice(idx + 7) : base64
  const binary = atob(raw)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
    binary += String.fromCharCode.apply(null, Array.from(chunk))
  }
  return btoa(binary)
}

// ==================== 文件读写 ====================

/** 读取绝对路径文件为 Uint8Array */
export async function readFileBytes(path: string): Promise<Uint8Array> {
  const result = await Filesystem.readFile({ path })
  const data = result.data
  if (typeof data === 'string') {
    return base64ToUint8Array(data)
  }
  // Web 端可能返回 Blob
  const buf = await (data as Blob).arrayBuffer()
  return new Uint8Array(buf)
}

/** 读取绝对路径文件为 ArrayBuffer */
export async function readFileArrayBuffer(path: string): Promise<ArrayBuffer> {
  const bytes = await readFileBytes(path)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/** 写入绝对路径文件 */
export async function writeFileBytes(path: string, data: Uint8Array): Promise<void> {
  await Filesystem.writeFile({
    path,
    data: uint8ArrayToBase64(data),
    recursive: true
  })
}

/** 读取文本文件，失败返回 null */
export async function readTextFile(path: string): Promise<string | null> {
  try {
    const bytes = await readFileBytes(path)
    return new TextDecoder('utf-8').decode(bytes)
  } catch {
    return null
  }
}

/** 判断文件/目录是否存在（优先原生快速判断） */
export async function fsExists(path: string): Promise<boolean> {
  try {
    const r = await SuchLocalMusic.fsExists({ path })
    return r.exists
  } catch {
    try {
      await Filesystem.stat({ path })
      return true
    } catch {
      return false
    }
  }
}

/** 将 Directory + 相对路径解析为绝对路径 */
export async function resolveAbsolutePath(path: string, directory: Directory): Promise<string> {
  const r = await Filesystem.getUri({ path, directory })
  return r.uri.replace(/^file:\/\//, '')
}

// ==================== 在线缓存目录 ====================

const CACHE_REL_DIR = 'online-cache'

export async function ensureCacheDir(): Promise<string> {
  try {
    await Filesystem.mkdir({ path: CACHE_REL_DIR, directory: Directory.Data, recursive: true })
  } catch {
    // 已存在
  }
  return resolveAbsolutePath(CACHE_REL_DIR, Directory.Data)
}

export function sanitizeCacheKey(key: string): string {
  return key.replace(/[^\w.-]/g, '_')
}
