import { computed, ref, type ComputedRef, type Ref } from 'vue'

/** 横屏曲库浏览方式：传统列表 / Cover Flow */
export type LibraryLayoutMode = 'list' | 'coverflow'

// v2：默认值改为「传统列表」，旧版本可能已把 coverflow 写进 localStorage，
// 换 key 让已有用户也回到新的默认值（之后主动切换仍会持久化）。
const STORAGE_KEY = 'suchmusic.mobile.landscape-library-layout.v2'

/** 默认使用传统列表（Cover Flow 需用户在设置/头部按钮中主动开启） */
const DEFAULT_MODE: LibraryLayoutMode = 'list'

function read(): LibraryLayoutMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'coverflow' ? 'coverflow' : DEFAULT_MODE
  } catch {
    return DEFAULT_MODE
  }
}

// 模块级单例：所有页面共享同一选择
const mode = ref<LibraryLayoutMode>(read())

// 横屏检测（模块级，避免在组件外调用 useLandscape 的 onBeforeUnmount）
const orientationMq =
  typeof window !== 'undefined' ? window.matchMedia('(orientation: landscape)') : null
const isLandscape = ref(orientationMq?.matches ?? false)
orientationMq?.addEventListener('change', (e) => {
  isLandscape.value = e.matches
})

const isCoverFlow = computed(() => mode.value === 'coverflow')

function setMode(next: LibraryLayoutMode): void {
  if (mode.value === next) return
  mode.value = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    /* 隐私模式下忽略写入失败 */
  }
}

function toggleMode(): void {
  setMode(isCoverFlow.value ? 'list' : 'coverflow')
}

/** 是否在横屏 + Cover Flow 模式下展示 3D 封面流 */
const useCoverFlowNow = computed(() => isLandscape.value && isCoverFlow.value)

export interface LibraryLayoutApi {
  mode: Ref<LibraryLayoutMode>
  isLandscape: Ref<boolean>
  isCoverFlow: ComputedRef<boolean>
  useCoverFlowNow: ComputedRef<boolean>
  setMode: (next: LibraryLayoutMode) => void
  toggleMode: () => void
}

export function useLibraryLayout(): LibraryLayoutApi {
  return {
    mode,
    isLandscape,
    isCoverFlow,
    useCoverFlowNow,
    setMode,
    toggleMode
  }
}
