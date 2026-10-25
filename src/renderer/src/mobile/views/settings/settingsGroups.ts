// 设置分组数据（设置首页与横屏左侧菜单共用）
export interface SettingsGroupItem {
  key: string
  label: string
  sub: string
  icon: string
  gradient: string
}

export interface SettingsGroup {
  items: SettingsGroupItem[]
}

export const settingsGroups: SettingsGroup[] = [
  {
    items: [
      {
        key: 'appearance',
        label: '外观',
        sub: '主题模式与主题色',
        icon: 'mgc_palette_line',
        gradient: 'linear-gradient(135deg, #8e8bff 0%, #5e5ce6 100%)'
      },
      {
        key: 'playback',
        label: '播放',
        sub: '压限器与十段均衡器',
        icon: 'mgc_play_circle_line',
        gradient: 'linear-gradient(135deg, #ffb547 0%, #ff9500 100%)'
      },
      {
        key: 'lyricDisplay',
        label: '播放页歌词展示',
        sub: '歌词颜色与排版',
        icon: 'mgc_quill_pen_line',
        gradient: 'linear-gradient(135deg, #64d2ff 0%, #0a84ff 100%)'
      },
      {
        key: 'lyrics',
        label: '悬浮歌词',
        sub: '样式、颜色与对齐方式',
        icon: 'mgc_text_line',
        gradient: 'linear-gradient(135deg, #5ee87f 0%, #30d158 100%)'
      },
      {
        key: 'preference',
        label: '偏好',
        sub: '偏好类设置',
        icon: 'mgc_settings_4_line',
        gradient: 'linear-gradient(135deg, #ffd60a 0%, #ff9f0a 100%)'
      }
    ]
  },
  {
    items: [
      {
        key: 'source',
        label: '音源与插件',
        sub: '首选平台、音质与插件管理',
        icon: 'mgc_earth_line',
        gradient: 'linear-gradient(135deg, #4da3ff 0%, #0a84ff 100%)'
      },
      {
        key: 'local',
        label: '本地与缓存',
        sub: '扫描目录与缓存清理',
        icon: 'mgc_folder_2_line',
        gradient: 'linear-gradient(135deg, #d98bff 0%, #bf5af2 100%)'
      }
    ]
  },
  {
    items: [
      {
        key: 'about',
        label: '关于',
        sub: '版本信息与开源声明',
        icon: 'mgc_information_line',
        gradient: 'linear-gradient(135deg, #b0b0b6 0%, #8e8e93 100%)'
      }
    ]
  }
]
