import { describe, expect, it } from 'vitest';
import { entryKey, hasMeaning, hasSourceSpan } from '../src/core/learning-view';

describe('推荐项中文释义校验', () => {
  it.each([undefined, '', '   ', 'vapor chamber', '暂无参考释义', '参考释义查询中…', '未提供释义', '没有参考释义', '<b>均热板</b>'])('拒绝空义、占位和标记文本 %s', (meaning) => {
    expect(hasMeaning(meaning)).toBe(false);
  });
  it('保留有效通用义和包含未提供等正常解释', () => {
    expect(hasMeaning('均热板，利用内部工质相变将局部热量扩散到更大面积')).toBe(true);
    expect(hasMeaning('暂定的，尚未提供最终确认')).toBe(true);
    expect(hasMeaning('未经证实，尚未提供证据')).toBe(true);
  });
  it('拒绝过长释义', () => {
    expect(hasMeaning('义'.repeat(1501))).toBe(false);
  });
});

describe('推荐原文完整片段校验', () => {
  it('保留完整词组、大小写差异和连续空白', () => {
    expect(hasSourceSpan('This Vapor  Chamber spreads heat.', 'vapor chamber')).toBe(true);
    expect(hasSourceSpan('An ultra-thin vapor chamber.', 'ultra-thin')).toBe(true);
    expect(hasSourceSpan('I came across a reference.', 'came across')).toBe(true);
  });
  it('拒绝词内子串和其他句子的旧缓存', () => {
    expect(hasSourceSpan('I understand the standard.', 'stand')).toBe(false);
    expect(hasSourceSpan('An ultra-thin layer.', 'thin')).toBe(false);
    expect(hasSourceSpan("It doesn't work.", 'does')).toBe(false);
    expect(hasSourceSpan('An advanced camera.', 'vapor chamber')).toBe(false);
    expect(hasSourceSpan('café', 'caf')).toBe(false);
  });
  it('原样匹配标点且不将正则字符当成语法', () => {
    expect(hasSourceSpan('The C++ code uses a (buffer).', 'C++')).toBe(true);
    expect(hasSourceSpan('A word followed by abc.', 'a.*')).toBe(false);
  });
  it('拒绝空片段或过长片段', () => {
    expect(hasSourceSpan('A sentence.', '')).toBe(false);
    expect(hasSourceSpan('A sentence.', 'x'.repeat(151))).toBe(false);
  });
});

it('收藏标识按类型和词形匹配，不混同整句与单词', () => {
  expect(entryKey('word', '  Obscure  ')).toBe(entryKey('word', 'obscure'));
  expect(entryKey('sentence', 'Obscure')).not.toBe(entryKey('word', 'obscure'));
});
