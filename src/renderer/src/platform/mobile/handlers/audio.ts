import { readFileArrayBuffer } from '../fsUtils'
import { emitChannel } from '../emitter'

let decodeContext: AudioContext | null = null

function getDecodeContext(): AudioContext {
  if (!decodeContext) {
    const Ctx =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    decodeContext = new Ctx()
  }
  return decodeContext
}

async function decodeFileToAudioBuffer(filePath: string): Promise<AudioBuffer> {
  const data = await readFileArrayBuffer(filePath)
  const ctx = getDecodeContext()
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume()
    } catch {
      // ignore
    }
  }
  return ctx.decodeAudioData(data)
}

// audio:decode —— 返回与 symphonia 解码器相同结构 { sampleRate, channels, data }
export async function audioDecode(filePath: string): Promise<{
  sampleRate: number
  channels: number
  data: number[]
}> {
  const buffer = await decodeFileToAudioBuffer(filePath)
  const channels = buffer.numberOfChannels
  const frames = buffer.length
  const data = new Array<number>(frames * channels)
  const channelData: Float32Array[] = []
  for (let c = 0; c < channels; c++) channelData.push(buffer.getChannelData(c))
  let idx = 0
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < channels; c++) {
      data[idx++] = channelData[c][f]
    }
  }
  return { sampleRate: buffer.sampleRate, channels, data }
}

// 流式解码状态
let streamCancelled = false

// audio:decode-stream:start（send 语义）
export function audioDecodeStreamStart(filePath: string): void {
  streamCancelled = false
  void (async () => {
    try {
      const buffer = await decodeFileToAudioBuffer(filePath)
      const channels = buffer.numberOfChannels
      const frames = buffer.length
      const sampleRate = buffer.sampleRate
      const framesPerChunk = 2048
      const channelData: Float32Array[] = []
      for (let c = 0; c < channels; c++) channelData.push(buffer.getChannelData(c))

      for (let offset = 0; offset < frames; offset += framesPerChunk) {
        if (streamCancelled) {
          emitChannel('audio:decode-stream:stopped')
          return
        }
        const chunkFrames = Math.min(framesPerChunk, frames - offset)
        const data = new Array<number>(chunkFrames * channels)
        let idx = 0
        for (let f = 0; f < chunkFrames; f++) {
          for (let c = 0; c < channels; c++) {
            data[idx++] = channelData[c][offset + f]
          }
        }
        const isLast = offset + chunkFrames >= frames
        emitChannel('audio:decode-stream:chunk', {
          sampleRate,
          channels,
          data,
          finished: isLast
        })
        if (isLast) {
          emitChannel('audio:decode-stream:finished')
          return
        }
        // 让出主线程，避免阻塞 UI
        await new Promise((r) => setTimeout(r, 0))
      }
      // 空文件
      if (frames === 0) emitChannel('audio:decode-stream:finished')
    } catch (error) {
      console.error('audio:decode-stream failed:', error)
      emitChannel('audio:decode-stream:error', String(error))
    }
  })()
}

export function audioDecodeStreamStop(): void {
  streamCancelled = true
}

// audio:load-file —— 返回 ArrayBuffer（与主进程一致）
export async function audioLoadFile(filePath: string): Promise<ArrayBuffer> {
  return readFileArrayBuffer(filePath)
}
