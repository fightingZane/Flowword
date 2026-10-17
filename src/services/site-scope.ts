import { browser } from 'wxt/browser';
import { readScope, SCOPE_KEY, scopeAllows, type SiteScope } from '../storage/site-scope';
import { STORAGE } from '../storage/settings';
export const ALL_SITE_ORIGINS = ['http://*/*', 'https://*/*'];
const GLOBAL_ID = 'flowword-site-all';
let writes = Promise.resolve();
// handleSiteScope 仅供可信扩展设置页调用message范围操作，后台不替网页弹出权限申请
// 列出打开网站仅返回来源与标题，写入只保存来源规则，串行合并避免多个标签互相覆盖
export async function handleSiteScope(message: Record<string, unknown>): Promise<object | undefined> {
  if (!['FLOWWORD_SCOPE_LIST', 'FLOWWORD_SCOPE_ALL', 'FLOWWORD_SCOPE_SITE'].includes(String(message.type))) return;
  if (message.type === 'FLOWWORD_SCOPE_LIST') {
    const scope = await readScope(); const tabs = await browser.tabs.query({});
    const candidates = await Promise.all(tabs.map(async (tab) => { try { const url = new URL(tab.url ?? ''); if (!/^https?:$/.test(url.protocol)) return; const permitted = url.origin === 'https://www.youtube.com' || await browser.permissions.contains({ origins: [url.origin + '/*'] }); return { origin: url.origin, title: tab.title || url.hostname, enabled: permitted && scopeAllows(scope, url.href) }; } catch { return; } }));
    const sites = [...new Map(candidates.filter((site) => site !== undefined).map((site) => [site.origin, site])).values()];
    return { ok: true, scope, sites };
  }
  const task = writes.then(async () => {
    const previous = await readScope();
    const registered = await browser.scripting.getRegisteredContentScripts();
    const legacy = registered.flatMap((script) => script.id !== GLOBAL_ID ? (script.matches ?? []).filter((pattern) => /^https?:\/\/[^*]+\/\*$/.test(pattern)).map((pattern) => pattern.slice(0, -2)) : []);
    const scope: SiteScope = previous ?? { allSites: false, allowed: [...new Set(legacy)], blocked: [] };
    if (message.type === 'FLOWWORD_SCOPE_ALL') {
      const enabled = message.enabled === true;
      if (enabled && !await browser.permissions.contains({ origins: ALL_SITE_ORIGINS })) throw new Error('请先授权所有网站访问');
      const existing = registered.some((script) => script.id === GLOBAL_ID);
      if (enabled && !existing) await browser.scripting.registerContentScripts([{ id: GLOBAL_ID, matches: ALL_SITE_ORIGINS, excludeMatches: registered.filter((script) => script.id !== GLOBAL_ID).flatMap((script) => script.matches ?? []).concat('https://www.youtube.com/*'), js: ['content-scripts/flowword.js'], runAt: 'document_idle', persistAcrossSessions: true }]);
      if (!enabled && existing) await browser.scripting.unregisterContentScripts({ ids: [GLOBAL_ID] });
      if (!enabled) for (const origin of scope.allowed) {
        if (origin === 'https://www.youtube.com' || !await browser.permissions.contains({ origins: [origin + '/*'] })) continue;
        const id = `flowword-site-${encodeURIComponent(origin).replace(/%/g, '-')}`;
        if (!registered.some((script) => script.id === id)) await browser.scripting.registerContentScripts([{ id, matches: [origin + '/*'], js: ['content-scripts/flowword.js'], runAt: 'document_idle', persistAcrossSessions: true }]);
      }
      scope.allSites = enabled;
    } else {
      const url = new URL(String(message.origin)); const origin = url.origin;
      if (!/^https?:$/.test(url.protocol) || origin !== message.origin) throw new Error('网站地址无效');
      const enabled = message.enabled === true;
      if (enabled && !await browser.permissions.contains({ origins: [origin + '/*'] })) throw new Error('请先授权此网站');
      scope.blocked = scope.blocked.filter((item) => item !== origin); scope.allowed = scope.allowed.filter((item) => item !== origin);
      if (enabled) scope.allowed.push(origin); else scope.blocked.push(origin);
      const id = `flowword-site-${encodeURIComponent(origin).replace(/%/g, '-')}`;
      if (enabled && !scope.allSites && origin !== 'https://www.youtube.com' && !registered.some((script) => script.id === id)) await browser.scripting.registerContentScripts([{ id, matches: [origin + '/*'], js: ['content-scripts/flowword.js'], runAt: 'document_idle', persistAcrossSessions: true }]);
    }
    await browser.storage.local.set({ [SCOPE_KEY]: scope, ...(message.enabled === true ? { [STORAGE.enabled]: true } : {}) });
    for (const tab of await browser.tabs.query({})) {
      if (tab.id === undefined || !/^https?:\/\//.test(tab.url ?? '') || !scopeAllows(scope, tab.url!)) continue;
      try { await browser.tabs.sendMessage(tab.id, { type: 'FLOWWORD_PING' }); } catch { try { await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ['/content-scripts/flowword.js'] }); } catch { /* 浏览器受限页面保持不可注入 */ } }
    }
    return { ok: true, scope };
  });
  writes = task.then(() => {}, () => {}); return task;
}
