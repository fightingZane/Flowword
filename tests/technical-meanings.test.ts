import { describe, expect, it } from 'vitest';
import { analyzeVocabulary } from '../src/core/vocabulary';
import { getCuratedMeaning, TECH_MEANINGS } from '../src/core/curated-meanings';
describe('科技表达的本地参考义', () => {
  it('散热专业词优先于actually且不拆出chamber抢推荐位', () => {
    const candidates = analyzeVocabulary('The vapor chamber actually reduces thermal throttling in this ultra-thin phone.');
    expect(candidates[0]?.lemma).toBe('vapor chamber');
    expect(candidates.find((item) => item.lemma === 'vapor chamber')?.meaning).toContain('均热板');
    expect(candidates.find((item) => item.lemma === 'thermal throttling')?.meaning).toContain('过热降频');
    expect(candidates.some((item) => ['actually','chamber'].includes(item.lemma))).toBe(false);
  });
  it('ultra-thin参考义不把Air误译成空气，且保留程度和用法解释', () => {
    const entry = getCuratedMeaning('ultra-thin');
    expect(entry?.meaning).toContain('超薄');
    expect(entry?.meaning).not.toContain('空气');
    expect(entry?.meaning.length).toBeGreaterThan(35);
  });
  it('术语附制造商依据，普通词义不因存在技术术语而被全局改写', () => {
    expect(TECH_MEANINGS.every((entry) => /^https:\/\/(www\.)?(eaton\.com\.cn|intel\.com)\//.test(entry.sourceUrl))).toBe(true);
    expect(getCuratedMeaning('chamber')).toBeUndefined();
    expect(getCuratedMeaning('actually')).toBeUndefined();
    expect(analyzeVocabulary('The useful chamber contains vapor.').some((item) => item.lemma === 'vapor chamber')).toBe(false);
  });
});
