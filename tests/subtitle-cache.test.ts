import { describe, expect, it } from 'vitest';
import { SubtitleCache } from '../src/core/subtitle-cache';
import type { SubtitleSegment } from '../src/core/types';

const caption = (text: string, time: number): SubtitleSegment => ({ text, start: time, end: time, source: 'youtube-dom', language: 'und' });

describe('短时字幕缓存', () => {
  it('持续显示同一句字幕时延长观测区间', () => {
    const cache = new SubtitleCache();
    cache.observe(caption('A sentence', 2), 2);
    cache.observe(caption('A sentence', 2.5), 2.5);
    expect(cache.all()).toHaveLength(1);
    expect(cache.select(2.3)?.text).toBe('A sentence');
  });
  it('切换边界只回退到最近 0.65 秒的字幕', () => {
    const cache = new SubtitleCache();
    cache.observe(caption('A sentence', 2), 2);
    cache.observe(null, 2.4);
    expect(cache.select(2.4)?.text).toBe('A sentence');
    expect(cache.select(2.8)).toBeUndefined();
  });
  it('时间微调不优先选择目标之后才开始的字幕', () => {
    const cache = new SubtitleCache();
    cache.observe(caption('Previous', 1), 1);
    cache.observe(caption('Previous', 1.4), 1.4);
    cache.observe(caption('Next', 1.6), 1.6);
    expect(cache.select(1.5)?.text).toBe('Previous');
    expect(cache.select(1.6)?.text).toBe('Next');
    expect(cache.select(0.95)).toBeUndefined();
  });
  it('退回播放进度后不保留原来片段', () => {
    const cache = new SubtitleCache();
    cache.observe(caption('Old', 5), 5);
    cache.observe(caption('New', 1), 1);
    expect(cache.all().map((value) => value.text)).toEqual(['New']);
  });
  it('大幅向前跳转也会清空缓存', () => {
    const cache = new SubtitleCache();
    cache.observe(caption('Old', 5), 5);
    cache.observe(caption('New', 20), 20);
    expect(cache.all().map((value) => value.text)).toEqual(['New']);
  });
  it('连续采样只保留最近 12 秒', () => {
    const cache = new SubtitleCache();
    for (let time = 0; time < 20; time++) cache.observe(caption(`At ${time}`, time), time);
    expect(cache.all()[0]?.start).toBeGreaterThanOrEqual(7);
  });
  it('上一条按开始时间选择，而不是重复当前字幕', () => {
    const cache = new SubtitleCache();
    cache.observe(caption('First', 1), 1);
    cache.observe(caption('Second', 2), 2);
    expect(cache.previous(2)?.text).toBe('First');
  });
  it('返回副本，不允许调用方损坏缓存', () => {
    const cache = new SubtitleCache();
    cache.observe(caption('Original', 1), 1);
    cache.all()[0]!.text = 'Changed';
    expect(cache.select(1)?.text).toBe('Original');
  });
});
