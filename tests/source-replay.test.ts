import { describe, expect, it } from 'vitest';
import { normalizeReplaySource, sourceMatches } from '../src/core/source-replay';
const source = { url: 'https://www.youtube.com/watch?v=fixture', time: 3, end: 6, sentence: 'A real sentence.' };
describe('词卡来源重听校验', () => {
  it('拒绝危险地址和不完整时间信息', () => {
    expect(() => normalizeReplaySource({ ...source, url: 'javascript:alert(1)' })).toThrow();
    expect(() => normalizeReplaySource({ ...source, time: -1 })).toThrow();
    expect(() => normalizeReplaySource({ ...source, url: 'https://user:secret@example.test/' })).toThrow();
  });
  it('只匹配同一个视频，不因不同时间参数拒绝，也不操作其他视频', () => {
    expect(sourceMatches(source, source.url + '&t=10s', 'fixture')).toBe(true);
    expect(sourceMatches(source, 'https://www.youtube.com/watch?v=other', 'other')).toBe(false);
    expect(sourceMatches(source, source.url, null)).toBe(false);
  });
  it('通用站相同网址的不同媒体身份仍要区分', () => {
    const entry = { ...source, url: 'https://example.test/course', videoKey: 'media-a' };
    expect(sourceMatches(entry, entry.url + '#t=10', 'media-a')).toBe(true);
    expect(sourceMatches(entry, entry.url, 'media-b')).toBe(false);
  });
});
