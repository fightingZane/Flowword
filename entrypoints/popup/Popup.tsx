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

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      try {
        const saved = await readSettings();
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (cancelled) return;
        setSettings(saved);
        if (!tab?.id || !tab.url?.startsWith('https://www.youtube.com/')) {
          setHint('打开 YouTube 视频后，在这里开启悬浮球');
          return;
        }
        try {
          const status = await browser.tabs.sendMessage(tab.id, { type: 'FLOWWORD_PING' }) as PageStatus;
          if (cancelled) return;
          setPage(status);
          setHint(status.isVideoPage ? '当前视频已就绪' : '已连接 YouTube · 请选择一个普通视频');
        } catch {
          if (!cancelled) setHint('首次安装后，请刷新 YouTube 页面再打开插件');
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

  return <main className="popup">
    <header><div className="logo"><FlowMark size={24} /></div><span className="wordmark">FlowWord</span><span className="version">0.2</span></header>
    <div className="intro"><span className="eyebrow">A SMALL PAUSE. A LITTLE MORE CLARITY.</span><h1>停一下，<br /><span>看懂这一句。</span></h1><p>在英文视频里，留住刚才没听懂的字幕。<br />不必复制，不必离开。</p></div>
    <section className={`switch-card ${settings.enabled ? 'enabled' : ''}`}>
      <div><strong>YouTube 悬浮球</strong><span>{settings.enabled ? '已开启 · 在视频页显示' : '已关闭 · 由你决定何时开启'}</span></div>
      <button type="button" role="switch" aria-checked={settings.enabled} aria-label="YouTube 悬浮球开关" disabled={loading || saving || (!page && !settings.enabled)} onClick={() => void toggle()}><span /></button>
    </section>
    <p className="page-hint" role="status"><span className={page ? 'connected' : ''} />{hint}</p>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="howto"><div><span>01</span><p>打开视频的 <b>English 字幕</b></p></div><div><span>02</span><p>点击悬浮球，暂停并查看原文</p></div><div><span>03</span><p>点击「继续观看」，接着听</p></div></div>
    <footer><button type="button" onClick={() => void browser.runtime.sendMessage({ type: 'FLOWWORD_BOOK_OPEN' })}>打开单词本<Icon name="arrow" size={14} /></button><button type="button" onClick={() => void resetPosition()}>重置悬浮球位置<Icon name="arrow" size={14} /></button><span>右键悬浮球配置外观与联网翻译</span></footer>
  </main>;
}
