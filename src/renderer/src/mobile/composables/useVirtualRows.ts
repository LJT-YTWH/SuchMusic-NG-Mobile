import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { useSettingsStore } from '../../stores/settingsStore'

/**
 * 长列表虚拟滚动（移动端）
 *
 * 超过阈值时只渲染可视区域内的行，用上下占位块维持滚动高度。
 * 行高按固定值估算（歌曲行 60px + 边距），配合 overscan 平滑滚动；
 * 关闭设置项（设置 → 偏好 → 长列表虚拟滚动）时退化为全量渲染。
 *
 * `columns` 用于横屏双列列表：两列时每行容纳 2 个条目，
 * 索引与高度都要按「行」而不是「条目」计算，否则占位块会把内容顶错位。
 */
export interface VirtualRowsResult<T> {
  enabled: ComputedRef<boolean>
  visibleItems: ComputedRef<T[]>
  startIndex: ComputedRef<number>
  paddingTop: ComputedRef<number>
  paddingBottom: ComputedRef<number>
  onScroll: (e: Event) => void
}

export function useVirtualRows<T>(options: {
  items: Ref<T[]> | ComputedRef<T[]>
  /** 单行高度（px），默认 61（60px 行高 + 1px 视觉间隔） */
  rowHeight?: number
  /** 超过该数量才启用，默认 120 */
  threshold?: number
  /** 视口外额外渲染的行数，默认 8 */
  overscan?: number
  /** 列表列数（横屏双列传 2），默认 1 */
  columns?: Ref<number> | ComputedRef<number>
}): VirtualRowsResult<T> {
  const settings = useSettingsStore()
  const scrollTop = ref(0)
  const viewport = ref(600)

  const rowHeight = options.rowHeight ?? 61
  const threshold = options.threshold ?? 120
  const overscan = options.overscan ?? 8
  const columns = options.columns ?? ref(1)

  const enabled = computed(
    () => settings.general.virtualScroll && options.items.value.length > threshold
  )

  const totalRows = computed(() => Math.ceil(options.items.value.length / columns.value))

  const startRow = computed(() =>
    enabled.value ? Math.max(0, Math.floor(scrollTop.value / rowHeight) - overscan) : 0
  )

  const endRow = computed(() => {
    if (!enabled.value) return totalRows.value
    return Math.min(
      totalRows.value,
      Math.ceil((scrollTop.value + viewport.value) / rowHeight) + overscan
    )
  })

  const startIndex = computed(() => startRow.value * columns.value)

  const endIndex = computed(() => {
    const total = options.items.value.length
    if (!enabled.value) return total
    return Math.min(total, endRow.value * columns.value)
  })

  const visibleItems = computed(() => options.items.value.slice(startIndex.value, endIndex.value))

  const paddingTop = computed(() => (enabled.value ? startRow.value * rowHeight : 0))

  const paddingBottom = computed(() =>
    enabled.value ? Math.max(0, (totalRows.value - endRow.value) * rowHeight) : 0
  )

  /** 绑定到滚动容器的 scroll 事件 */
  function onScroll(e: Event): void {
    const el = e.target as HTMLElement
    if (!el || typeof el.scrollTop !== 'number') return
    scrollTop.value = el.scrollTop
    if (el.clientHeight) viewport.value = el.clientHeight
  }

  return { enabled, visibleItems, startIndex, paddingTop, paddingBottom, onScroll }
}
