import { TECH_MEANINGS } from './curated-meanings';
export type VocabularyKind = 'word' | 'phrase';
export type VocabularyPartOfSpeech = 'verb' | 'noun' | 'adjective' | 'adverb' | 'phrase' | 'unclassified';

export interface VocabularyCandidate {
  text: string;   // 保留用户句子中的实际拼写和词形
  lemma: string;   // 只做有依据的基础词形归一，未知词保留原形
  kind: VocabularyKind;
  score: number;   // 本地启发式排序值，不是生词概率或考试等级
  reason: string;
  meaning?: string;   // 仅固定表达带自行撰写的参考释义，单词由真实服务补充
  partOfSpeech?: VocabularyPartOfSpeech;
  examTags?: string[];   // 考点标签由用户设置，本地规则不猜测
}

interface PhraseEntry {
  lemma: string;
  meaning: string;
  score: number;
  words: string[];
}

interface Token {
  text: string;
  lemma: string;
  start: number;
  end: number;
}

// 基础词表只用于减少常见词干扰，不冒充外部语料统计或用户已认识词库
const BASIC_WORDS = new Set((
  'a an the i you he she it we they me him her us them my your his its our their mine yours ' +
  'this that these those who what which when where why how whose whom ' +
  'be am is are was were been being have has had having do does did doing done ' +
  'can could may might must shall should will would not no yes all any some every each ' +
  'and or but if then than so because while as of to in on at by for from with without ' +
  'up down into onto over under out off about around through across between among ' +
  'here there now before after again also too very more most less least much many ' +
  'one two three four five six seven eight nine ten first second last next other another ' +
  'only even still just already always never often sometimes usually really almost quite actually useful ' +
  'both either neither own same different enough such rather ' +
  'go come get make take give find think know see look say tell ask use need want feel try ' +
  'work play help keep put let turn bring run set call move start stop begin end leave stay ' +
  'wait meet learn read write hear listen speak talk show watch change live die love like ' +
  'eat drink buy sell pay spend save send close open hold carry lose win cut walk drive ' +
  'cannot please visit good bad great best better nice new old young big small large little long short ' +
  'high low right wrong true false easy hard fast slow early late happy sad clear ' +
  'important possible simple real sure able ready beautiful interesting ' +
  'people person man woman child children friend family parent mother father brother sister ' +
  'time day week month year today tomorrow yesterday morning night evening hour minute ' +
  'life world country place home house room school class book word name number ' +
  'way thing something anything nothing everything someone anyone everyone ' +
  'part side point case example question answer idea problem story fact reason result ' +
  'money water food light air car road hand head face eye body voice sound ' +
  'job team group company city area level order line plan test video computer cat dog table chair ' +
  'attention advantage account terms spite charge purpose result practice track mind ' +
  'information language common special free full better basic together away back once ' +
  'seen saw said told known knew spoke spoken left found ' +
  'soon later far yet since during until though whether also instead both well '
).trim().split(/\s+/));

// 人工分层只帮助初始排序，没有校准为词频、CEFR、四六级或用户陌生程度
const WORD_PRIORITY: Record<string, number> = {
  telephoto: 95, semiconductor: 95, latency: 90, throughput: 92, refraction: 92,
  'ultra-thin': 96, 'high-refresh': 88, 'refresh-rate': 88, benchmark: 87, firmware: 90,
  obscure: 82, underwhelming: 80, counterintuitive: 86, unprecedented: 84,
  meticulous: 85, ambiguous: 77, subtle: 70, constraint: 72, feasible: 72,
  redundant: 70, resilient: 78, intriguing: 78, pitfall: 76, underlying: 72,
  overwhelming: 75, inadvertently: 84, tentative: 79, plausible: 77,
  versatile: 74, compelling: 75, sustainable: 70, accountability: 83,
  predicament: 86, reluctant: 71, skeptical: 75, intricate: 81, coherent: 75,
  marginal: 71, adverse: 73, incentive: 71, intuition: 74, scrutiny: 85,
  obsolete: 78, scarce: 74, dilemma: 78, misconception: 81, crucial: 65,
  perspective: 63, consequence: 68, efficient: 55, methodology: 78,
  quantify: 81, hypothesis: 75, nuance: 85, concise: 65, phenomenon: 79,
  empirical: 85, evaluate: 64, assumption: 66, inevitable: 77,
  reference: 54, surprisingly: 55, fascinating: 71, significant: 67,
  substantial: 70, derive: 72, establish: 60, interpret: 68, tolerate: 65,
  allocate: 74, negotiate: 71, distinguish: 72, coincidence: 74,
};

// 以下释义由项目自行撰写，保留多义提示，不声称已完成上下文词义消歧
const PHRASE_DATA: Array<[string, string, number]> = [
  ...TECH_MEANINGS.filter((entry) => entry.lemma.includes(' ')).map((entry): [string, string, number] => [entry.lemma, entry.meaning, 98]),
  ['telephoto lens', '长焦镜头；可在较远距离拍摄更紧的取景画面', 97],
  ['refresh rate', '刷新率；显示器每秒更新画面的次数', 93],
  ['high-refresh display', '高刷新率显示屏', 94],
  ['come across', '偶然遇到；偶然发现', 82],
  ['figure out', '弄明白；想出解决办法', 78],
  ['put up with', '忍受；容忍', 84],
  ['run out of', '用完；耗尽', 75],
  ['look forward to', '期待；盼望', 62],
  ['take into account', '把……考虑进去', 78],
  ['get rid of', '摆脱；除去', 75],
  ['break down', '分解；出故障；崩溃', 77],
  ['carry out', '执行；实施', 71],
  ['turn out', '结果是；关闭灯光等', 73],
  ['bring up', '提出话题；抚养', 74],
  ['point out', '指出；提醒注意', 62],
  ['take for granted', '认为理所当然', 85],
  ['keep up with', '跟上；及时了解', 76],
  ['come up with', '想出；提出', 79],
  ['put off', '推迟；使人反感', 74],
  ['set up', '建立；安排', 62],
  ['work out', '解决；计算出；锻炼', 73],
  ['find out', '查明；得知', 59],
  ['deal with', '处理；应对', 64],
  ['end up', '最终处于；最终做了', 69],
  ['rely on', '依靠；依赖', 60],
  ['lead to', '导致；通向', 60],
  ['make up for', '弥补；补偿', 80],
  ['back up', '支持；备份；倒退', 72],
  ['rule out', '排除可能性', 80],
  ['stick to', '坚持；遵守', 72],
  ['cut down on', '减少……的数量或消耗', 77],
  ['account for', '解释原因；占某个比例', 81],
  ['fall apart', '散架；崩溃', 76],
  ['get over', '克服；从……恢复', 74],
  ['in terms of', '就……而言；从……方面看', 68],
  ['on the other hand', '另一方面', 55],
  ['at first glance', '乍看之下', 73],
  ['as a result', '因此；结果', 55],
  ['by no means', '绝不；一点也不', 81],
  ['in the long run', '从长远来看', 75],
  ['for the time being', '暂时；目前', 78],
  ['in a nutshell', '简而言之', 85],
  ['out of the blue', '突然地；出乎意料地', 86],
  ['sooner or later', '迟早', 65],
  ['once in a while', '偶尔', 67],
  ['in spite of', '尽管；不顾', 71],
  ['apart from', '除……以外', 64],
  ['in addition to', '除了……还', 64],
  ['regardless of', '不管；不顾', 72],
  ['rather than', '而不是', 50],
  ['as opposed to', '与……相对；而不是', 78],
  ['at stake', '处于风险之中；成败所系', 83],
  ['on behalf of', '代表……', 75],
  ['in accordance with', '按照；依据', 80],
  ['take advantage of', '利用机会；占……的便宜', 75],
  ['draw a conclusion', '得出结论', 66],
  ['pay attention to', '注意；留意', 51],
  ['lose track of', '忘记进展；失去对……的了解', 78],
  ['put into practice', '付诸实践', 74],
  ['shed light on', '帮助解释；使……更清楚', 85],
  ['boil down to', '归结为', 84],
  ['bear in mind', '记住；考虑到', 78],
  ['look into', '调查；研究', 71],
  ['brush up on', '复习；温习', 83],
  ['phase out', '逐步停止；逐步淘汰', 81],
  ['stand out', '突出；显眼', 70],
  ['take over', '接管；接替', 69],
  ['call off', '取消', 75],
  ['go through', '经历；仔细检查', 72],
  ['take place', '发生；举行', 59],
  ['in charge of', '负责；主管', 66],
  ['on purpose', '故意地', 63],
];

const PHRASES: PhraseEntry[] = PHRASE_DATA
  .map(([lemma, meaning, score]) => ({ lemma, meaning, score, words: lemma.split(' ') }))
  .sort((a, b) => b.words.length - a.words.length);   // 先匹配长表达，避免把同一句短语拆成重复候选

// 只列常见且可明确还原的词形，不对所有单词机械删除后缀
const IRREGULAR: Record<string, string> = {
  came: 'come', coming: 'come', took: 'take', taken: 'take', taking: 'take',
  got: 'get', gotten: 'get', getting: 'get', went: 'go', gone: 'go', going: 'go',
  brought: 'bring', ran: 'run', running: 'run', kept: 'keep', made: 'make', making: 'make',
  put: 'put', putting: 'put', set: 'set', setting: 'set', gave: 'give', given: 'give',
  giving: 'give', stood: 'stand', lost: 'lose', losing: 'lose', drew: 'draw',
  drawn: 'draw', paid: 'pay', thought: 'think', felt: 'feel', fell: 'fall', fallen: 'fall',
  broke: 'break', broken: 'break', stuck: 'stick', hypotheses: 'hypothesis',
};

const PRESERVE_FORM = new Set('news series species analysis physics mathematics politics means headquarters glasses'.split(' '));
const KNOWN_BASES = new Set([...BASIC_WORDS, ...Object.keys(WORD_PRIORITY), ...PHRASES.flatMap((entry) => entry.words)]);
const NAMES = new Set((
  'alice bob charlie david emma james john mary michael peter sarah london paris berlin ' +
  'tokyo beijing shanghai china india france germany america europe africa oxford cambridge ' +
  'youtube google microsoft apple amazon netflix openai chatgpt windows chrome edge python ' +
  'january february march april june july august september october november december ' +
  'monday tuesday wednesday thursday friday saturday sunday'
).split(' '));

// normalizeVocabularyWord 归一value实际词形，仅使用已知词表支持的变化，不机械截词尾
export function normalizeVocabularyWord(value: string): string {
  const word = value.toLowerCase().replace(/’/g, "'").replace(/'s$/, '');
  if (PRESERVE_FORM.has(word)) return word;   // 这些词不能简单按末尾 s 当作复数
  if (IRREGULAR[word]) return IRREGULAR[word];
  if (KNOWN_BASES.has(word) || word.includes("'") || word.includes('-')) return word;
  const possible: string[] = [];
  if (word.endsWith('ies')) possible.push(word.slice(0, -3) + 'y');
  if (word.endsWith('ied')) possible.push(word.slice(0, -3) + 'y');
  if (word.endsWith('ing')) {
    const stem = word.slice(0, -3);
    possible.push(stem, stem + 'e');
    if (/([a-z])\1$/.test(stem)) possible.push(stem.slice(0, -1));
  }
  if (word.endsWith('ed')) possible.push(word.slice(0, -2), word.slice(0, -1));
  if (word.endsWith('es')) possible.push(word.slice(0, -2), word.slice(0, -1));
  if (word.endsWith('s') && !word.endsWith('ss')) possible.push(word.slice(0, -1));
  return possible.find((candidate) => KNOWN_BASES.has(candidate)) ?? word;   // 归一结果必须存在于明确词表
}

// isLikelyName 用token与sentence位置保守判断专名，可能的专名不加入普通生词候选
function isLikelyName(token: Token, sentence: string): boolean {
  if (NAMES.has(token.lemma) || /[a-z][A-Z]|[A-Z]{2}/.test(token.text)) return true;
  if (!/^[A-Z]/.test(token.text)) return false;
  const before = sentence.slice(0, token.start).trimEnd();
  const startsSentence = !before || /^["'“‘(]+$/.test(before) || /[.!?]["'”’)]*$/.test(before);
  return !startsSentence || !KNOWN_BASES.has(token.lemma);   // 句首未知大写词保守跳过，不能可靠区分专名与普通词
}

// wordPriority 为lemma计算本地启发式优先级，返回值不是陌生概率或考试等级
function wordPriority(lemma: string): number {
  return WORD_PRIORITY[lemma] ?? 44 + Math.min(12, Math.max(0, lemma.length - 5));   // 未列出的词只按粗略规则候选，不声称低频
}

// analyzeVocabulary 从sentence提取最多limit个原文候选，长表达优先匹配，未知词可能没有本地参考义
export function analyzeVocabulary(sentence: string, limit = 8): VocabularyCandidate[] {
  if (typeof sentence !== 'string' || !sentence.trim()) return [];
  const maximum = Number.isFinite(limit) ? Math.max(0, Math.min(8, Math.floor(limit))) : 8;
  if (!maximum) return [];
  const tokens: Token[] = Array.from(sentence.matchAll(/[A-Za-z]+(?:['’][A-Za-z]+|-[A-Za-z]+)*/g))
    .map((match) => ({
      text: match[0], lemma: normalizeVocabularyWord(match[0]),
      start: match.index, end: match.index + match[0].length,
    }));
  const occupied = new Set<number>();
  const results: Array<VocabularyCandidate & { order: number }> = [];
  const unique = new Set<string>();

  // 只匹配表内的连续表达，不跨标点、不跨专名，也不生成任意相邻词组
  for (const entry of PHRASES) {
    for (let start = 0; start + entry.words.length <= tokens.length; start++) {
      const parts = tokens.slice(start, start + entry.words.length);
      const matches = parts.every((token, index) =>
        !occupied.has(start + index) && !isLikelyName(token, sentence) &&
        (token.lemma === entry.words[index] || (entry.words[index] === 'find' && token.lemma === 'found')) &&
        (index === 0 || /^\s+$/.test(sentence.slice(parts[index - 1]!.end, token.start))));
      if (!matches) continue;
      const key = 'phrase:' + entry.lemma;
      parts.forEach((_, index) => occupied.add(start + index));   // 短语中的单词不再重复挤占前三项
      if (unique.has(key)) continue;
      unique.add(key);
      results.push({
        text: sentence.slice(parts[0]!.start, parts.at(-1)!.end),
        lemma: entry.lemma, kind: 'phrase', score: entry.score,
        reason: '表内固定表达，按本地规则优先提示', meaning: entry.meaning,
        partOfSpeech: 'phrase', examTags: [], order: parts[0]!.start,
      });
    }
  }

  tokens.forEach((token, index) => {
    if (occupied.has(index) || token.lemma.length < 3 || BASIC_WORDS.has(token.lemma) ||
      token.lemma.includes("'") || isLikelyName(token, sentence)) return;
    const key = 'word:' + token.lemma;
    if (unique.has(key)) return;
    unique.add(key);
    results.push({
      text: token.text, lemma: token.lemma, kind: 'word', score: wordPriority(token.lemma),
      reason: WORD_PRIORITY[token.lemma] ? '人工分层词表中的学习候选' : '基础词表外的学习候选',
      partOfSpeech: 'unclassified', examTags: [], order: token.start,
    });   // 单词不内置中文释义，不推断词性和考试标签
  });

  return results.sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, maximum).map(({ order: _order, ...candidate }) => candidate);   // 同分按原句出现顺序稳定输出
}
