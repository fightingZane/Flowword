import { browser } from 'wxt/browser';
import { STORAGE } from '../storage/settings';
import { cachedTranslation, cacheTranslation, DEFAULT_PROVIDER, readProvider, type ProviderConfig } from '../storage/provider';
import { parseCloudOutput, requestCloud, type ContextExpression } from './cloud';
import { requestTranslation, splitTranslation } from './translation';
import { requestCodex } from './codex-cli';
import { RequestScheduler } from './request-scheduler';
export interface LearningResult { translation?: string; expressions?: ContextExpression[]; segmented?: boolean; provider?: string; cached?: boolean; shared?: boolean; skipped?: boolean; budgetExceeded?: boolean; contextUnavailable?: boolean; elapsedMs?: number; status?: 'cached' | 'ready' | 'skipped'; cacheWarning?: boolean }
interface SharedRequest { controller: AbortController; subscribers: Set<symbol>; promise: Promise<LearningResult> }
const pending = new Map<string, SharedRequest>();
const scheduler = new RequestScheduler();
let fallbackQueue = Promise.resolve();
// abortError 创建取消异常，无参数，不包含密钥或服务原始错误
function abortError() { return new DOMException('请求已取消', 'AbortError'); }
// cancelAllLearningRequests 停止所有旧配置共享任务，无参数，关闭联网或变更服务时调用
export function cancelAllLearningRequests(): void { for (const entry of pending.values()) entry.controller.abort(); pending.clear(); }
browser.storage.onChanged?.addListener((changes, area) => { if (area === 'local' && changes[STORAGE.onlineTranslation]?.newValue === false) cancelAllLearningRequests(); });
// fallbackTranslation 串行请求text参考机译，signal取消本次网络，不允许云端失败后自动切换服务
async function fallbackTranslation(text: string, signal: AbortSignal) {
  const task = fallbackQueue.then(async () => {
    if (signal.aborted) throw abortError();
    if ((await effectiveProvider()).mode !== 'mymemory') throw new Error('联网翻译已关闭或服务已改变');
    try { return await requestTranslation(text, fetch, signal); } finally { await new Promise((resolve) => setTimeout(resolve, 250)); }
  });
  fallbackQueue = task.then(() => {}, () => {}); return task;
}
// effectiveProvider 读取实际服务，无参数，总开关关闭时返回off，完整密钥只供扩展可信代码使用
export async function effectiveProvider(): Promise<ProviderConfig> {
  const config = await readProvider(); const stored = await browser.storage.local.get(STORAGE.onlineTranslation);
  if (config) return { ...config, mode: stored[STORAGE.onlineTranslation] === true ? config.mode : 'off' };
  return { ...DEFAULT_PROVIDER, mode: stored[STORAGE.onlineTranslation] === true ? 'cloud' : 'off' };
}
// normalizeLearningInput 仅归一sentence与context空白，保留字形标点大小写和真实重复邻句的顺序
export function normalizeLearningInput(sentence: string, context: string[]): { sentence: string; context: string[] } {
  const clean = (text: string) => text.replace(/\s+/g, ' ').trim(); const normalized = clean(sentence);
  return { sentence: normalized, context: context.filter((text) => typeof text === 'string').map(clean).filter((text) => text && text.length <= 2000 && text !== normalized).slice(0, 2) };
}
// subscribeRequest 订阅共享entry，signal仅取消本订阅，最后使用者离开才停止底层请求，shared用于界面诊断
function subscribeRequest(entry: SharedRequest, signal: AbortSignal | undefined, shared: boolean): Promise<LearningResult> {
  if (signal?.aborted) return Promise.reject(abortError());
  const token = Symbol(); entry.subscribers.add(token);
  return new Promise((resolve, reject) => {
    let finished = false;
    // detach 移除本订阅，无参数，正常结束不影响其他订阅
    const detach = () => { entry.subscribers.delete(token); signal?.removeEventListener('abort', cancelled); };
    // cancelled 响应调用者取消，无参数，共享任务仍有使用者时不能误杀其他标签页
    const cancelled = () => { if (finished) return; finished = true; detach(); if (!entry.subscribers.size) entry.controller.abort(); reject(abortError()); };
    signal?.addEventListener('abort', cancelled, { once: true });
    entry.promise.then((result) => { if (!finished) { finished = true; detach(); resolve({ ...result, shared }); } }, (error) => { if (!finished) { finished = true; detach(); reject(error); } });
  });
}
// learningRequest 请求原句task，priority保留前台槽，signal按订阅取消，cacheOnly只读缓存与共享在途而不增加模型调用
export async function learningRequest(sentence: string, context: string[], task: 'translate' | 'context', priority: 'foreground' | 'prefetch' = 'foreground', signal?: AbortSignal, cacheOnly = false): Promise<LearningResult> {
  const started = Date.now(); if (signal?.aborted) throw abortError();
  if (typeof sentence !== 'string' || !sentence.trim() || sentence.length > 6000) throw new Error('字幕文本无效或过长');
  ({ sentence, context } = normalizeLearningInput(sentence, context)); const config = await effectiveProvider();
  if ((config.mode === 'cloud' || config.mode === 'codex-cli') && !config.apiKey) throw new Error(config.mode === 'codex-cli' ? '请在模型设置中导入本机 CLI 连接文件并保存' : '请在悬浮框模型设置中填写 API Key 并保存');
  if (config.mode === 'off') throw new Error('请先在服务设置中启用翻译');
  if ((config.mode === 'cloud' || config.mode === 'codex-cli') && !await browser.permissions.contains({ origins: [new URL(config.endpoint).origin + '/*'] })) throw new Error('请在服务设置中授权接口访问');
  if (priority === 'prefetch' && (config.mode === 'codex-cli' || !config.prefetch || (task === 'context' && config.prefetchExpressions !== true))) return { skipped: true, status: 'skipped' };
  if (task === 'context' && config.mode !== 'cloud' && config.mode !== 'codex-cli') return { provider: config.mode, expressions: [], contextUnavailable: true };
  const key = JSON.stringify(['context-v4-quality', 'zh-CN', new URL(config.endpoint).hostname === 'api.deepseek.com' ? 'thinking-disabled' : 'provider-default', config.mode === 'cloud' && config.protocol === 'responses' ? 'cloud-responses' : config.mode, config.endpoint, config.model, task, sentence, context]);
  let cached: string | undefined;
  try { cached = await cachedTranslation(key); } catch { /* 缓存不可用仍可翻译 */ }
  if (signal?.aborted) throw abortError();
  if (cached) { try { return { ...parseCloudOutput({ choices: [{ message: { content: cached } }] }, sentence, task), provider: config.mode, cached: true, status: 'cached', elapsedMs: Date.now() - started }; } catch { /* 损坏缓存重新请求 */ } }
  const pendingKey = key + config.apiKey;   // 仅内存区分密钥变更，持久缓存键不含密钥
  let entry = pending.get(pendingKey);
  if (entry && !entry.controller.signal.aborted) return subscribeRequest(entry, signal, true);
  if (cacheOnly || priority === 'prefetch' && !scheduler.canPrefetch()) return { skipped: true, budgetExceeded: cacheOnly, status: 'skipped' };
  const controller = new AbortController();
  const promise = scheduler.run(async (): Promise<LearningResult> => {
    const latest = await effectiveProvider();
    if (controller.signal.aborted) throw abortError();
    if (priority === 'prefetch' && (!latest.prefetch || (task === 'context' && latest.prefetchExpressions !== true))) return { skipped: true, status: 'skipped' };
    if (latest.mode !== config.mode || latest.endpoint !== config.endpoint || latest.model !== config.model || latest.apiKey !== config.apiKey || latest.protocol !== config.protocol) throw new Error('联网翻译已关闭或配置已改变');
    if ((config.mode === 'cloud' || config.mode === 'codex-cli') && !await browser.permissions.contains({ origins: [new URL(config.endpoint).origin + '/*'] })) throw new Error('接口访问权限已撤销');
    let result: LearningResult;
    if (config.mode === 'cloud') result = await requestCloud(config, sentence, context, task, fetch, controller.signal);
    else if (config.mode === 'codex-cli') result = await requestCodex(config, sentence, context, task, fetch, controller.signal);
    else { const chunks = splitTranslation(sentence); result = { translation: (await Promise.all(chunks.map((chunk) => fallbackTranslation(chunk, controller.signal)))).join(' '), segmented: chunks.length > 1 }; }
    if (controller.signal.aborted) throw abortError();
    try { if (result.translation || result.expressions) await cacheTranslation(key, JSON.stringify(result)); } catch { result = { ...result, cacheWarning: true }; }
    return { ...result, provider: config.mode, cached: false, status: 'ready', elapsedMs: Date.now() - started };
  }, priority, controller.signal);
  entry = { controller, subscribers: new Set(), promise }; pending.set(pendingKey, entry);
  const owned = entry; void promise.finally(() => { if (pending.get(pendingKey) === owned) pending.delete(pendingKey); }).catch(() => {});
  return subscribeRequest(entry, signal, false);
}
// prefetchLearning 准备sentence及邻context，表达须独立授权，signal取消本订阅，cacheOnly预算不足时不启动新网络
export async function prefetchLearning(sentence: string, context: string[], includeExpressions: boolean, request = learningRequest, signal?: AbortSignal, cacheOnly = false) {
  const [translation, expressions] = await Promise.allSettled([request(sentence, context, 'translate', 'prefetch', signal, cacheOnly), includeExpressions ? request(sentence, context, 'context', 'prefetch', signal, cacheOnly) : Promise.resolve({} as LearningResult)]);
  const translated = translation.status === 'fulfilled' ? translation.value : undefined;
  const explained = expressions.status === 'fulfilled' ? expressions.value : undefined;
  return { text: sentence, ...(translated ?? { translationError: '预译失败' }), ...(explained ?? { contextError: '语境预解析失败' }),
    preparedNew: !!((translated?.status === 'ready' && !translated.cached && !translated.shared) || (explained?.status === 'ready' && !explained.cached && !explained.shared)),
    complete: !!translated?.translation && (!includeExpressions || Array.isArray(explained?.expressions)),
    skipped: !!translated?.skipped || !!explained?.skipped,
  };
}
