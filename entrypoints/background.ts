import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { STORAGE } from '../src/storage/settings';
import { requestTranslation, splitTranslation, validTranslationInput } from '../src/services/translation';
import { allEntries, deleteEntry, saveEntry } from '../src/storage/wordbook';

export default defineBackground(() => {
  const cache = new Map<string, string>();
  const pending = new Map<string, Promise<string>>();
  let queue = Promise.resolve();
  let queued = 0;

  async function translate(text: string): Promise<string> {
    if (cache.has(text)) return cache.get(text)!;
    if (pending.has(text)) return pending.get(text)!;
    if (queued >= 16) throw new Error('翻译请求较多，请稍后再试');
    queued++;
    const task = queue.then(async () => {
      const stored = await browser.storage.local.get(STORAGE.onlineTranslation);
      if (stored[STORAGE.onlineTranslation] !== true) throw new Error('请先在右键配置中开启联网翻译');
      try {
        const translated = await requestTranslation(text);
        cache.set(text, translated);
        if (cache.size > 200) cache.delete(cache.keys().next().value!);
        return translated;
      } finally { await new Promise((resolve) => setTimeout(resolve, 250)); }   // 成功和失败都限速，避免请求洪峰
    });
    pending.set(text, task);
    queue = task.then(() => {}, () => {});
    void task.finally(() => { queued--; pending.delete(text); }).catch(() => {});
    return task;
  }

  browser.runtime.onMessage.addListener((message, sender) => {
    const internal = sender.id === browser.runtime.id && (sender.url?.startsWith('https://www.youtube.com/') || sender.url?.startsWith(browser.runtime.getURL('/')));
    if (!internal || !message || typeof message !== 'object') return;
    return (async () => {
      try {
        if (message.type === 'FLOWWORD_TRANSLATE') {
          const stored = await browser.storage.local.get(STORAGE.onlineTranslation);
          if (stored[STORAGE.onlineTranslation] !== true) throw new Error('请先开启联网翻译');
          if (typeof message.sentence !== 'string' || !Array.isArray(message.words) || message.words.length > 3) throw new Error('翻译请求无效');
          const chunks = splitTranslation(message.sentence);
          const words: Record<string, string> = {};
          let translation: string | undefined;
          const errors: string[] = [];
          try {
            const pieces: string[] = [];
            for (const chunk of chunks) pieces.push(await translate(chunk));
            translation = pieces.join(' ');
          } catch (error) { errors.push(chunks.length > 1 ? '分段翻译未完整成功，请重试' : error instanceof Error ? error.message : '整句翻译失败'); }
          for (const item of message.words) {
            if (!validTranslationInput(item?.text) || item.text.length > 100) continue;
            if (typeof item.meaning === 'string' && item.meaning.length < 500) { words[item.text] = item.meaning; continue; }
            try { words[item.text] = await translate(item.text); } catch { errors.push(`${item.text} 暂无参考译文`); }
          }
          return { ok: true, translation, words, segmented: chunks.length > 1, error: errors.length ? errors.join('；') : undefined };
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
