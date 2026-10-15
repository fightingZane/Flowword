import { describe, expect, it, vi } from 'vitest';
vi.mock('wxt/browser', () => ({ browser: {} }));
import { quickWordbookEntries } from '../src/ui/QuickWordbook';
import type { WordbookEntry } from '../src/core/types';

// entry 表示测试收藏，index 控制词条与更新时间，patch 覆盖搜索所需字段
// 只构造本地测试数据，不读写扩展数据库
function entry(index: number, patch: Partial<WordbookEntry> = {}): WordbookEntry {
  return { id: `word:${index}`, kind: 'word', text: `word ${index}`, lemma: `lemma ${index}`, translation: `译文 ${index}`, partOfSpeech: '未分类', examTags: [], tags: [], contexts: [], createdAt: index, updatedAt: index, ...patch };
}
describe('悬浮词本最近收藏与搜索', () => {
  it('更新时间降序，只取最近二十条且不修改输入数组', () => {
    const entries = Array.from({ length: 25 }, (_, index) => entry(index));
    const result = quickWordbookEntries(entries, ''); expect(result).toHaveLength(20); expect(result[0]?.id).toBe('word:24'); expect(result.at(-1)?.id).toBe('word:5'); expect(entries[0]?.id).toBe('word:0');
  });
  it('按原文、词形与译文搜索，忽略大小写和首尾空白', () => {
    const entries = [entry(1, { text: 'Came Across', lemma: 'come across', translation: '偶然发现' }), entry(2)];
    expect(quickWordbookEntries(entries, '  CAME ')).toHaveLength(1); expect(quickWordbookEntries(entries, 'come across')).toHaveLength(1); expect(quickWordbookEntries(entries, '偶然')).toHaveLength(1);
  });
  it('搜索全部收藏后取二十条，旧收藏仍可找到', () => {
    const entries = Array.from({ length: 25 }, (_, index) => entry(index)); entries[0] = entry(0, { text: 'rare expression' }); expect(quickWordbookEntries(entries, 'rare')[0]?.id).toBe('word:0');
  });
  it('没有匹配或空列表时返回空数组', () => { expect(quickWordbookEntries([], '')).toEqual([]); expect(quickWordbookEntries([entry(1)], 'missing')).toEqual([]); });
});
