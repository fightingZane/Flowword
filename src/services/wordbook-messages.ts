import { browser } from 'wxt/browser';
import type { EntryPatch, EntryQuery, ReviewGrade, SourceKind } from '../core/types';
import { allEntries, batchEntries, bookSummary, deleteEntries, entryOccurrences, exportBackup, gradeReview, importBackup, queryEntries, reviewDue, savedEntryIds, saveEntry, undoDelete, updateOccurrence } from '../storage/wordbook';

interface MessageSender { id?: string; url?: string; tab?: { id?: number } }
const TYPES = new Set(['FLOWWORD_BOOK_SAVE', 'FLOWWORD_BOOK_LIST', 'FLOWWORD_BOOK_STATUS', 'FLOWWORD_BOOK_DELETE', 'FLOWWORD_BOOK_QUERY', 'FLOWWORD_BOOK_SUMMARY',
  'FLOWWORD_BOOK_OCCURRENCES', 'FLOWWORD_OCCURRENCE_UPDATE', 'FLOWWORD_BOOK_BATCH', 'FLOWWORD_BOOK_DELETE_MANY', 'FLOWWORD_BOOK_UNDO',
  'FLOWWORD_BOOK_EXPORT', 'FLOWWORD_BOOK_IMPORT', 'FLOWWORD_REVIEW_DUE', 'FLOWWORD_REVIEW_GRADE']);
const CONTENT_TYPES = new Set(['FLOWWORD_BOOK_SAVE', 'FLOWWORD_BOOK_LIST', 'FLOWWORD_BOOK_STATUS', 'FLOWWORD_BOOK_QUERY', 'FLOWWORD_REVIEW_DUE', 'FLOWWORD_REVIEW_GRADE']);

// broadcastBookChanged 通知扩展页面和已注入标签页刷新收藏，无参数，只发送无资料的变更事件
// 查询tab只使用id，不读取URL或新增tabs权限，通知失败不能把已提交保存报告为失败
async function broadcastBookChanged(): Promise<void> {
  void browser.runtime.sendMessage({ type: 'FLOWWORD_BOOK_CHANGED' }).catch(() => {});
  try {
    const tabs = await browser.tabs.query({});
    await Promise.all(tabs.filter((tab) => tab.id !== undefined).map((tab) => browser.tabs.sendMessage(tab.id!, { type: 'FLOWWORD_BOOK_CHANGED' }).catch(() => {})));
  } catch { /* 页面关闭或浏览器退出不影响已提交的本地事务 */ }
}

// handleWordbookMessage 处理message本地词本RPC，sender用于校验本扩展页面或自有内容脚本
// 未知消息返回undefined交给其他路由，数据操作失败返回明确错误，不泄露配置或密钥
// 完整备份与批量编辑只向扩展页面开放，自有内容脚本可使用收藏、分页与本地复习
export async function handleWordbookMessage(message: unknown, sender: MessageSender): Promise<object | undefined> {
  if (!message || typeof message !== 'object' || !('type' in message) || typeof message.type !== 'string' || !TYPES.has(message.type)) return;
  const request = message as Record<string, unknown>;
  const extensionPage = sender.url?.startsWith(browser.runtime.getURL('/')) === true;
  if (sender.id !== browser.runtime.id || (!extensionPage && !/^https?:\/\//.test(sender.url ?? ''))) return { ok: false, error: '仅允许本扩展使用本地词本' };
  if (!extensionPage && !CONTENT_TYPES.has(message.type)) return { ok: false, error: '请在单词本页面执行此操作' };
  try {
    let result: object; let changed = false;
    switch (message.type) {
      case 'FLOWWORD_BOOK_SAVE': result = { entry: await saveEntry(request.entry, typeof request.replaceId === 'string' ? request.replaceId : undefined) }; changed = true; break;
      case 'FLOWWORD_BOOK_LIST': result = { entries: await allEntries() }; break;
      case 'FLOWWORD_BOOK_STATUS': result = { savedIds: await savedEntryIds(request.ids as string[]) }; break;
      case 'FLOWWORD_BOOK_QUERY': result = await queryEntries((request.query ?? {}) as EntryQuery); break;
      case 'FLOWWORD_BOOK_SUMMARY': result = await bookSummary(); break;
      case 'FLOWWORD_BOOK_OCCURRENCES': result = { occurrences: await entryOccurrences(request.id as string, typeof request.sourceId === 'string' ? request.sourceId : typeof request.videoId === 'string' ? request.videoId : undefined) }; break;
      case 'FLOWWORD_OCCURRENCE_UPDATE': result = { occurrence: await updateOccurrence(request.id as string, request.translation as string) }; changed = true; break;
      case 'FLOWWORD_BOOK_BATCH': result = await batchEntries(request.ids as string[], request.patch as EntryPatch); changed = true; break;
      case 'FLOWWORD_BOOK_DELETE': result = await deleteEntries([request.id as string]); changed = true; break;
      case 'FLOWWORD_BOOK_DELETE_MANY': result = await deleteEntries(request.ids as string[]); changed = true; break;
      case 'FLOWWORD_BOOK_UNDO': result = await undoDelete(request.token as string); changed = true; break;
      case 'FLOWWORD_BOOK_EXPORT': result = { backup: await exportBackup((request.query ?? {}) as { videoId?: string; sourceId?: string; sourceKind?: SourceKind }) }; break;
      case 'FLOWWORD_BOOK_IMPORT': result = await importBackup(request.backup); changed = true; break;
      case 'FLOWWORD_REVIEW_DUE': result = { cards: await reviewDue((request.query ?? {}) as { limit?: number; videoId?: string; sourceId?: string; sourceKind?: SourceKind }) }; break;
      case 'FLOWWORD_REVIEW_GRADE': result = { review: await gradeReview(request.id as string, request.grade as ReviewGrade) }; changed = true; break;
      default: return;
    }
    if (changed) await broadcastBookChanged();
    return { ok: true, ...result };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : '本地操作未完成，请重试' }; }
}
