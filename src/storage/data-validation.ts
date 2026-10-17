import type { EntryPatch, LearningContext, ReviewState, SourceQuote, WordbookEntry } from '../core/types';

export const BACKUP_LIMITS = { entries: 50000, captures: 100000, occurrences: 200000, videos: 50000, labels: 1000, bytes: 64 * 1024 * 1024 } as const;

// safeSourceUrl 检查value来源地址，只返回无凭据的HTTP或HTTPS地址
// 备份和页面来源共用此规则，keepHash为true保留网页路由与章节，不发起网络请求
export function safeSourceUrl(value: unknown, keepHash = false): string | undefined {
  if (typeof value !== 'string' || value.length > 2000) return;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return;
    if (!keepHash) url.hash = '';
    return url.href;
  } catch { return; }
}

// sourceKind 读取context来源类型，旧资料没有source字段时按video处理
// source字段一旦提供就必须明确合法kind，不能把损坏网页来源误当视频
export function sourceKind(context: LearningContext): 'video' | 'web' {
  if (context.source === undefined) return 'video';
  if (!context.source || !['video', 'web'].includes(context.source.kind)) throw new Error('来源类型无效');
  return context.source.kind;
}

// validateQuote 复制value文字定位资料，exact为真实选文，前后文最多各五百字符
// 缺失时允许只保存网页原链接，不保存DOM路径或整页正文，不承诺页面改版后仍能定位
function validateQuote(value: unknown): SourceQuote | undefined {
  if (value === undefined) return;
  if (!value || typeof value !== 'object') throw new Error('网页选文定位无效');
  const quote = value as SourceQuote;
  if (typeof quote.exact !== 'string' || !quote.exact.trim() || quote.exact.length > 2000 ||
    (quote.prefix !== undefined && (typeof quote.prefix !== 'string' || quote.prefix.length > 500)) ||
    (quote.suffix !== undefined && (typeof quote.suffix !== 'string' || quote.suffix.length > 500))) throw new Error('网页选文定位无效或超过上限');
  return { exact: quote.exact, ...(quote.prefix !== undefined ? { prefix: quote.prefix } : {}), ...(quote.suffix !== undefined ? { suffix: quote.suffix } : {}) };
}

// validateContext 校验raw真实来源，strict决定旧资料非法来源是否直接报错
// 网页不能带time/end/videoKey，视频必须有有限非负秒数，返回值只复制白名单字段
export function validateContext(raw: LearningContext, strict = false): LearningContext | undefined {
  if (!raw || typeof raw !== 'object') { if (strict) throw new Error('词条语境无效'); return; }
  const kind = sourceKind(raw);
  if (kind === 'web' && (raw.time !== undefined || raw.end !== undefined || raw.videoKey !== undefined)) throw new Error('网页来源不能包含视频时间或媒体标识');
  if (typeof raw.sentence !== 'string' || !raw.sentence.trim() || raw.sentence.length > 2000 || !safeSourceUrl(raw.url, kind === 'web') ||
    (kind === 'video' && (typeof raw.time !== 'number' || !Number.isFinite(raw.time) || raw.time < 0 || (raw.end !== undefined && (!Number.isFinite(raw.end) || raw.end < raw.time)))) ||
    (raw.title !== undefined && (typeof raw.title !== 'string' || raw.title.length > 300)) ||
    (raw.videoKey !== undefined && (typeof raw.videoKey !== 'string' || raw.videoKey.length > 2000)) ||
    (strict && raw.thumbnail !== undefined && !safeSourceUrl(raw.thumbnail)) ||
    (raw.translation !== undefined && (typeof raw.translation !== 'string' || raw.translation.length > 6000))) {
    if (strict || kind === 'web') throw new Error('词条语境无效'); return;
  }
  const quote = kind === 'web' ? validateQuote(raw.source?.quote) : undefined;
  return { sentence: raw.sentence, url: safeSourceUrl(raw.url, kind === 'web')!, source: { kind, ...(quote ? { quote } : {}) },
    ...(kind === 'video' ? { time: raw.time, ...(raw.videoKey !== undefined ? { videoKey: raw.videoKey } : {}), ...(raw.end !== undefined ? { end: raw.end } : {}) } : {}),
    ...(raw.title !== undefined ? { title: raw.title } : {}), ...(raw.translation !== undefined ? { translation: raw.translation } : {}), ...(safeSourceUrl(raw.thumbnail) ? { thumbnail: safeSourceUrl(raw.thumbnail)! } : {}) };
}

// contextIdentity 为context生成摘要去重键，网页采用URL和选文前后文，不伪造零秒
// 视频保留原URL媒体键时间原句组合，网页重复句可由quote前后文区分
export function contextIdentity(context: LearningContext): string {
  return sourceKind(context) === 'web' ? JSON.stringify(['web', context.url, context.sentence, context.source?.quote])
    : JSON.stringify(['video', context.url, context.videoKey, context.time, context.sentence]);
}

// labelList 校验value标签数组并去重，strict用于整份备份预校验，不允许静默丢标签
// 普通编辑允许空值，备份中的超限或非字符串标签直接抛错，调用方不得先写部分数据
export function labelList(value: unknown, strict = false): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value) && value.length > BACKUP_LIMITS.labels) throw new Error('标签数量超过统一上限');
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length > 50)) {
    if (strict) throw new Error('标签资料无效或超过上限');
    if (!Array.isArray(value)) return [];
  }
  return [...new Set((value as unknown[]).filter((item): item is string => typeof item === 'string').map((item) => item.trim().slice(0, 50)).filter(Boolean))];
}

// validTime 检查value是否为合理的非负毫秒时间戳，允许一分钟设备时钟误差
// 用于备份日期与复习时间校验，allowFuture为true时允许计划中的复习日期
export function validTime(value: unknown, allowFuture = false): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && (allowFuture || value <= Date.now() + 60000);
}

// validateReview 校验value复习计划并仅复制约定字段，未知配置和密钥不会落库
// 无复习资料返回undefined，损坏资料抛错，由上层终止完整备份导入
export function validateReview(value: unknown): ReviewState | undefined {
  if (value === undefined) return;
  if (!value || typeof value !== 'object') throw new Error('复习资料无效');
  const review = value as ReviewState;
  if (!validTime(review.dueAt, true) || !Number.isFinite(review.intervalDays) || review.intervalDays < 0 || review.intervalDays > 36500 ||
    !Number.isSafeInteger(review.repetitions) || review.repetitions < 0 || !Number.isSafeInteger(review.lapses) || review.lapses < 0 ||
    (review.lastReviewedAt !== undefined && !validTime(review.lastReviewedAt)) ||
    (review.lastGrade !== undefined && !['forgot', 'uncertain', 'remember'].includes(review.lastGrade))) throw new Error('复习资料无效');
  return { dueAt: review.dueAt, intervalDays: review.intervalDays, repetitions: review.repetitions, lapses: review.lapses,
    ...(review.lastReviewedAt !== undefined ? { lastReviewedAt: review.lastReviewedAt } : {}), ...(review.lastGrade ? { lastGrade: review.lastGrade } : {}) };
}

// validateEntry 校验value收藏字段并生成规范键，preserveTimes控制是否恢复备份日期
// strict用于完整备份，遇到非法语境立即拒绝整份资料，普通收藏只保留安全来源
export function validateEntry(value: unknown, preserveTimes = false, strict = false): WordbookEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('单词本条目无效');
  const entry = value as Partial<WordbookEntry>;
  if (!['word', 'phrase', 'sentence'].includes(entry.kind ?? '') || typeof entry.text !== 'string' || !entry.text.trim() || entry.text.length > 2000) throw new Error('单词本条目无效');
  for (const [field, limit] of [['lemma', 2000], ['translation', 6000], ['partOfSpeech', 40]] as const) {
    if (entry[field] !== undefined && (typeof entry[field] !== 'string' || entry[field]!.length > limit)) throw new Error('词条字段无效或超过上限');
  }
  if (entry.status !== undefined && !['new', 'learning', 'mastered'].includes(entry.status)) throw new Error('学习状态无效');
  if (entry.contexts !== undefined && (!Array.isArray(entry.contexts) || entry.contexts.length > BACKUP_LIMITS.captures)) throw new Error('词条语境无效或超过上限');
  const contexts: WordbookEntry['contexts'] = [];
  for (const raw of entry.contexts ?? []) {
    const context = validateContext(raw, strict); if (context) contexts.push(context);
  }
  const canonical = entry.lemma?.trim() || entry.text;
  const now = Date.now();
  if (preserveTimes && strict && ((entry.createdAt !== undefined && !validTime(entry.createdAt)) || (entry.updatedAt !== undefined && !validTime(entry.updatedAt)))) throw new Error('词条备份时间无效');
  return { id: `${entry.kind}:${canonical.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()}`, kind: entry.kind!, text: entry.text.trim(), lemma: canonical,
    translation: entry.translation ?? '', partOfSpeech: entry.partOfSpeech || '未分类', examTags: labelList(entry.examTags, strict), tags: labelList(entry.tags, strict),
    createdAt: preserveTimes && validTime(entry.createdAt) ? entry.createdAt : now, updatedAt: preserveTimes && validTime(entry.updatedAt) ? entry.updatedAt : now,
    contexts, ...(entry.status ? { status: entry.status } : {}), ...(entry.review !== undefined ? { review: validateReview(entry.review) } : {}) };
}

// mergeEntries 合并previous已存收藏与next新收藏，保留创建日期和已有学习计划
// contexts仅作为最近八条摘要，完整语境由同一事务中的occurrences保存，不以摘要覆盖历史
export function mergeEntries(previous: WordbookEntry | undefined, next: WordbookEntry): WordbookEntry {
  if (!previous) return next;
  const contexts = [...previous.contexts, ...next.contexts].filter((context, index, values) => values.findIndex((item) => contextIdentity(item) === contextIdentity(context)) === index).slice(-8);
  const examTags = [...new Set([...previous.examTags, ...next.examTags])];
  const tags = [...new Set([...previous.tags, ...next.tags])];
  if (examTags.length > BACKUP_LIMITS.labels || tags.length > BACKUP_LIMITS.labels) throw new Error('合并后的标签超过统一上限，请先整理标签，尚未修改资料');
  return { ...next, createdAt: previous.createdAt, translation: next.translation || previous.translation,
    partOfSpeech: ['未分类', 'unclassified'].includes(next.partOfSpeech) ? previous.partOfSpeech : next.partOfSpeech,
    examTags, tags, contexts,
    status: next.status ?? previous.status, review: next.review ?? previous.review };
}

// validatePatch 检查value批量编辑字段，只允许分类与学习状态，不接受任意数据库字段
// 批量操作在写入前完成校验，空对象和未知字段拒绝，避免误以为部分字段生效
export function validatePatch(value: unknown): EntryPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('批量修改无效');
  const patch = value as EntryPatch;
  if (!Object.keys(patch).length || Object.keys(patch).some((key) => !['partOfSpeech', 'examTags', 'tags', 'status'].includes(key))) throw new Error('批量修改字段无效');
  if (patch.partOfSpeech !== undefined && (typeof patch.partOfSpeech !== 'string' || !patch.partOfSpeech.trim() || patch.partOfSpeech.length > 40)) throw new Error('词性无效');
  if (patch.status !== undefined && !['new', 'learning', 'mastered'].includes(patch.status)) throw new Error('学习状态无效');
  return { ...(patch.partOfSpeech !== undefined ? { partOfSpeech: patch.partOfSpeech.trim() } : {}), ...(patch.examTags !== undefined ? { examTags: labelList(patch.examTags, true) } : {}),
    ...(patch.tags !== undefined ? { tags: labelList(patch.tags, true) } : {}), ...(patch.status !== undefined ? { status: patch.status } : {}) };
}
