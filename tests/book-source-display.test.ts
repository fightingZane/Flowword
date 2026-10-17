import { describe, expect, it, vi } from 'vitest';
vi.mock('wxt/browser', () => ({ browser: {} }));
import { quickSourceLabel } from '../src/ui/QuickWordbook';

describe('真实收藏来源展示', () => {
  it('网页只显示原文入口，不制造视频时间', () => {
    const label = quickSourceLabel({ sentence: 'A clear reference.', url: 'https://example.com/article', title: 'Research notes', source: { kind: 'web', quote: { exact: 'A clear reference.' } } });
    expect(label).toBe('↗ Research notes · 回到原文'); expect(label).not.toMatch(/\d+:\d\d/);
  });
  it('旧版无来源类型的视频仍保留真实时间', () => expect(quickSourceLabel({ sentence: 'A video sentence.', url: 'https://example.com/video', title: 'Video lesson', time: 65.8 })).toBe('▷ Video lesson · 1:05'));
  it('网页没有标题时也不误称视频', () => expect(quickSourceLabel({ sentence: 'Example text.', url: 'https://example.com', source: { kind: 'web' } })).toBe('↗ 来源网页 · 回到原文'));
});
