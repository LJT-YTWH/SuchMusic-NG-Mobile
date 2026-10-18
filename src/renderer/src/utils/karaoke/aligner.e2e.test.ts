// 逐字对齐算法端到端冒烟测试：合成"类人声"音频 → 完整 DSP + DP 管线
import { describe, it, expect } from 'vitest'
import { generateKaraokeLrc, SR } from './aligner'

/** 合成带谐波与振幅包络的"哼唱"片段 */
function synthSong(): Float32Array {
  const dur = 15
  const n = dur * SR
  const y = new Float32Array(n)
  // (起始秒, 结束秒, 基频)
  const segs: Array<[number, number, number]> = [
    [1.0, 4.2, 220],
    [6.0, 9.2, 330],
    [11.0, 14.0, 262]
  ]
  for (const [a, b, f0] of segs) {
    const i0 = Math.floor(a * SR)
    const i1 = Math.floor(b * SR)
    for (let i = i0; i < i1; i++) {
      const t = i / SR
      // 颤音 + 双谐波，模拟人声
      const vib = 1 + 0.01 * Math.sin(2 * Math.PI * 5.5 * t)
      const ph = 2 * Math.PI * f0 * vib * t
      const env = Math.min(1, (i - i0) / (0.05 * SR)) * Math.min(1, (i1 - i) / (0.08 * SR))
      y[i] = env * (0.6 * Math.sin(ph) + 0.3 * Math.sin(2 * ph) + 0.1 * Math.sin(3 * ph)) * 0.8
    }
  }
  return y
}

const LRC = `[00:01.00]你好世界
[00:06.00]hello world
[00:06.00]你好世界
[00:11.00]再见
`

describe('generateKaraokeLrc 端到端（合成音频）', () => {
  const y = synthSong()

  it.each(['v3', 'v4'] as const)('%s 算法完整跑通且结构正确', (algo) => {
    const out = generateKaraokeLrc(y, LRC, algo)
    expect(out).toBeTruthy()
    const rows = out!.trim().split('\n')
    // 3 个逐字行 + 1 个翻译行
    expect(rows).toHaveLength(4)
    // 逐字行格式：[start]<t>字<t>字...<end>
    expect(rows[0]).toMatch(/^\[\d{2}:\d{2}\.\d{2}\](<\d{2}:\d{2}\.\d{2}>[^<]+)+<\d{2}:\d{2}\.\d{2}>$/)
    // 首行包含全部 4 个汉字
    for (const ch of ['你', '好', '世', '界']) expect(rows[0]).toContain(ch)
    // 第二行（英文）保留词间空格
    expect(rows[1]).toContain('hello ')
    expect(rows[1]).toContain('world')
    // 翻译行保留且为普通 LRC 行
    expect(rows[2]).toMatch(/^\[\d{2}:\d{2}\.\d{2}\]你好世界$/)
    // 行起始时间应接近标注时间（±1.2s）
    const start1 = parseFloat(rows[0].slice(4, 9))
    const start2 = parseFloat(rows[1].slice(4, 9)) + 60 * parseInt(rows[1].slice(1, 3), 10)
    expect(Math.abs(start1 - 1.0)).toBeLessThan(1.2)
    expect(Math.abs(start2 - 6.0)).toBeLessThan(1.2)
  }, 120000)
})
