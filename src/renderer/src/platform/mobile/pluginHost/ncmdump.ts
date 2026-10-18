// 纯 TS 实现的 NCM 解密引擎（等价于 ncmdump-go 的核心功能）
// Android 无法运行 ncmdump-go 原生二进制，这里按 NCM 公开格式实现：
//   1. 核心密钥 AES-128-ECB 解出 RC4 变种密钥盒
//   2. 元信息密钥 AES-128-ECB 解出 JSON 元数据
//   3. 密钥盒流式异或还原音频数据
// AES 使用项目已有依赖 node-forge，无新增原生依赖。
import forge from 'node-forge'
import { Filesystem } from '@capacitor/filesystem'
import { readFileBytes, writeFileBytes, fsExists } from '../fsUtils'

const CORE_KEY = 'hzHRAmso5kInbaxW'
const META_KEY = "#14ljk_!\\]&0U<'("
const NCM_MAGIC = 'CTENFDAM'

export interface NcmMeta {
  musicName?: string
  artist?: Array<[string, number] | string>
  album?: string
  format?: string
  duration?: number
  [key: string]: unknown
}

export interface NcmParseResult {
  /** 解密后的音频数据 */
  audio: Uint8Array
  /** 元数据（可能为空对象） */
  meta: NcmMeta
  /** 建议输出扩展名（mp3/flac 等） */
  format: string
}

// ==================== 字节辅助 ====================

function u8ToBinary(data: Uint8Array): string {
  let s = ''
  const chunk = 0x8000
  for (let i = 0; i < data.length; i += chunk) {
    s += String.fromCharCode(...data.subarray(i, Math.min(i + chunk, data.length)))
  }
  return s
}

function binaryToU8(bin: string): Uint8Array {
  const u8 = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
  return u8
}

function readUint32LE(data: Uint8Array, offset: number): number {
  return (
    (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>>
    0
  )
}

/** AES-128-ECB 解密（forge 自动处理 PKCS7 去填充） */
function aesEcbDecrypt(data: Uint8Array, key: string): Uint8Array {
  const decipher = forge.cipher.createDecipher('AES-ECB', key)
  decipher.start()
  decipher.update(forge.util.createBuffer(u8ToBinary(data)))
  if (!decipher.finish()) {
    throw new Error('AES 解密失败（文件可能已损坏）')
  }
  return binaryToU8(decipher.output.getBytes())
}

// ==================== 密钥盒 ====================

function buildKeyBox(key: Uint8Array): Uint8Array {
  const box = new Uint8Array(256)
  for (let i = 0; i < 256; i++) box[i] = i
  let c = 0
  let lastByte = 0
  let keyOffset = 0
  for (let i = 0; i < 256; i++) {
    const swap = box[i]
    c = (swap + lastByte + key[keyOffset++]) & 0xff
    if (keyOffset >= key.length) keyOffset = 0
    box[i] = box[c]
    box[c] = swap
    lastByte = c
  }
  return box
}

/** 密钥盒流式异或（与 ncmdump 的 0x8000 分块语义等价：256 周期内连续处理结果一致） */
function xorWithKeyBox(audio: Uint8Array, box: Uint8Array): void {
  for (let i = 0; i < audio.length; i++) {
    const j = (i + 1) & 0xff
    audio[i] ^= box[(box[j] + box[(box[j] + j) & 0xff]) & 0xff]
  }
}

// ==================== NCM 解析 ====================

export function parseNcm(data: Uint8Array): NcmParseResult {
  // 文件头校验
  let magic = ''
  for (let i = 0; i < 8; i++) magic += String.fromCharCode(data[i])
  if (magic !== NCM_MAGIC) {
    throw new Error('不是有效的 NCM 文件（文件头不匹配）')
  }

  let offset = 10 // 跳过 magic(8) + 2 字节间隔

  // ---- 密钥数据 ----
  const keyLen = readUint32LE(data, offset)
  offset += 4
  const keyData = new Uint8Array(keyLen)
  for (let i = 0; i < keyLen; i++) keyData[i] = data[offset + i] ^ 0x64
  offset += keyLen

  const decryptedKey = aesEcbDecrypt(keyData, CORE_KEY)
  // 前 17 字节为 "neteasecloudmusic" 前缀
  const keyBox = buildKeyBox(decryptedKey.subarray(17))

  // ---- 元数据 ----
  const metaLen = readUint32LE(data, offset)
  offset += 4
  let meta: NcmMeta = {}
  if (metaLen > 0) {
    const metaData = new Uint8Array(metaLen)
    for (let i = 0; i < metaLen; i++) metaData[i] = data[offset + i] ^ 0x63
    offset += metaLen
    try {
      // 前 22 字符为 "163 key(Don't modify):" 前缀
      const metaB64 = u8ToBinary(metaData).slice(22)
      const encrypted = binaryToU8(atob(metaB64))
      const decrypted = aesEcbDecrypt(encrypted, META_KEY)
      // 前 6 字节为 "music:" 前缀
      const jsonText = new TextDecoder('utf-8').decode(decrypted.subarray(6))
      meta = JSON.parse(jsonText) as NcmMeta
    } catch {
      // 部分文件无元数据，忽略
    }
  }

  // ---- 封面（跳过）----
  offset += 4 // CRC32
  offset += 5 // 5 字节间隔
  const imageSize = readUint32LE(data, offset)
  offset += 4 + imageSize

  // ---- 音频数据 ----
  const audio = data.subarray(offset)
  xorWithKeyBox(audio, keyBox)

  const format = (meta.format || 'mp3').toLowerCase()
  return { audio, meta, format }
}

// ==================== 输出命名 ====================

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim()
}

export function suggestOutputName(meta: NcmMeta, format: string, fallbackBase: string): string {
  if (meta.musicName) {
    const artists = Array.isArray(meta.artist)
      ? meta.artist.map((a) => (Array.isArray(a) ? a[0] : a)).join(',')
      : ''
    const base = artists ? `${meta.musicName} - ${artists}` : meta.musicName
    return `${sanitizeFileName(base)}.${format}`
  }
  return `${sanitizeFileName(fallbackBase)}.${format}`
}

// ==================== 单文件 / 目录批量 ====================

export interface NcmDumpSummary {
  total: number
  success: number
  failed: number
  outputs: string[]
  logs: string[]
}

/** 解密单个 NCM 文件，返回输出路径 */
export async function dumpNcmFile(ncmPath: string, outDir: string): Promise<string> {
  const data = await readFileBytes(ncmPath)
  const { audio, meta, format } = parseNcm(data)

  const fileName = ncmPath.split('/').pop() || 'output.ncm'
  const fallbackBase = fileName.replace(/\.ncm$/i, '')
  let outName = suggestOutputName(meta, format, fallbackBase)

  // 重名避让：xxx (1).mp3
  let candidate = `${outDir}/${outName}`
  let n = 1
  while (await fsExists(candidate)) {
    const dot = outName.lastIndexOf('.')
    outName = `${outName.slice(0, dot)} (${n})${outName.slice(dot)}`
    candidate = `${outDir}/${outName}`
    n++
  }

  await writeFileBytes(candidate, audio)
  return candidate
}

async function collectNcmFiles(dir: string, recursive: boolean): Promise<string[]> {
  const out: string[] = []
  let entries
  try {
    entries = await Filesystem.readdir({ path: dir })
  } catch {
    return out
  }
  for (const f of entries.files) {
    const full = `${dir}/${f.name}`
    if (f.type === 'directory') {
      if (recursive) out.push(...(await collectNcmFiles(full, recursive)))
    } else if (/\.ncm$/i.test(f.name)) {
      out.push(full)
    }
  }
  return out
}

/** 批量解密目录中的 .ncm 文件到输出目录 */
export async function dumpNcmDirectory(
  ncmDir: string,
  outDir: string,
  recursive: boolean,
  onLog?: (line: string) => void
): Promise<NcmDumpSummary> {
  const logs: string[] = []
  const log = (line: string): void => {
    logs.push(line)
    onLog?.(line)
  }

  try {
    await Filesystem.mkdir({ path: outDir, recursive: true })
  } catch {
    // 已存在
  }

  const files = await collectNcmFiles(ncmDir, recursive)
  const summary: NcmDumpSummary = {
    total: files.length,
    success: 0,
    failed: 0,
    outputs: [],
    logs
  }

  if (!files.length) {
    log(`未在 ${ncmDir} 中找到 .ncm 文件`)
    return summary
  }

  log(`发现 ${files.length} 个 NCM 文件，开始解密...`)
  for (const file of files) {
    const name = file.split('/').pop() || file
    try {
      const outPath = await dumpNcmFile(file, outDir)
      summary.success++
      summary.outputs.push(outPath)
      log(`[成功] ${name} -> ${outPath.split('/').pop()}`)
    } catch (e) {
      summary.failed++
      log(`[失败] ${name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  log(`完成：成功 ${summary.success} 个，失败 ${summary.failed} 个`)
  return summary
}
