import { describe, expect, it } from 'vitest';
import { analyzeVocabulary, normalizeVocabularyWord } from '../src/core/vocabulary';

// 人工自编自然英语句子的回归评估集，不冒充真实视频字幕或用户陌生词标注集
// 每句规定需要找到的学习表达，另外单独检查排序、误检、词形及释义来源边界
const EVALUATION: Array<{ sentence: string; expected: string[] }> = [
  { sentence: 'I came across a rather obscure reference.', expected: ['come across', 'obscure'] },
  { sentence: 'She figured out why the experiment failed.', expected: ['figure out'] },
  { sentence: 'We cannot put up with this constant noise.', expected: ['put up with'] },
  { sentence: 'They ran out of fuel on the way home.', expected: ['run out of'] },
  { sentence: 'I am looking forward to meeting the team.', expected: ['look forward to'] },
  { sentence: 'The design takes into account the available space.', expected: ['take into account'] },
  { sentence: 'We need to get rid of these obsolete files.', expected: ['get rid of', 'obsolete'] },
  { sentence: 'The machine broke down during the demonstration.', expected: ['break down'] },
  { sentence: 'The team carried out an extensive survey.', expected: ['carry out'] },
  { sentence: 'The solution turned out to be surprisingly simple.', expected: ['turn out'] },
  { sentence: 'He brought up a crucial question.', expected: ['bring up', 'crucial'] },
  { sentence: 'Please point out any ambiguous wording.', expected: ['point out', 'ambiguous'] },
  { sentence: 'Do not take for granted the support of your team.', expected: ['take for granted'] },
  { sentence: 'She kept up with the latest developments.', expected: ['keep up with'] },
  { sentence: 'We came up with a feasible alternative.', expected: ['come up with', 'feasible'] },
  { sentence: 'They put off the meeting until Friday.', expected: ['put off'] },
  { sentence: 'We set up a small experiment.', expected: ['set up'] },
  { sentence: 'I worked out a more efficient route.', expected: ['work out', 'efficient'] },
  { sentence: 'We found out what caused the discrepancy.', expected: ['find out'] },
  { sentence: 'We have to deal with an inevitable delay.', expected: ['deal with', 'inevitable'] },
  { sentence: 'The discussion ended up being unexpectedly helpful.', expected: ['end up'] },
  { sentence: 'Do not rely on a single untested assumption.', expected: ['rely on', 'assumption'] },
  { sentence: 'A minor change can lead to substantial consequences.', expected: ['lead to', 'substantial'] },
  { sentence: 'Nothing can make up for lost time.', expected: ['make up for'] },
  { sentence: 'We backed up the files before the update.', expected: ['back up'] },
  { sentence: 'The evidence rules out a coincidence.', expected: ['rule out', 'coincidence'] },
  { sentence: 'She stuck to the original plan.', expected: ['stick to'] },
  { sentence: 'We should cut down on unnecessary expenses.', expected: ['cut down on'] },
  { sentence: 'This factor accounts for the marginal difference.', expected: ['account for', 'marginal'] },
  { sentence: 'The old structure fell apart under pressure.', expected: ['fall apart'] },
  { sentence: 'It takes time to get over a difficult experience.', expected: ['get over'] },
  { sentence: 'In terms of cost, this approach is sustainable.', expected: ['in terms of', 'sustainable'] },
  { sentence: 'On the other hand, the hypothesis remains plausible.', expected: ['on the other hand', 'hypothesis'] },
  { sentence: 'At first glance, the data looks counterintuitive.', expected: ['at first glance', 'counterintuitive'] },
  { sentence: 'As a result, we had to negotiate a new deadline.', expected: ['as a result', 'negotiate'] },
  { sentence: 'The outcome is by no means inevitable.', expected: ['by no means', 'inevitable'] },
  { sentence: 'This decision matters in the long run.', expected: ['in the long run'] },
  { sentence: 'The temporary fix will work for the time being.', expected: ['for the time being'] },
  { sentence: 'In a nutshell, the methodology needs revision.', expected: ['in a nutshell', 'methodology'] },
  { sentence: 'The announcement came out of the blue.', expected: ['out of the blue'] },
  { sentence: 'Sooner or later, the misconception will disappear.', expected: ['sooner or later', 'misconception'] },
  { sentence: 'We review the assumptions once in a while.', expected: ['once in a while', 'assumption'] },
  { sentence: 'The plan succeeded in spite of adverse conditions.', expected: ['in spite of', 'adverse'] },
  { sentence: 'Apart from that subtle flaw, the argument is coherent.', expected: ['apart from', 'subtle'] },
  { sentence: 'In addition to cost, we evaluated the potential risks.', expected: ['in addition to', 'evaluate'] },
  { sentence: 'The rule applies regardless of personal preference.', expected: ['regardless of'] },
  { sentence: 'We need empirical evidence rather than intuition.', expected: ['rather than', 'empirical'] },
  { sentence: 'We value resilience as opposed to short-term convenience.', expected: ['as opposed to'] },
  { sentence: 'Our credibility is at stake.', expected: ['at stake'] },
  { sentence: 'She spoke on behalf of the entire team.', expected: ['on behalf of'] },
  { sentence: 'The contract is in accordance with local regulations.', expected: ['in accordance with'] },
  { sentence: 'They took advantage of a rare opportunity.', expected: ['take advantage of'] },
  { sentence: 'We drew a conclusion from the available evidence.', expected: ['draw a conclusion'] },
  { sentence: 'Please pay attention to the underlying assumptions.', expected: ['pay attention to', 'underlying'] },
  { sentence: 'I lost track of the exact sequence.', expected: ['lose track of'] },
  { sentence: 'We put into practice the techniques discussed earlier.', expected: ['put into practice'] },
  { sentence: 'The results shed light on an intricate phenomenon.', expected: ['shed light on', 'intricate'] },
  { sentence: 'The dilemma boils down to a lack of accountability.', expected: ['boil down to', 'dilemma'] },
  { sentence: 'Bear in mind that the estimate is tentative.', expected: ['bear in mind', 'tentative'] },
  { sentence: 'We need to brush up on these obsolete procedures.', expected: ['brush up on', 'obsolete'] },
  { sentence: 'The company phased out its redundant equipment.', expected: ['phase out', 'redundant'] },
  { sentence: 'The resilient design stood out during the evaluation.', expected: ['stand out', 'resilient'] },
  { sentence: 'She took over the negotiation at a crucial moment.', expected: ['take over', 'crucial'] },
  { sentence: 'They called off the experiment because of a scarce resource.', expected: ['call off', 'scarce'] },
  { sentence: 'We went through the document with meticulous care.', expected: ['go through', 'meticulous'] },
  { sentence: 'The ceremony took place at a sustainable venue.', expected: ['take place', 'sustainable'] },
  { sentence: 'He is in charge of a versatile research team.', expected: ['in charge of', 'versatile'] },
  { sentence: 'I did not omit the detail on purpose.', expected: ['on purpose'] },
  { sentence: 'Meticulous preparation can prevent an ambiguous outcome.', expected: ['meticulous', 'ambiguous'] },
  { sentence: 'A plausible hypothesis requires empirical evidence.', expected: ['plausible', 'empirical'] },
  { sentence: 'The unprecedented scrutiny revealed a substantial pitfall.', expected: ['unprecedented', 'scrutiny'] },
  { sentence: 'Nuance matters when we interpret an obscure reference.', expected: ['nuance', 'obscure'] },
  { sentence: 'The project faces constraints and unforeseen consequences.', expected: ['constraint', 'consequence'] },
];

describe('本地候选的自然句评估', () => {
  it('维护至少五十句独立评估输入', () => {
    expect(EVALUATION.length).toBeGreaterThanOrEqual(50);
    expect(new Set(EVALUATION.map((entry) => entry.sentence)).size).toBe(EVALUATION.length);
  });
  for (const entry of EVALUATION) {
    it(entry.sentence, () => {
      const candidates = analyzeVocabulary(entry.sentence);
      const topThree = candidates.slice(0, 3).map((candidate) => candidate.lemma);
      for (const expected of entry.expected) expect(topThree).toContain(expected);
      expect(candidates.length).toBeLessThanOrEqual(8);
    });   // 检查实际候选和前三项，不只检查函数有没有返回数组
  }
});

describe('词形、误检与来源边界', () => {
  it('只还原有明确基础词的词形', () => {
    expect(normalizeVocabularyWord('constraints')).toBe('constraint');
    expect(normalizeVocabularyWord('carried')).toBe('carry');
    expect(normalizeVocabularyWord('evaluated')).toBe('evaluate');
    expect(normalizeVocabularyWord('hypotheses')).toBe('hypothesis');
    expect(normalizeVocabularyWord('business')).toBe('business');
    expect(normalizeVocabularyWord('analysis')).toBe('analysis');
    expect(normalizeVocabularyWord('news')).toBe('news');
    expect(normalizeVocabularyWord('underwhelming')).toBe('underwhelming');
  });
  it('识别真实固定表达，不生成任意相邻词组', () => {
    const candidates = analyzeVocabulary('The obscure blue machine creates a surprising result.');
    expect(candidates.filter((candidate) => candidate.kind === 'phrase')).toEqual([]);
  });
  it('不跨句末、逗号或分号把单词拼成短语', () => {
    for (const sentence of ['We came. Across the room stood a table.', 'We came, across the room.', 'We came; across the road.']) {
      expect(analyzeVocabulary(sentence).some((candidate) => candidate.lemma === 'come across')).toBe(false);
    }
  });
  it('字幕换行和多个空格不破坏连续固定表达', () => {
    expect(analyzeVocabulary('We came\n  across an obscure reference.')[0]?.lemma).toBe('come across');
  });
  it('长表达优先，表达里的词不重复占候选位置', () => {
    const candidates = analyzeVocabulary('We came up with a feasible plan.');
    expect(candidates[0]?.lemma).toBe('come up with');
    expect(candidates.some((candidate) => ['come', 'up', 'with'].includes(candidate.lemma))).toBe(false);
  });
  it('相同词和不同已知词形去重', () => {
    const candidates = analyzeVocabulary('The constraints were obscure; another constraint was obscure.');
    expect(candidates.filter((candidate) => candidate.lemma === 'constraint')).toHaveLength(1);
    expect(candidates.filter((candidate) => candidate.lemma === 'obscure')).toHaveLength(1);
  });
  it('跳过专有名词、缩写和未知句首大写词', () => {
    const candidates = analyzeVocabulary('Xyloria met Alice and Bob in Paris after watching YouTube with NASA.');
    expect(candidates.some((candidate) => ['xyloria', 'alice', 'bob', 'paris', 'youtube', 'nasa'].includes(candidate.lemma))).toBe(false);
  });
  it('引号内的已知普通词仍可成为候选', () => {
    expect(analyzeVocabulary('"Obscure references matter."')[0]?.lemma).toBe('obscure');
  });
  it('基础词、收缩形式和纯标点不造成伪候选', () => {
    expect(analyzeVocabulary("I can't go there, and you don't need to stay.")).toEqual([]);
    expect(analyzeVocabulary('The cat is on the table and the book is in the room.')).toEqual([]);
    expect(analyzeVocabulary('123 — !?')).toEqual([]);
  });
  it('单词不输出内置中文释义、猜测词性或考试标签', () => {
    const candidate = analyzeVocabulary('An obscure reference.').find((value) => value.lemma === 'obscure')!;
    expect(candidate.meaning).toBeUndefined();
    expect(candidate.partOfSpeech).toBe('unclassified');
    expect(candidate.examTags).toEqual([]);
  });
  it('固定表达的本地中文释义和原词形均保留', () => {
    const candidate = analyzeVocabulary('We came across it.')[0]!;
    expect(candidate.text).toBe('came across');
    expect(candidate.lemma).toBe('come across');
    expect(candidate.meaning).toBe('偶然遇到；偶然发现');
    expect(candidate.partOfSpeech).toBe('phrase');
    expect(candidate.examTags).toEqual([]);
  });
  it('排序稳定且不虚构概率或考试等级', () => {
    const sentence = 'An obscure reference creates a subtle dilemma.';
    expect(analyzeVocabulary(sentence)).toEqual(analyzeVocabulary(sentence));
    const candidates = analyzeVocabulary(sentence);
    expect(candidates[0]?.lemma).toBe('obscure');
    expect(candidates.every((candidate, index) => index === 0 || candidates[index - 1]!.score >= candidate.score)).toBe(true);
    expect(candidates.every((candidate) => !/概率|CET|四六级|百分比/.test(candidate.reason))).toBe(true);
  });
  it('最多八项且可请求更少，空输入不会调用任何服务', () => {
    const sentence = 'An obscure and intricate hypothesis creates a plausible yet unprecedented predicament with substantial scrutiny, empirical nuance, tentative accountability, and marginal consequences.';
    expect(analyzeVocabulary(sentence)).toHaveLength(8);
    expect(analyzeVocabulary(sentence, 3)).toHaveLength(3);
    expect(analyzeVocabulary(sentence, 99)).toHaveLength(8);
    expect(analyzeVocabulary(sentence, 0)).toEqual([]);
    expect(analyzeVocabulary('')).toEqual([]);
    expect(analyzeVocabulary('  \n ')).toEqual([]);
  });
});
