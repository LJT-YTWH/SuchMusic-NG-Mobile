/**
 * Cover Flow 封面缓存
 *
 * Cover Flow 启用了虚拟化：划出窗口的 <img> 会被销毁，划回来时重新创建。
 * 如果每次重建都重新发起请求/解码，快速滑动时会明显闪白、甚至掉帧。
 *
 * 这里用「预热 + 成功/失败记录」做一层应用侧缓存：
 * - preloadCover 通过 new Image() 提前把图片拉进 WebView 的内存/磁盘缓存；
 * - 重建的 <img> 命中缓存后基本可以当帧绘制；
 * - 失败（404/无封面）也会被记住，避免反复重试。
 *
 * 说明：不做 base64 常驻，避免大量封面把 JS 堆撑爆；依赖 WebView 自身的图片缓存。
 */

const loaded = new Set<string>()
const failed = new Set<string>()
const pending = new Map<string, Promise<boolean>>()

/** 该封面是否已经成功加载过（同步，可用于首帧直接显示） */
export function isCoverCached(url?: string): boolean {
  return !!url && loaded.has(url)
}

/** 该封面是否已确认加载失败 */
export function isCoverFailed(url?: string): boolean {
  return !!url && failed.has(url)
}

/** 预热单张封面；返回是否可用（已缓存的会同步返回） */
export function preloadCover(url?: string): Promise<boolean> {
  if (!url) return Promise.resolve(false)
  if (loaded.has(url)) return Promise.resolve(true)
  if (failed.has(url)) return Promise.resolve(false)

  const running = pending.get(url)
  if (running) return running

  const task = new Promise<boolean>((resolve) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => {
      loaded.add(url)
      pending.delete(url)
      resolve(true)
    }
    img.onerror = () => {
      failed.add(url)
      pending.delete(url)
      resolve(false)
    }
    img.src = url
  })
  pending.set(url, task)
  return task
}

/** 批量预热（按顺序去重，最多 max 张） */
export function preloadCovers(urls: Array<string | undefined>, max = 12): void {
  let count = 0
  for (const url of urls) {
    if (!url) continue
    if (count >= max) break
    count += 1
    void preloadCover(url)
  }
}

/** 供调试/设置页使用：清空记录（WebView 图片缓存本身不受影响） */
export function clearCoverCache(): void {
  loaded.clear()
  failed.clear()
  pending.clear()
}
