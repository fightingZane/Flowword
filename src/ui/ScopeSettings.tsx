import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import type { SiteScope } from '../storage/site-scope';
const origins = ['http://*/*', 'https://*/*'];
// ScopeSettings 在扩展来源设置框管理网站权限，无参数，只在用户点选时申请权限和保存来源规则
// 打开标签标题仅用于本次显示，网站规则按来源保存，下次访问仍生效
export function ScopeSettings() {
  const [scope, setScope] = useState<SiteScope>();
  const [sites, setSites] = useState<{ origin: string; title: string; enabled: boolean }[]>([]);
  const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  // refresh 刷新公开网站规则与当前可见标签列表，无参数，不保存标题或整页内容
  async function refresh() { const result = await browser.runtime.sendMessage({ type: 'FLOWWORD_SCOPE_LIST' }); if (!result?.ok) throw new Error(result?.error || '网站列表读取失败'); setScope(result.scope); setSites(result.sites); }
  useEffect(() => { void refresh().catch((error) => setNotice(error.message)); }, []);
  // change 修改all或单一origin范围，value决定开启，权限获准后才写入记忆
  async function change(value: boolean, origin?: string) {
    setBusy(true); setNotice('');
    if (!origin) setScope((previous) => ({ allSites: value, allowed: previous?.allowed ?? [], blocked: previous?.blocked ?? [] }));
    else setSites((previous) => previous.map((site) => site.origin === origin ? { ...site, enabled: value } : site));
    try {
      if (value && !await browser.permissions.contains({ origins: origin ? [origin + '/*'] : origins }) && !await browser.permissions.request({ origins: origin ? [origin + '/*'] : origins })) throw new Error('未获得网站权限，原设置保留');
      const result = await browser.runtime.sendMessage({ type: origin ? 'FLOWWORD_SCOPE_SITE' : 'FLOWWORD_SCOPE_ALL', enabled: value, origin });
      if (!result?.ok) throw new Error(result?.error || '网站设置保存失败');
      await refresh(); setNotice('已保存，下次打开该网站仍沿用此选择');
    } catch (error) { setNotice(error instanceof Error ? error.message : '设置失败'); await refresh().catch(() => {}); } finally { setBusy(false); }
  }
  // showTabs 取得可选标签权限后读取所有打开的网站，无参数，不授权这些网站的内容访问
  async function showTabs() { try { if (!await browser.permissions.request({ permissions: ['tabs'] })) throw new Error('未获得标签列表权限'); await refresh(); } catch (error) { setNotice(error instanceof Error ? error.message : '列表读取失败'); } }
  return <section className="scope-settings"><h2>使用范围</h2><label className="check"><input type="checkbox" aria-label="在所有网站启用" checked={scope?.allSites === true} disabled={busy} onChange={(event) => void change(event.target.checked)} />在所有普通网页启用</label><p>同一网站共用启停选择，下次访问自动记住。关闭的网站不会采样字幕或选区</p><button type="button" onClick={() => void showTabs()} disabled={busy}>显示所有打开的网站</button><div className="scope-sites">{sites.map((site) => <label key={site.origin}><input type="checkbox" aria-label={`启用网站 ${site.origin}`} checked={site.enabled} disabled={busy} onChange={(event) => void change(event.target.checked, site.origin)} /><span><strong>{site.title}</strong><small>{site.origin}</small></span></label>)}</div>{!!scope?.blocked.length && <details><summary>已停用的网站（{scope.blocked.length}）</summary>{scope.blocked.map((origin) => <p key={origin}>{origin} <button type="button" disabled={busy} onClick={() => void change(true, origin)}>重新启用</button></p>)}</details>}<p role="status">{notice}</p></section>;
}
