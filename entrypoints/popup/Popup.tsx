import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import type { PageStatus, Settings } from '../../src/core/types';
import { DEFAULT_SETTINGS, readSettings, writeSetting } from '../../src/storage/settings';
import { FlowMark, Icon } from '../../src/ui/Icons';

export function Popup() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [page, setPage] = useState<PageStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hint, setHint] = useState('正在连接当前页面');
  const [error, setError] = useState('');
  const [siteOrigin, setSiteOrigin] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      try {
        const saved = await readSettings();
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (cancelled) return;
        setSettings(saved);
        if (!tab?.id || !/^https?:\/\//.test(tab.url ?? '')) {
          setHint('打开英文网页或视频后启用FlowWord');
          return;
        }
        if (!tab.url?.startsWith('https://www.youtube.com/')) setSiteOrigin(new URL(tab.url!).origin);
        try {
          const status = await browser.tabs.sendMessage(tab.id, { type: 'FLOWWORD_PING' }) as PageStatus;
          if (cancelled) return;
          setPage(status);
          setHint(status.isVideoPage ? '当前视频已就绪' : '当前网页已就绪 · 选中英文即可翻译');
        } catch {
          if (!cancelled) setHint(tab.url?.startsWith('https://www.youtube.com/') ? '首次安装后，请刷新页面再打开插件' : '授权此网站后，可使用划词翻译和视频字幕学习');
        }
      } catch {
        if (!cancelled) setError('设置读取失败，请关闭插件面板后重试');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void initialize();
    return () => { cancelled = true; };
  }, []);

  async function toggle() {
    setSaving(true);
    setError('');
    try {
      const enabled = !settings.enabled;
      await writeSetting('enabled', enabled);
      setSettings((previous) => ({ ...previous, enabled }));
    } catch { setError('没有保存成功，请再试一次'); }
    finally { setSaving(false); }
  }

  async function resetPosition() {
    try {
      await writeSetting('position', DEFAULT_SETTINGS.position);
      setHint('悬浮球已回到右侧默认位置');
    } catch { setError('位置重置失败，请重试'); }
  }

  async function enableSite() {
    setSaving(true); setError('');
    try {
      const granted = await browser.permissions.request({ origins: [`${siteOrigin}/*`] });   // 只为用户选择的当前网站请求访问权限
      if (!granted) { setHint('没有授予网站权限'); return; }
      const response = await browser.runtime.sendMessage({ type: 'FLOWWORD_ENABLE_SITE', origin: siteOrigin });
      if (!response?.ok) throw new Error(response?.error || '站点启用失败');
      await writeSetting('enabled', true); setSettings((previous) => ({ ...previous, enabled: true }));
      setHint('已授权此站，请刷新页面后选中英文或打开视频字幕');
    } catch (error) { setError(error instanceof Error ? error.message : '启用失败'); }
    finally { setSaving(false); }
  }

  // openPanel 打开当前视频悬浮面板，view选择模型或快捷词本，失败保留提示而不创建网页
  async function openPanel(view: 'provider' | 'book' | 'scope') {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('请先打开英文网页或视频');
      const result = await browser.tabs.sendMessage(tab.id, { type: 'FLOWWORD_PANEL_OPEN', view });
      if (!result?.ok) throw new Error(result?.error || '请先开启FlowWord并刷新页面');
      window.close();
    } catch { setError('请先在已授权页面开启FlowWord，再打开此面板'); }
  }

  // openScope 优先在当前悬浮框打开总设置，未启用网站时使用扩展来源入口完成授权
  async function openScope() {
    try { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); if (!tab?.id) throw new Error(); const response = await browser.tabs.sendMessage(tab.id, { type: 'FLOWWORD_PANEL_OPEN', view: 'scope' }); if (!response?.ok) throw new Error(); window.close(); }
    catch { await browser.tabs.create({ url: browser.runtime.getURL('/settings.html') + '?view=scope' }); }
  }
  return <main className="popup">
    <header><div className="logo"><FlowMark size={24} /></div><span className="wordmark">FlowWord</span><span className="version">{browser.runtime.getManifest().version}</span></header>
    <div className="intro"><span className="eyebrow">A SMALL PAUSE. A LITTLE MORE CLARITY.</span><h1>停一下，<br /><span>看懂这一句</span></h1><p>看视频、读网页，在原处理解英文<br />收藏词句，随时重听和复习</p></div>
    <section className={`switch-card ${settings.enabled ? 'enabled' : ''}`}>
      <div><strong>英文学习助手</strong><span>{settings.enabled ? '已开启 · 在授权站显示' : '已关闭 · 由你决定何时开启'}</span></div>
      <button type="button" role="switch" aria-checked={settings.enabled} aria-label="FlowWord 学习助手开关" disabled={loading || saving || (!page && !settings.enabled)} onClick={() => void toggle()}><span /></button>
    </section>
    <p className="page-hint" role="status"><span className={page ? 'connected' : ''} />{hint}</p>
    {siteOrigin && <button type="button" disabled={saving} onClick={() => void enableSite()}>在此网站启用 · {siteOrigin}</button>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="howto"><div><span>01</span><p>选中网页英文，或打开视频的 <b>English 字幕</b></p></div><div><span>02</span><p>点击「翻译」，或点击悬浮球暂停视频</p></div><div><span>03</span><p>收藏值得记住的词句，进入词本复习</p></div></div>
    <footer><button type="button" onClick={() => void openScope()}>总设置 · 网站使用范围</button><button type="button" onClick={() => void openPanel('book')}>打开单词本<Icon name="arrow" size={14} /></button><button type="button" onClick={() => void openPanel('provider')}>云端模型与快捷键设置<Icon name="arrow" size={14} /></button><button type="button" onClick={() => void resetPosition()}>重置悬浮球位置<Icon name="arrow" size={14} /></button><span>右键悬浮球配置外观</span></footer>
  </main>;
}
