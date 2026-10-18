import type { LyricLine, LyricWord } from "@applemusic-like-lyrics/lyric";

interface ParsedEvent {
    time: number;
    text: string;
    index: number; // 用于保持同时间戳下的原始顺序
}

/**
 * 一个更好的 LRC 解析器，相比于 AMLL 的 LRC 解析器，支持丢弃空行、trim 歌词和自动检测翻译与音译行
 * @note 如果遇到相同时间戳的歌词行，第一行会作为主歌词行，第二行会作为翻译歌词，第三行会作为音译歌词
 * @param lrcContent LRC 字符串
 * @returns LyricLine 数组
 */
export function parseLrc(lrcContent: string): LyricLine[] {
    const lines = lrcContent.split(/\r?\n/);
    const parsedEvents: ParsedEvent[] = [];

    const timeTagRegex = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

    let globalIndex = 0;

    for (const line of lines) {
        const text = line.replace(timeTagRegex, "").trim();
        const matches = line.matchAll(timeTagRegex);

        for (const match of matches) {
            const minutes = parseInt(match[1], 10);
            const seconds = parseInt(match[2], 10);
            const fractionStr = match[3] || "0";
            const milliseconds = parseInt(fractionStr.padEnd(3, "0"), 10);

            const totalMilliseconds = minutes * 60 * 1000 + seconds * 1000 + milliseconds;

            parsedEvents.push({
                time: totalMilliseconds,
                text: text,
                index: globalIndex++,
            });
        }
    }

    parsedEvents.sort((a, b) => a.time - b.time || a.index - b.index);

    const validLyricLines: LyricLine[] = [];

    let i = 0;
    while (i < parsedEvents.length) {
        const currentTime = parsedEvents[i].time;

        const group: ParsedEvent[] = [];
        while (i < parsedEvents.length && parsedEvents[i].time === currentTime) {
            group.push(parsedEvents[i]);
            i++;
        }

        const nextEvent = i < parsedEvents.length ? parsedEvents[i] : null;
        const endTime = nextEvent ? nextEvent.time : currentTime + 10000;

        const textEvents = group.filter((e) => e.text.length > 0);

        if (textEvents.length === 0) {
            continue;
        }

        const mainLine = createBasicLyricLine(textEvents[0].text, currentTime, endTime);

        // 第二行作为翻译
        if (textEvents.length > 1) {
            mainLine.translatedLyric = textEvents[1].text;
        }

        // 第三行作为音译
        if (textEvents.length > 2) {
            mainLine.romanLyric = textEvents[2].text;
        }

        validLyricLines.push(mainLine);

        if (textEvents.length > 3) {
            for (let k = 3; k < textEvents.length; k++) {
                const extraLine = createBasicLyricLine(textEvents[k].text, currentTime, endTime);
                validLyricLines.push(extraLine);
            }
        }
    }

    return validLyricLines;
}

const wordTagRegex = /<(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;

function wordTagToMs(match: RegExpExecArray): number {
    const minutes = parseInt(match[1], 10);
    const seconds = parseInt(match[2], 10);
    const fractionStr = match[3] || "0";
    const milliseconds = parseInt(fractionStr.padEnd(3, "0"), 10);
    return minutes * 60 * 1000 + seconds * 1000 + milliseconds;
}

/**
 * 解析增强（逐字）LRC 行：<mm:ss.xx>词<mm:ss.xx>词...<mm:ss.xx>
 * 最后一个时间标签为行结束标记。词文本保持原样（含词间空格 token）。
 */
function parseEnhancedWords(text: string, fallbackEndTime: number): { words: LyricWord[]; endTime: number } | null {
    wordTagRegex.lastIndex = 0;
    const tags: Array<{ ms: number; start: number; end: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = wordTagRegex.exec(text)) !== null) {
        tags.push({ ms: wordTagToMs(m), start: m.index, end: m.index + m[0].length });
    }
    if (tags.length < 2) return null;
    const words: LyricWord[] = [];
    for (let i = 0; i < tags.length - 1; i++) {
        const w = newLyricWord();
        w.word = text.slice(tags[i].end, tags[i + 1].start);
        w.startTime = tags[i].ms;
        w.endTime = tags[i + 1].ms;
        words.push(w);
    }
    // 末标签之后的残余文本（异常格式兜底）
    const tail = text.slice(tags[tags.length - 1].end);
    let endTime = tags[tags.length - 1].ms;
    if (tail.length > 0) {
        const w = newLyricWord();
        w.word = tail;
        w.startTime = endTime;
        w.endTime = Math.max(fallbackEndTime, endTime);
        words.push(w);
        endTime = w.endTime;
    }
    return { words, endTime };
}

function createBasicLyricLine(text: string, startTime: number, endTime: number): LyricLine {
    // 逐字（增强）LRC：行内含 <mm:ss.xx> 词级时间标签
    if (text.includes("<")) {
        const enhanced = parseEnhancedWords(text, endTime);
        if (enhanced && enhanced.words.length > 0) {
            const line = newLyricLine();
            line.words = enhanced.words;
            line.startTime = startTime;
            line.endTime = Math.max(enhanced.endTime, startTime);
            return line;
        }
    }

    const line = newLyricLine();
    const word = newLyricWord();

    word.word = text;
    word.startTime = startTime;
    word.endTime = endTime;

    line.words = [word];
    line.startTime = startTime;
    line.endTime = endTime;

    return line;
}

const newLyricLine = (): LyricLine => ({
    words: [],
    translatedLyric: "",
    romanLyric: "",
    isBG: false,
    isDuet: false,
    startTime: 0,
    endTime: 0,
});

const newLyricWord = (): LyricWord => ({
    startTime: 0,
    endTime: 0,
    word: "",
    romanWord: "",
});