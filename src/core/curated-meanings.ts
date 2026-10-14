export type CuratedWordPartOfSpeech = 'noun' | 'verb' | 'adjective' | 'adverb';

export interface CuratedSense {
  readonly partOfSpeech: CuratedWordPartOfSpeech;   // 词典中的通用词性，不是当前字幕的词性判断
  readonly meaning: string;
}

export interface CuratedMeaning {
  readonly lemma: string;
  readonly meaning: string;   // 带词性标签的多义参考，可直接作为纯文本显示
  readonly senses: readonly CuratedSense[];
  readonly sourceName: 'Cambridge Dictionary';
  readonly sourceUrl: string;
  readonly verifiedAt: string;
  readonly note: string;
}

export const GENERAL_MEANING_NOTE = '通用参考义，未按当前语境消歧';
const PART_NAMES: Record<CuratedWordPartOfSpeech, string> = {
  noun: '名词', verb: '动词', adjective: '形容词', adverb: '副词',
};

function entry(lemma: string, senses: readonly CuratedSense[]): CuratedMeaning {
  return {
    lemma, senses,
    meaning: senses.map((sense) => PART_NAMES[sense.partOfSpeech] + '：' + sense.meaning).join(' / '),
    sourceName: 'Cambridge Dictionary',
    sourceUrl: 'https://dictionary.cambridge.org/us/dictionary/english/' + lemma,
    verifiedAt: '2026-10-13',
    note: GENERAL_MEANING_NOTE,
  };   // 只保存核验依据链接，不获取词典网页、不上传字幕或查询服务
}

// 中文释义由项目自行撰写，逐条核验词性与基本语义，没有复制词典例句或完整定义
// 这里只覆盖八个初始候选，不能当成完整词典，也不能把多义自动选成当前语境义
export const CURATED_MEANINGS: readonly CuratedMeaning[] = [
  entry('obscure', [
    { partOfSpeech: 'adjective', meaning: '鲜为人知的；不清楚或难懂的' },
    { partOfSpeech: 'verb', meaning: '遮挡；掩盖；使难以理解' },
  ]),
  entry('reference', [
    { partOfSpeech: 'noun', meaning: '提及；参考资料或引文；推荐信或推荐人' },
    { partOfSpeech: 'verb', meaning: '提到；引证资料出处' },
  ]),
  entry('underwhelming', [
    { partOfSpeech: 'adjective', meaning: '不够出色的；未给人深刻印象的' },
  ]),
  entry('ambiguous', [
    { partOfSpeech: 'adjective', meaning: '含义不明确的；可以作多种解释的' },
  ]),
  entry('subtle', [
    { partOfSpeech: 'adjective', meaning: '不易觉察的；细微但重要的；巧妙而不张扬的' },
  ]),
  entry('inevitable', [
    { partOfSpeech: 'adjective', meaning: '无法避免的；必定会发生的' },
  ]),
  entry('feasible', [
    { partOfSpeech: 'adjective', meaning: '能够实施或完成的；可行的' },
  ]),
  entry('plausible', [
    { partOfSpeech: 'adjective', meaning: '看起来有道理或可信的；貌似诚实但未必可靠的' },
  ]),
];

const BY_LEMMA = new Map(CURATED_MEANINGS.map((value) => [value.lemma, value]));

export function getCuratedMeaning(lemma: string): CuratedMeaning | undefined {
  if (typeof lemma !== 'string') return undefined;
  return BY_LEMMA.get(lemma.normalize('NFKC').trim().toLowerCase());   // 调用方传已归一的词条，不对未知词编造释义
}
