<script setup lang="ts">
import { useLandscape } from '../composables/useLandscape'
import MobileCardDialog from './MobileCardDialog.vue'

/**
 * 统一的二级弹层容器：
 * - 竖屏：直接弹出的深色卡片（不做展开动画）
 * - 横屏：沿用右侧滑入抽屉（mp-sheet）
 * 内容只写一次，避免两套模板重复。
 */
withDefaults(
  defineProps<{
    show: boolean
    title?: string
    meta?: string
  }>(),
  { title: '', meta: '' }
)

const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()

const { isLandscape } = useLandscape()

const close = (): void => emit('update:show', false)
</script>

<template>
  <MobileCardDialog
    v-if="!isLandscape"
    :show="show"
    :title="title"
    :meta="meta"
    @update:show="emit('update:show', $event)"
  >
    <slot />
  </MobileCardDialog>

  <Teleport v-else to="body">
    <div v-if="show" class="mp-sheet-mask" @click="close"></div>
    <div v-if="show" class="mp-sheet">
      <div class="sheet-grabber"></div>
      <div v-if="title" class="sheet-title">{{ title }}</div>
      <slot />
      <div class="sheet-bottom-space"></div>
    </div>
  </Teleport>
</template>
