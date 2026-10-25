<script setup lang="ts">
import type { PlayerSong } from '../../stores/playerStore'
import { formatDuration } from '../helpers'
import { rememberMorphOrigin } from '../composables/useMorphOrigin'
import MobileCover from './MobileCover.vue'

const props = defineProps<{
  song: PlayerSong
  index?: number
  playing?: boolean
  showCover?: boolean
  showIndex?: boolean
  tag?: string
  tagType?: 'local' | 'online'
}>()

const emit = defineEmits<{
  (e: 'click', song: PlayerSong): void
  (e: 'action', song: PlayerSong): void
}>()

/**
 * 「从哪来回哪去」：点击歌曲行时显式把该行记为播放页的展开原点，
 * 播放页从这一行放大展开、收起时也回到这一行，
 * 不会再因为上一次记录的底栏控制面板位置而「从底部音乐控制区放大」。
 */
function onClick(event: MouseEvent): void {
  rememberMorphOrigin(event.currentTarget as HTMLElement | null)
  emit('click', props.song)
}
</script>

<template>
  <div class="song-row" data-morph-origin :class="{ playing }" @click="onClick">
    <div v-if="showIndex" class="row-index" :class="{ 'is-playing': playing }">
      <i v-if="playing" class="mgc_volume_line"></i>
      <span v-else>{{ (index ?? 0) + 1 }}</span>
    </div>
    <MobileCover v-if="showCover" :src="song.cover" class="row-cover" radius="14px" />
    <div class="row-main">
      <div class="row-title">{{ song.title }}</div>
      <div class="row-sub">
        <span v-if="tag" class="row-tag" :class="tagType === 'local' ? 'tag-local' : 'tag-online'">{{ tag }}</span>
        <span class="row-artist">{{ song.artist }}</span>
        <span v-if="song.album" class="row-album"> · {{ song.album }}</span>
      </div>
    </div>
    <div v-if="song.durationMs" class="row-duration">{{ formatDuration(song.durationMs) }}</div>
    <div class="row-action" @click.stop="emit('action', song)">
      <slot name="action">
        <i class="mgc_more_2_line"></i>
      </slot>
    </div>
  </div>
</template>

<style scoped>
.song-row {
  display: flex;
  align-items: center;
  padding: 9px 16px;
  gap: 12px;
  min-height: 60px;
  box-sizing: border-box;
  transition:
    background 0.15s ease,
    transform 0.15s cubic-bezier(0.32, 0.72, 0.35, 1);
}

.song-row:active {
  background: var(--mp-fill, rgba(120, 120, 128, 0.12));
}

.row-index {
  width: 26px;
  text-align: center;
  color: var(--mp-text-3, rgba(60, 60, 67, 0.33));
  font-size: 13px;
  font-weight: 500;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.row-index.is-playing {
  color: var(--mp-primary, #2c8efd);
}

.row-cover {
  width: 46px;
  height: 46px;
  flex-shrink: 0;
  box-shadow: var(--mp-shadow-sm, 0 2px 8px rgba(0, 0, 0, 0.04));
}

.row-main {
  flex: 1;
  min-width: 0;
}

.row-title {
  font-size: 15px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--mp-text, #1c1c1e);
}

.playing .row-title {
  color: var(--mp-primary, #2c8efd);
  font-weight: 600;
}

.row-sub {
  font-size: 12px;
  color: var(--mp-text-2, rgba(60, 60, 67, 0.6));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 3px;
}

.row-tag {
  display: inline-block;
  padding: 0 5px;
  margin-right: 5px;
  border-radius: 4px;
  font-size: 10px;
  line-height: 16px;
  font-weight: 600;
  vertical-align: 1px;
}

.row-tag.tag-local {
  color: #2c8efd;
  background: rgba(44, 142, 253, 0.12);
}

.row-tag.tag-online {
  color: #f2732c;
  background: rgba(242, 115, 44, 0.12);
}

.row-duration {
  font-size: 11px;
  color: var(--mp-text-3, rgba(60, 60, 67, 0.33));
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.row-action {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--mp-text-3, rgba(60, 60, 67, 0.33));
  font-size: 18px;
  flex-shrink: 0;
  transition: transform 0.15s cubic-bezier(0.32, 0.72, 0.35, 1);
}

.row-action:active {
  transform: scale(0.85);
}
</style>
