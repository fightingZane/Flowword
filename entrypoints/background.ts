import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { handleLookupLocalMessage } from '../src/services/lookup-local-messages';
import { handleLookupMessage, cancelLookupRequests } from '../src/services/lookup-messages';
import { handleSiteScope } from '../src/services/site-scope';
import { STORAGE } from '../src/storage/settings';
import { effectiveProvider, cancelAllLearningRequests } from '../src/services/learning-background';
import { handleWordbookMessage } from '../src/services/wordbook-messages';
import { handleTranslationMessage, cancelTranslationOwner } from '../src/services/translation-messages';
import { handleSettingsAccess, clearSettingsGrants, isSettingsFrameGranted } from '../src/services/settings-access';
import { handleSourceReplay, deliverPendingSourceReplay } from '../src/services/source-replay';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message, sender) => {
    const internal = sender.id === browser.runtime.id && ((/^https?:\/\//.test(sender.url ?? '')) || sender.url?.startsWith(browser.runtime.getURL('/')));
    if (!internal || !message || typeof message !== 'object') return;
    return (async () => {
      try {
        const extensionPage = sender.url?.startsWith(browser.runtime.getURL('/')) === true;
        const access = await handleSettingsAccess(message, sender);
        if (access !== undefined) return access;
        if (extensionPage && !await isSettingsFrameGranted(sender)) return { ok: false, error: '请从FlowWord面板打开配置框' };
        if (extensionPage) { const scope = await handleSiteScope(message); if (scope !== undefined) return scope; }
        const source = await handleSourceReplay(message, sender);
        if (source !== undefined) return source;
        const lookup = await handleLookupMessage(message, sender); if (lookup !== undefined) return lookup;
        const localLookup = await handleLookupLocalMessage(message, sender); if (localLookup !== undefined) return localLookup;
        const translated = await handleTranslationMessage(message, sender);
        if (translated !== undefined) return translated;
        const book = await handleWordbookMessage(message, sender);
        if (book !== undefined) return book;

        if (message.type === 'FLOWWORD_PROVIDER_CHANGED' && extensionPage) {
          cancelAllLearningRequests(); cancelLookupRequests();
          const config = await effectiveProvider();
          const publicConfig = { mode: config.mode, model: config.model, prefetch: config.prefetch, prefetchExpressions: config.prefetchExpressions === true, configured: !['cloud', 'codex-cli'].includes(config.mode) || !!config.apiKey };
          for (const tab of await browser.tabs.query({})) if (tab.id !== undefined) void browser.tabs.sendMessage(tab.id, { type: 'FLOWWORD_PROVIDER_CHANGED', ...publicConfig }).catch(() => {});
          return { ok: true };
        }
        if (message.type === 'FLOWWORD_PROVIDER_PUBLIC') {
          const config = await effectiveProvider();
          return { ok: true, mode: config.mode, model: config.model, prefetch: config.prefetch, prefetchExpressions: config.prefetchExpressions === true, configured: !['cloud', 'codex-cli'].includes(config.mode) || !!config.apiKey };
        }
        if (message.type === 'FLOWWORD_SETTINGS_OPEN') { await browser.tabs.create({ url: browser.runtime.getURL('/settings.html') }); return { ok: true }; }
        if (message.type === 'FLOWWORD_ENABLE_SITE' && extensionPage) {
          const origin = new URL(message.origin).origin;
          if (!/^https?:/.test(origin) || !await browser.permissions.contains({ origins: [origin + '/*'] })) throw new Error('请先通过浏览器授权该网站');
          const id = `flowword-site-${encodeURIComponent(origin).replace(/%/g, '-')}`;
          if (origin === 'https://www.youtube.com') return { ok: true };
          const registered = await browser.scripting.getRegisteredContentScripts({ ids: [id] });
          if (!registered.length) await browser.scripting.registerContentScripts([{ id, matches: [origin + '/*'], js: ['content-scripts/flowword.js'], runAt: 'document_idle', persistAcrossSessions: true }]);
          return await handleSiteScope({ type: 'FLOWWORD_SCOPE_SITE', origin, enabled: true });
        }
        if (message.type === 'FLOWWORD_BOOK_OPEN') { await browser.tabs.create({ url: browser.runtime.getURL('/wordbook.html') }); return { ok: true }; }
        return { ok: false, error: '未知操作' };
      } catch (error) { return { ok: false, error: error instanceof Error ? error.message : '操作失败，请重试' }; }
    })();
  });   // 只接收本扩展页面和自己的 YouTube 内容脚本，不允许任意网页调用服务
  browser.permissions.onRemoved.addListener((removed) => {
    void (async () => {
      if (!removed.origins?.length) return;
      cancelAllLearningRequests(); cancelLookupRequests();
      const registered = await browser.scripting.getRegisteredContentScripts();
      const checks = await Promise.all(registered.filter((script) => script.id.startsWith('flowword-site-')).map(async (script) => ({ script, allowed: await browser.permissions.contains({ origins: script.matches ?? [] }) })));
      const revoke = checks.filter((item) => !item.allowed).map((item) => item.script);
      if (!revoke.length) return;
      await browser.scripting.unregisterContentScripts({ ids: revoke.map((script) => script.id) });
      const revokedMatches = revoke.flatMap((script) => script.matches ?? []);
      for (const tab of await browser.tabs.query({})) if (tab.id !== undefined) void browser.tabs.sendMessage(tab.id, { type: 'FLOWWORD_SITE_REVOKED', origins: revokedMatches }).catch(() => {});
    })().catch(() => {});
  });   // 只撤销已注册网站脚本，接口授权不会被误当成视频站授权
  browser.tabs.onRemoved.addListener((tabId) => { cancelTranslationOwner(tabId); cancelLookupRequests(tabId); void clearSettingsGrants(tabId); });
  browser.tabs.onUpdated.addListener((tabId, changed) => { if (changed.status === 'complete') void deliverPendingSourceReplay(tabId); });
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
    await browser.action.setTitle({ title: enabled ? 'FlowWord · 学习助手已开启' : 'FlowWord · 开启学习助手' });
  }
  const refresh = () => { void updateBadge().catch((error) => console.warn('FlowWord 标识更新失败', error)); };
  browser.runtime.onInstalled.addListener(refresh);
  browser.runtime.onStartup.addListener(refresh);
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && STORAGE.enabled in changes) refresh();
  });   // 后台只更新图标，核心交互和设置不依赖内存中的全局变量
});
