import { describe, expect, it } from 'vitest';
import { safeSourceUrl, videoIdentity, videoSourceLink } from '../src/storage/archive';
import { validateEntry } from '../src/storage/wordbook';

describe('学习视频来源与安全定位', () => {
  it('接受普通 HTTP 和 HTTPS 视频来源', () => {
    expect(safeSourceUrl('https://example.com/course?id=7')).toBe('https://example.com/course?id=7');
    expect(safeSourceUrl('http://localhost:8000/video')).toBe('http://localhost:8000/video');
  });
  it('拒绝脚本、文件、带凭据与非法地址', () => {
    for (const url of ['javascript:alert(1)', 'file:///C:/secret', 'https://name:password@example.com', 'invalid']) expect(safeSourceUrl(url)).toBeUndefined();
  });
  it('同一 YouTube 视频不同时间归并到同一视频', () => {
    const context = { sentence: 'A sentence.', time: 5, url: 'https://www.youtube.com/watch?v=abc&t=5s' };
    expect(videoIdentity(context)).toBe(videoIdentity({ ...context, url: 'https://www.youtube.com/watch?v=abc&t=25s' }));
    expect(videoIdentity(context)).not.toBe(videoIdentity({ ...context, url: 'https://www.youtube.com/watch?v=other' }));
  });
  it('视频定位替换旧时间参数且保留查询参数', () => expect(videoSourceLink({ sentence: 'test', time: 63.9, url: 'https://www.youtube.com/watch?v=abc&t=5s' })).toBe('https://www.youtube.com/watch?v=abc&t=63s'));
  it('通用网站采用媒体时间片段', () => expect(videoSourceLink({ sentence: 'test', time: 17, url: 'https://example.com/video?id=7' })).toBe('https://example.com/video?id=7#t=17'));
  it('收藏整句保留视频标题、原句译文和结束时间', () => {
    const entry = validateEntry({ kind: 'sentence', text: 'A whole sentence.', contexts: [{ sentence: 'A whole sentence.', url: 'https://example.com/video', time: 12, title: '课程', end: 15, translation: '完整句子' }], apiKey: 'never-export-this' });
    expect(entry.kind).toBe('sentence'); expect(entry.contexts[0]).toMatchObject({ title: '课程', end: 15, translation: '完整句子' }); expect('apiKey' in entry).toBe(false);
  });
});
