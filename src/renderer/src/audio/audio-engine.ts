import type { DecodedAudio } from '../apis/audio-decoder.types'
import { usePlayerStore } from '../stores/playerStore'
import { isNativeMobile } from '../platform'

// 全局 Web Audio 引擎，用于统一管理播放
class WebAudioEngine {
  private audioContext: AudioContext | null = null
  private gainNode: GainNode | null = null
  private limiterNode: DynamicsCompressorNode | null = null
  private limiterStrength: number = 0.6 // 压限强度（0-1）
  private eqNodes: BiquadFilterNode[] = [] // 均衡器滤波节点
  private eqGains: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] // 各频段增益（dB）
  private eqEnabled: boolean = false // 是否启用均衡器
  // ---- 高级音效节点 ----
  private msMidLevel: GainNode | null = null // M/S 矩阵：中声道增益（人声消除时置 0）
  private msSideLevel: GainNode | null = null // M/S 矩阵：侧声道增益（立体声宽度）
  private msMidLowLevel: GainNode | null = null // M/S 矩阵：中声道低频补偿增益（人声消除时保留鼓/贝斯）
  private pannerNode: StereoPannerNode | null = null // 声像平衡
  private loudnessNode: DynamicsCompressorNode | null = null // 响度均衡（动态压缩）
  private makeupNode: GainNode | null = null // 响度均衡补偿增益
  // ---- 高级音效参数（持久保存：AudioContext 懒创建，节点不存在时先存状态，建图后回放） ----
  private playbackRate: number = 1 // 播放速度
  private preservePitch: boolean = true // 变速保持音调（元素路径）
  private loudnessActive: boolean = false // 响度均衡开关
  private loudnessStrengthValue: number = 0.5 // 响度均衡强度
  private balanceValue: number = 0 // 声像平衡
  private msMidGain: number = 1 // M/S 矩阵：中声道增益（0 = 人声消除）
  private msSideGain: number = 1 // M/S 矩阵：侧声道增益（立体声宽度）
  private crossfadeEnabled: boolean = false
  private crossfadeMs: number = 6000
  private endingFade: boolean = false // 已触发结尾淡出
  private currentSource: AudioBufferSourceNode | null = null
  private currentBuffer: AudioBuffer | null = null
  private startOffset: number = 0
  private startTime: number = 0
  private streamSources: AudioBufferSourceNode[] = []
  private streamSampleRate: number | null = null
  private streamChannels: number | null = null
  private streamCursorTime = 0
  private mediaElement: HTMLAudioElement | null = null
  // 移动端远程 URL 直出元素：不接入 AudioContext（跨域无 CORS 会被静音），流式秒开
  private directElement: HTMLAudioElement | null = null
  private positionTimer: number | null = null
  private volume: number = 1
  // 播放会话令牌：stop/切歌时递增，用于丢弃旧播放源的 ended 回调
  private playSession = 0

  // 确保 AudioContext 初始化
  private ensureContext(): void {
    if (this.audioContext) return

    const Ctx =
      window.AudioContext ||
      // 兼容部分旧浏览器
      (window as any).webkitAudioContext

    const context = new Ctx()
    const gain = context.createGain()
    const limiter = context.createDynamicsCompressor()

    // 创建 10 段均衡器：低频到高频
    const freqs = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
    this.eqNodes = freqs.map((freq) => {
      const biquad = context.createBiquadFilter()
      biquad.type = 'peaking'
      biquad.frequency.value = freq
      biquad.Q.value = 1
      biquad.gain.value = 0
      return biquad
    })

    // ---- 高级音效节点 ----
    // M/S 矩阵：把 L/R 拆成 中(mid)/侧(side) 两路，
    // mid = 0.5L + 0.5R，side = 0.5L - 0.5R；
    // L' = midLevel*mid + midLowLevel*low(mid) + sideLevel*side，
    // R' = midLevel*mid + midLowLevel*low(mid) - sideLevel*side。
    // 默认 midLevel=1、midLowLevel=0、sideLevel=1 时数学上完全透明；
    // 立体声扩展调 sideLevel，人声消除把 midLevel 置 0，
    // 同时用 midLowLevel 恢复 250Hz 以下的居中低频（鼓/贝斯），避免伴奏发空。
    const msSplitter = context.createChannelSplitter(2)
    const msMerger = context.createChannelMerger(2)
    const midFromL = context.createGain(); midFromL.gain.value = 0.5
    const midFromR = context.createGain(); midFromR.gain.value = 0.5
    const sideFromL = context.createGain(); sideFromL.gain.value = 0.5
    const sideFromR = context.createGain(); sideFromR.gain.value = -0.5
    const midSum = context.createGain()
    const sideSum = context.createGain()
    const midLevel = context.createGain()
    const sideLevel = context.createGain()
    const sideInvert = context.createGain(); sideInvert.gain.value = -1
    // 中声道低频通路（人声消除时补偿低频，默认增益 0 即透明）
    const midLowpass = context.createBiquadFilter()
    midLowpass.type = 'lowpass'
    midLowpass.frequency.value = 250
    midLowpass.Q.value = 0.7
    const midLowLevel = context.createGain()
    midLowLevel.gain.value = 0

    msSplitter.connect(midFromL, 0); midFromL.connect(midSum)
    msSplitter.connect(midFromR, 1); midFromR.connect(midSum)
    msSplitter.connect(sideFromL, 0); sideFromL.connect(sideSum)
    msSplitter.connect(sideFromR, 1); sideFromR.connect(sideSum)
    midSum.connect(midLevel)
    sideSum.connect(sideLevel)
    midSum.connect(midLowpass)
    midLowpass.connect(midLowLevel)
    midLevel.connect(msMerger, 0, 0)
    midLevel.connect(msMerger, 0, 1)
    midLowLevel.connect(msMerger, 0, 0)
    midLowLevel.connect(msMerger, 0, 1)
    sideLevel.connect(msMerger, 0, 0)
    sideLevel.connect(sideInvert)
    sideInvert.connect(msMerger, 0, 1)

    const panner = context.createStereoPanner()
    const loudness = context.createDynamicsCompressor()
    const makeup = context.createGain()

    // 连接顺序：增益 -> M/S 矩阵 -> 声像 -> EQ 链 -> 响度均衡 -> 补偿增益 -> 压限器 -> 输出
    gain.connect(msSplitter)
    msMerger.connect(panner)
    panner.connect(this.eqNodes[0])
    for (let i = 0; i < this.eqNodes.length - 1; i += 1) {
      this.eqNodes[i].connect(this.eqNodes[i + 1])
    }
    this.eqNodes[this.eqNodes.length - 1].connect(loudness)
    loudness.connect(makeup)
    makeup.connect(limiter)
    limiter.connect(context.destination)

    this.audioContext = context
    this.gainNode = gain
    this.limiterNode = limiter
    this.msMidLevel = midLevel
    this.msSideLevel = sideLevel
    this.msMidLowLevel = midLowLevel
    this.pannerNode = panner
    this.loudnessNode = loudness
    this.makeupNode = makeup

    // 根据当前设定应用压限与 EQ 参数
    this.applyLimiterStrength(this.limiterStrength)
    this.applyEqSettings()
    // 回放建图前已保存的高级音效状态（AudioContext 懒创建，早先的 setter 只落了状态）
    this.setLoudness(this.loudnessActive, this.loudnessStrengthValue)
    this.setBalance(this.balanceValue)
    this.setMsMatrix(this.msMidGain, this.msSideGain)
  }

  // 停止位置更新，防止切歌时进度条跳变
  private stopProgressUpdates(): void {
    if (this.positionTimer !== null) {
      window.clearInterval(this.positionTimer)
      this.positionTimer = null
    }
    if (this.mediaElement) {
      this.mediaElement.ontimeupdate = null
    }
  }

  // 停止当前播放
  stop(): void {
    // 使旧播放源的 ended 回调失效
    this.playSession++

    // 停止进度更新
    this.stopProgressUpdates()

    // 停止并释放直出播放元素
    if (this.directElement) {
      const el = this.directElement
      this.directElement = null
      el.onloadedmetadata = null
      el.ontimeupdate = null
      el.onended = null
      el.onerror = null
      el.pause()
      el.removeAttribute('src')
      el.load()
    }

    if (this.currentSource) {
      this.currentSource.stop()
      this.currentSource.disconnect()
      this.currentSource = null
    }

    // 停止所有正在流式播放的音频
    if (this.streamSources.length > 0) {
      this.streamSources.forEach((source) => {
        try {
          source.stop()
          source.disconnect()
        } catch {
          // 忽略停止过程中的异常
        }
      })
      this.streamSources = []
    }

    this.streamSampleRate = null
    this.streamChannels = null
    this.streamCursorTime = 0

    // 停止并重置基于 HTMLAudioElement 的播放
    if (this.mediaElement) {
      this.mediaElement.pause()
      this.mediaElement.currentTime = 0
    }

    this.currentBuffer = null
    this.startOffset = 0
    this.startTime = 0
    this.endingFade = false
  }

  private fadeTo(target: number, durationMs: number): void {
    if (!this.audioContext || !this.gainNode) return
    const now = this.audioContext.currentTime
    const gain = this.gainNode.gain
    const current = gain.value
    const durationSec = Math.max(durationMs, 0) / 1000
    gain.cancelScheduledValues(now)
    gain.setValueAtTime(current, now)
    gain.linearRampToValueAtTime(target, now + durationSec)
  }

  public async fadeOutAndStop(durationMs: number): Promise<void> {
    // 立即停止进度更新，防止切歌时进度条跳变
    this.stopProgressUpdates()

    if (!this.audioContext || !this.gainNode) {
      this.stop()
      return
    }
    const originalVolume = this.volume
    this.fadeTo(0, durationMs)
    await new Promise((resolve) => setTimeout(resolve, durationMs))
    this.stop()
    this.gainNode.gain.value = 0
    this.volume = originalVolume
  }

  // 暂停播放
  async pause(): Promise<void> {
    // 直出元素不经 AudioContext，必须直接暂停
    if (this.directElement && !this.directElement.paused) {
      this.directElement.pause()
    }
    if (this.mediaElement && !this.currentBuffer && !this.mediaElement.paused) {
      this.mediaElement.pause()
    }
    if (this.audioContext?.state === 'running') {
      await this.audioContext.suspend()
    }
    if (this.positionTimer !== null) {
      window.clearInterval(this.positionTimer)
      this.positionTimer = null
    }
  }

  // 恢复播放（同时恢复 AudioContext 和播放源）
  async play(): Promise<boolean> {
    this.ensureContext()
    if (this.audioContext?.state === 'suspended') {
      await this.audioContext.resume()
    }

    if (this.directElement && !this.currentBuffer) {
      // 恢复直出播放
      try {
        await this.directElement.play()
        return true
      } catch (e) {
        console.error('Failed to play direct element', e)
        return false
      }
    }

    if (this.mediaElement && !this.currentBuffer) {
      // 恢复 HTMLAudioElement 播放
      // 注意：进度由 ontimeupdate 上报，不能启动 positionTimer，
      // 否则两套进度源交替写入会导致进度条反复前进后退
      try {
        await this.mediaElement.play()
        this.fadeTo(this.volume, 200)
        return true
      } catch (e) {
        console.error('Failed to play media element', e)
        return false
      }
    } else if (this.currentBuffer) {
      // 恢复 Buffer 播放
      // 如果当前没有 source 在播放（例如刚加载完或者已停止），则重新开始
      if (!this.currentSource) {
        const p = usePlayerStore()
        const offset = p.positionMs / 1000
        this.playBuffer(this.currentBuffer, offset)
        this.gainNode!.gain.value = 0
        this.fadeTo(this.volume, 200)
      }
      // 恢复位置更新定时器
      this.startPositionTimer()
      return true
    }
    
    return false
  }

  // 仅恢复 AudioContext（不触发播放源的 play）
  async resume(): Promise<void> {
    if (this.audioContext?.state === 'suspended') {
      await this.audioContext.resume()
    }
    
    // 恢复位置更新定时器（仅限 Buffer 播放；mediaElement 走 ontimeupdate）
    if (this.positionTimer === null && this.currentSource && this.audioContext) {
      this.startPositionTimer()
    }
  }

  private startPositionTimer() {
    if (this.positionTimer !== null) {
      window.clearInterval(this.positionTimer)
    }

    const p = usePlayerStore()
    const durationMs = p.currentSong?.durationMs ?? 0 // 当前歌曲总时长（毫秒）

    this.positionTimer = window.setInterval(() => {
      // 该定时器基于 startTime/startOffset，仅对 Buffer 播放有意义
      if (!this.audioContext || !this.currentSource) return

      // 计算当前播放位置：(当前时间 - 播放开始时间) × 播放速率 + 偏移量
      const elapsed = (this.audioContext.currentTime - this.startTime) * this.playbackRate
      const currentPos = (elapsed + this.startOffset) * 1000

      // 先做下限裁剪，避免出现负数
      let clamped = Math.max(currentPos, 0)

      // 当已知总时长时再做上限裁剪，避免出现“回跳到 0”现象
      if (durationMs > 0) {
        clamped = Math.min(clamped, durationMs)
      }

      // 临近结尾自动淡出（交叉淡入淡出）
      this.checkEndFade(clamped, durationMs)

      p.setPosition(clamped)
    }, 250)
  }

  // 播放指定的 buffer
  private playBuffer(buffer: AudioBuffer, offset: number) {
    if (!this.audioContext || !this.gainNode) return

    // 停止旧 source
    if (this.currentSource) {
      try {
        this.currentSource.stop()
        this.currentSource.disconnect()
      } catch (e) {
        // ignore
      }
    }

    const source = this.audioContext.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = this.playbackRate
    source.connect(this.gainNode)

    this.startOffset = offset
    this.startTime = this.audioContext.currentTime

    source.start(0, offset)
    this.currentSource = source

    // 自然播放结束 → 单曲循环重播或自动切下一首
    const session = this.playSession
    source.onended = () => {
      if (session !== this.playSession || this.currentSource !== source) return
      this.handleNaturalEnd()
    }

    this.startPositionTimer()
  }

  // 跳转到指定位置
  seek(positionMs: number) {
    // 跳转后取消结尾淡出状态（避免淡出中的音量残留）
    this.endingFade = false
    if (this.gainNode && this.audioContext) {
      this.gainNode.gain.cancelScheduledValues(this.audioContext.currentTime)
      this.gainNode.gain.value = this.volume
    }
    // 优先处理直出播放元素
    if (this.directElement && !this.currentBuffer) {
      this.directElement.currentTime = Math.max(positionMs / 1000, 0)
      const p = usePlayerStore()
      p.setPosition(positionMs)
      return
    }

    // 优先处理基于 HTMLAudioElement 的播放（例如 URL 播放）
    if (this.mediaElement && !this.currentBuffer) {
      const seconds = Math.max(positionMs / 1000, 0)
      this.mediaElement.currentTime = seconds

      const p = usePlayerStore()
      p.setPosition(positionMs)
      return
    }

    // 处理基于 AudioBuffer 的本地播放
    if (!this.currentBuffer || !this.audioContext) return
    const offset = positionMs / 1000
    this.playBuffer(this.currentBuffer, offset)
    
    // 立即更新 store
    const p = usePlayerStore()
    p.setPosition(positionMs)
  }


  // 设置全局音量（0.0 - 1.0）
  setVolume(volume: number): void {
    this.ensureContext()
    this.volume = Math.min(Math.max(volume, 0), 1)
    if (this.gainNode) {
      this.gainNode.gain.value = this.volume
    }
    // 直出元素不经增益节点，单独设置音量
    if (this.directElement) {
      this.directElement.volume = this.volume
    }
  }

  // 配置压限器强度（0-1，数值越大限制越明显）
  setLimiterStrength(strength: number): void {
    this.ensureContext()
    this.applyLimiterStrength(strength)
  }

  // 实际应用压限参数
  private applyLimiterStrength(strength: number): void {
    this.limiterStrength = Math.min(Math.max(strength, 0), 1)
    if (!this.limiterNode) return

    const s = this.limiterStrength
    // 阈值从 -2dB ~ -10dB
    const threshold = -2 - s * 8
    // 压缩比从 4:1 ~ 20:1
    const ratio = 4 + s * 16

    this.limiterNode.threshold.value = threshold
    this.limiterNode.knee.value = 0
    this.limiterNode.ratio.value = ratio
    this.limiterNode.attack.value = 0.003
    this.limiterNode.release.value = 0.1
  }

  // 设置均衡器启用状态
  setEqEnabled(enabled: boolean): void {
    this.ensureContext()
    this.eqEnabled = enabled
    this.applyEqSettings()
  }

  // 设置均衡器各频段增益（长度为 5 的数组，单位 dB）
  setEqGains(gains: number[]): void {
    this.ensureContext()
    if (!gains || gains.length === 0) return
    const bands = this.eqNodes.length || gains.length
    const clamped: number[] = []
    for (let i = 0; i < bands; i += 1) {
      const g = gains[i] ?? 0
      // 限制在 -12dB ~ +12dB
      clamped.push(Math.min(Math.max(g, -12), 12))
    }
    this.eqGains = clamped
    this.applyEqSettings()
  }

  // 应用当前 EQ 设置到滤波节点
  private applyEqSettings(): void {
    if (!this.eqNodes || this.eqNodes.length === 0) return

    for (let i = 0; i < this.eqNodes.length; i += 1) {
      const node = this.eqNodes[i]
      const gain = this.eqEnabled ? (this.eqGains[i] ?? 0) : 0
      node.gain.value = gain
    }
  }

  // ---- 高级音效：变速播放 ----
  setPlaybackRate(rate: number, preservePitch: boolean): void {
    const clamped = Math.min(Math.max(rate, 0.5), 2)
    // Buffer 播放：先把已走过的进度按旧速率折算进偏移，再换速率，避免进度跳变
    if (this.audioContext && this.currentSource && this.currentBuffer) {
      const posSec =
        (this.audioContext.currentTime - this.startTime) * this.playbackRate + this.startOffset
      this.startOffset = posSec
      this.startTime = this.audioContext.currentTime
      this.currentSource.playbackRate.value = clamped
    }
    this.playbackRate = clamped
    this.preservePitch = preservePitch
    this.applyRateToElement(this.mediaElement)
    this.applyRateToElement(this.directElement)
  }

  private applyRateToElement(el: HTMLAudioElement | null): void {
    if (!el) return
    el.playbackRate = this.playbackRate
    // 保持音调（各内核属性名兼容）
    ;(el as any).preservesPitch = this.preservePitch
    if ('mozPreservesPitch' in el) (el as any).mozPreservesPitch = this.preservePitch
    if ('webkitPreservesPitch' in el) (el as any).webkitPreservesPitch = this.preservePitch
  }

  // ---- 高级音效：响度均衡（动态范围压缩 + 补偿增益） ----
  setLoudness(enabled: boolean, strength: number): void {
    this.loudnessActive = enabled
    this.loudnessStrengthValue = Math.min(Math.max(strength, 0), 1)
    if (!this.loudnessNode || !this.makeupNode) return
    const s = this.loudnessStrengthValue
    if (!enabled || s <= 0) {
      // 透明：阈值 0、压缩比 1、补偿 1
      this.loudnessNode.threshold.value = 0
      this.loudnessNode.knee.value = 0
      this.loudnessNode.ratio.value = 1
      this.makeupNode.gain.value = 1
      return
    }
    this.loudnessNode.threshold.value = -8 - s * 22 // -8 ~ -30 dB
    this.loudnessNode.knee.value = 6
    this.loudnessNode.ratio.value = 1 + s * 7 // 1:1 ~ 8:1
    this.loudnessNode.attack.value = 0.02
    this.loudnessNode.release.value = 0.3
    this.makeupNode.gain.value = Math.pow(10, (s * 6) / 20) // 0 ~ +6dB 补偿
  }

  // ---- 高级音效：声像平衡 ----
  setBalance(pan: number): void {
    this.balanceValue = Math.min(Math.max(pan, -1), 1)
    if (!this.pannerNode) return
    this.pannerNode.pan.value = this.balanceValue
  }

  // ---- 高级音效：M/S 矩阵（立体声扩展 / 人声消除） ----
  setMsMatrix(midGain: number, sideGain: number): void {
    this.msMidGain = Math.min(Math.max(midGain, 0), 1)
    this.msSideGain = Math.min(Math.max(sideGain, 0), 2)
    if (!this.msMidLevel || !this.msSideLevel) return
    this.msMidLevel.gain.value = this.msMidGain
    this.msSideLevel.gain.value = this.msSideGain
    // 人声消除（中声道被切）时，恢复 250Hz 以下的居中低频（鼓/贝斯通常居中，
    // 全切会让伴奏发空发飘）；中声道增益为 1（未消除）时必须为 0，否则低频加倍
    if (this.msMidLowLevel) {
      this.msMidLowLevel.gain.value = (1 - this.msMidGain) * 0.9
    }
  }

  // 是否有依赖 WebAudio 图的高级音效/EQ 生效（直出元素路径无法处理这些效果）
  requiresAudioGraph(): boolean {
    return (
      this.eqEnabled ||
      this.loudnessActive ||
      this.balanceValue !== 0 ||
      this.msMidGain < 1 ||
      this.msSideGain !== 1
    )
  }

  // ---- 高级音效：交叉淡入淡出 ----
  setCrossfade(enabled: boolean, seconds: number): void {
    this.crossfadeEnabled = enabled
    this.crossfadeMs = Math.min(Math.max(seconds, 1), 12) * 1000
  }

  // 歌曲起始淡入时长（未开交叉淡入淡出时保持 200ms 快速淡入）
  private fadeInMs(): number {
    return this.crossfadeEnabled ? this.crossfadeMs : 200
  }

  // 临近自然结束时自动淡出（每 250ms 进度 tick 调用）
  private checkEndFade(positionMs: number, durationMs: number): void {
    if (!this.crossfadeEnabled || this.endingFade) return
    if (durationMs <= 0) return
    const remaining = durationMs - positionMs
    if (remaining > 0 && remaining <= this.crossfadeMs) {
      this.endingFade = true
      this.fadeTo(0, Math.max(remaining, 50))
    }
  }

  // 使用解码好的 PCM 数据播放
  async playDecodedAudio(decoded: DecodedAudio): Promise<void> {
    this.ensureContext()
    if (!this.audioContext || !this.gainNode) return

    await this.fadeOutAndStop(200)

    // 同时兼容 sample_rate / sampleRate 两种字段命名
    const sampleRate =
      (decoded as any).sample_rate ?? (decoded as any).sampleRate

    const channels = decoded.channels
    const totalSamples = decoded.data.length
    const totalFrames = totalSamples / channels

    // 控制首帧准备时间：只构造前 1 秒的缓冲区
    const effectiveSampleRate = sampleRate || this.audioContext.sampleRate
    const maxFrames = Math.min(
      totalFrames,
      Math.floor(effectiveSampleRate * 1) // 1 秒
    )

    const buffer = this.audioContext.createBuffer(
      channels,
      maxFrames,
      effectiveSampleRate
    )

    // 将交错布局的数据拆分填充到各个声道，只处理前 1 秒的数据
    for (let channelIndex = 0; channelIndex < channels; channelIndex += 1) {
      const channelData = buffer.getChannelData(channelIndex)
      for (let frameIndex = 0; frameIndex < maxFrames; frameIndex += 1) {
        const sourceIndex = frameIndex * channels + channelIndex
        channelData[frameIndex] = decoded.data[sourceIndex] ?? 0
      }
    }

    const source = this.audioContext.createBufferSource()
    source.buffer = buffer
    source.connect(this.gainNode)

    source.start()
    this.currentSource = source

    this.gainNode.gain.value = 0
    this.fadeTo(this.volume, 200)
  }

  // 使用原始文件二进制数据播放
  async playFromFileData(data: ArrayBuffer): Promise<void> {
    await this.loadFromFileData(data)
    if (this.audioContext?.state === 'suspended') {
      await this.audioContext.resume()
    }
    if (this.currentBuffer) {
      this.playBuffer(this.currentBuffer, 0)
      this.gainNode!.gain.value = 0
      this.fadeTo(this.volume, this.fadeInMs())
    }
  }

  // 加载文件数据但不播放
  async loadFromFileData(data: ArrayBuffer): Promise<void> {
    this.ensureContext()
    if (!this.audioContext || !this.gainNode) return

    await this.fadeOutAndStop(200)

    const bufferCopy = data.slice(0)
    const audioBuffer = await this.audioContext.decodeAudioData(bufferCopy)
    const durationMs = audioBuffer.duration * 1000

    const player = usePlayerStore()
    // 同步总时长到全局 store
    player.setDuration(durationMs)

    this.currentBuffer = audioBuffer
  }

  // 通过 URL 播放音频
  async playFromUrl(url: string): Promise<void> {
    // 移动端：远程 URL 用 HTMLAudioElement 直出流式播放。
    // 不接入 WebAudio（跨域无 CORS 会被静音），但秒开、不下载整文件、不阻塞主线程。
    if (isNativeMobile) {
      // 高级音效/EQ 依赖 WebAudio 图，直出元素完全旁路处理链（人声消除等会无效），
      // 此时必须先下载再解码播放（与「开启高级音效需先下载」的提示一致）
      if (this.requiresAudioGraph()) {
        console.log('[audio-engine] 高级音效已启用，在线音频先下载再解码播放:', url)
        const data = await this.downloadUrlAsArrayBuffer(url)
        await this.playFromFileData(data)
        return
      }
      await this.playDirectUrl(url)
      return
    }
    await this.loadFromUrl(url)
    if (this.mediaElement) {
      if (this.audioContext!.state === 'suspended') {
        await this.audioContext!.resume()
      }
      await this.mediaElement.play()
      this.gainNode!.gain.value = 0
      this.fadeTo(this.volume, this.fadeInMs())
    }
  }

  // 移动端：本地文件流式播放（经 Capacitor 文件桥，与应用同域，可走 WebAudio/EQ）
  async playFromFilePath(filePath: string): Promise<void> {
    const { Capacitor } = await import('@capacitor/core')
    const src = Capacitor.convertFileSrc(filePath)
    await this.loadFromUrl(src)
    if (this.mediaElement) {
      if (this.audioContext!.state === 'suspended') {
        await this.audioContext!.resume()
      }
      await this.mediaElement.play()
      this.gainNode!.gain.value = 0
      this.fadeTo(this.volume, this.fadeInMs())
    }
  }

  // 移动端：远程 URL 直出播放（不经 AudioContext，系统原生流式解码）
  private async playDirectUrl(url: string): Promise<void> {
    this.stop()
    const session = this.playSession

    const element = new Audio()
    element.preload = 'auto'
    element.volume = this.volume
    this.applyRateToElement(element)

    const p = usePlayerStore()
    element.onloadedmetadata = () => {
      if (session !== this.playSession) return
      p.setDuration((element.duration || 0) * 1000)
    }
    element.ontimeupdate = () => {
      if (session !== this.playSession) return
      p.setPosition(element.currentTime * 1000)
    }
    element.onended = () => {
      if (session !== this.playSession) return
      this.handleNaturalEnd()
    }

    element.src = url
    this.directElement = element

    // 等待播放真正开始；直出失败则回退到「原生下载 + 解码」
    const started = await new Promise<boolean>((resolve) => {
      let settled = false
      const done = (ok: boolean): void => {
        if (settled) return
        settled = true
        resolve(ok)
      }
      element.onerror = () => {
        if (session !== this.playSession) return
        console.error('[audio-engine] 直出播放失败:', {
          code: element.error?.code,
          message: element.error?.message,
          networkState: element.networkState,
          readyState: element.readyState,
          url
        })
        done(false)
      }
      element
        .play()
        .then(() => done(true))
        .catch((e) => {
          console.error('[audio-engine] 直出 play() 被拒绝:', e)
          done(false)
        })
      // 20s 仍未开始播放，视为失败
      window.setTimeout(() => done(false), 20000)
    })

    if (session !== this.playSession) return
    if (started) return

    // 回退：经原生网络栈下载后解码播放
    console.warn('[audio-engine] 直出播放未开始，回退到原生下载解码:', url)
    try {
      const data = await this.downloadUrlAsArrayBuffer(url)
      if (session !== this.playSession) return
      await this.playFromFileData(data)
    } catch (e) {
      console.error('[audio-engine] 下载解码回退也失败:', e)
      throw e instanceof Error ? e : new Error('在线播放失败')
    }
  }

  // 移动端：经原生 HTTP 栈下载远程音频（兜底路径）
  private async downloadUrlAsArrayBuffer(url: string): Promise<ArrayBuffer> {
    const { CapacitorHttp } = await import('@capacitor/core')
    const res = await CapacitorHttp.get({
      url,
      responseType: 'arraybuffer',
      connectTimeout: 30000,
      readTimeout: 60000
    })
    if (res.status !== 200 || !res.data) {
      throw new Error(`下载音频失败: HTTP ${res.status}`)
    }
    const base64 = res.data as string
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes.buffer as ArrayBuffer
  }

  // 自然播放结束：单曲循环重播，否则自动切下一首
  private handleNaturalEnd(): void {
    const p = usePlayerStore()
    if (p.playMode === 'loop') {
      this.endingFade = false
      if (this.directElement) {
        this.directElement.currentTime = 0
        this.directElement.volume = this.volume
        void this.directElement.play()
        return
      }
      if (this.currentBuffer && this.audioContext) {
        this.playBuffer(this.currentBuffer, 0)
        // 结尾淡出后重播：恢复增益并淡入
        if (this.gainNode) {
          this.gainNode.gain.value = 0
          this.fadeTo(this.volume, this.fadeInMs())
        }
        return
      }
      if (this.mediaElement) {
        this.mediaElement.currentTime = 0
        if (this.gainNode) {
          this.gainNode.gain.value = 0
          this.fadeTo(this.volume, this.fadeInMs())
        }
        void this.mediaElement.play()
        return
      }
    }
    p.playNext()
  }

  // 加载 URL 但不播放
  async loadFromUrl(url: string): Promise<void> {
    this.ensureContext()
    if (!this.audioContext || !this.gainNode) return

    await this.fadeOutAndStop(200)

    if (!this.mediaElement) {
      const element = new Audio()
      // 提前缓冲，降低首帧等待时间
      element.preload = 'auto'
      element.crossOrigin = 'anonymous'
      this.mediaElement = element
      this.applyRateToElement(element)

      // 创建 MediaElementAudioSource 连接到全局增益节点
      const source = this.audioContext.createMediaElementSource(element)
      source.connect(this.gainNode)
    }

    this.mediaElement.src = url
    this.mediaElement.currentTime = 0

    // 同步 HTMLAudioElement 的时长和进度到全局 store
    const p = usePlayerStore()
    this.mediaElement.onloadedmetadata = () => {
      if (!this.mediaElement) return
      const durationMs = (this.mediaElement.duration || 0) * 1000
      p.setDuration(durationMs)
    }

    this.mediaElement.ontimeupdate = () => {
      if (!this.mediaElement) return
      const positionMs = this.mediaElement.currentTime * 1000
      // 临近结尾自动淡出（交叉淡入淡出）
      this.checkEndFade(positionMs, p.currentSong?.durationMs ?? 0)
      p.setPosition(positionMs)
    }

    const session = this.playSession
    this.mediaElement.onended = () => {
      if (session !== this.playSession) return
      this.handleNaturalEnd()
    }
  }

  // 开始流式播放会话
  startStream(sampleRate: number, channels: number): void {
    this.ensureContext()
    if (!this.audioContext || !this.gainNode) return

    void this.fadeOutAndStop(200)

    // 初始化流式播放时间轴，从当前时间开始排队
    this.streamSampleRate = sampleRate || this.audioContext.sampleRate
    this.streamChannels = channels
    this.streamCursorTime = this.audioContext.currentTime
  }

  // 追加一块流式解码得到的 PCM 数据
  appendStreamChunk(chunk: {
    sampleRate: number
    channels: number
    data: number[]
    finished?: boolean
  }): void {
    if (!this.audioContext || !this.gainNode) return

    const sampleRate =
      chunk.sampleRate || this.streamSampleRate || this.audioContext.sampleRate
    const channels = chunk.channels || this.streamChannels || 1

    const totalSamples = chunk.data.length
    if (totalSamples === 0) return

    const frames = totalSamples / channels
    const buffer = this.audioContext.createBuffer(
      channels,
      frames,
      sampleRate
    )

    for (let channelIndex = 0; channelIndex < channels; channelIndex += 1) {
      const channelData = buffer.getChannelData(channelIndex)
      for (let frameIndex = 0; frameIndex < frames; frameIndex += 1) {
        const sourceIndex = frameIndex * channels + channelIndex
        channelData[frameIndex] = chunk.data[sourceIndex] ?? 0
      }
    }

    const source = this.audioContext.createBufferSource()
    source.buffer = buffer
    source.connect(this.gainNode)

    const now = this.audioContext.currentTime
    // 确保不会把播放时间排在「已经过去」的时间点，避免被 Web Audio 直接丢弃
    const startTime = Math.max(now, this.streamCursorTime)
    const duration = frames / sampleRate

    source.start(startTime)

    this.streamCursorTime = startTime + duration
    this.streamSources.push(source)
  }
}

// 导出全局单例
export const webAudioEngine = new WebAudioEngine()
