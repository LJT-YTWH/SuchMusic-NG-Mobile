import { Filesystem } from '@capacitor/filesystem'
import { CapacitorHttp } from '@capacitor/core'
import { SuchLocalMusic } from '../native'
import {
  readFileBytes,
  writeFileBytes,
  readTextFile,
  uint8ArrayToBase64,
  base64ToUint8Array,
  ensureCacheDir,
  sanitizeCacheKey,
  resolveAbsolutePath
} from '../fsUtils'

const AUDIO_EXTS = ['.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg']

function extOf(path: string): string {
  const idx = path.lastIndexOf('.')
  return idx >= 0 ? path.slice(idx).toLowerCase() : ''
}

// ==================== local-music:scan ====================

export async function scanLocalMusic(scanDirs?: string[]): Promise<{
  rootDir: string
  rootDirs: string[]
  tracks: Array<{
    id: string
    name: string
    filePath: string
    ar: { name: string }[]
    al: { name: string }
    dt?: number
    quality: string
  }>
}> {
  // 确保存储权限
  const perm = await SuchLocalMusic.checkStoragePermission()
  if (!perm.granted) {
    const r = await SuchLocalMusic.requestStoragePermission()
    if (!r.granted) {
      throw new Error('未授予存储访问权限，无法扫描本地音乐')
    }
  }

  const result = await SuchLocalMusic.scan({
    dirs: Array.isArray(scanDirs) && scanDirs.length ? scanDirs : undefined
  })

  return {
    rootDir: result.rootDir,
    rootDirs: result.rootDirs,
    tracks: result.tracks.map((t) => ({
      id: t.id,
      name: t.name,
      filePath: t.filePath,
      ar: [{ name: t.artist || '本地音乐' }],
      al: { name: t.album || '本地音乐' },
      dt: t.durationMs,
      quality: 'Standard'
    }))
  }
}

export async function chooseScanDirs(): Promise<{ canceled: boolean; dirs: string[] }> {
  try {
    return await SuchLocalMusic.chooseDirs()
  } catch (e) {
    console.error('chooseDirs failed', e)
    return { canceled: true, dirs: [] }
  }
}

export async function getMusicDir(): Promise<string> {
  const r = await SuchLocalMusic.getMusicDir()
  return r.path
}

export async function deleteLocalFiles(filePaths: string[]): Promise<{
  success: boolean
  deletedCount: number
  failedCount: number
}> {
  const r = await SuchLocalMusic.deleteFiles({ paths: filePaths })
  return { success: true, deletedCount: r.deletedCount, failedCount: r.failedCount }
}

// ==================== local-music:get-meta（原生实现，避免 WebView OOM） ====================

export async function getLocalMeta(filePath: string): Promise<{
  durationMs?: number
  bitrate?: number
  sampleRate?: number
  cover?: { mimeType: string; base64: string }
  title?: string
  artists?: string[]
  album?: string
  lyrics?: string
  year?: number
}> {
  try {
    // 原生 MediaMetadataRetriever 提取（不占用 WebView 内存）
    const meta = await SuchLocalMusic.getMeta({ path: filePath })

    // 尝试读取同名 .lrc 歌词文件
    let lyrics: string | undefined
    const lrcPath = filePath.substring(0, filePath.lastIndexOf('.')) + '.lrc'
    const lrcContent = await readTextFile(lrcPath)
    if (lrcContent) lyrics = lrcContent

    return {
      durationMs: meta.durationMs,
      bitrate: meta.bitrate,
      cover: meta.coverBase64
        ? { mimeType: meta.coverMime || 'image/jpeg', base64: meta.coverBase64 }
        : undefined,
      title: meta.title,
      artists: meta.artist ? [meta.artist] : undefined,
      album: meta.album,
      lyrics
    }
  } catch (e) {
    console.error('get-meta failed:', filePath, e)
    return {}
  }
}

// ==================== local-music:write-meta（移植自主进程实现） ====================

interface MetaTags {
  title?: string
  artist?: string
  album?: string
  year?: string | number
  unsynchronisedLyrics?: { text?: string }
  image?: { imageBuffer?: string | Uint8Array; mime?: string; description?: string }
}

export async function writeLocalMeta(filePath: string, tags: MetaTags): Promise<boolean> {
  const ext = extOf(filePath)
  const fileBytes = await readFileBytes(filePath)

  // Buffer polyfill（由 vite-plugin-node-polyfills 提供全局 Buffer）
  const BufferCtor = (globalThis as { Buffer?: typeof Buffer }).Buffer
  if (!BufferCtor) throw new Error('Buffer polyfill 未加载')
  const fileBuffer = BufferCtor.from(fileBytes)

  // 封面 base64 -> Buffer
  let imageBuffer: Buffer | undefined
  if (tags.image && typeof tags.image.imageBuffer === 'string') {
    imageBuffer = BufferCtor.from(base64ToUint8Array(tags.image.imageBuffer as string))
  }

  if (ext === '.mp3') {
    const NodeID3 = (await import('node-id3')).default
    const result = NodeID3.update(
      { ...tags, image: imageBuffer ? { ...tags.image, imageBuffer } : tags.image } as never,
      fileBuffer
    )
    if (!result || result instanceof Error) throw new Error('更新标签失败')
    await writeFileBytes(filePath, new Uint8Array(result as unknown as ArrayBuffer))
    return true
  } else if (ext === '.flac') {
    const out = await writeFlacTag(fileBuffer, tags, imageBuffer, BufferCtor)
    await writeFileBytes(filePath, new Uint8Array(out as unknown as ArrayBuffer))
    return true
  } else if (ext === '.wav') {
    const { WaveFile } = await import('wavefile')
    const wav = new WaveFile(fileBuffer)
    if (tags.title) wav.setTag('TIT2', tags.title)
    if (tags.artist) wav.setTag('TPE1', tags.artist)
    if (tags.album) wav.setTag('TALB', tags.album)
    if (tags.year) wav.setTag('TYER', String(tags.year))
    if (imageBuffer) {
      wav.setTag('APIC', {
        type: 3,
        data: imageBuffer,
        mime: tags.image?.mime || 'image/jpeg',
        description: tags.image?.description || ''
      } as never)
    }
    await writeFileBytes(filePath, new Uint8Array(wav.toBuffer() as unknown as ArrayBuffer))
    return true
  }
  throw new Error(`不支持的文件格式: ${ext}`)
}

async function writeFlacTag(
  fileBuffer: Buffer,
  tags: MetaTags,
  imageBuffer: Buffer | undefined,
  BufferCtor: typeof Buffer
): Promise<Buffer> {
  const flac = (await import('flac-metadata')).default

  if (fileBuffer.toString('utf8', 0, 4) !== 'fLaC') {
    throw new Error('文件不是合法的 FLAC 格式')
  }

  let offset = 4
  const keptBlocks: Buffer[] = []
  let last = false

  while (!last) {
    const header = fileBuffer.readUInt32BE(offset)
    const isLast = header >>> 31 !== 0
    const type = (header >>> 24) & 0x7f
    const length = header & 0x00ffffff
    const block = fileBuffer.subarray(offset, offset + 4 + length)

    if (
      type !== flac.Processor.MDB_TYPE_VORBIS_COMMENT &&
      type !== flac.Processor.MDB_TYPE_PICTURE
    ) {
      keptBlocks.push(block)
    }
    offset += 4 + length
    last = isLast
  }

  const audioData = fileBuffer.subarray(offset)

  const fixedKeptBlocks = keptBlocks.map((b) => {
    const buf = BufferCtor.from(b)
    const header = buf.readUInt32BE(0)
    buf.writeUInt32BE((header & 0x7fffffff) >>> 0, 0)
    return buf
  })

  const comments = [
    `TITLE=${tags.title || ''}`,
    `ARTIST=${tags.artist || ''}`,
    `ALBUM=${tags.album || ''}`,
    `DATE=${tags.year || ''}`,
    `LYRICS=${(tags.unsynchronisedLyrics?.text || '').replace(/\r\n/g, '\n')}`
  ]

  const vorbisBlock = flac.data.MetaDataBlockVorbisComment.create(
    false,
    'such-pc-ng',
    comments
  )
  const vorbisBuffer = vorbisBlock.publish() as Buffer

  let pictureBuffer: Buffer | null = null
  if (imageBuffer) {
    const pictureBlock = flac.data.MetaDataBlockPicture.create(
      true,
      3,
      tags.image?.mime || 'image/jpeg',
      tags.image?.description || '',
      0,
      0,
      0,
      0,
      imageBuffer
    )
    pictureBuffer = pictureBlock.publish() as Buffer
  }

  const blocksToWrite: Buffer[] = [...fixedKeptBlocks]
  if (pictureBuffer) {
    const h = vorbisBuffer.readUInt32BE(0) & 0x7fffffff
    vorbisBuffer.writeUInt32BE(h >>> 0, 0)
    blocksToWrite.push(vorbisBuffer, pictureBuffer)
  } else {
    const h = vorbisBuffer.readUInt32BE(0) | 0x80000000
    vorbisBuffer.writeUInt32BE(h >>> 0, 0)
    blocksToWrite.push(vorbisBuffer)
  }

  const metaSize = blocksToWrite.reduce((sum, b) => sum + b.length, 0)
  const outBuffer = BufferCtor.alloc(4 + metaSize + audioData.length)
  outBuffer.write('fLaC', 0, 'ascii')
  let pos = 4
  for (const b of blocksToWrite) {
    b.copy(outBuffer, pos)
    pos += b.length
  }
  audioData.copy(outBuffer, pos)
  return outBuffer
}

// ==================== online-cache:* ====================

async function resolveCacheDir(dir?: string | null): Promise<string> {
  if (dir && typeof dir === 'string' && dir.trim()) {
    try {
      await Filesystem.mkdir({ path: dir, recursive: true })
    } catch {
      // 已存在或无法创建时忽略
    }
    return dir
  }
  return ensureCacheDir()
}

async function listFilesRecursive(absDir: string): Promise<Array<{ path: string; size: number }>> {
  const out: Array<{ path: string; size: number }> = []
  const walk = async (dir: string): Promise<void> => {
    let entries
    try {
      entries = await Filesystem.readdir({ path: dir })
    } catch {
      return
    }
    for (const f of entries.files) {
      const full = `${dir}/${f.name}`
      if (f.type === 'directory') {
        await walk(full)
      } else {
        out.push({ path: full, size: f.size ?? 0 })
      }
    }
  }
  await walk(absDir)
  return out
}

export async function onlineCacheGetInfo(dir?: string | null): Promise<{
  dir: string
  sizeBytes: number
  fileCount: number
}> {
  const cacheDir = await resolveCacheDir(dir)
  const files = await listFilesRecursive(cacheDir)
  return {
    dir: cacheDir,
    sizeBytes: files.reduce((s, f) => s + f.size, 0),
    fileCount: files.length
  }
}

export async function onlineCacheChooseDir(): Promise<{ canceled: boolean; dir: string | null }> {
  // 移动端使用应用私有目录，不提供目录选择
  return { canceled: true, dir: null }
}

export async function onlineCacheClear(dir?: string | null): Promise<{ success: boolean }> {
  const cacheDir = await resolveCacheDir(dir)
  try {
    await Filesystem.rmdir({ path: cacheDir, recursive: true })
  } catch {
    // ignore
  }
  try {
    await Filesystem.mkdir({ path: cacheDir, recursive: true })
  } catch {
    // ignore
  }
  return { success: true }
}

export async function onlineCacheCheck(options: {
  dir?: string | null
  key: string
}): Promise<string | null> {
  const { dir, key } = options || {}
  if (!key) return null
  const cacheDir = await resolveCacheDir(dir)
  const safeKey = sanitizeCacheKey(key)
  try {
    const entries = await Filesystem.readdir({ path: cacheDir })
    for (const f of entries.files) {
      if (f.name.startsWith(safeKey + '.') && f.type === 'file' && (f.size ?? 0) > 0) {
        return `${cacheDir}/${f.name}`
      }
    }
  } catch {
    // 目录不存在
  }
  return null
}

export async function onlineCachePrepare(options: {
  dir?: string | null
  key: string
  url: string
}): Promise<{ usedCache: boolean; filePath: string | null; url: string }> {
  const { dir, key, url } = options || {}
  if (!url || typeof url !== 'string') throw new Error('无效的播放链接')

  if (!/^https?:\/\//i.test(url)) {
    return { usedCache: false, filePath: null, url }
  }

  const cacheDir = await resolveCacheDir(dir)
  const safeKey = sanitizeCacheKey(key || '')

  let ext = ''
  try {
    const u = new URL(url)
    const name = u.pathname.split('/').pop() || ''
    const idx = name.lastIndexOf('.')
    if (idx !== -1 && idx < name.length - 1) ext = name.slice(idx)
  } catch {
    // ignore
  }
  if (!ext) ext = '.dat'

  const filePath = `${cacheDir}/${safeKey}${ext}`

  try {
    const stat = await Filesystem.stat({ path: filePath })
    if (stat.type === 'file' && stat.size > 0) {
      return { usedCache: true, filePath, url }
    }
  } catch {
    // 不存在则下载
  }

  const response = await CapacitorHttp.get({
    url,
    responseType: 'arraybuffer',
    connectTimeout: 30000,
    readTimeout: 30000,
    headers: { 'User-Agent': 'SuchMusic/OnlineCache' }
  })

  if (response.status !== 200 || !response.data) {
    throw new Error(`下载音频失败: HTTP ${response.status}`)
  }

  // arraybuffer 响应为 base64 字符串
  const base64 =
    typeof response.data === 'string'
      ? response.data
      : uint8ArrayToBase64(new Uint8Array(response.data as ArrayBuffer))

  await Filesystem.writeFile({ path: filePath, data: base64, recursive: true })
  return { usedCache: false, filePath, url }
}

export { AUDIO_EXTS, resolveAbsolutePath }
