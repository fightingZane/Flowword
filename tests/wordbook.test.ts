import { describe, expect, it } from 'vitest';
import { mergeEntries, validateEntry } from '../src/storage/wordbook';
import { filterWordbook } from '../src/core/wordbook-filters';

const make = (text: string, kind: 'word' | 'phrase' | 'sentence' = 'word') => validateEntry({ text, kind, translation: '测试译文', partOfSpeech: '名词', examTags: ['词义辨析', '四级'], tags: ['工作表达'], contexts: [{ sentence: 'An observed sentence.', url: 'https://www.youtube.com/watch?v=test', time: 12 }] });
describe('单词本去重与多维分类', () => {
  it('同类型英文大小写和空白不会生成重复条目', () => expect(make(' Standpoint ').id).toBe(make('standpoint').id));
  it('词条与整句分类是独立键', () => expect(make('test', 'sentence').id).not.toBe(make('test', 'word').id));
  it('重复加入保留创建时间，合并标签而不丢原译文', () => {
    const old = { ...make('standpoint'), createdAt: 1 };
    const next = { ...make('standpoint'), translation: '', examTags: ['写作表达'], tags: ['技术英语'] };
    const merged = mergeEntries(old, next);
    expect(merged.createdAt).toBe(1); expect(merged.translation).toBe('测试译文');
    expect(merged.examTags).toEqual(['词义辨析', '四级', '写作表达']); expect(merged.contexts).toHaveLength(1);
  });
  it('词性、考点和自定义标签可同时筛选', () => {
    const entries = [make('standpoint'), { ...make('came across', 'phrase'), partOfSpeech: '短语' }];
    expect(filterWordbook(entries, { search: '', kind: 'word', part: '名词', exam: '四级', tag: '工作表达' })).toHaveLength(1);
    expect(filterWordbook(entries, { search: '', kind: '', part: '名词', exam: '雅思', tag: '' })).toHaveLength(0);
  });
  it('可搜索译文和标签', () => expect(filterWordbook([make('test')], { search: '工作表达', kind: '', part: '', exam: '', tag: '' })).toHaveLength(1));
  it('拒绝空白条目，不保存任意站点的来源', () => {
    expect(() => make('   ')).toThrow();
    expect(validateEntry({ ...make('test'), contexts: [{ sentence: 'test', url: 'javascript:alert(1)', time: 1 }] }).contexts).toEqual([]);
  });
});
