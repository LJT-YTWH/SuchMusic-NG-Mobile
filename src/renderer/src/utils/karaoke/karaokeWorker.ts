/// <reference lib="webworker" />
// 逐字歌词生成 Worker：在独立线程中执行 DSP + DP 对齐，避免阻塞 UI/播放
import { generateKaraokeLrc, type KaraokeAlgo } from './aligner'

const ctx = self as unknown as Worker

ctx.onmessage = (ev: MessageEvent) => {
  const { samples, lrc, algo } = ev.data as {
    samples: ArrayBuffer
    lrc: string
    algo: KaraokeAlgo
  }
  try {
    const pcm = new Float32Array(samples)
    const out = generateKaraokeLrc(pcm, lrc, algo, (stage) => {
      ctx.postMessage({ type: 'progress', stage })
    })
    ctx.postMessage({ type: 'done', lrc: out })
  } catch (e) {
    ctx.postMessage({ type: 'error', error: e instanceof Error ? e.message : String(e) })
  }
}
