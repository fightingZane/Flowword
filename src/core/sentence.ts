import type { SentenceContext, SubtitleSnapshot } from './types';

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();   // 保留原文，只整理字幕换行和多余空白
}

export function joinObserved(left: string, right: string): string {
  const first = normalizeText(left);
  const second = normalizeText(right);
  if (!first) return second;
  if (!second) return first;
  const a = first.split(' ');
  const b = second.split(' ');
  const key = (word: string) => word.toLowerCase().replace(/[.,!?;:]+$/g, '');
  for (let count = Math.min(a.length, b.length); count > 0; count--) {
    if (a.slice(-count).every((word, index) => key(word) === key(b[index] ?? ''))) {
      return [...a.slice(0, -count), ...b].join(' ');   // 自动字幕滚动时去掉真实重复的词
    }
  }
  return `${first} ${second}`;
}

export function assembleSentence(snapshot: SubtitleSnapshot): SentenceContext {
  let text = normalizeText(snapshot.selected.text);
  let start = snapshot.selected.start;
  const past = snapshot.segments
    .filter((segment) => segment.start < start - 0.05 && segment.end <= snapshot.targetTime + 0.2)
    .sort((a, b) => b.start - a.start);

  // 仅拼接已观测到的连续片段，碰到上一句的结束标点就停止
  // 最多取前两段，不读取未来字幕来补造用户尚未听到的句子
  for (const segment of past.slice(0, 2)) {
    if (start - segment.end > 0.55 || snapshot.selected.start - segment.start > 8) break;
    if (/[.!?]["'”’)]?$/.test(segment.text)) break;
    text = joinObserved(segment.text, text);
    start = segment.start;
  }
  return { ...snapshot, text, isPartial: !/[.!?]["'”’)]?$/.test(text) };
}
