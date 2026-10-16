import { browser } from 'wxt/browser';
import { effectiveProvider, learningRequest, prefetchLearning } from './learning-background';
interface Sender { tab?: { id?: number }; frameId?: number; documentId?: string; url?: string }
interface Subscription { tabId?: number; controller: AbortController }
const subscriptions = new Map<string, Subscription>();
const cancelled = new Map<string, number>();
const reservations = new Map<string, number>();
const usedMemory = new Map<string, number>();
let budgetQueue = Promise.resolve();
// ownerKey 按sender的标签框架文档隔离请求，无密钥，防止其他标签页取消本页订阅
function ownerKey(sender: Sender): string { return `${sender.tab?.id ?? 'extension'}:${sender.frameId ?? 0}:${sender.documentId ?? sender.url ?? ''}`; }
// cancelTranslationOwner 取消tabId已关闭标签的全部订阅，底层共享任务仍由引用计数决定是否终止
export function cancelTranslationOwner(tabId: number): void { for (const [key, entry] of subscriptions) if (entry.tabId === tabId) { entry.controller.abort(); subscriptions.delete(key); } }
// reserveBudget 为budgetKey预约一个准备单元，无参数内容上传，已用加正在准备不超过二十，缓存不结算
async function reserveBudget(budgetKey: string): Promise<boolean> {
  let allowed = false;
  const job = budgetQueue.then(async () => {
    const stored = await browser.storage.session.get(budgetKey);
    const used = Math.max(Number(stored[budgetKey] || 0), usedMemory.get(budgetKey) ?? 0);
    usedMemory.set(budgetKey, used);
    if (used + (reservations.get(budgetKey) ?? 0) < 20) { reservations.set(budgetKey, (reservations.get(budgetKey) ?? 0) + 1); allowed = true; }
  });
  budgetQueue = job.then(() => {}, () => {}); await job; return allowed;
}
// settleBudget 释放budgetKey预约，preparedNew只对成功产生的新准备计一次，失败跳过共享及缓存不扣额度
async function settleBudget(budgetKey: string, preparedNew: boolean): Promise<void> {
  const job = budgetQueue.then(async () => {
    reservations.set(budgetKey, Math.max(0, (reservations.get(budgetKey) ?? 0) - 1));
    if (!preparedNew) return;
    const next = Math.min(20, (usedMemory.get(budgetKey) ?? 0) + 1); usedMemory.set(budgetKey, next);
    await browser.storage.session.set({ [budgetKey]: next });
  });
  budgetQueue = job.then(() => {}, () => {}); await job;
}
// handleTranslationMessage 接收可信后台转发的message与sender，未知消息返回undefined，密钥从不通过响应返回
// requestId只标识本sender订阅，CANCEL取消订阅而非误杀其他页面共享请求
export async function handleTranslationMessage(message: Record<string, unknown>, sender: Sender): Promise<object | undefined> {
  const type = message.type;
  if (!['FLOWWORD_TRANSLATE', 'FLOWWORD_CONTEXT', 'FLOWWORD_PREFETCH', 'FLOWWORD_CANCEL'].includes(String(type))) return undefined;
  const id = typeof message.requestId === 'string' && message.requestId.length <= 160 ? message.requestId : crypto.randomUUID();
  const key = ownerKey(sender) + ':' + id;
  if (type === 'FLOWWORD_CANCEL') {
    subscriptions.get(key)?.controller.abort(); subscriptions.delete(key); cancelled.set(key, Date.now());
    for (const [oldKey, at] of cancelled) if (Date.now() - at > 10000) cancelled.delete(oldKey);
    return { ok: true, cancelled: true };
  }
  if (cancelled.has(key)) return { ok: false, cancelled: true, error: '请求已取消' };
  subscriptions.get(key)?.controller.abort();
  const controller = new AbortController(); subscriptions.set(key, { tabId: sender.tab?.id, controller });
  try {
    if (type !== 'FLOWWORD_PREFETCH') {
      const context = Array.isArray(message.context) ? message.context.filter((value): value is string => typeof value === 'string' && value.length <= 2000).slice(0, 2) : [];
      const result = await learningRequest(message.sentence as string, context, type === 'FLOWWORD_CONTEXT' ? 'context' : 'translate', 'foreground', controller.signal);
      if (result.skipped) return { ok: false, error: '请求已跳过，请重试', skipped: true };
      return { ok: true, ...result };
    }
    const config = await effectiveProvider();
    if (!config.prefetch || config.mode !== 'cloud') return { ok: true, skipped: true, results: [] };
    const rawItems = Array.isArray(message.items) ? message.items : Array.isArray(message.sentences) ? message.sentences.map((sentence) => ({ sentence, context: [] })) : [];
    const results: object[] = [];
    for (const item of rawItems.slice(0, 2)) {
      if (controller.signal.aborted) throw new DOMException('请求已取消', 'AbortError');
      if (!item || typeof item.sentence !== 'string' || !item.sentence.trim() || item.sentence.length > 2000) continue;
      const context = Array.isArray(item.context) ? item.context.filter((value: unknown): value is string => typeof value === 'string' && value.length <= 2000).slice(0, 2) : [];
      const budgetKey = `prefetch:${sender.tab?.id ?? 'extension'}`;
      const reserved = await reserveBudget(budgetKey);
      let preparedNew = false;
      try {
        const result = await prefetchLearning(item.sentence, context, config.prefetchExpressions === true, learningRequest, controller.signal, !reserved);
        preparedNew = result.preparedNew; results.push(result);
      } finally { if (reserved) { try { await settleBudget(budgetKey, preparedNew); } catch { /* 内存预算仍保持，不丢成功结果 */ } } }
    }
    return { ok: true, results };
  } catch (error) { return { ok: false, cancelled: controller.signal.aborted || error instanceof DOMException && error.name === 'AbortError', error: controller.signal.aborted ? '请求已取消' : error instanceof Error ? error.message : '翻译失败，请重试' }; }
  finally { if (subscriptions.get(key)?.controller === controller) subscriptions.delete(key); }
}
