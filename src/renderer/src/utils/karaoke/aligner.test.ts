// 逐字歌词算法的文本处理与输出回归测试（翻译保留 / 词间空格保留 / 解析往返）
import { describe, it, expect } from 'vitest'
import { parseLrcForAlign, buildKaraokeLrc } from './aligner'
import { parseLrc } from '../lyric/ParseLrc'

const SAMPLE = `[00:01.623]歌手: 某人
[00:28.715]When voice from the memories call
[00:28.715]当旧忆传来声声呼唤
[00:32.268]Unresolved the riddles stood ever long
[00:32.268]昔日的谜犹然未解
[00:44.595]（破夜）
[00:46.301]In the silent waste
[00:46.301]寂寥荒原
`

describe('parseLrcForAlign', () => {
  it('过滤制作名单行', () => {
    const lines = parseLrcForAlign(SAMPLE)
    expect(lines.some((l) => l.text.includes('歌手'))).toBe(false)
  })

  it('保留翻译行', () => {
    const lines = parseLrcForAlign(SAMPLE)
    expect(lines).toHaveLength(4)
    expect(lines[0].translations).toEqual(['当旧忆传来声声呼唤'])
    expect(lines[1].translations).toEqual(['昔日的谜犹然未解'])
    expect(lines[2].translations).toEqual([])
    expect(lines[3].translations).toEqual(['寂寥荒原'])
  })

  it('拉丁词 token 保留词间空格', () => {
    const lines = parseLrcForAlign(SAMPLE)
    const texts = lines[0].tokens.map((t) => t.text)
    expect(texts).toEqual(['When ', 'voice ', 'from ', 'the ', 'memories ', 'call'])
    // 词权重只按音节，不含空格
    expect(lines[0].tokens[0].weight).toBe(1)
    expect(lines[0].tokens[4].weight).toBe(3)
  })

  it('纯中文括号行保留并逐字切分', () => {
    const lines = parseLrcForAlign(SAMPLE)
    const bracket = lines[2]
    expect(bracket.tokens.map((t) => t.text).join('')).toBe('破夜')
  })
})

describe('buildKaraokeLrc', () => {
  function fakeAlign(lrc: string): string {
    const lines = parseLrcForAlign(lrc)
    // 假对齐：每行 4 秒，token 均匀分配
    for (const line of lines) {
      line.end = line.start + 4
      const n = line.tokens.length
      for (let i = 0; i < n; i++) {
        line.tokens[i].start = line.start + (4 * i) / n
        line.tokens[i].end = line.start + (4 * (i + 1)) / n
      }
    }
    return buildKaraokeLrc(lines)
  }

  it('输出包含逐字时间标签且保留词间空格', () => {
    const out = fakeAlign(SAMPLE)
    const firstRow = out.split('\n')[0]
    expect(firstRow).toContain('<00:28.71>When ')
    expect(firstRow).toContain('voice ')
    expect(firstRow).toMatch(/call<\d{2}:\d{2}\.\d{2}>$/)
  })

  it('输出保留翻译行（与逐字行同一起始时间戳）', () => {
    const out = fakeAlign(SAMPLE)
    const rows = out.split('\n')
    expect(rows[1]).toBe('[00:28.71]当旧忆传来声声呼唤')
    expect(rows.some((r) => r.includes('昔日的谜犹然未解'))).toBe(true)
  })

  it('应用侧解析器（ParseLrc）可解析：词级时间轴 + 翻译 + 空格', () => {
    const out = fakeAlign(SAMPLE)
    const lines = parseLrc(out)
    expect(lines.length).toBeGreaterThan(0)
    const first = lines[0]
    // 逐字词单元
    expect(first.words.length).toBeGreaterThan(1)
    expect(first.words.map((w) => w.word).join('')).toBe('When voice from the memories call')
    expect(first.words[1].startTime).toBeGreaterThan(first.words[0].startTime)
    // 翻译
    expect(first.translatedLyric).toBe('当旧忆传来声声呼唤')
  })
})
