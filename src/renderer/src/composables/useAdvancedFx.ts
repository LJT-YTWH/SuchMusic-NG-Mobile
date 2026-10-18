import { useDialog, useMessage } from 'naive-ui'
import { useSettingsStore, type AdvancedFxSettings } from '../stores/settingsStore'

/** 高级音效功能标识 */
export type FxFeatureId =
  | 'rate'
  | 'loudness'
  | 'balance'
  | 'width'
  | 'crossfade'
  | 'vocalRemoval'

export interface FxFeatureMeta {
  id: FxFeatureId
  name: string
  icon: string
  desc: string
}

/** 6 种高级音效功能元数据（列表展示顺序） */
export const FX_FEATURES: FxFeatureMeta[] = [
  {
    id: 'rate',
    name: '变速播放',
    icon: 'mgc_time_duration_line',
    desc: '调整播放速度（0.5× - 2.0×），可选择保持音调'
  },
  {
    id: 'loudness',
    name: '响度均衡',
    icon: 'mgc_volume_line',
    desc: '压缩动态范围，让不同歌曲的音量大小趋于一致'
  },
  {
    id: 'balance',
    name: '声像平衡',
    icon: 'mgc_speaker_line',
    desc: '调节左右声道的声音偏移'
  },
  {
    id: 'width',
    name: '立体声扩展',
    icon: 'mgc_ear_line',
    desc: '加宽立体声声场，增强空间感（耳机更明显）'
  },
  {
    id: 'crossfade',
    name: '交叉淡入淡出',
    icon: 'mgc_transfer_horizontal_line',
    desc: '切歌时旧歌曲淡出、新歌曲淡入，过渡更平滑'
  },
  {
    id: 'vocalRemoval',
    name: '人声消除',
    icon: 'mgc_mic_off_line',
    desc: '削弱居中人声，秒变伴奏（仅对立体声歌曲有效）'
  }
]

/** 各功能的启用字段映射 */
const ENABLE_FIELD: Record<FxFeatureId, keyof AdvancedFxSettings> = {
  rate: 'rateEnabled',
  loudness: 'loudnessEnabled',
  balance: 'balanceEnabled',
  width: 'widthEnabled',
  crossfade: 'crossfadeEnabled',
  vocalRemoval: 'vocalRemovalEnabled'
}

/**
 * 高级音效共享逻辑：
 * - 首次开启任意功能时弹窗确认（在线音乐需先下载到缓存再播放）
 * - 恢复默认（带确认弹窗）
 * 须在组件 setup 中调用（依赖 naive-ui 的 dialog/message 上下文）
 */
export function useAdvancedFx() {
  const settingsStore = useSettingsStore()
  const dialog = useDialog()
  const message = useMessage()

  const isEnabled = (id: FxFeatureId): boolean =>
    !!settingsStore.advancedFx[ENABLE_FIELD[id]]

  /** 功能开关：开启时若未确认过，先弹「下载后播放」提示 */
  const toggleFeature = (id: FxFeatureId, target: boolean): void => {
    const fx = settingsStore.advancedFx
    if (target && !fx.confirmed) {
      dialog.warning({
        title: '开启高级音效',
        content:
          '开启高级音效后，播放在线音乐时会先将歌曲完整下载到缓存目录再开始播放，首次播放等待时间会变长（已缓存的歌曲不受影响）。是否开启？',
        positiveText: '开启',
        negativeText: '取消',
        onPositiveClick: () => {
          settingsStore.advancedFx.confirmed = true
          ;(settingsStore.advancedFx[ENABLE_FIELD[id]] as boolean) = true
        }
      })
      return
    }
    ;(settingsStore.advancedFx[ENABLE_FIELD[id]] as boolean) = target
  }

  /** 列表行的状态摘要文本 */
  const statusText = (id: FxFeatureId): string => {
    const fx = settingsStore.advancedFx
    switch (id) {
      case 'rate':
        return fx.rateEnabled ? `${fx.playbackRate.toFixed(2)}×` : '关闭'
      case 'loudness':
        return fx.loudnessEnabled ? `${Math.round(fx.loudnessStrength * 100)}%` : '关闭'
      case 'balance':
        if (!fx.balanceEnabled) return '关闭'
        if (fx.balance === 0) return '居中'
        return fx.balance < 0 ? `左 ${Math.round(-fx.balance * 100)}%` : `右 ${Math.round(fx.balance * 100)}%`
      case 'width':
        return fx.widthEnabled ? `${Math.round(fx.stereoWidth * 100)}%` : '关闭'
      case 'crossfade':
        return fx.crossfadeEnabled ? `${fx.crossfadeSeconds}s` : '关闭'
      case 'vocalRemoval':
        return fx.vocalRemovalEnabled ? '开启' : '关闭'
    }
  }

  /** 恢复默认（确认弹窗） */
  const confirmReset = (): void => {
    dialog.warning({
      title: '恢复默认',
      content: '确定要将全部高级音效恢复为默认设置吗？',
      positiveText: '恢复',
      negativeText: '取消',
      onPositiveClick: () => {
        settingsStore.resetAdvancedFx()
        message.success('已恢复默认设置')
      }
    })
  }

  return {
    settingsStore,
    isEnabled,
    toggleFeature,
    statusText,
    confirmReset
  }
}
