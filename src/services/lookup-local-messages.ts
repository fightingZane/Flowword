import { browser } from 'wxt/browser';
import { canonicalDatabase, type ArchiveCapture } from '../storage/archive';

// normalizeLookupText 归一化查词输入，value 是单词或短语，限制长度避免误传整段网页
export function normalizeLookupText(value: unknown): string {
  if (typeof value !== 'string') throw new Error('请输入单词或词组');
  const text = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!text || text.length > 120 || /[\r\n\u0000-\u001f]/.test(text)) throw new Error('请输入 120 字以内的单词或词组');
  return text;
}

// lookupSentenceMatches 检查sentence是否包含完整text词组，词内连字符与撇号不拆开，避免stand误中understand
export function lookupSentenceMatches(sentence: string, text: string): boolean {
  const escaped = text.normalize('NFKC').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}’'\\-])${escaped}(?![\\p{L}\\p{N}’'\\-])`, 'iu').test(sentence.normalize('NFKC'));
}

// searchSavedSentences 扫描完整归档原句，text 是已校验词组，只返回仍有关联收藏的真实语境
// 最多保留二十句，total统计全部命中，不加载整个词本且不产生网络请求
export async function searchSavedSentences(text: string): Promise<{ matches: ArchiveCapture[]; total: number }> {
  const db = await canonicalDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['captures', 'occurrences'], 'readonly');
    const matches: ArchiveCapture[] = []; let total = 0;
    const request = transaction.objectStore('captures').openCursor();
    request.onsuccess = () => {
      const cursor = request.result; if (!cursor) return;
      const capture = cursor.value as ArchiveCapture;
      if (!lookupSentenceMatches(capture.sentence, text)) { cursor.continue(); return; }
      const count = transaction.objectStore('occurrences').index('captureId').count(capture.id);
      count.onsuccess = () => { if (count.result) { total++; if (matches.length < 20) matches.push(capture); } cursor.continue(); };
    };
    transaction.oncomplete = () => resolve({ matches, total });
    transaction.onerror = () => reject(new Error('收藏原句读取失败')); transaction.onabort = () => reject(new Error('收藏原句读取中断'));
  });
}

// handleLookupLocalMessage 路由本地查词语境请求，sender必须为本扩展页面或自有http内容脚本
// 未知消息交还其他路由，返回值不含密钥或完整数据库备份
export async function handleLookupLocalMessage(message: unknown, sender: { id?: string; url?: string }): Promise<object | undefined> {
  if (!message || typeof message !== 'object' || !('type' in message) || message.type !== 'FLOWWORD_LOOKUP_LOCAL') return;
  if (sender.id !== browser.runtime.id || !(sender.url?.startsWith(browser.runtime.getURL('/')) || /^https?:\/\//.test(sender.url ?? ''))) return { ok: false, error: '仅允许本扩展查询收藏原句' };
  try { return { ok: true, ...await searchSavedSentences(normalizeLookupText((message as { text?: unknown }).text)) }; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : '读取收藏失败' }; }
}
