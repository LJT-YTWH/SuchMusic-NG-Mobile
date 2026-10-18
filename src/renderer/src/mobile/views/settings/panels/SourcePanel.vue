<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { NSpin, useMessage, useDialog } from 'naive-ui'
import { useSettingsStore } from '../../../../stores/settingsStore'
import { usePluginStore } from '../../../../stores/pluginStore'
import PluginWidgetSheet from '../../../components/PluginWidgetSheet.vue'
import type { Plugin } from '../../../../types/plugin'

// 音源与插件：首选平台、首选音质、插件管理
const settingsStore = useSettingsStore()
const pluginStore = usePluginStore()
const message = useMessage()
const dialog = useDialog()

const platforms = [
  { label: '所有平台', value: 'all' },
  { label: '网易云', value: 'wy' },
  { label: 'QQ音乐', value: 'tx' },
  { label: '酷狗', value: 'kg' },
  { label: '酷我', value: 'kw' },
  { label: '咪咕', value: 'mg' }
]

const qualities = [
  { label: '标准 128k', value: '128k' },
  { label: '高品质 320k', value: '320k' },
  { label: '无损 FLAC', value: 'flac' },
  { label: 'Hi-Res', value: 'hires' }
]

const pluginUrl = ref('')
const showPluginUrlInput = ref(false)
const pluginsLoading = ref(false)

// UI 组件插件面板
const showWidgetSheet = ref(false)
const currentWidgetPlugin = ref<Plugin | null>(null)

function openWidget(plugin: Plugin): void {
  currentWidgetPlugin.value = plugin
  showWidgetSheet.value = true
}

async function refreshPlugins(): Promise<void> {
  pluginsLoading.value = true
  try {
    await pluginStore.loadAllPlugins()
  } finally {
    pluginsLoading.value = false
  }
}

async function importFromFile(): Promise<void> {
  const result = await pluginStore.importPluginFromFile()
  if (result && 'error' in result && result.error) {
    message.error(String(result.error))
  } else if (result && 'plugin' in result && result.plugin) {
    message.success('插件导入成功')
    await refreshPlugins()
  }
}

async function importFromUrl(): Promise<void> {
  const url = pluginUrl.value.trim()
  if (!url) return
  const result = await pluginStore.importPluginFromUrl(url)
  if (result && 'error' in result && result.error) {
    message.error(String(result.error))
  } else if (result && 'plugin' in result && result.plugin) {
    message.success('插件导入成功')
    pluginUrl.value = ''
    showPluginUrlInput.value = false
    await refreshPlugins()
  }
}

async function togglePlugin(id: string, status?: string): Promise<void> {
  try {
    if (status === 'active') {
      await pluginStore.deactivatePlugin(id)
    } else {
      await pluginStore.activatePlugin(id)
      message.success('插件已激活')
    }
    await refreshPlugins()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '操作失败')
  }
}

function uninstallPlugin(id: string, name: string): void {
  dialog.warning({
    title: '卸载插件',
    content: `确定卸载插件「${name}」吗？`,
    positiveText: '卸载',
    negativeText: '取消',
    onPositiveClick: async () => {
      await pluginStore.uninstallPlugin(id)
      message.success('已卸载')
      await refreshPlugins()
    }
  })
}

onMounted(() => {
  void refreshPlugins()
})
</script>

<template>
  <div class="sp-panel">
    <div class="mp-section-title">首选平台</div>
    <div class="chip-wrap">
      <span
        v-for="p in platforms"
        :key="p.value"
        class="mp-chip"
        :class="{ active: settingsStore.source.preferredPlatform === p.value }"
        @click="settingsStore.source.preferredPlatform = p.value"
      >
        {{ p.label }}
      </span>
    </div>

    <div class="mp-section-title">首选音质</div>
    <div class="chip-wrap">
      <span
        v-for="q in qualities"
        :key="q.value"
        class="mp-chip"
        :class="{ active: settingsStore.source.preferredQuality === q.value }"
        @click="settingsStore.source.preferredQuality = q.value"
      >
        {{ q.label }}
      </span>
    </div>

    <div class="mp-section-title">音源插件</div>
    <div class="mp-list setting-list">
      <div class="setting-row" @click="importFromFile">
        <span class="row-label"><i class="mgc_folder_3_line row-ic"></i>从文件导入插件</span>
        <i class="mgc_arrow_right_line row-arrow"></i>
      </div>
      <div class="setting-row" @click="showPluginUrlInput = !showPluginUrlInput">
        <span class="row-label"><i class="mgc_link_line row-ic"></i>从 URL 导入插件</span>
        <i class="mgc_arrow_right_line row-arrow"></i>
      </div>
      <div v-if="showPluginUrlInput" class="url-input-row">
        <div class="mp-input">
          <input v-model="pluginUrl" placeholder="https://…/plugin.js" @keyup.enter="importFromUrl" />
        </div>
        <button class="mp-btn-primary url-btn" @click="importFromUrl">导入</button>
      </div>
    </div>

    <div v-if="pluginsLoading" class="mp-loading"><n-spin size="small" /></div>
    <div v-else class="mp-list setting-list">
      <div v-if="!pluginStore.installedPlugins.length" class="empty-plugins">
        尚未安装插件，安装后可解锁多平台音源
      </div>
      <div v-for="p in pluginStore.installedPlugins" :key="p.id" class="plugin-row">
        <div class="plugin-main">
          <div class="plugin-name">
            {{ p.info.name }}
            <span v-if="p.isUIWidget" class="plugin-badge widget">UI 组件</span>
            <span v-else-if="p.status === 'active'" class="plugin-badge">已激活</span>
          </div>
          <div class="plugin-sub">
            v{{ p.info.version }} · {{ p.info.author }}
            <template v-if="!p.isUIWidget">
              · {{ p.sources.map((s) => s.name).join(' / ') }}
            </template>
          </div>
        </div>
        <div class="plugin-actions">
          <span v-if="p.isUIWidget" class="plugin-btn" @click="openWidget(p)">打开</span>
          <span v-else class="plugin-btn" @click="togglePlugin(p.id, p.status)">
            {{ p.status === 'active' ? '停用' : '激活' }}
          </span>
          <span class="plugin-btn danger" @click="uninstallPlugin(p.id, p.info.name)">卸载</span>
        </div>
      </div>
    </div>

    <!-- UI 组件插件面板 -->
    <PluginWidgetSheet v-model:show="showWidgetSheet" :plugin="currentWidgetPlugin" />
  </div>
</template>
