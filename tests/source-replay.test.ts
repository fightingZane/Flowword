import { describe, expect, it } from 'vitest';
import { normalizeReplaySource, sourceMatches, normalizeWebSource, webSourceLink } from '../src/core/source-replay';
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


describe('网页来源回看', () => {
  it('保留网页身份与选区文本，不接受伪造视频时间', () => {
    const input = { url: 'https://example.test/article#old', sentence: 'Take a step back.', source: { kind: 'web', quote: { exact: 'step back', prefix: 'Take a', suffix: 'and rethink' } } };
    const normalized = normalizeWebSource(input);
    expect(normalized.url).toBe('https://example.test/article#old');
    expect(webSourceLink(normalized)).toBe('https://example.test/article#old:~:text=Take%20a-,step%20back,-and%20rethink');
    expect(() => normalizeWebSource({ ...input, time: 0 })).toThrow();
    expect(() => normalizeWebSource({ ...input, url: 'javascript:alert(1)' })).toThrow();
    expect(() => normalizeWebSource({ ...input, url: 'https://name:secret@example.test/' })).toThrow();
  });
});
