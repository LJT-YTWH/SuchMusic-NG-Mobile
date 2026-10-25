// 逐字歌词持久化存储：应用私有数据目录下的 karaoke-lyrics/ 文件夹（非临时目录）
//   karaoke-lyrics/<key>.lrc   —— 每首歌的逐字歌词文件
//   karaoke-lyrics/index.json  —— 清单（歌曲信息、源文件路径、算法、时间）
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'

const KARAOKE_DIR = 'karaoke-lyrics'
const MANIFEST_PATH = `${KARAOKE_DIR}/index.json`

export interface KaraokeEntry {
  /** 存储文件主键（源文件路径哈希） */
  key: string
  /** 歌曲源文件绝对路径 */
  filePath: string
  title: string
  artist: string
  /** 生成算法 v3 / v4 */
  algo: string
  createdAt: number
  sizeBytes: number
}

/** cyrb53 风格字符串哈希 → 16 位十六进制 */
export function karaokeKeyOf(filePath: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < filePath.length; i++) {
    const ch = filePath.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')
}

function filePathOf(key: string): string {
  return `${KARAOKE_DIR}/${key}.lrc`
}

async function ensureDir(): Promise<void> {
  try {
    await Filesystem.mkdir({ path: KARAOKE_DIR, directory: Directory.Data, recursive: true })
  } catch {
    // 已存在
  }
}

export async function listKaraoke(): Promise<KaraokeEntry[]> {
  try {
    const r = await Filesystem.readFile({
      path: MANIFEST_PATH,
      directory: Directory.Data,
      encoding: Encoding.UTF8
    })
    const text = typeof r.data === 'string' ? r.data : await (r.data as Blob).text()
    const list = JSON.parse(text)
    return Array.isArray(list) ? (list as KaraokeEntry[]) : []
  } catch {
    return []
  }
}

async function saveManifest(list: KaraokeEntry[]): Promise<void> {
  await ensureDir()
  await Filesystem.writeFile({
    path: MANIFEST_PATH,
    directory: Directory.Data,
    data: JSON.stringify(list),
    encoding: Encoding.UTF8,
    recursive: true
  })
}

/** 读取某首歌已生成的逐字歌词内容 */
export async function loadKaraokeFor(filePath: string): Promise<string | null> {
  const list = await listKaraoke()
  const entry = list.find((e) => e.filePath === filePath)
  if (!entry) return null
  try {
    const r = await Filesystem.readFile({
      path: filePathOf(entry.key),
      directory: Directory.Data,
      encoding: Encoding.UTF8
    })
    return typeof r.data === 'string' ? r.data : await (r.data as Blob).text()
  } catch {
    return null
  }
}

export async function hasKaraokeFor(filePath: string): Promise<boolean> {
  const list = await listKaraoke()
  return list.some((e) => e.filePath === filePath)
}

/** 保存生成结果（同歌曲覆盖旧文件） */
export async function saveKaraokeFor(
  filePath: string,
  title: string,
  artist: string,
  algo: string,
  content: string
): Promise<void> {
  await ensureDir()
  const key = karaokeKeyOf(filePath)
  await Filesystem.writeFile({
    path: filePathOf(key),
    directory: Directory.Data,
    data: content,
    encoding: Encoding.UTF8,
    recursive: true
  })
  const list = await listKaraoke()
  const idx = list.findIndex((e) => e.filePath === filePath)
  const entry: KaraokeEntry = {
    key,
    filePath,
    title: title || filePath.split('/').pop() || key,
    artist: artist || '未知歌手',
    algo,
    createdAt: Date.now(),
    sizeBytes: new Blob([content]).size
  }
  if (idx >= 0) list[idx] = entry
  else list.push(entry)
  await saveManifest(list)
}

/**
 * 原地更新某首歌的逐字歌词内容（保留算法/创建时间等清单信息）。
 * 用于把 AI 译文插回已生成的逐字歌词文件。
 */
export async function updateKaraokeContent(filePath: string, content: string): Promise<void> {
  const list = await listKaraoke()
  const idx = list.findIndex((e) => e.filePath === filePath)
  if (idx < 0) return
  const key = list[idx].key
  await ensureDir()
  await Filesystem.writeFile({
    path: filePathOf(key),
    directory: Directory.Data,
    data: content,
    encoding: Encoding.UTF8,
    recursive: true
  })
  list[idx] = { ...list[idx], sizeBytes: new Blob([content]).size }
  await saveManifest(list)
}

/** 按主键删除（管理界面批量删除用），返回删除数量 */
export async function deleteKaraokeEntries(keys: string[]): Promise<number> {
  const list = await listKaraoke()
  const keySet = new Set(keys)
  const removed = list.filter((e) => keySet.has(e.key))
  for (const e of removed) {
    try {
      await Filesystem.deleteFile({ path: filePathOf(e.key), directory: Directory.Data })
    } catch {
      // 文件可能已不存在
    }
  }
  await saveManifest(list.filter((e) => !keySet.has(e.key)))
  return removed.length
}

/** 删除某首歌的逐字歌词 */
export async function deleteKaraokeFor(filePath: string): Promise<void> {
  const list = await listKaraoke()
  const entry = list.find((e) => e.filePath === filePath)
  if (!entry) return
  await deleteKaraokeEntries([entry.key])
}
