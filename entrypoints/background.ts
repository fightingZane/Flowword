import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { STORAGE } from '../src/storage/settings';
import { effectiveProvider, learningRequest } from '../src/services/learning-background';
import { allEntries, deleteEntry, saveEntry } from '../src/storage/wordbook';

export default defineBackground(() => {
  let prefetchQueue = Promise.resolve();
  browser.runtime.onMessage.addListener((message, sender) => {
    const internal = sender.id === browser.runtime.id && ((/^https?:\/\//.test(sender.url ?? '')) || sender.url?.startsWith(browser.runtime.getURL('/')));
    if (!internal || !message || typeof message !== 'object') return;
    return (async () => {
      try {
        const extensionPage = sender.url?.startsWith(browser.runtime.getURL('/')) === true;
        if (message.type === 'FLOWWORD_PROVIDER_CHANGED' && extensionPage) {
          const config = await effectiveProvider();
          const publicConfig = { mode: config.mode, model: config.model, prefetch: config.prefetch, configured: config.mode !== 'cloud' || !!config.apiKey };
          for (const tab of await browser.tabs.query({})) if (tab.id !== undefined) void browser.tabs.sendMessage(tab.id, { type: 'FLOWWORD_PROVIDER_CHANGED', ...publicConfig }).catch(() => {});
          return { ok: true };
        }
        if (message.type === 'FLOWWORD_PROVIDER_PUBLIC') {
          const config = await effectiveProvider();
          return { ok: true, mode: config.mode, model: config.model, prefetch: config.prefetch, configured: config.mode !== 'cloud' || !!config.apiKey };
        }
        if (message.type === 'FLOWWORD_SETTINGS_OPEN') { await browser.tabs.create({ url: browser.runtime.getURL('/settings.html') }); return { ok: true }; }
        if (message.type === 'FLOWWORD_TRANSLATE' || message.type === 'FLOWWORD_CONTEXT') {
          const context = Array.isArray(message.context) ? message.context.filter((value: unknown): value is string => typeof value === 'string' && value.length <= 2000).slice(0, 2) : [];
          return { ok: true, ...await learningRequest(message.sentence, context, message.type === 'FLOWWORD_CONTEXT' ? 'context' : 'translate') as object };
        }
        if (message.type === 'FLOWWORD_PREFETCH') {
          const config = await effectiveProvider();
          if (!config.prefetch || config.mode !== 'cloud') return { ok: true, skipped: true };
          const rawItems = Array.isArray(message.items) ? message.items : Array.isArray(message.sentences) ? message.sentences.map((sentence: unknown) => ({ sentence, context: [] })) : [];
          const items: { sentence: string; context: string[] }[] = [];
          for (const item of rawItems.slice(0, 2)) {
            if (typeof item?.sentence !== 'string' || !item.sentence.trim() || item.sentence.length > 2000) continue;
            const context: string[] = Array.isArray(item.context) ? item.context.filter((value: unknown): value is string => typeof value === 'string' && value.length <= 2000).slice(0, 2) : [];
            items.push({ sentence: item.sentence, context });
          }
          const budgetKey = `prefetch:${sender.tab?.id ?? 'extension'}`;
          const reservation = prefetchQueue.then(async () => {
            const stored = await browser.storage.session.get(budgetKey);
            const used = Number(stored[budgetKey] || 0);
            const reserved = items.slice(0, Math.max(0, 20-used));
            await browser.storage.session.set({ [budgetKey]: used + reserved.length });
            return reserved;
          });
          prefetchQueue = reservation.then(() => {}, () => {});
          const reserved = await reservation;
          const results = await Promise.allSettled(reserved.map((item) => learningRequest(item.sentence, item.context, 'translate', 'prefetch')));
          return { ok: true, results: results.map((result, index) => ({ text: reserved[index]?.sentence, ...(result.status === 'fulfilled' ? result.value as object : { error: '预译失败' }) })) };
        }
        if (message.type === 'FLOWWORD_ENABLE_SITE' && extensionPage) {
          const origin = new URL(message.origin).origin;
          if (!/^https?:/.test(origin) || !await browser.permissions.contains({ origins: [origin + '/*'] })) throw new Error('请先通过浏览器授权该网站');
          const id = `flowword-site-${encodeURIComponent(origin).replace(/%/g, '-')}`;
          if (origin === 'https://www.youtube.com') return { ok: true };
          const registered = await browser.scripting.getRegisteredContentScripts({ ids: [id] });
          if (!registered.length) await browser.scripting.registerContentScripts([{ id, matches: [origin + '/*'], js: ['content-scripts/flowword.js'], runAt: 'document_idle', persistAcrossSessions: true }]);
          return { ok: true };
        }
        if (message.type === 'FLOWWORD_BOOK_SAVE') {
          const entry = await saveEntry(message.entry, typeof message.replaceId === 'string' ? message.replaceId : undefined);
          void browser.runtime.sendMessage({ type: 'FLOWWORD_BOOK_CHANGED' }).catch(() => {});
          return { ok: true, entry };
        }
        if (message.type === 'FLOWWORD_BOOK_LIST') return { ok: true, entries: await allEntries() };
        if (message.type === 'FLOWWORD_BOOK_DELETE' && typeof message.id === 'string') {
          await deleteEntry(message.id); void browser.runtime.sendMessage({ type: 'FLOWWORD_BOOK_CHANGED' }).catch(() => {}); return { ok: true };
        }
        if (message.type === 'FLOWWORD_BOOK_OPEN') { await browser.tabs.create({ url: browser.runtime.getURL('/wordbook.html') }); return { ok: true }; }
        return { ok: false, error: '未知操作' };
      } catch (error) { return { ok: false, error: error instanceof Error ? error.message : '操作失败，请重试' }; }
    })();
  });   // 只接收本扩展页面和自己的 YouTube 内容脚本，不允许任意网页调用服务
  browser.permissions.onRemoved.addListener((removed) => {
    void (async () => {
      if (!removed.origins?.length) return;
      const registered = await browser.scripting.getRegisteredContentScripts();
      const checks = await Promise.all(registered.filter((script) => script.id.startsWith('flowword-site-')).map(async (script) => ({ script, allowed: await browser.permissions.contains({ origins: script.matches ?? [] }) })));
      const revoke = checks.filter((item) => !item.allowed).map((item) => item.script);
      if (!revoke.length) return;
      await browser.scripting.unregisterContentScripts({ ids: revoke.map((script) => script.id) });
      const revokedMatches = revoke.flatMap((script) => script.matches ?? []);
      for (const tab of await browser.tabs.query({})) if (tab.id !== undefined) void browser.tabs.sendMessage(tab.id, { type: 'FLOWWORD_SITE_REVOKED', origins: revokedMatches }).catch(() => {});
    })().catch(() => {});
  });   // 只撤销已注册网站脚本，接口授权不会被误当成视频站授权
  browser.commands.onCommand.addListener((command) => {
    void (async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined) return;
      const action = command === 'flowword-toggle' ? 'toggle-playback' : command === 'flowword-repeat' ? 'repeat-sentence' : undefined;
      if (action) await browser.tabs.sendMessage(tab.id, { type: 'FLOWWORD_COMMAND', command: action });
    })().catch(() => {});
  });   // 扩展快捷键只作用于当前活动标签页，不拦截输入框普通按键
  async function updateBadge() {
    const stored = await browser.storage.local.get(STORAGE.enabled);
    const enabled = stored[STORAGE.enabled] === true;
    await browser.action.setBadgeText({ text: enabled ? 'ON' : '' });
    await browser.action.setBadgeBackgroundColor({ color: '#355f47' });
    await browser.action.setTitle({ title: enabled ? 'FlowWord · 悬浮球已开启' : 'FlowWord · 开启悬浮球' });
  }
  const refresh = () => { void updateBadge().catch((error) => console.warn('FlowWord 标识更新失败', error)); };
  browser.runtime.onInstalled.addListener(refresh);
  browser.runtime.onStartup.addListener(refresh);
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && STORAGE.enabled in changes) refresh();
  });   // 后台只更新图标，核心交互和设置不依赖内存中的全局变量
});
