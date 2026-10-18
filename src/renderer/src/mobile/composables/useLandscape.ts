import { ref, onBeforeUnmount } from 'vue'

// 响应式横屏检测（跟随设备旋转实时更新）
export function useLandscape() {
  const mq = window.matchMedia('(orientation: landscape)')
  const isLandscape = ref(mq.matches)
  const onChange = (e: MediaQueryListEvent): void => {
    isLandscape.value = e.matches
  }
  mq.addEventListener('change', onChange)
  onBeforeUnmount(() => mq.removeEventListener('change', onChange))
  return { isLandscape }
}
