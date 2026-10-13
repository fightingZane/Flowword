import { describe, expect, it } from 'vitest';
import { assembleSentence, joinObserved, normalizeText } from '../src/core/sentence';
import type { SubtitleSegment, SubtitleSnapshot } from '../src/core/types';

const segment = (text: string, start: number, end: number): SubtitleSegment => ({ text, start, end, source: 'youtube-dom', language: 'und' });
function snapshot(segments: SubtitleSegment[], targetTime = 6): SubtitleSnapshot {
  return { segments, selected: segments.at(-1)!, targetTime, capturedTime: targetTime, offset: 0, videoKey: 'test', title: 'test', url: 'https://www.youtube.com/watch?v=test' };
}

describe('整理已观测字幕', () => {
  it('只处理空白，不改写英文', () => expect(normalizeText('  I\ncame\tacross it.  ')).toBe('I came across it.'));
  it('拼接滚动字幕时去除重叠单词', () => expect(joinObserved('I came across', 'came across a reference.')).toBe('I came across a reference.'));
  it('完全重复的字幕只显示一次', () => expect(joinObserved('Look at this.', 'Look at this.')).toBe('Look at this.'));
  it('保留非重复的正常词语', () => expect(joinObserved('It is very', 'very interesting.')).toBe('It is very interesting.'));
  it('允许整理紧邻的未完成句', () => {
    const value = assembleSentence(snapshot([segment('I came across', 3, 5), segment('an obscure reference.', 5.3, 7)]));
    expect(value.text).toBe('I came across an obscure reference.');
  });
  it('在上句结束标点处停止', () => {
    const value = assembleSentence(snapshot([segment('That is all.', 3, 5), segment('A new idea', 5.3, 7)]));
    expect(value.text).toBe('A new idea');
    expect(value.isPartial).toBe(true);
  });
  it('不拼接中间存在较大时间空白的字幕', () => {
    expect(assembleSentence(snapshot([segment('an old fragment', 0, 2), segment('current fragment', 5, 7)])).text).toBe('current fragment');
  });
  it('不使用点击之后才开始的未来片段', () => {
    const current = segment('current fragment', 4, 6);
    const value = assembleSentence({ ...snapshot([current]), selected: current, segments: [current, segment('future words', 8, 9)] });
    expect(value.text).toBe('current fragment');
  });
});
