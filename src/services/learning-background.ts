import { browser } from 'wxt/browser';
import { STORAGE } from '../storage/settings';
import { cachedTranslation, cacheTranslation, DEFAULT_PROVIDER, readProvider, type ProviderConfig } from '../storage/provider';
import { parseCloudOutput, requestCloud } from './cloud';
import { requestTranslation, splitTranslation } from './translation';
import { RequestScheduler } from './request-scheduler';
const pending = new Map<string, Promise<unknown>>();
const scheduler = new RequestScheduler();
let fallbackQueue = Promise.resolve();
// fallbackTranslation 为text执行用户选定的MyMemory整句请求，串行限速并重新检查开关
// 名称表示备用服务实现，不能在云服务失败时自动调用上传
async function fallbackTranslation(text: string) {
  const task = fallbackQueue.then(async () => {
    if ((await effectiveProvider()).mode !== 'mymemory') throw new Error('联网翻译已关闭或服务已改变');
    try { return await requestTranslation(text); } finally { await new Promise((resolve) => setTimeout(resolve, 250)); }
  });
  fallbackQueue = task.then(() => {}, () => {});
  return task;
}
// effectiveProvider 读取当前实际可运行服务，无参数，总开关关闭时返回off
// 结果含本地密钥，只供后台使用，公开RPC必须裁剪字段
export async function effectiveProvider(): Promise<ProviderConfig> {
  const config = await readProvider();
  const stored = await browser.storage.local.get(STORAGE.onlineTranslation);
  if (config) return { ...config, mode: stored[STORAGE.onlineTranslation] === true ? config.mode : 'off' };
  return { ...DEFAULT_PROVIDER, mode: stored[STORAGE.onlineTranslation] === true ? 'mymemory' : 'off' };
}
// learningRequest 调度sentence和context的指定task，priority区分点击前台与可跳过的预译
// 先复用缓存与相同请求，出队重新核对服务和授权，不能让预译占满前台通道
export async function learningRequest(sentence: string, context: string[], task: 'translate' | 'context', priority: 'foreground' | 'prefetch' = 'foreground') {
  if (typeof sentence !== 'string' || !sentence.trim() || sentence.length > 6000) throw new Error('字幕文本无效或过长');
  const config = await effectiveProvider();
  if (config.mode === 'off') throw new Error('请先在服务设置中启用翻译');
  if (config.mode === 'cloud' && !await browser.permissions.contains({ origins: [new URL(config.endpoint).origin + '/*'] })) throw new Error('请在服务设置中授权接口访问');
  if (priority === 'prefetch' && (!config.prefetch || (task === 'context' && config.prefetchExpressions !== true))) return { skipped: true };
  if (task === 'context' && config.mode !== 'cloud') return { provider: config.mode, expressions: [], contextUnavailable: true };
  const key = JSON.stringify(['context-v3-fast', 'zh-CN', new URL(config.endpoint).hostname === 'api.deepseek.com' ? 'thinking-disabled' : 'provider-default', config.mode, config.endpoint, config.model, task, sentence, context]);
  const cached = await cachedTranslation(key);
  if (cached) {
    try {
      const result = parseCloudOutput({ choices: [{ message: { content: cached } }] }, sentence, task);
      return { ...result, provider: config.mode, cached: true };
    } catch { /* 损坏缓存重新请求，不把脏结果展示给用户 */ }
  }
  if (pending.has(key)) return pending.get(key);
  if (priority === 'prefetch' && !scheduler.canPrefetch()) return { skipped: true };
  const request = scheduler.run(async () => {
    const latest = await effectiveProvider();
    if (priority === 'prefetch' && (!latest.prefetch || (task === 'context' && latest.prefetchExpressions !== true))) return { skipped: true };
    if (latest.mode !== config.mode || latest.endpoint !== config.endpoint || latest.model !== config.model || latest.apiKey !== config.apiKey) throw new Error('联网翻译已关闭或配置已改变');
    if (config.mode === 'cloud' && !await browser.permissions.contains({ origins: [new URL(config.endpoint).origin + '/*'] })) throw new Error('接口访问权限已撤销');
    let result: { translation?: string; expressions?: unknown[]; segmented?: boolean };
    if (config.mode === 'cloud') result = await requestCloud(config, sentence, context, task);
    else { const chunks = splitTranslation(sentence); result = { translation: (await Promise.all(chunks.map((chunk) => fallbackTranslation(chunk)))).join(' '), segmented: chunks.length > 1 }; }
    if (result.translation || result.expressions) await cacheTranslation(key, JSON.stringify(result));
    return { ...result, provider: config.mode };
  }, priority);
  pending.set(key, request);
  void request.finally(() => { pending.delete(key); }).catch(() => {});
  return request;
}


// prefetchLearning 预备原句译文与可选表达，参数包含独立表达授权及可注入请求器，旧授权只允许整句预译
export async function prefetchLearning(sentence: string, context: string[], includeExpressions: boolean, request = learningRequest) {
  const [translation, expressions] = await Promise.allSettled([
    request(sentence, context, 'translate', 'prefetch'),
    includeExpressions ? request(sentence, context, 'context', 'prefetch') : Promise.resolve({}),
  ]);
  return { text: sentence,
    ...(translation.status === 'fulfilled' ? translation.value as object : { translationError: '预译失败' }),
    ...(expressions.status === 'fulfilled' ? expressions.value as object : { contextError: '语境预解析失败' }) };
}
