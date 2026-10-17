import { browser, type Browser } from 'wxt/browser';
import { STORAGE } from '../storage/settings';

type SettingsSender = Pick<Browser.runtime.MessageSender, 'url' | 'frameId'> & { tab?: { id?: number } };
interface EmbedGrant { tabId: number; expires: number; frameId?: number }
const prefix = 'flowword-settings-grant:';

// handleSettingsAccess 处理悬浮框设置会话，message指定创建校验或撤销，sender由浏览器提供
// 令牌仅绑定发起内容脚本所在标签和首次加载的扩展子框，不允许未启用站点独立加载配置
export async function handleSettingsAccess(message: { type?: string; token?: string }, sender: SettingsSender): Promise<object | undefined> {
  if (!['FLOWWORD_SETTINGS_EMBED_CREATE', 'FLOWWORD_SETTINGS_EMBED_CHECK', 'FLOWWORD_SETTINGS_EMBED_REVOKE'].includes(message.type || '')) return;
  const tabId = sender.tab?.id;
  if (tabId === undefined) return { ok: false, error: '设置会话必须从FlowWord面板打开' };
  if (message.type === 'FLOWWORD_SETTINGS_EMBED_CREATE') {
    if (sender.frameId !== 0 || !/^https?:\/\//.test(sender.url || '')) return { ok: false, error: '无效设置入口' };
    const enabled = (await browser.storage.local.get(STORAGE.enabled))[STORAGE.enabled] === true;
    const origin = new URL(sender.url!).origin;
    if (!enabled || (origin !== 'https://www.youtube.com' && !await browser.permissions.contains({ origins: [origin + '/*'] }))) return { ok: false, error: '请先在当前网站启用FlowWord' };
    const token = crypto.randomUUID();
    await browser.storage.session.set({ [prefix + token]: { tabId, expires: Date.now() + 2 * 60_000 } satisfies EmbedGrant });
    return { ok: true, token };
  }
  if (typeof message.token !== 'string' || !/^[a-f0-9-]{36}$/i.test(message.token)) return { ok: false, error: '请从FlowWord面板重新打开模型设置' };
  const key = prefix + message.token;
  const grant = (await browser.storage.session.get(key))[key] as EmbedGrant | undefined;
  if (!grant || grant.tabId !== tabId) return { ok: false, error: '设置会话不属于当前标签页' };
  if (message.type === 'FLOWWORD_SETTINGS_EMBED_REVOKE') {
    if (sender.frameId !== 0 || !/^https?:\/\//.test(sender.url || '')) return { ok: false, error: '无效设置入口' };
    await browser.storage.session.remove(key); return { ok: true };
  }
  if (grant.expires < Date.now() || !sender.url?.startsWith(browser.runtime.getURL('/settings.html')) || !sender.frameId || (grant.frameId !== undefined && grant.frameId !== sender.frameId)) return { ok: false, error: '设置会话已过期，请从FlowWord面板重新打开' };
  await browser.storage.session.set({ [key]: { ...grant, frameId: sender.frameId, expires: Date.now() + 60 * 60_000 } });
  return { ok: true };
}

// clearSettingsGrants 清理tabId关闭标签的设置授权，避免浏览器会话持续堆积失效记录
export async function clearSettingsGrants(tabId: number): Promise<void> {
  const stored = await browser.storage.session.get(null);
  const keys = Object.entries(stored).filter(([key, value]) => key.startsWith(prefix) && (value as EmbedGrant)?.tabId === tabId).map(([key]) => key);
  if (keys.length) await browser.storage.session.remove(keys);
}

// isSettingsFrameGranted 复核sender扩展子框会话，顶层扩展页无需嵌入授权
export async function isSettingsFrameGranted(sender: SettingsSender): Promise<boolean> {
  if (!sender.tab || !sender.frameId) return true;
  const records = await browser.storage.session.get(null);
  return Object.entries(records).some(([key, value]) => {
    const grant = value as EmbedGrant;
    return key.startsWith(prefix) && grant.tabId === sender.tab!.id && grant.frameId === sender.frameId && grant.expires > Date.now();
  });
}
