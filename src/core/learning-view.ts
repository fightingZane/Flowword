import type { WordbookEntry } from './types';

// entryKey 将kind类型与text原文规范为收藏标识，供显示状态使用，不改保存内容
export function entryKey(kind: WordbookEntry['kind'], text: string): string {
  return `${kind}:${text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()}`;
}

// hasMeaning 检查meaning中文释义是否可直接展示，拒绝空结果、标记文本和查询占位
// 仅识别开头的占位提示，保留正常释义中用于解释证据不足的未提供等用词
export function hasMeaning(meaning: string | undefined): boolean {
  if (typeof meaning !== 'string') return false;
  const text = meaning.trim();
  if (!text || text.length > 1500 || !/[\u3400-\u9fff]/.test(text) || /<[^>]*>/.test(text)) return false;
  return !/^(?:暂无(?:可用)?(?:参考)?(?:中文)?(?:释义|词义|解释)?|(?:正在)?(?:参考)?(?:释义)?查询中|未提供(?:可用)?(?:参考)?(?:中文)?(?:释义|词义|解释)|没有(?:可用)?参考(?:释义|词义|解释)?)(?:[\s，,。.!！?？…：:]|$)/.test(text);
}

// hasSourceSpan 检查text推荐原文是否完整出现在sentence当前句中，忽略大小写与空白数量
// 参数必须使用展示原文而非词形lemma，词内子串和其他句子的旧缓存不得进入推荐列表
export function hasSourceSpan(sentence: string, text: string): boolean {
  if (typeof sentence !== 'string' || typeof text !== 'string') return false;
  const span = text.trim().replace(/\s+/g, ' ');
  if (!span || span.length > 150) return false;
  const escaped = span.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}_'’\\-])${escaped}(?=$|[^\\p{L}\\p{N}_'’\\-])`, 'iu')
    .test(sentence.replace(/\s+/g, ' '));
}
