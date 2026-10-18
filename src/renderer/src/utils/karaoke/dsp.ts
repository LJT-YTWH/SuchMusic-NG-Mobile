// 基础 DSP 工具：FFT / STFT / 中值滤波 / 频域带通 / 形态学
// 为逐字歌词对齐算法（V3/V4 的 TypeScript 移植）提供与 numpy/scipy 等价的原语

// ==================== FFT（基-2，原地复数） ====================

interface FftPlan {
  cos: Float64Array
  sin: Float64Array
  rev: Uint32Array
}

const fftPlans = new Map<number, FftPlan>()

function getFftPlan(n: number): FftPlan {
  let p = fftPlans.get(n)
  if (p) return p
  const bits = Math.round(Math.log2(n))
  const rev = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    let r = 0
    for (let b = 0; b < bits; b++) r = (r << 1) | ((i >> b) & 1)
    rev[i] = r
  }
  const cos = new Float64Array(n >> 1)
  const sin = new Float64Array(n >> 1)
  for (let i = 0; i < n >> 1; i++) {
    const a = (-2 * Math.PI * i) / n
    cos[i] = Math.cos(a)
    sin[i] = Math.sin(a)
  }
  p = { cos, sin, rev }
  fftPlans.set(n, p)
  return p
}

/** 原地 FFT（inverse=true 时做逆变换并除以 n） */
export function fftInPlace(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length
  const { cos, sin, rev } = getFftPlan(n)
  for (let i = 0; i < n; i++) {
    const r = rev[i]
    if (r > i) {
      const tr = re[i]
      re[i] = re[r]
      re[r] = tr
      const ti = im[i]
      im[i] = im[r]
      im[r] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1
    const step = n / len
    for (let i = 0; i < n; i += len) {
      let k = 0
      for (let j = 0; j < half; j++, k += step) {
        const wr = cos[k]
        const wi = inverse ? -sin[k] : sin[k]
        const a = i + j
        const b = a + half
        const xr = re[b] * wr - im[b] * wi
        const xi = re[b] * wi + im[b] * wr
        re[b] = re[a] - xr
        im[b] = im[a] - xi
        re[a] += xr
        im[a] += xi
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n
      im[i] /= n
    }
  }
}

export function nextPow2(n: number): number {
  let p = 1
  while (p < n) p <<= 1
  return p
}

// ==================== 窗函数 ====================

/** scipy.signal.windows.hann(n, sym=True) */
export function hannSym(n: number): Float64Array {
  const w = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
  }
  return w
}

// ==================== STFT 幅值（仅保留指定频带） ====================

/**
 * 等价 scipy.signal.stft(y, fs, window='hann'(sym), nperseg=nFft,
 *   noverlap=nFft-hop, boundary='zeros', padded=True) 后取 |Z|，
 * 但只保留 [binLo, binHi] 的频率 bin（节省内存）。
 * 帧 k 中心位于第 k*hop 个采样点。
 */
export function stftMagBand(
  y: Float32Array,
  nFft: number,
  hop: number,
  binLo: number,
  binHi: number
): { mag: Float32Array; nFrames: number; nBins: number } {
  const nBins = binHi - binLo + 1
  const nFrames = Math.ceil(y.length / hop) + 1
  const mag = new Float32Array(nFrames * nBins)
  const win = hannSym(nFft)
  const re = new Float64Array(nFft)
  const im = new Float64Array(nFft)
  const pad = nFft >> 1
  for (let f = 0; f < nFrames; f++) {
    const start = f * hop - pad
    re.fill(0)
    im.fill(0)
    for (let j = 0; j < nFft; j++) {
      const idx = start + j
      if (idx >= 0 && idx < y.length) re[j] = y[idx] * win[j]
    }
    fftInPlace(re, im, false)
    const rowBase = f * nBins
    for (let b = binLo; b <= binHi; b++) {
      mag[rowBase + (b - binLo)] = Math.hypot(re[b], im[b])
    }
  }
  return { mag, nFrames, nBins }
}

// ==================== 滑动中值（sorted window） ====================

function binSearchGE(arr: Float32Array, len: number, v: number): number {
  let lo = 0
  let hi = len
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] < v) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** scipy.ndimage 的 'reflect' 边界索引映射 (d c b a | a b c d | d c b a) */
function reflectIndex(j: number, n: number): number {
  if (n <= 1) return 0
  while (j < 0 || j >= n) {
    if (j < 0) j = -j
    else j = 2 * n - 2 - j
  }
  return j
}

/**
 * 对序列做滑动中值（kernel 为奇数，reflect 边界）。
 * get 为取值函数，out 为输出。逐位置 O(k)。
 */
function slidingMedian(get: (i: number) => number, n: number, k: number, out: Float32Array): void {
  const half = k >> 1
  const win = new Float32Array(k)
  for (let i = 0; i < k; i++) win[i] = get(reflectIndex(i - half, n))
  const sorted = Float32Array.from(win).sort()
  let len = k
  for (let i = 0; i < n; i++) {
    out[i] = sorted[len >> 1]
    if (i === n - 1) break
    // 移出 reflectIndex(i - half)，移入 reflectIndex(i + half + 1)
    const outV = get(reflectIndex(i - half, n))
    const inV = get(reflectIndex(i + half + 1, n))
    const idx = binSearchGE(sorted, len, outV)
    sorted.copyWithin(idx, idx + 1, len)
    len--
    const insPos = binSearchGE(sorted, len, inV)
    sorted.copyWithin(insPos + 1, insPos, len)
    sorted[insPos] = inV
    len++
  }
}

/** scipy.ndimage.median_filter(mag, size=(1, k))：沿帧轴（每列一个中值序列） */
export function medianFilterAxis0(
  mag: Float32Array,
  nFrames: number,
  nBins: number,
  k: number
): Float32Array {
  const out = new Float32Array(mag.length)
  const col = new Float32Array(nFrames)
  const tmp = new Float32Array(nFrames)
  for (let b = 0; b < nBins; b++) {
    for (let f = 0; f < nFrames; f++) col[f] = mag[f * nBins + b]
    slidingMedian((i) => col[i], nFrames, k, tmp)
    for (let f = 0; f < nFrames; f++) out[f * nBins + b] = tmp[f]
  }
  return out
}

/** scipy.ndimage.median_filter(mag, size=(k, 1))：沿频率轴（每行一个中值序列） */
export function medianFilterAxis1(
  mag: Float32Array,
  nFrames: number,
  nBins: number,
  k: number
): Float32Array {
  const out = new Float32Array(mag.length)
  const rowOut = new Float32Array(nBins)
  for (let f = 0; f < nFrames; f++) {
    const base = f * nBins
    slidingMedian((i) => mag[base + i], nBins, k, rowOut)
    out.set(rowOut, base)
  }
  return out
}

/** scipy.ndimage.median_filter(x, size=k)：一维，reflect 边界 */
export function medianFilter1d(x: Float32Array, k: number): Float32Array {
  const out = new Float32Array(x.length)
  slidingMedian((i) => x[i], x.length, k, out)
  return out
}

// ==================== 统计 ====================

/** numpy.percentile（线性插值） */
export function percentile(x: Float32Array | Float64Array, p: number): number {
  const s = Float64Array.from(x as Float64Array).sort()
  const n = s.length
  if (n === 0) return 0
  const rank = (p / 100) * (n - 1)
  const lo = Math.floor(rank)
  const hi = Math.min(lo + 1, n - 1)
  const frac = rank - lo
  return s[lo] + (s[hi] - s[lo]) * frac
}

/** numpy.median */
export function medianOf(x: ArrayLike<number>): number {
  const s = Float64Array.from(x as Float64Array).sort()
  const n = s.length
  if (n === 0) return 0
  const mid = n >> 1
  return n % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// ==================== 一维形态学 / 滤波 ====================

/** 连通域提取（1D 布尔 → [start, end] 闭区间列表） */
export function extractRuns(mask: Uint8Array): Array<[number, number]> {
  const runs: Array<[number, number]> = []
  let i = 0
  const n = mask.length
  while (i < n) {
    if (mask[i]) {
      let j = i
      while (j + 1 < n && mask[j + 1]) j++
      runs.push([i, j])
      i = j + 1
    } else {
      i++
    }
  }
  return runs
}

/** scipy.ndimage.binary_dilation(x, structure=ones(2r+1))，border_value=0 */
export function binaryDilation(x: Uint8Array, r: number): Uint8Array {
  const n = x.length
  const out = new Uint8Array(n)
  if (r <= 0) return x.slice()
  // 滑动窗口最大值
  const dq: number[] = []
  for (let i = 0; i < n; i++) {
    const inIdx = i + r
    if (inIdx < n) {
      while (dq.length && x[dq[dq.length - 1]] <= x[inIdx]) dq.pop()
      dq.push(inIdx)
    }
    while (dq.length && dq[0] < i - r) dq.shift()
    out[i] = dq.length ? x[dq[0]] : 0
  }
  return out
}

/** scipy.ndimage.binary_erosion(x, structure=ones(2r+1))，border_value=0 */
export function binaryErosion(x: Uint8Array, r: number): Uint8Array {
  const n = x.length
  const out = new Uint8Array(n)
  if (r <= 0) return x.slice()
  for (let i = 0; i < n; i++) {
    if (i - r < 0 || i + r >= n) {
      out[i] = 0
      continue
    }
    let all = 1
    for (let j = i - r; j <= i + r; j++) {
      if (!x[j]) {
        all = 0
        break
      }
    }
    out[i] = all
  }
  return out
}

/** binary_closing = dilation → erosion */
export function binaryClosing(x: Uint8Array, size: number): Uint8Array {
  const r = Math.floor(size / 2)
  return binaryErosion(binaryDilation(x, r), r)
}

/**
 * scipy.ndimage.maximum_filter1d(x, size, origin, mode='nearest')
 * 窗口 [i+origin, i+origin+size)，越界按最近边缘值补齐
 */
export function maximumFilter1d(x: Float32Array, size: number, origin: number): Float32Array {
  const n = x.length
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let m = -Infinity
    const lo = i + origin
    const hi = lo + size - 1
    for (let j = lo; j <= hi; j++) {
      const idx = j < 0 ? 0 : j >= n ? n - 1 : j
      if (x[idx] > m) m = x[idx]
    }
    out[i] = m
  }
  return out
}

/** scipy.ndimage.uniform_filter1d(x, size)，reflect 边界 */
export function uniformFilter1d(x: Float32Array, size: number): Float32Array {
  const n = x.length
  const out = new Float32Array(n)
  const half = Math.floor(size / 2)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let j = i - half; j <= i + half; j++) s += x[reflectIndex(j, n)]
    out[i] = s / size
  }
  return out
}

// ==================== 频域带通（零相位，overlap-add 线性相位 FIR） ====================

function sinc(x: number): number {
  if (x === 0) return 1
  const px = Math.PI * x
  return Math.sin(px) / px
}

/**
 * 零相位带通滤波：设计 Hamming 窗线性相位 FIR（截止 lo/hi Hz），
 * overlap-add FFT 卷积后补偿群延迟（等价零相位）。
 * 用于 YIN 前置带通（抑制鼓与极低频伴奏），与 scipy sosfiltfilt 的零相位特性一致。
 */
export function bandpassZeroPhase(
  y: Float32Array,
  sr: number,
  loHz: number,
  hiHz: number
): Float32Array {
  const n = y.length
  const M = 4097 // 奇数，线性相位
  const c = (M - 1) / 2
  const h = new Float64Array(M)
  const f1 = loHz / sr
  const f2 = hiHz / sr
  for (let i = 0; i < M; i++) {
    const t = i - c
    const ideal = 2 * f2 * sinc(2 * f2 * t) - 2 * f1 * sinc(2 * f1 * t)
    const win = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (M - 1)) // Hamming
    h[i] = ideal * win
  }
  const N = nextPow2(Math.min(n, 262144) + M)
  const L = N - M + 1
  // H = FFT(h)
  const hre = new Float64Array(N)
  const him = new Float64Array(N)
  hre.set(h)
  fftInPlace(hre, him, false)
  const out = new Float64Array(n + M)
  const re = new Float64Array(N)
  const im = new Float64Array(N)
  for (let off = 0; off < n; off += L) {
    const len = Math.min(L, n - off)
    re.fill(0)
    im.fill(0)
    for (let i = 0; i < len; i++) re[i] = y[off + i]
    fftInPlace(re, im, false)
    for (let i = 0; i < N; i++) {
      const a = re[i]
      const b = im[i]
      re[i] = a * hre[i] - b * him[i]
      im[i] = a * him[i] + b * hre[i]
    }
    fftInPlace(re, im, true)
    for (let i = 0; i < len + M - 1; i++) out[off + i] += re[i]
  }
  // 补偿群延迟 c → 零相位
  const res = new Float32Array(n)
  for (let i = 0; i < n; i++) res[i] = out[i + c]
  return res
}

/** 线性插值重采样（兜底；正常路径由 AudioContext 解码时重采样到 22050Hz） */
export function resampleLinear(y: Float32Array, srFrom: number, srTo: number): Float32Array {
  if (srFrom === srTo) return y
  const ratio = srFrom / srTo
  const nOut = Math.floor(y.length / ratio)
  const out = new Float32Array(nOut)
  for (let i = 0; i < nOut; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, y.length - 1)
    const frac = pos - i0
    out[i] = y[i0] * (1 - frac) + y[i1] * frac
  }
  return out
}
