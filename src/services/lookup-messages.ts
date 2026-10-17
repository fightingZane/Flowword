import { browser } from 'wxt/browser';
import { effectiveProvider } from './learning-background';
import { cachedTranslation, cacheTranslation } from '../storage/provider';
import { lookupText, parseLookup, requestLookup } from './lookup';
import { RequestScheduler } from './request-scheduler';
import { STORAGE } from '../storage/settings';
interface Sender { tab?: { id?: number }; frameId?: number; documentId?: string; url?: string }
const active = new Map<string, AbortController>();
const scheduler = new RequestScheduler(2, 8);
// owner 隔离sender标签页文档，请求取消不能跨其他页面生效
function owner(sender: Sender): string { return `${sender.tab?.id ?? 'extension'}:${sender.frameId ?? 0}:${sender.documentId ?? sender.url ?? ''}:`; }
// cancelLookupRequests 取消tabId所属请求，省略参数则在关闭联网或变更服务时取消全部
export function cancelLookupRequests(tabId?: number): void { for (const [key, controller] of active) if (tabId === undefined || key.startsWith(`${tabId}:`)) { controller.abort(); active.delete(key); } }
browser.storage?.onChanged?.addListener((changes, area) => { if (area === 'local' && changes[STORAGE.onlineTranslation]?.newValue === false) cancelLookupRequests(); });
// handleLookupMessage 处理可信后台转发message与sender，只响应显式查词或取消，后台须先校验来源权限
export async function handleLookupMessage(message: Record<string, unknown>, sender: Sender): Promise<object | undefined> {
  if (message.type !== 'FLOWWORD_LOOKUP' && message.type !== 'FLOWWORD_LOOKUP_CANCEL') return undefined;
  const id = typeof message.requestId === 'string' && message.requestId.length <= 160 ? message.requestId : 'lookup';
  const key = owner(sender) + id;
  active.get(key)?.abort(); active.delete(key);
  if (message.type === 'FLOWWORD_LOOKUP_CANCEL') return { ok: true };
  const controller = new AbortController(); active.set(key, controller);
  try {
    const text = lookupText(message.text); const config = await effectiveProvider();
    if (config.mode !== 'cloud' && config.mode !== 'codex-cli') throw new Error('查词需要先配置云端模型或本机 CLI，参考机译不支持造例句');
    if (!await browser.permissions.contains({ origins: [new URL(config.endpoint).origin + '/*'] })) throw new Error('请先在模型设置授权接口访问');
    const cacheKey = JSON.stringify(['lookup-v1', config.mode, config.endpoint, config.model, config.protocol ?? 'chat-completions', text]);
    let cached: string | undefined; try { cached = await cachedTranslation(cacheKey); } catch { /* 缓存不可用仍可查词 */ }
    if (controller.signal.aborted) throw new DOMException('请求已取消', 'AbortError');
    if (cached) { try { return { ok: true, ...parseLookup(JSON.parse(cached)), cached: true, provider: config.mode }; } catch { /* 损坏缓存不展示 */ } }
    const result = await scheduler.run(async () => {
      const current = await effectiveProvider();
      if (current.mode !== config.mode || current.endpoint !== config.endpoint || current.model !== config.model || current.apiKey !== config.apiKey || current.protocol !== config.protocol) throw new Error('服务配置已变更，请重新查词');
      if (!await browser.permissions.contains({ origins: [new URL(config.endpoint).origin + '/*'] })) throw new Error('接口授权已撤销');
      return requestLookup(config, text, controller.signal);
    }, 'foreground', controller.signal);
    if ('skipped' in result || controller.signal.aborted) throw new DOMException('请求已取消', 'AbortError');
    try { await cacheTranslation(cacheKey, JSON.stringify(result)); } catch { /* 写缓存失败不丢弃已成功结果 */ }
    return { ok: true, ...result, cached: false, provider: config.mode };
  } catch (error) { return { ok: false, cancelled: controller.signal.aborted, error: error instanceof Error ? error.message : '查词失败，请重试' }; }
  finally { if (active.get(key) === controller) active.delete(key); }
}
