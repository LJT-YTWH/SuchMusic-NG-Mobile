// 逐字歌词强制对齐算法（V3 / V4）—— Python 原版的 TypeScript 移植
// 移植说明（相对原版的修复）：
//   1. 输出的逐字歌词保留原 LRC 中的翻译行（同时间戳的第二行及以后），
//      以「逐字行精修后的起始时间戳」紧随其后输出为普通 LRC 行；
//   2. 保留原歌词中拉丁单词之间的空格（空格并入前一个单词 token，随其一同计时）。
// 管线：STFT → HPSS → onset/人声带 RMS → YIN 基频/浊音跟踪 → 行区间精修 → DP 逐字对齐 → 间隙空格
import {
  stftMagBand,
  medianFilterAxis0,
  medianFilterAxis1,
  medianFilter1d,
  percentile,
  medianOf,
  extractRuns,
  binaryDilation,
  binaryClosing,
  maximumFilter1d,
  uniformFilter1d,
  bandpassZeroPhase,
  fftInPlace
} from './dsp'

// ---------------------------------------------------------------- 共享常量

export const SR = 22050
const N_FFT = 2048
const HOP = 256
const DT = HOP / SR

const HPSS_KERNEL_T = 31
const HPSS_KERNEL_F = 31

const VOCAL_LO = 150.0
const VOCAL_HI = 5500.0

const YIN_WIN = 2048
const YIN_FMIN = 80.0
const YIN_FMAX = 1000.0
const YIN_BP_LO = 100.0
const YIN_BP_HI = 1200.0

/** STFT 频带裁剪的 bin 范围（freqs = linspace(0, sr/2, 1025)，vmask = 150~5500Hz） */
const BIN_LO = Math.ceil(VOCAL_LO / (SR / N_FFT)) // 14
const BIN_HI = Math.floor(VOCAL_HI / (SR / N_FFT)) // 510

// ---------------------------------------------------------------- 参数集

export interface AlignParams {
  YIN_THR: number
  YIN_MED_THR: number
  YIN_WEAK_THR: number
  VOICE_CLOSE_S: number
  VOICE_MINRUN_S: number
  VOICE_ENERGY_GATE: number
  WEAK_ENERGY_GATE: number
  START_BACK_S: number
  START_FWD_S: number
  START_BACKOFF_S: number
  END_RELEASE_S: number
  END_GAP_CUT_S: number
  END_CAP_BASE_S: number
  END_CAP_PER_UNIT: number
  END_TAIL_MAX_S: number
  GAP_SPACE_S: number
  GAP_END_TRIM_S: number
  W_BOUND: number
  W_LEAD: number
  W_GAP: number
  W_TRAIL: number
  W_DUR: number
  DUR_LN_SIGMA: number
  DUR_MIN_RATIO: number
  DUR_MAX_RATIO: number
  DUR_MAX_RATIO_LAST: number
  DUR_MIN_S: number
  DUR_MAX_S: number
  CUE_REV_ONSET: number
  CUE_PJUMP: number
  CUE_RISE: number
  CUE_NOTE: number
  SNAP_RADIUS: number
  FLUX_MED: number
  MED_GAP_S: number
  MED_MIN_SEG_S: number
  ACT_WIN_S: number
  ACT_RATIO: number
  ACT_FLOOR: number
  ACT_CLOSE_S: number
  SND_WIN_S: number
  SND_RATIO: number
  SND_FLOOR: number
  SND_CLOSE_S: number
  ACT_DIL_S: number
  PJ_WIN_S: number
  PJ_GUARD_S: number
  PJ_CLIP: number
  CUE_SOFT: number
  CUE_ACCOMP: number
  STR_MIN_SEG_S: number
  TAIL_SEMI_TOL: number
  TAIL_ENV_RATIO: number
  BUDGET_BASE_S: number
  VAD_THR_RATIO: number
  VAD_CLOSE_S: number
  VAD_MINSEG_S: number
}

export const PARAMS_V3: AlignParams = {
  YIN_THR: 0.09620758544742632,
  YIN_MED_THR: 0.20115352656191218,
  YIN_WEAK_THR: 0.3006914417097795,
  VOICE_CLOSE_S: 0.06962929677369945,
  VOICE_MINRUN_S: 0.06974223633552672,
  VOICE_ENERGY_GATE: 0.019252875629857225,
  WEAK_ENERGY_GATE: 0.04726539495064121,
  START_BACK_S: 0.29353010424262765,
  START_FWD_S: 0.4,
  START_BACKOFF_S: 0.1502154120140806,
  END_RELEASE_S: 0.12263937616096456,
  END_GAP_CUT_S: 0.7197824522694474,
  END_CAP_BASE_S: 1.236194490808558,
  END_CAP_PER_UNIT: 0.46024735228490615,
  END_TAIL_MAX_S: 4.3544474924243985,
  GAP_SPACE_S: 0.5841242616167385,
  GAP_END_TRIM_S: 0.19785727832555985,
  W_BOUND: 1.3838696057388635,
  W_LEAD: 1.0290263528850172,
  W_GAP: 0.6123554329790188,
  W_TRAIL: 0.07845897695025411,
  W_DUR: 0.14406973997881584,
  DUR_LN_SIGMA: 1.043961591358318,
  DUR_MIN_RATIO: 0.5,
  DUR_MAX_RATIO: 6.056058696751039,
  DUR_MAX_RATIO_LAST: 4.327249995717804,
  DUR_MIN_S: 0.04,
  DUR_MAX_S: 6.0,
  CUE_REV_ONSET: 0.9039484071821502,
  CUE_PJUMP: 1.0,
  CUE_RISE: 0.7148583211380275,
  CUE_NOTE: 0.4265574086819161,
  SNAP_RADIUS: 7,
  FLUX_MED: 43,
  MED_GAP_S: 0.9298305542091392,
  MED_MIN_SEG_S: 0.1,
  ACT_WIN_S: 1.2867651370421844,
  ACT_RATIO: 0.11537137651142966,
  ACT_FLOOR: 0.0159605219196049,
  ACT_CLOSE_S: 0.06,
  SND_WIN_S: 3.706911223379634,
  SND_RATIO: 0.08658920259185778,
  SND_FLOOR: 0.013575785962712505,
  SND_CLOSE_S: 0.1,
  ACT_DIL_S: 0.130539263916847,
  PJ_WIN_S: 0.09881497287806841,
  PJ_GUARD_S: 0.015,
  PJ_CLIP: 3.0,
  CUE_SOFT: 0.15492566854814263,
  CUE_ACCOMP: 0.277988473022156,
  STR_MIN_SEG_S: 0.06,
  TAIL_SEMI_TOL: 1.7892027182453172,
  TAIL_ENV_RATIO: 1.2649515522179253,
  BUDGET_BASE_S: 1.4642819731558854,
  VAD_THR_RATIO: 0.16,
  VAD_CLOSE_S: 0.18,
  VAD_MINSEG_S: 0.1
}

export const PARAMS_V4: AlignParams = {
  YIN_THR: 0.06,
  YIN_MED_THR: 0.22727582702316884,
  YIN_WEAK_THR: 0.2933915287366007,
  VOICE_CLOSE_S: 0.08721078621370068,
  VOICE_MINRUN_S: 0.06624364095867526,
  VOICE_ENERGY_GATE: 0.016802324420836415,
  WEAK_ENERGY_GATE: 0.04716448890615072,
  START_BACK_S: 0.16099181680243385,
  START_FWD_S: 0.634227918015618,
  START_BACKOFF_S: 0.12351979999274372,
  END_RELEASE_S: 0.20473858219223656,
  END_GAP_CUT_S: 1.1124611158894389,
  END_CAP_BASE_S: 1.2575681834316155,
  END_CAP_PER_UNIT: 0.4,
  END_TAIL_MAX_S: 4.801560462862535,
  GAP_SPACE_S: 0.5619174967568462,
  GAP_END_TRIM_S: 0.2672068356903181,
  W_BOUND: 1.705943923802984,
  W_LEAD: 1.11313091493648,
  W_GAP: 0.502522489672762,
  W_TRAIL: 0.037615995120512356,
  W_DUR: 0.24858293424881236,
  DUR_LN_SIGMA: 0.8972613496830314,
  DUR_MIN_RATIO: 0.47779921992660296,
  DUR_MAX_RATIO: 9.704009044709755,
  DUR_MAX_RATIO_LAST: 4.0,
  DUR_MIN_S: 0.04,
  DUR_MAX_S: 6.0,
  CUE_REV_ONSET: 0.8627691265905364,
  CUE_PJUMP: 0.9523968368538676,
  CUE_RISE: 1.0,
  CUE_NOTE: 0.4993427006936544,
  SNAP_RADIUS: 7,
  FLUX_MED: 43,
  MED_GAP_S: 0.7995626671411777,
  MED_MIN_SEG_S: 0.1,
  ACT_WIN_S: 1.4991582406637556,
  ACT_RATIO: 0.10198047378026882,
  ACT_FLOOR: 0.015387125656108348,
  ACT_CLOSE_S: 0.06,
  SND_WIN_S: 2.9231638029858686,
  SND_RATIO: 0.10510028570338113,
  SND_FLOOR: 0.010756446119245212,
  SND_CLOSE_S: 0.1,
  ACT_DIL_S: 0.1467389004340073,
  PJ_WIN_S: 0.1199987531183098,
  PJ_GUARD_S: 0.015,
  PJ_CLIP: 3.0,
  CUE_SOFT: 0.16714340977187694,
  CUE_ACCOMP: 0.5288229876502876,
  STR_MIN_SEG_S: 0.06,
  TAIL_SEMI_TOL: 2.1008969020278467,
  TAIL_ENV_RATIO: 2.5,
  BUDGET_BASE_S: 1.1099825928385088,
  VAD_THR_RATIO: 0.16,
  VAD_CLOSE_S: 0.18,
  VAD_MINSEG_S: 0.1
}

export type KaraokeAlgo = 'v3' | 'v4'

// ---------------------------------------------------------------- 文本处理

const CJK_RE = /[㐀-䶿一-鿿豈-﫿]/
const CJK_RE_G = /[㐀-䶿一-鿿豈-﫿]/g
const LATIN_CHAR_RE_G = /[A-Za-zÀ-ɏḀ-ỿ]/g
const LATIN_WORD_RE = /[A-Za-zÀ-ɏḀ-ỿ0-9]+(?:['’][A-Za-zÀ-ɏ]+)*/
const VOWEL_GROUP_RE = /[aeiouyæœøåäöáéíóúàèìòùâêîôûāēīōū]+/gi
const CREDIT_RE =
  /(歌手|作曲|作词|编曲|混音|母带|制作人|监制|音乐设计|采样|小提琴|和声|伴唱|吉他|贝斯|鼓|键盘|出品|企划|OP|SP|词|曲)\s*[:：]/
const TIME_TAG_RE = /\[(\d+):(\d+(?:\.\d+)?)\]/g
const OFFSET_RE = /\[offset:([+-]?\d+)\]/
const BRACKET_CJK_RE = /[（(][^()（）]*[㐀-䶿一-鿿豈-﫿][^()（）]*[)）]/g

function countMatches(re: RegExp, s: string): number {
  re.lastIndex = 0
  const m = s.match(re)
  return m ? m.length : 0
}

function syllableCount(word: string): number {
  const m = word.match(VOWEL_GROUP_RE)
  const n = m ? m.length : 0
  return Math.max(1, Math.min(n, 6))
}

interface Token {
  text: string
  weight: number
  start: number
  end: number
  confidence: number
}

function makeToken(text: string, weight: number): Token {
  return { text, weight, start: 0, end: 0, confidence: 0 }
}

/** 规整歌词行：剥离中文翻译，保留实际演唱文本（逻辑与 Python 一致） */
function cleanLineText(text: string): string {
  text = text.trim()
  if (!text) return ''
  let nCjk = countMatches(CJK_RE_G, text)
  let nLatin = countMatches(LATIN_CHAR_RE_G, text)
  if (nCjk && nLatin) {
    text = text.replace(BRACKET_CJK_RE, ' ')
    nCjk = countMatches(CJK_RE_G, text)
    nLatin = countMatches(LATIN_CHAR_RE_G, text)
  }
  if (nCjk && nLatin && nLatin >= nCjk) {
    text = text.replace(CJK_RE_G, '')
    text = text.replace(/[　-〿＀-￯]/g, ' ')
    text = text.replace(/[（(]\s*[)）]/g, ' ')
  }
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * 中文逐字、拉丁语逐词切分；拉丁词按音节数加权。
 * 【修复】拉丁词后面的空格并入该词 token（保留原歌词词间空格），空格不额外加权。
 */
function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (CJK_RE.test(ch)) {
      tokens.push(makeToken(ch, 1.0))
      i += 1
    } else if ((ch.charCodeAt(0) < 128 && /[A-Za-z0-9]/.test(ch)) || ('À' <= ch && ch <= 'ɏ') || ('Ḁ' <= ch && ch <= 'ỿ')) {
      LATIN_WORD_RE.lastIndex = 0
      const m = LATIN_WORD_RE.exec(text.slice(i))
      if (m && m.index === 0) {
        const w = m[0]
        let j = i + w.length
        // 并入后续空格（cleanLineText 已把连续空白压成单个空格）
        while (j < text.length && text[j] === ' ') j++
        tokens.push(makeToken(text.slice(i, j), syllableCount(w)))
        i = j
      } else {
        i += 1
      }
    } else {
      i += 1
    }
  }
  return tokens
}

export interface KaraokeLine {
  start: number
  text: string
  tokens: Token[]
  translations: string[]
  end: number
}

/**
 * 解析逐行 LRC：
 *  - 同一时间戳的第一条有效行为演唱行，其余非制作名单行保留为翻译（修复翻译丢失）；
 *  - 过滤制作名单行；支持 [offset:] 与一行多时间戳。
 */
export function parseLrcForAlign(lrcText: string): KaraokeLine[] {
  let offsetMs = 0
  interface Event {
    time: number
    text: string
    order: number
  }
  const events: Event[] = []
  let order = 0
  for (const rawRow of lrcText.split(/\r?\n/)) {
    const row = rawRow.trim()
    if (!row) continue
    const mOff = OFFSET_RE.exec(row)
    if (mOff) {
      offsetMs = parseFloat(mOff[1])
      continue
    }
    TIME_TAG_RE.lastIndex = 0
    const tags: Array<[number, number]> = []
    let m: RegExpExecArray | null
    while ((m = TIME_TAG_RE.exec(row)) !== null) {
      tags.push([parseInt(m[1], 10), parseFloat(m[2])])
    }
    if (!tags.length) continue
    const text = row.replace(TIME_TAG_RE, '').trim()
    if (CREDIT_RE.test(text)) continue
    for (const [mm, ss] of tags) {
      events.push({ time: mm * 60 + ss - offsetMs / 1000, text, order: order++ })
    }
  }
  // 按时间分组（同时间戳保持原始顺序）
  events.sort((a, b) => a.time - b.time || a.order - b.order)
  const lines: KaraokeLine[] = []
  let i = 0
  while (i < events.length) {
    let j = i
    while (j < events.length && events[j].time === events[i].time) j++
    const group = events.slice(i, j)
    i = j
    let main: KaraokeLine | null = null
    for (const ev of group) {
      if (!main) {
        const cleaned = cleanLineText(ev.text)
        if (!cleaned) continue
        const tokens = tokenize(cleaned)
        if (!tokens.length) continue
        main = {
          start: Math.max(0, ev.time),
          text: cleaned,
          tokens,
          translations: [],
          end: 0
        }
        lines.push(main)
      } else {
        // 同时间戳的后续行 → 翻译（保留原文，仅去空白）
        const t = ev.text.replace(/\s+/g, ' ').trim()
        if (t) main.translations.push(t)
      }
    }
  }
  lines.sort((a, b) => a.start - b.start)
  return lines
}

// ---------------------------------------------------------------- YIN 基频跟踪

interface YinResult {
  f0: Float32Array
  vmin: Float32Array
}

/** 自研 YIN 基频跟踪，帧中心与 STFT 帧网格对齐（center = f*HOP） */
function yinTrack(y: Float32Array, nFrames: number, P: AlignParams): YinResult {
  const tauMin = Math.max(2, Math.floor(SR / YIN_FMAX))
  const tauMax = Math.floor(SR / YIN_FMIN)
  const win = YIN_WIN
  const pad = win >> 1
  const yp = new Float32Array(pad + y.length + pad + HOP)
  yp.set(y, pad)
  const nfft = 1 << Math.ceil(Math.log2(2 * win)) // 4096

  const f0 = new Float32Array(nFrames)
  const vmin = new Float32Array(nFrames).fill(1)

  const re = new Float64Array(nfft)
  const im = new Float64Array(nfft)
  const d = new Float64Array(tauMax + 1)
  const cmnd = new Float64Array(tauMax + 1)
  // cs[j] = sum_{k<j} (x_k)^2，j = 0..win
  const cs = new Float64Array(win + 1)

  for (let f = 0; f < nFrames; f++) {
    const base = f * HOP
    let mean = 0
    for (let j = 0; j < win; j++) mean += yp[base + j]
    mean /= win
    re.fill(0)
    im.fill(0)
    let csAcc = 0
    cs[0] = 0
    for (let j = 0; j < win; j++) {
      const v = yp[base + j] - mean
      re[j] = v
      csAcc += v * v
      cs[j + 1] = csAcc
    }
    fftInPlace(re, im, false)
    for (let j = 0; j < nfft; j++) {
      const a = re[j]
      const b = im[j]
      re[j] = a * a + b * b
      im[j] = 0
    }
    fftInPlace(re, im, true)
    // d(τ) = cs[win-τ] + cs[win] - cs[τ] - 2*ac[τ]
    const csWin = cs[win]
    d[0] = 0
    let cdf = 0
    cmnd[0] = 1
    for (let tau = 1; tau <= tauMax; tau++) {
      let dv = cs[win - tau] + csWin - cs[tau] - 2.0 * re[tau]
      if (dv < 0) dv = 0
      d[tau] = dv
      cdf += dv
      cmnd[tau] = cdf > 1e-12 ? (dv * tau) / cdf : 1
    }
    // 阈值选择
    let has = false
    let tau = tauMin
    let amin = tauMin
    let aminV = Infinity
    for (let tau2 = tauMin; tau2 <= tauMax; tau2++) {
      const v = cmnd[tau2]
      if (v < aminV) {
        aminV = v
        amin = tau2
      }
      if (!has && v < P.YIN_THR) {
        has = true
        tau = tau2
      }
    }
    if (!has) tau = amin
    const v = cmnd[tau]
    const ok = has && v < P.YIN_WEAK_THR
    // 抛物线插值
    const tc = Math.min(Math.max(tau, tauMin + 1), tauMax - 1)
    const y1 = cmnd[tc - 1]
    const y2 = cmnd[tc]
    const y3 = cmnd[tc + 1]
    const denom = y1 - 2.0 * y2 + y3
    let shift = 0
    if (Math.abs(denom) > 1e-9) {
      shift = Math.min(1, Math.max(-1, (0.5 * (y1 - y3)) / Math.max(denom, 1e-9)))
    }
    const tauF = tc + shift
    f0[f] = ok ? SR / Math.max(tauF, 1.0) : 0
    vmin[f] = v
  }
  return { f0, vmin }
}

// ---------------------------------------------------------------- 特征提取

export class Features {
  duration: number
  nFrames: number
  onset: Float32Array
  rms: Float32Array
  voiced: Uint8Array
  strong: Uint8Array
  f0: Float32Array
  env: Float32Array
  active: Uint8Array
  sounding: Uint8Array
  nextVoiced: Int32Array
  prevVoiced: Int32Array
  cuv: Float64Array
  revoice: Float32Array
  pjump: Float32Array
  rise: Float32Array
  noteEdge: Float32Array
  activeDil: Float32Array
  private P: AlignParams

  constructor(y: Float32Array, P: AlignParams, onStage?: (stage: string) => void) {
    this.P = P
    this.duration = y.length / SR

    onStage?.('频谱特征提取')
    const { mag, nFrames, nBins } = stftMagBand(y, N_FFT, HOP, BIN_LO, BIN_HI)
    this.nFrames = nFrames

    // HPSS：中值滤波软掩蔽，取谐波分量
    const medH = medianFilterAxis0(mag, nFrames, nBins, HPSS_KERNEL_T)
    const medP = medianFilterAxis1(mag, nFrames, nBins, HPSS_KERNEL_F)
    // harm 原地写回 mag
    const harm = mag
    for (let i = 0; i < harm.length; i++) {
      harm[i] = (harm[i] * medH[i]) / (medH[i] + medP[i] + 1e-10)
    }

    // 起始强度：谐波对数幅值正向谱通量（已限人声频带）
    // np.diff(log_h, axis=1, prepend=log_h[:, :1]) → 首帧差分为 0
    const flux = new Float32Array(nFrames)
    const prev = new Float32Array(nBins)
    const rms = new Float32Array(nFrames)
    for (let f = 0; f < nFrames; f++) {
      const base = f * nBins
      let fl = 0
      let acc = 0
      for (let b = 0; b < nBins; b++) {
        const h = harm[base + b]
        const lh = Math.log1p(1.0e4 * h)
        if (f > 0) {
          const d = lh - prev[b]
          if (d > 0) fl += d
        }
        prev[b] = lh
        acc += h * h
      }
      flux[f] = fl
      rms[f] = Math.sqrt(acc / nBins + 1e-12)
    }
    // 中值滤波去趋势
    const fluxMed = medianFilter1d(flux, P.FLUX_MED)
    for (let f = 0; f < nFrames; f++) {
      flux[f] = Math.max(0, flux[f] - fluxMed[f])
    }
    const fluxP99 = percentile(flux, 99) + 1e-9
    const rmsP99 = percentile(rms, 99) + 1e-9
    this.onset = new Float32Array(nFrames)
    this.rms = new Float32Array(nFrames)
    for (let f = 0; f < nFrames; f++) {
      this.onset[f] = flux[f] / fluxP99
      this.rms[f] = rms[f] / rmsP99
    }

    // ---- YIN 基频/浊音（带通预滤波，抑制鼓与极低频伴奏）----
    onStage?.('人声基频跟踪')
    const yb = bandpassZeroPhase(y, SR, YIN_BP_LO, YIN_BP_HI)
    const { f0, vmin } = yinTrack(yb, nFrames, P)
    const nF = nFrames

    // 滞后双阈值浊音判决
    const strong = new Uint8Array(nF)
    const medium = new Uint8Array(nF)
    const weak = new Uint8Array(nF)
    for (let f = 0; f < nF; f++) {
      if (this.rms[f] > P.VOICE_ENERGY_GATE) {
        if (vmin[f] < P.YIN_THR) strong[f] = 1
        if (vmin[f] < P.YIN_MED_THR) medium[f] = 1
      }
      if (vmin[f] < P.YIN_WEAK_THR && this.rms[f] > P.WEAK_ENERGY_GATE) weak[f] = 1
    }
    const voiced = new Uint8Array(nF)
    const weakRuns = extractRuns(weak)
    if (weakRuns.length) {
      const nseg = weakRuns.length
      const hasStrong = new Array<boolean>(nseg).fill(false)
      const hasMedium = new Array<boolean>(nseg).fill(false)
      const segLen = new Array<number>(nseg).fill(0)
      for (let s = 0; s < nseg; s++) {
        const [a, b] = weakRuns[s]
        segLen[s] = b - a + 1
        for (let f = a; f <= b; f++) {
          if (strong[f]) hasStrong[s] = true
          if (medium[f]) hasMedium[s] = true
        }
      }
      const minSeg = Math.round(P.MED_MIN_SEG_S / DT)
      const keep = hasStrong.slice()
      const medOk = medOkArr(hasMedium, segLen, minSeg)
      const gapMax = Math.round(P.MED_GAP_S / DT)
      let lastKeepEnd = -1e9
      for (let s = 0; s < nseg; s++) {
        if (keep[s]) {
          lastKeepEnd = weakRuns[s][1]
        } else if (medOk[s] && weakRuns[s][0] - lastKeepEnd <= gapMax) {
          keep[s] = true
          lastKeepEnd = weakRuns[s][1]
        }
      }
      let nextKeepStart = 1e9
      for (let s = nseg - 1; s >= 0; s--) {
        if (keep[s]) {
          nextKeepStart = weakRuns[s][0]
        } else if (medOk[s] && nextKeepStart - weakRuns[s][1] <= gapMax) {
          keep[s] = true
          nextKeepStart = weakRuns[s][0]
        }
      }
      for (let s = 0; s < nseg; s++) {
        if (!keep[s]) continue
        const [a, b] = weakRuns[s]
        for (let f = a; f <= b; f++) voiced[f] = 1
      }
    }

    // 浊音段整形：补小洞、去碎段
    const closeN = Math.max(1, Math.round(P.VOICE_CLOSE_S / DT))
    const closed = binaryClosing(voiced, closeN)
    const minRun = Math.max(1, Math.round(P.VOICE_MINRUN_S / DT))
    for (const [a, b] of extractRuns(closed)) {
      if (b - a + 1 < minRun) {
        for (let f = a; f <= b; f++) closed[f] = 0
      }
    }
    this.voiced = closed
    this.strong = strong
    this.f0 = f0
    // 平滑能量包络（≈80ms 窗）
    this.env = uniformFilter1d(this.rms, 7)

    // ---- 声活度 active：滞后浊音 且 包络高于局部相对门限 ----
    const actWin = Math.round(P.ACT_WIN_S / DT)
    const roll = maximumFilter1d(this.env, actWin + 1, -(actWin >> 1))
    const active = new Uint8Array(nF)
    for (let f = 0; f < nF; f++) {
      active[f] = this.voiced[f] && this.env[f] > Math.max(P.ACT_RATIO * roll[f], P.ACT_FLOOR) ? 1 : 0
    }
    this.active = binaryClosing(active, Math.max(1, Math.round(P.ACT_CLOSE_S / DT)))

    // ---- 响度掩码 sounding ----
    const sndWin = Math.round(P.SND_WIN_S / DT)
    const roll3 = maximumFilter1d(this.env, sndWin + 1, -(sndWin >> 1))
    const sounding = new Uint8Array(nF)
    for (let f = 0; f < nF; f++) {
      sounding[f] =
        this.active[f] || this.env[f] > Math.max(P.SND_RATIO * roll3[f], P.SND_FLOOR) ? 1 : 0
    }
    this.sounding = binaryClosing(sounding, Math.max(1, Math.round(P.SND_CLOSE_S / DT)))

    // 前驱/后继声活帧索引
    this.nextVoiced = new Int32Array(nF)
    let nxt = nF
    for (let f = nF - 1; f >= 0; f--) {
      if (this.active[f]) nxt = f
      this.nextVoiced[f] = nxt
    }
    this.prevVoiced = new Int32Array(nF)
    let prv = -1
    for (let f = 0; f < nF; f++) {
      if (this.active[f]) prv = f
      this.prevVoiced[f] = prv
    }
    // 无声累积和
    this.cuv = new Float64Array(nF + 1)
    for (let f = 0; f < nF; f++) {
      this.cuv[f + 1] = this.cuv[f] + (this.active[f] ? 0 : 1)
    }
    // 重新起音标记：无声->声活跳变沿
    this.revoice = new Float32Array(nF)
    for (let f = 1; f < nF; f++) {
      if (this.active[f] && !this.active[f - 1]) this.revoice[f] = 1
    }
    // 音高跳变：双侧均值阶跃（半音）
    this.pjump = new Float32Array(nF)
    {
      const csL = new Float64Array(nF + 1)
      const csC = new Float64Array(nF + 1)
      for (let f = 0; f < nF; f++) {
        const v = f0[f] > 0
        csL[f + 1] = csL[f] + (v ? Math.log2(Math.max(f0[f], 1.0)) : 0)
        csC[f + 1] = csC[f] + (v ? 1 : 0)
      }
      const W = Math.round(P.PJ_WIN_S / DT)
      const G = Math.round(P.PJ_GUARD_S / DT)
      for (let i = 0; i < nF; i++) {
        const b0 = Math.min(Math.max(i - W, 0), nF)
        const b1 = Math.min(Math.max(i - G, 0), nF)
        const a0 = Math.min(Math.max(i + G + 1, 0), nF)
        const a1 = Math.min(Math.max(i + W + 1, 0), nF)
        const cntB = csC[b1] - csC[b0]
        const cntA = csC[a1] - csC[a0]
        if (cntB >= 3 && cntA >= 3) {
          const mb = (csL[b1] - csL[b0]) / Math.max(cntB, 1)
          const ma = (csL[a1] - csL[a0]) / Math.max(cntA, 1)
          this.pjump[i] = Math.abs(ma - mb) * 12.0
        }
      }
      for (let i = 0; i < nF; i++) {
        this.pjump[i] = Math.min(Math.max(this.pjump[i], 0), P.PJ_CLIP) / P.PJ_CLIP
      }
    }
    // 包络上升沿
    this.rise = new Float32Array(nF)
    {
      let prevE = this.env[0]
      for (let f = 0; f < nF; f++) {
        const d = this.env[f] - prevE
        this.rise[f] = d > 0 ? d : 0
        prevE = this.env[f]
      }
      const riseP99 = percentile(this.rise, 99) + 1e-9
      for (let f = 0; f < nF; f++) this.rise[f] /= riseP99
    }

    // ---- f0 音符分段：连音中换字 = 换音高 ----
    {
      const f0mSrc = new Float32Array(nF)
      for (let f = 0; f < nF; f++) f0mSrc[f] = this.voiced[f] ? f0[f] : 0
      const f0m = medianFilter1d(f0mSrc, 5)
      const semi = new Int32Array(nF)
      const vpos = new Uint8Array(nF)
      for (let f = 0; f < nF; f++) {
        if (f0m[f] > 0) {
          vpos[f] = 1
          semi[f] = Math.round(12.0 * Math.log2(f0m[f] / 55.0))
        }
      }
      const edge = new Uint8Array(nF)
      for (let f = 1; f < nF; f++) {
        if (vpos[f] && vpos[f - 1] && semi[f] !== semi[f - 1]) edge[f] = 1
      }
      // 新音高需向后持续 >=3 帧
      for (let f = 0; f < nF - 2; f++) {
        if (!(semi[f] === semi[f + 1] && semi[f] === semi[f + 2])) edge[f] = 0
      }
      const dil = binaryDilation(edge, 1) // ones(3)
      this.noteEdge = Float32Array.from(dil)
    }

    // 声活度膨胀掩码：抑制纯伴奏段的 onset 假线索
    this.activeDil = Float32Array.from(
      binaryDilation(this.active, Math.max(1, Math.round(P.ACT_DIL_S / DT)))
    )
  }

  frame(t: number): number {
    return Math.min(Math.max(Math.round(t / DT), 0), this.nFrames - 1)
  }

  /** 窗口 [f0, f1] 内的边界线索：onset / 重新起音 / 音高跳变 / 上升沿 的融合 */
  boundaryCue(f0: number, f1: number): Float32Array {
    const P = this.P
    const len = f1 - f0 + 1
    const out = new Float32Array(len)
    for (let i = 0; i < len; i++) {
      const f = f0 + i
      let on = this.onset[f]
      on = on / (on + P.CUE_SOFT)
      on = on * (P.CUE_ACCOMP + (1.0 - P.CUE_ACCOMP) * this.activeDil[f])
      const rv = this.revoice[f] * P.CUE_REV_ONSET
      const pj = this.pjump[f] * P.CUE_PJUMP
      let ri = this.rise[f]
      ri = (ri / (ri + P.CUE_SOFT)) * P.CUE_RISE
      const ne = this.noteEdge[f] * P.CUE_NOTE
      out[i] = Math.max(on, rv, pj, ri, ne)
    }
    return out
  }
}

function medOkArr(hasMedium: boolean[], segLen: number[], minSeg: number): boolean[] {
  const out = new Array<boolean>(hasMedium.length).fill(false)
  for (let i = 0; i < hasMedium.length; i++) {
    out[i] = hasMedium[i] && segLen[i] >= minSeg
  }
  return out
}

// ---------------------------------------------------------------- 行区间精修

/** RMS-VAD 兜底：帧区间 [f_lo, f_hi) 内的布尔活动掩码 */
function vocalActiveRegions(feat: Features, fLo: number, fHi: number, P: AlignParams): Uint8Array {
  const len = fHi - fLo
  if (len <= 0) return new Uint8Array(0)
  const seg = feat.rms.subarray(fLo, fHi)
  const thr = P.VAD_THR_RATIO * (percentile(seg, 90) + 1e-9)
  let act: Uint8Array = new Uint8Array(len)
  for (let i = 0; i < len; i++) act[i] = seg[i] > thr ? 1 : 0
  act = binaryClosing(act, Math.max(1, Math.round(P.VAD_CLOSE_S / DT)))
  const minN = Math.max(1, Math.round(P.VAD_MINSEG_S / DT))
  for (const [a, b] of extractRuns(act)) {
    if (b - a + 1 < minN) {
      for (let i = a; i <= b; i++) act[i] = 0
    }
  }
  return act
}

/** 行窗口内是否存在成段强浊音——有则行尾可用音高规则锚定 */
function lineHasAnchor(
  feat: Features,
  tStart: number,
  tEnd: number,
  tokens: Token[],
  P: AlignParams
): boolean {
  const weightSum = tokens.reduce((s, t) => s + t.weight, 0)
  const cap = P.END_CAP_BASE_S + weightSum * P.END_CAP_PER_UNIT
  const fLo = feat.frame(Math.max(0.0, tStart - P.START_BACK_S))
  const fHi = feat.frame(Math.min(feat.duration, tEnd, tStart + cap))
  if (fHi <= fLo) return false
  const minSeg = Math.round(P.STR_MIN_SEG_S / DT)
  // 提取 strong 段
  let runLen = 0
  for (let f = fLo; f <= fHi; f++) {
    if (feat.strong[f]) {
      runLen++
      if (runLen >= minSeg) return true
    } else {
      runLen = 0
    }
  }
  return false
}

/** 把标注行区间 [tStart, tEnd] 精修为真实演唱区间 [t0, t1] */
function refineWindow(
  feat: Features,
  tStart: number,
  tEnd: number,
  tokens: Token[],
  budgetPerUnit: number,
  P: AlignParams
): [number, number] {
  const n = tokens.length
  const weightSum = tokens.reduce((s, t) => s + t.weight, 0)
  tEnd = Math.min(tEnd, feat.duration)
  const cap = P.END_CAP_BASE_S + weightSum * P.END_CAP_PER_UNIT

  // ---- 行首：标注点附近最近的浊音段起点，向左退到邻近 onset ----
  const fA = feat.frame(Math.max(0.0, tStart - P.START_BACK_S))
  const fB = feat.frame(Math.min(feat.duration, tStart + P.START_FWD_S))
  let t0: number | null = null
  if (fB > fA) {
    let bestF = -1
    let bestDist = Infinity
    for (let f = fA; f <= fB; f++) {
      if (feat.revoice[f] > 0) {
        const dist = Math.abs(f * DT - tStart)
        if (dist < bestDist) {
          bestDist = dist
          bestF = f
        }
      }
    }
    if (bestF >= 0) {
      const fV = bestF
      // 向左退到 onset（覆盖声母/辅音起音）
      const fOb = Math.max(fA, fV - Math.round(P.START_BACKOFF_S / DT))
      let oMax = 0
      let oIdx = -1
      for (let f = fOb; f <= fV; f++) {
        if (feat.onset[f] > oMax) {
          oMax = feat.onset[f]
          oIdx = f
        }
      }
      t0 = oIdx >= 0 && oMax > 0.1 ? oIdx * DT - 0.01 : fV * DT - 0.04
    }
  }
  if (t0 === null) {
    // 无浊音：RMS-VAD 兜底
    const act = vocalActiveRegions(feat, fA, fB, P)
    t0 = tStart
    for (let i = 0; i < act.length; i++) {
      if (act[i]) {
        t0 = (fA + i) * DT
        break
      }
    }
  }
  t0 = Math.min(Math.max(t0, 0.0), tEnd - 0.25)

  // ---- 行尾：响度掩码衰减 + 尾音音高连续性 ----
  const fLo = feat.frame(t0)
  const fHi = feat.frame(Math.min(tEnd, t0 + cap))
  let t1 = Math.min(tEnd, t0 + cap)
  if (fHi > fLo) {
    const wLen = fHi - fLo + 1
    let anyActive = false
    let lastActiveRel = -1
    for (let i = 0; i < wLen; i++) {
      if (feat.sounding[fLo + i]) {
        anyActive = true
        lastActiveRel = i
      }
    }
    if (anyActive) {
      // 强帧碎片（<0.12s）多为伴奏偶发周期段，不作人声锚点
      const minStr = Math.round(P.STR_MIN_SEG_S / DT)
      const strW = new Uint8Array(wLen)
      {
        let f = fLo
        while (f <= fHi) {
          if (feat.strong[f]) {
            let j = f
            while (j + 1 <= fHi && feat.strong[j + 1]) j++
            if (j - f + 1 >= minStr) {
              for (let k = f; k <= j; k++) strW[k - fLo] = 1
            }
            f = j + 1
          } else {
            f++
          }
        }
      }
      const st: number[] = []
      for (let i = 0; i < wLen; i++) if (strW[i]) st.push(i)
      if (!st.length) {
        // 整行无成段强浊音：能量掩码被伴奏维持，行尾不可信 → 时长预算兜底
        const budget = P.BUDGET_BASE_S + budgetPerUnit * weightSum
        t1 = Math.min(t1, t0 + budget)
      } else {
        let fLast = fLo + lastActiveRel
        const fS = fLo + st[st.length - 1]
        // 参考音高：最后 0.3s 强浊音的中位数
        const refWindow = Math.round(0.3 / DT)
        const stRef = st.filter((s) => s >= st[st.length - 1] - refWindow)
        const refF0 = medianOf(stRef.map((s) => feat.f0[fLo + s]))
        if (refF0 > 0) {
          const envRef = feat.env[fS] * P.TAIL_ENV_RATIO
          // 有 f0 要求音高连续；无 f0（气声尾巴）信任包络
          const tailOk = new Uint8Array(wLen)
          for (let i = 0; i < wLen; i++) {
            const f = fLo + i
            const f0w = feat.f0[f]
            const semiDev = f0w > 0 ? Math.abs(12.0 * Math.log2(Math.max(f0w, 1.0) / refF0)) : 9.9
            tailOk[i] =
              feat.sounding[f] &&
              (semiDev <= P.TAIL_SEMI_TOL || f0w <= 0) &&
              feat.env[f] <= Math.max(envRef, 1e-6)
                ? 1
                : 0
          }
          const tailClosed = binaryClosing(tailOk, Math.max(1, Math.round(0.15 / DT)))
          // 取包含 fS 的连通域的末端
          const sRel = fS - fLo
          let fTail = fS
          if (tailClosed[sRel]) {
            let a = sRel
            let b = sRel
            while (a - 1 >= 0 && tailClosed[a - 1]) a--
            while (b + 1 < wLen && tailClosed[b + 1]) b++
            fTail = fLo + b
          }
          fLast = Math.min(fLast, fTail, fS + Math.round(P.END_TAIL_MAX_S / DT))
        }
        t1 = fLast * DT + P.END_RELEASE_S
        // 长低活动间隙切割：唱完进间奏
        const minGap = Math.round(P.END_GAP_CUT_S / DT)
        let i = 0
        const gapEnd = fLast - fLo + 1
        while (i < gapEnd) {
          if (!feat.sounding[fLo + i]) {
            let j = i
            while (j + 1 < gapEnd && !feat.sounding[fLo + j + 1]) j++
            if (j - i + 1 >= minGap && i * DT > n * 0.25) {
              t1 = (fLo + i) * DT + 0.1
              break
            }
            i = j + 1
          } else {
            i++
          }
        }
      }
    } else {
      // 无活动（低语/说唱/YIN失效）：RMS-VAD 兜底，更紧时长上限
      const act = vocalActiveRegions(feat, fLo, fHi, P)
      for (let i = act.length - 1; i >= 0; i--) {
        if (act[i]) {
          t1 = (fLo + i) * DT + 0.06
          break
        }
      }
      const nvCap = Math.max(2.0, weightSum * 1.2)
      t1 = Math.min(t1, t0 + nvCap)
    }
  }
  t1 = Math.min(t1, tEnd, feat.duration)

  // ---- 区间长度下限 ----
  const need = n * 0.1
  if (t1 - t0 < need) t1 = Math.min(tEnd, t0 + need)
  if (t1 - t0 < 0.25) {
    t1 = Math.min(tEnd, t0 + 0.25)
    t0 = Math.max(0.0, Math.min(t0, t1 - 0.2))
  }
  return [t0, t1]
}

// ---------------------------------------------------------------- 动态规划

/** 在帧区间 [f0, f1] 内为 tokens 分配边界，返回 N+1 个边界帧（绝对帧号）；失败返回 null */
function dpAlign(
  feat: Features,
  t0: number,
  t1: number,
  tokens: Token[],
  P: AlignParams
): Int32Array | null {
  const n = tokens.length
  const f0 = feat.frame(t0)
  let f1 = Math.max(feat.frame(t1), f0 + 2 * n)
  f1 = Math.min(f1, feat.nFrames - 1)
  const L = f1 - f0 + 1

  const cue = feat.boundaryCue(f0, f1)
  // boundReward[p] = -W_BOUND * cue[p]（起点奖励，越小越好）
  const cuv0 = feat.cuv[f0]
  // cuvW[i] = [f0, f0+i) 内无声帧数（长度 L+1）
  const cuvW = new Float64Array(L + 1)
  for (let i = 0; i <= L; i++) cuvW[i] = feat.cuv[f0 + i] - cuv0

  const weights = new Float64Array(n)
  let wSum = 0
  for (let i = 0; i < n; i++) {
    weights[i] = tokens[i].weight
    wSum += weights[i]
  }
  const total = L - 1
  const expected = new Float64Array(n)
  for (let i = 0; i < n; i++) expected[i] = (total * weights[i]) / wSum

  const minLen = new Int32Array(n)
  const maxLen = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    const ratio = i === n - 1 ? P.DUR_MAX_RATIO_LAST : P.DUR_MAX_RATIO
    minLen[i] = Math.max(Math.round(P.DUR_MIN_S / DT), Math.round(P.DUR_MIN_RATIO * expected[i]))
    maxLen[i] = Math.min(Math.round(P.DUR_MAX_S / DT), Math.round(ratio * expected[i]))
    if (maxLen[i] < minLen[i] + 1) maxLen[i] = minLen[i] + 1
  }

  const INF = Infinity
  const dp: Float64Array[] = []
  const ptr: Int32Array[] = []
  for (let k = 0; k <= n; k++) {
    dp.push(new Float64Array(L).fill(INF))
    ptr.push(new Int32Array(L).fill(-1))
  }
  dp[0][0] = 0.0

  for (let k = 1; k <= n; k++) {
    const ek = Math.max(expected[k - 1], 2.0)
    const dLo = minLen[k - 1]
    const dHi = Math.min(maxLen[k - 1], L - 1)
    const lnE = Math.log(ek)
    const dpPrev = dp[k - 1]
    const dpCur = dp[k]
    const ptrCur = ptr[k]
    for (let d = dLo; d <= dHi; d++) {
      const durCost = P.W_DUR * Math.pow((Math.log(d) - lnE) / P.DUR_LN_SIGMA, 2)
      const np = L - d
      for (let p = 0; p < np; p++) {
        // 区间 [p, p+d)，绝对帧 [f0+p, f0+p+d)
        const pAbs = f0 + p
        const eAbs = pAbs + d - 1
        // 区间内首个/末个声活帧（钳到区间内）
        let fv = feat.nextVoiced[f0 + p]
        if (fv < pAbs) fv = pAbs
        if (fv > pAbs + d) fv = pAbs + d
        let lv = feat.prevVoiced[f0 + d - 1 + p]
        if (lv < pAbs - 1) lv = pAbs - 1
        if (lv > eAbs) lv = eAbs
        const lead = fv - pAbs
        const trail = eAbs - lv
        const sil = cuvW[d + p] - cuvW[p]
        const internal = Math.max(0, sil - lead - trail)
        const silCost = (P.W_LEAD * lead + P.W_GAP * internal + P.W_TRAIL * trail) * DT
        let base = dpPrev[p]
        if (k > 1) base += -P.W_BOUND * cue[p]
        const val = base + durCost + silCost
        if (val < dpCur[d + p]) {
          dpCur[d + p] = val
          ptrCur[d + p] = p
        }
      }
    }
  }

  if (!Number.isFinite(dp[n][L - 1])) return null
  const bounds: number[] = [L - 1]
  let f = L - 1
  for (let k = n; k >= 1; k--) {
    f = ptr[k][f]
    if (f < 0) return null
    bounds.push(f)
  }
  bounds.reverse()
  const out = new Int32Array(bounds.length)
  for (let i = 0; i < bounds.length; i++) out[i] = f0 + bounds[i]
  return out
}

/** 把内部边界吸附到邻近最强边界线索 */
function snapBoundaries(feat: Features, bounds: Int32Array, P: AlignParams): Int32Array {
  if (bounds.length <= 2) return Int32Array.from(bounds)
  const fLo = bounds[0]
  const fHi = bounds[bounds.length - 1]
  const cue = feat.boundaryCue(fLo, fHi)
  const out = Int32Array.from(bounds)
  for (let i = 1; i < bounds.length - 1; i++) {
    const lo = Math.max(out[i - 1] + 2, bounds[i] - P.SNAP_RADIUS)
    const hi = Math.min(out[i + 1] - 2, bounds[i] + P.SNAP_RADIUS)
    if (lo > hi) continue
    let best = lo
    let bestV = -Infinity
    for (let f = lo; f <= hi; f++) {
      if (cue[f - fLo] > bestV) {
        bestV = cue[f - fLo]
        best = f
      }
    }
    out[i] = best
  }
  return out
}

/** 间隙空格 token（QQ 逐字惯例：前字高亮在音符结束处停止，间隙归空格） */
function applyGapSpaces(feat: Features, line: KaraokeLine, P: AlignParams): void {
  const n = line.tokens.length
  const newTokens: Token[] = []
  for (let i = 0; i < n; i++) {
    const tok = line.tokens[i]
    const bI = Math.round(tok.start / DT)
    const bN = Math.round(tok.end / DT)
    let vocalEnd = tok.end
    let lastS = -1
    for (let f = bI; f < bN && f < feat.nFrames; f++) {
      if (feat.sounding[f]) lastS = f
    }
    if (lastS >= 0) vocalEnd = (lastS + 1) * DT + 0.1
    if (i < n - 1) {
      if (tok.end - vocalEnd > P.GAP_SPACE_S) {
        tok.end = vocalEnd
        newTokens.push(tok)
        const sp = makeToken(' ', 0.0)
        sp.start = vocalEnd
        sp.end = bN * DT
        sp.confidence = 1.0
        newTokens.push(sp)
        continue
      }
    } else {
      // 末字：行尾收缩到音符实际结束点
      if (line.end - vocalEnd > P.GAP_END_TRIM_S) {
        line.end = vocalEnd
        tok.end = vocalEnd
      }
    }
    newTokens.push(tok)
  }
  line.tokens = newTokens
}

function alignLine(
  feat: Features,
  line: KaraokeLine,
  tEnd: number,
  budgetPerUnit: number,
  P: AlignParams,
  monoClamp: boolean
): void {
  const n = line.tokens.length
  const [t0, t1] = refineWindow(feat, line.start, tEnd, line.tokens, budgetPerUnit, P)
  let bounds = dpAlign(feat, t0, t1, line.tokens, P)

  if (bounds === null) {
    // 兜底：按权重均匀分配
    const f0 = feat.frame(t0)
    const f1 = Math.max(feat.frame(t1), feat.frame(t0) + 2 * n)
    const cum: number[] = [0]
    for (const t of line.tokens) cum.push(cum[cum.length - 1] + t.weight)
    bounds = new Int32Array(cum.length)
    for (let i = 0; i < cum.length; i++) {
      bounds[i] = f0 + Math.round(((f1 - f0) * cum[i]) / cum[cum.length - 1])
    }
  } else {
    bounds = snapBoundaries(feat, bounds, P)
  }

  // 硬性钳制：边界不得越过下一行标注起点
  const fHard = Math.floor(Math.min(tEnd, feat.duration) / DT)
  for (let i = 0; i < bounds.length; i++) bounds[i] = Math.min(bounds[i], fHard)
  if (monoClamp) {
    // V4：单调性钳制（snapping/硬钳在极端情形可能打乱边界顺序）
    for (let i = 1; i < bounds.length; i++) {
      if (bounds[i] < bounds[i - 1]) bounds[i] = bounds[i - 1]
    }
  }

  line.start = bounds[0] * DT
  line.end = bounds[bounds.length - 1] * DT
  const cue = feat.boundaryCue(bounds[0], bounds[bounds.length - 1])
  for (let i = 0; i < line.tokens.length; i++) {
    const tok = line.tokens[i]
    tok.start = bounds[i] * DT
    tok.end = bounds[i + 1] * DT
    if (i === 0) {
      tok.confidence = 1.0
    } else {
      const c = cue[bounds[i] - bounds[0]]
      tok.confidence = Math.round(Math.min(1.0, 0.3 + 0.7 * c) * 1000) / 1000
    }
  }
  applyGapSpaces(feat, line, P)
}

/** 两遍对齐 + 相邻行重叠修正（原地修改 lines） */
function alignLines(
  feat: Features,
  lines: KaraokeLine[],
  P: AlignParams,
  overlapClamp: boolean,
  onStage?: (stage: string) => void
): void {
  const anchors: number[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const tEnd = i + 1 < lines.length ? lines[i + 1].start : feat.duration
    if (lineHasAnchor(feat, line.start, tEnd, line.tokens, P)) {
      anchors.push(i)
      alignLine(feat, line, tEnd, 0.55, P, overlapClamp)
    }
    if (onStage && i % 8 === 0) onStage(`逐字对齐 ${i + 1}/${lines.length}`)
  }
  let perUnit = 0.55
  if (anchors.length) {
    const perUnits = anchors.map((i) => {
      const l = lines[i]
      const w = l.tokens.reduce((s, t) => s + t.weight, 0)
      return (l.end - l.start) / Math.max(w, 1e-9)
    })
    perUnit = Math.min(Math.max(medianOf(perUnits), 0.3), 1.2)
  }
  const anchorSet = new Set(anchors)
  for (let i = 0; i < lines.length; i++) {
    if (anchorSet.has(i)) continue
    const line = lines[i]
    const tEnd = i + 1 < lines.length ? lines[i + 1].start : feat.duration
    alignLine(feat, line, tEnd, perUnit, P, overlapClamp)
  }

  // 相邻行重叠修正：卡拉OK 惯例共享边界，切在重叠区包络最弱点
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1]
    const cur = lines[i]
    if (cur.start < prev.end - 0.02 && prev.tokens.length && cur.tokens.length) {
      const fA = feat.frame(cur.start)
      const fB = feat.frame(prev.end)
      let boundary: number
      if (fB > fA + 1) {
        let minIdx = fA
        let minV = Infinity
        for (let f = fA; f <= fB; f++) {
          if (feat.env[f] < minV) {
            minV = feat.env[f]
            minIdx = f
          }
        }
        boundary = minIdx * DT
      } else {
        boundary = (prev.end + cur.start) / 2.0
      }
      if (overlapClamp) {
        // V4：共享边界必须同时落在 前末字 与 后首字 的时长范围内
        const lo = Math.max(cur.start, prev.tokens[prev.tokens.length - 1].start)
        const hi = Math.min(prev.end, cur.tokens[0].end)
        if (hi <= lo) continue
        boundary = Math.min(Math.max(boundary, lo), hi)
      }
      prev.end = boundary
      prev.tokens[prev.tokens.length - 1].end = boundary
      cur.start = boundary
      cur.tokens[0].start = boundary
    }
  }
}

// ---------------------------------------------------------------- 输出

function fmtTime(t: number, digits: number = 2): string {
  t = Math.max(0, t)
  const mm = Math.floor(t / 60)
  const ss = t - mm * 60
  const ssStr = ss.toFixed(digits)
  return `${String(mm).padStart(2, '0')}:${ssStr.padStart(3 + digits, '0')}`
}

/**
 * 输出增强 LRC（逐字/逐词卡拉OK时间戳）。
 * 【修复】每行逐字歌词之后，以相同起始时间戳补写原歌词的翻译行。
 */
export function buildKaraokeLrc(lines: KaraokeLine[]): string {
  const rows: string[] = []
  for (const line of lines) {
    const parts: string[] = [`[${fmtTime(line.start)}]`]
    for (const tok of line.tokens) {
      parts.push(`<${fmtTime(tok.start)}>${tok.text}`)
    }
    parts.push(`<${fmtTime(line.end)}>`)
    rows.push(parts.join(''))
    for (const tr of line.translations) {
      rows.push(`[${fmtTime(line.start)}]${tr}`)
    }
  }
  return rows.join('\n') + '\n'
}

// ---------------------------------------------------------------- 主流程

/**
 * 生成逐字歌词。
 * @param samples 单声道 PCM（22050Hz，-1..1）
 * @param lrcText 逐行 LRC 文本
 * @param algo 'v3' | 'v4'
 * @param onStage 进度回调（阶段描述）
 * @returns 增强 LRC 文本；无有效歌词行时返回 null
 */
export function generateKaraokeLrc(
  samples: Float32Array,
  lrcText: string,
  algo: KaraokeAlgo,
  onStage?: (stage: string) => void
): string | null {
  const lines = parseLrcForAlign(lrcText)
  if (!lines.length) return null
  const P = algo === 'v4' ? PARAMS_V4 : PARAMS_V3
  const feat = new Features(samples, P, onStage)
  onStage?.('逐字对齐')
  alignLines(feat, lines, P, algo === 'v4', onStage)
  return buildKaraokeLrc(lines)
}
