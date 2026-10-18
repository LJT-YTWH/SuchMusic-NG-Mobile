<script setup lang="ts">
import { computed } from 'vue'
import { usePlayerStore } from '../../stores/playerStore'
import { webAudioEngine } from '../../audio/audio-engine'
import MobileCover from '../../mobile/components/MobileCover.vue'

const player = usePlayerStore()

const progressPercent = computed(() => {
  const duration = player.currentSong?.durationMs ?? 0
  if (!duration || duration <= 0) return 0
  return Math.min((player.positionMs / duration) * 100, 100)
})

const togglePlay = async (): Promise<void> => {
  if (!player.currentSong) return
  if (player.isPlaying) {
    await webAudioEngine.pause()
    player.setPlaying(false)
  } else {
    const ok = await webAudioEngine.play()
    if (ok) {
      player.setPlaying(true)
    } else {
      // 引擎内无音频源（应用重启后恢复状态）：交由 PlayerBar 重新加载并播放
      window.dispatchEvent(new CustomEvent('player:replay-current'))
    }
  }
}

const openPlayerPage = (): void => {
  player.setPlayerPageShown(true)
}
</script>

<template>
  <div class="minibar" @click="openPlayerPage">
    <MobileCover :src="player.currentSong?.cover" class="cover" radius="14px" />
    <div class="info">
      <div class="title">{{ player.currentSong?.title || '未在播放' }}</div>
      <div class="artist">{{ player.currentSong?.artist || 'SuchMusic' }}</div>
    </div>
    <button class="btn play" @click.stop="togglePlay">
      <i :class="player.isPlaying ? 'mgc_pause_fill' : 'mgc_play_fill'"></i>
    </button>

    <!-- 底部细进度条 -->
    <div class="progress">
      <div class="progress-fill" :style="{ transform: `scaleX(${progressPercent / 100})` }" />
    </div>
  </div>
</template>

<style scoped>
.minibar {
  display: flex;
  align-items: center;
  width: 100%;
  height: 100%;
  gap: 10px;
  position: relative;
  transition: transform 0.15s cubic-bezier(0.32, 0.72, 0.35, 1);
}

.minibar:active {
  transform: scale(0.985);
}

.cover {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  object-fit: cover;
  background: var(--mp-bg-secondary, #e5e5e5);
  flex-shrink: 0;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.14);
}

.info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.title {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--mp-text, #1c1c1e);
}

.artist {
  font-size: 11.5px;
  color: var(--mp-text-2, rgba(60, 60, 67, 0.6));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--mp-text, #1c1c1e);
  font-size: 22px;
  padding: 0;
  flex-shrink: 0;
  transition:
    transform 0.15s cubic-bezier(0.32, 0.72, 0.35, 1),
    opacity 0.15s ease;
}

.btn:active {
  transform: scale(0.85);
  opacity: 0.6;
}

.btn.play {
  width: 42px;
  height: 42px;
  background: var(--mp-primary, #2c8efd);
  color: #fff;
  font-size: 21px;
  margin-right: 4px;
  box-shadow: 0 5px 12px color-mix(in srgb, var(--mp-primary, #2c8efd) 32%, transparent);
}

.progress {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 0;
  height: 2.5px;
  border-radius: 2px;
  background: var(--mp-fill, rgba(120, 120, 128, 0.12));
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  width: 100%;
  border-radius: 2px;
  background: var(--mp-primary, #2c8efd);
  transform-origin: left center;
  transition: transform 0.25s linear;
}
</style>
