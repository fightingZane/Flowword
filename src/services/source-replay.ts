import { browser, type Browser } from 'wxt/browser';
import { normalizeReplaySource, type SourceReplayRequest } from '../core/source-replay';

const pendingPrefix = 'flowword-source-replay:';
const delivering = new Set<number>();

// deliverPendingSourceReplay 向tabId新打开视频交付一次原句重听，等待内容脚本准备，不读取其他网页资料
export async function deliverPendingSourceReplay(tabId: number): Promise<void> {
  if (delivering.has(tabId)) return;
  const key = pendingPrefix + tabId;
  const record = (await browser.storage.session.get(key))[key] as { source: SourceReplayRequest; expires: number } | undefined;
  if (!record) return;
  if (record.expires < Date.now()) { await browser.storage.session.remove(key); return; }
  delivering.add(tabId);
  try {
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const probe = await browser.tabs.sendMessage(tabId, { type: 'FLOWWORD_SOURCE_PROBE', source: record.source });
        if (probe?.matches) {
          await browser.storage.session.remove(key);
          await browser.tabs.sendMessage(tabId, { type: 'FLOWWORD_SOURCE_REPLAY', source: record.source });
          return;
        }
      } catch { /* 页面尚未就绪时短暂等待，未授权页面不会注入脚本 */ }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await browser.storage.session.remove(key);
  } finally { delivering.delete(tabId); }
}

// handleSourceReplay 处理词卡的source回看，只允许扩展页面发起，现有已授权标签优先复用
// 新网页只有本来已获授权并成功识别视频时才自动重听，其他情况保留正常来源链接
export async function handleSourceReplay(message: { type?: string; source?: unknown }, sender: Browser.runtime.MessageSender): Promise<object | undefined> {
  if (message.type === 'FLOWWORD_SOURCE_READY') { if (sender.tab?.id !== undefined) void deliverPendingSourceReplay(sender.tab.id); return { ok: true }; }
  if (message.type !== 'FLOWWORD_REPLAY_SOURCE') return;
  if (!sender.url?.startsWith(browser.runtime.getURL('/')) && !/^https?:\/\//.test(sender.url || '')) return { ok: false, error: '无效回看入口' };
  const source = normalizeReplaySource(message.source);
  for (const tab of await browser.tabs.query({})) {
    if (tab.id === undefined) continue;
    try {
      const probe = await browser.tabs.sendMessage(tab.id, { type: 'FLOWWORD_SOURCE_PROBE', source });
      if (!probe?.matches) continue;
      await browser.tabs.update(tab.id, { active: true });
      return await browser.tabs.sendMessage(tab.id, { type: 'FLOWWORD_SOURCE_REPLAY', source });
    } catch { /* 其他标签无本扩展脚本，既不读取内容也不操作 */ }
  }
  const url = new URL(source.url);
  if (url.hostname === 'www.youtube.com') url.searchParams.set('t', `${Math.floor(source.time)}s`);
  else url.hash = `t=${Math.floor(source.time)}`;
  const tab = await browser.tabs.create({ url: url.href });
  if (tab.id !== undefined) {
    await browser.storage.session.set({ [pendingPrefix + tab.id]: { source, expires: Date.now() + 60_000 } });
    void deliverPendingSourceReplay(tab.id);
  }
  return { ok: true, opened: true, message: '已打开来源；已授权且能识别字幕时自动重听，否则请在播放器中继续' };
}
