<script setup lang="ts">
// CeruPlugins(window.source) UI 组件插件的移动端面板：
// 将插件声明的 uiSchema 渲染为底部弹层，字段变更/按钮动作转发给 Widget 宿主。
import { ref, reactive, watch, onBeforeUnmount } from 'vue'
import { useMessage } from 'naive-ui'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
// 仅类型导入：widgetHost（含 node-forge 等大依赖）在打开面板时才动态加载，
// 避免其进入主入口 chunk 图导致构建内存峰值过高
import type {
  MobileUiWidgetHost,
  UiSchemaField,
  UiSchemaAction
} from '../../platform/mobile/pluginHost/widgetHost'
import type { Plugin } from '../../types/plugin'

const props = defineProps<{
  show: boolean
  plugin: Plugin | null
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
}>()

const message = useMessage()

const loading = ref(false)
const loadError = ref('')
const runningAction = ref('')
const widgetProps = reactive<Record<string, any>>({})

let host: MobileUiWidgetHost | null = null
const uiSchema = ref<MobileUiWidgetHost['uiSchema']>(null)

function close(): void {
  emit('update:show', false)
}

function disposeHost(): void {
  host?.dispose()
  host = null
  uiSchema.value = null
  loadError.value = ''
  runningAction.value = ''
  for (const k of Object.keys(widgetProps)) delete widgetProps[k]
}

async function loadWidget(): Promise<void> {
  if (!props.plugin) return
  loading.value = true
  loadError.value = ''
  try {
    // 必须显式指定 UTF8：v8 原生层不传 encoding 时 readFile 返回 Base64 字符串，
    // 直接当 JS 执行会报 "Invalid or unexpected token"
    const r = await Filesystem.readFile({
      path: `plugins/${props.plugin.id}.js`,
      directory: Directory.Data,
      encoding: Encoding.UTF8
    })
    const code =
      typeof r.data === 'string'
        ? r.data
        : new TextDecoder().decode(await (r.data as Blob).arrayBuffer())

    const { MobileUiWidgetHost: WidgetHost } = await import(
      '../../platform/mobile/pluginHost/widgetHost'
    )
    const h = new WidgetHost({
      propsTarget: widgetProps,
      notify: (msg, type) => {
        if (type === 'success') message.success(msg)
        else if (type === 'error') message.error(msg)
        else if (type === 'warning') message.warning(msg)
        else message.info(msg)
      }
    })
    await h.load(code)
    host = h
    if (!h.uiSchema) {
      loadError.value = '该组件插件未声明 uiSchema，无法渲染界面'
    } else {
      uiSchema.value = h.uiSchema
    }
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

watch(
  () => props.show,
  (show) => {
    if (show) {
      disposeHost()
      void loadWidget()
    } else {
      disposeHost()
    }
  }
)

onBeforeUnmount(disposeHost)

// ==================== 字段与动作 ====================

function fieldValue(key?: string): string {
  if (!key) return ''
  const v = widgetProps[key]
  return v === undefined || v === null ? '' : String(v)
}

function onInput(field: UiSchemaField, e: Event): void {
  const value = (e.target as HTMLInputElement).value
  if (field.key) widgetProps[field.key] = value
  if (host && field.key) void host.onFieldChange(field.key, value)
}

function onBrowse(field: UiSchemaField): void {
  if (host && field.key && field.action) void host.browseField(field.key, field.action)
}

async function runAction(action: UiSchemaAction): Promise<void> {
  if (!host || !action.method || runningAction.value) return
  runningAction.value = action.method
  try {
    await host.callAction(action.method)
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  } finally {
    runningAction.value = ''
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="mp-sheet-mask" @click="close"></div>
    <div v-if="show" class="mp-sheet widget-sheet">
      <div class="sheet-grabber"></div>
      <div class="sheet-title widget-title">
        <span>{{ plugin?.info?.name || '组件插件' }}</span>
        <i class="mgc_close_line widget-close" @click="close"></i>
      </div>

      <div class="widget-body">
        <div v-if="loading" class="widget-hint">正在加载组件...</div>
        <div v-else-if="loadError" class="widget-hint error">{{ loadError }}</div>

        <template v-else-if="uiSchema">
          <div v-for="(section, si) in uiSchema.sections" :key="si" class="widget-section">
            <div v-if="section.title" class="mp-section-title">{{ section.title }}</div>

            <!-- 字段 -->
            <div v-for="(field, fi) in section.fields || []" :key="fi" class="widget-field">
              <!-- 输入框 -->
              <template v-if="field.type === 'input'">
                <div class="field-label">{{ field.label }}</div>
                <div class="field-input-row">
                  <div class="mp-input field-input">
                    <input
                      :value="fieldValue(field.key)"
                      :placeholder="field.placeholder || ''"
                      :readonly="!!field.readonly"
                      @input="onInput(field, $event)"
                    />
                  </div>
                  <button
                    v-if="field.action === 'browse' || field.action === 'browseDir'"
                    class="browse-btn"
                    @click="onBrowse(field)"
                  >
                    <i class="mgc_folder_3_line"></i>
                  </button>
                </div>
              </template>

              <!-- 只读文本 -->
              <template v-else-if="field.type === 'text'">
                <div class="field-label">{{ field.label }}</div>
                <div class="field-text">{{ fieldValue(field.key) || '—' }}</div>
              </template>

              <!-- 状态标签 -->
              <template v-else-if="field.type === 'tag'">
                <span class="widget-tag">{{ fieldValue(field.key) || '—' }}</span>
              </template>

              <!-- 日志 -->
              <template v-else-if="field.type === 'log'">
                <pre class="widget-log">{{ fieldValue(field.key) || '暂无输出' }}</pre>
              </template>

              <!-- 分割线 -->
              <template v-else-if="field.type === 'divider'">
                <div class="widget-divider"></div>
              </template>
            </div>

            <!-- 动作按钮 -->
            <div v-if="section.actions?.length" class="widget-actions">
              <button
                v-for="(action, ai) in section.actions"
                :key="ai"
                class="action-btn"
                :class="{
                  primary: action.variant === 'primary',
                  running: runningAction === action.method
                }"
                :disabled="!!runningAction"
                @click="runAction(action)"
              >
                {{ runningAction === action.method ? '执行中...' : action.label || action.method }}
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.widget-sheet {
  max-height: 88vh;
  display: flex;
  flex-direction: column;
}

.widget-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.widget-close {
  font-size: 20px;
  color: var(--mp-text-secondary, #888);
  padding: 4px;
}

.widget-body {
  overflow-y: auto;
  padding: 0 16px 24px;
  flex: 1;
}

.widget-hint {
  padding: 40px 0;
  text-align: center;
  font-size: 13px;
  color: var(--mp-text-secondary, #888);
}

.widget-hint.error {
  color: #ff4d4f;
}

.widget-section {
  margin-bottom: 8px;
}

.widget-field {
  margin-bottom: 12px;
}

.field-label {
  font-size: 12px;
  color: var(--mp-text-secondary, #888);
  margin-bottom: 6px;
}

.field-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.field-input {
  flex: 1;
}

.browse-btn {
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 10px;
  background: var(--mp-fill, rgba(127, 127, 127, 0.12));
  color: var(--mp-text, #333);
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.field-text {
  font-size: 13px;
  color: var(--mp-text, #333);
  word-break: break-all;
  padding: 8px 0;
}

.widget-tag {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  background: var(--mp-fill, rgba(127, 127, 127, 0.12));
  color: var(--mp-text, #333);
  margin-right: 8px;
  margin-bottom: 4px;
}

.widget-log {
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--mp-bg-secondary, rgba(127, 127, 127, 0.08));
  font-size: 11px;
  line-height: 1.6;
  max-height: 180px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--mp-text-secondary, #888);
  font-family: monospace;
}

.widget-divider {
  height: 0.5px;
  background: var(--mp-separator, rgba(127, 127, 127, 0.2));
  margin: 8px 0;
}

.widget-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 8px 0 12px;
}

.action-btn {
  flex: 1;
  min-width: 96px;
  height: 38px;
  border: none;
  border-radius: 10px;
  font-size: 13px;
  background: var(--mp-fill, rgba(127, 127, 127, 0.12));
  color: var(--mp-text, #333);
}

.action-btn.primary {
  background: var(--mp-primary, #ec4141);
  color: #fff;
}

.action-btn:disabled {
  opacity: 0.5;
}
</style>
