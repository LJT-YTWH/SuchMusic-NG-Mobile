// 逐字歌词生成引擎（主线程侧）：音频解码（22050Hz 单声道）+ Worker 调度
import { readFileArrayBuffer } from '../../platform/mobile/fsUtils'
import { SR, type KaraokeAlgo } from './aligner'
import { resampleLinear } from './dsp'

let decodeCtx: OfflineAudioContext | null = null

/** 解码音频文件为 22050Hz 单声道 Float32 PCM（解码时由 WebAudio 重采样） */
export async function decodeToMono(filePath: string): Promise<Float32Array> {
  const buf = await readFileArrayBuffer(filePath)
  const Ctx =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext
  if (!Ctx) throw new Error('当前环境不支持音频解码')
  if (!decodeCtx) decodeCtx = new Ctx(2, SR, SR)
  const audio = await decodeCtx.decodeAudioData(buf.slice(0))
  const len = audio.length
  const ch = audio.numberOfChannels
  const out = new Float32Array(len)
  for (let c = 0; c < ch; c++) {
    const data = audio.getChannelData(c)
    for (let i = 0; i < len; i++) out[i] += data[i] / ch
  }
  if (audio.sampleRate !== SR) return resampleLinear(out, audio.sampleRate, SR)
  return out
}

export interface KaraokeJob {
  promise: Promise<string | null>
  /** 取消生成：终止 Worker 并以 CANCELLED 错误拒绝 promise */
  cancel: () => void
}

/** 在 Worker 中运行逐字对齐算法 */
export function runKaraokeWorker(
  pcm: Float32Array,
  lrc: string,
  algo: KaraokeAlgo,
  onStage?: (stage: string) => void
): KaraokeJob {
  const worker = new Worker(new URL('./karaokeWorker.ts', import.meta.url), { type: 'module' })
  let rejectFn: (e: Error) => void = () => undefined
  let settled = false
  const promise = new Promise<string | null>((resolve, reject) => {
    rejectFn = reject
    worker.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as
        | { type: 'progress'; stage: string }
        | { type: 'done'; lrc: string | null }
        | { type: 'error'; error: string }
      if (msg.type === 'progress') {
        onStage?.(msg.stage)
      } else if (msg.type === 'done') {
        settled = true
        worker.terminate()
        resolve(msg.lrc)
      } else {
        settled = true
        worker.terminate()
        reject(new Error(msg.error))
      }
    }
    worker.onerror = (e) => {
      settled = true
      worker.terminate()
      reject(new Error(e.message || '生成失败'))
    }
  })
  const buf = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength)
  worker.postMessage({ samples: buf, lrc, algo }, [buf])
  return {
    promise,
    cancel: () => {
      if (settled) return
      settled = true
      worker.terminate()
      rejectFn(new Error('CANCELLED'))
    }
  }
}
