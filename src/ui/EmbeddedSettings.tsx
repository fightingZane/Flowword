import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { PALETTE_KEYS, parseThemePalette } from '../core/theme-palette';
import { THEMES } from './themes';

// EmbeddedSettings 在原悬浮框打开模型设置，无参数，先取得当前标签的短期授权再挂载扩展iframe
// 不接触密钥，关闭或切换面板撤销授权，异步回复晚于卸载时也立即回收
export function EmbeddedSettings({ view = 'model' }: { view?: 'model' | 'scope' | 'selection' }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const frame = useRef<HTMLIFrameElement>(null);
  const [theme, setTheme] = useState('dark');
  const [palette, setPalette] = useState('{}');
  useEffect(() => {
    const parent = frame.current?.closest('.fw-app');
    if (!parent) return;
    // syncTheme 读取父面板主题白名单，无参数，只传主题名而不跨来源传配置或密钥
    const syncTheme = () => {
      const value = parent.getAttribute('data-theme'); setTheme(THEMES.some((item) => item.value === value) ? value! : 'dark');
      const style = getComputedStyle(parent); const colors = Object.fromEntries(PALETTE_KEYS.map((key) => [key, style.getPropertyValue('--fw-' + key).trim()]));
      const surface = parent.matches('.fw-selection') ? parent : parent.querySelector('.fw-bubble');
      if (surface) { const actual = getComputedStyle(surface); colors.paper = actual.backgroundColor; colors.ink = actual.color; }
      setPalette(JSON.stringify(parseThemePalette(colors)));
    };
    syncTheme(); const observer = new MutationObserver(syncTheme); observer.observe(parent, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
    return () => observer.disconnect();
  }, [token]);
  useEffect(() => {
    let active = true;
    let issued = '';
    void browser.runtime.sendMessage({ type: 'FLOWWORD_SETTINGS_EMBED_CREATE' }).then((result) => {
      if (!result?.ok || !result.token) throw new Error(result?.error || '设置暂时无法打开');
      issued = result.token;
      if (active) setToken(issued);
      else void browser.runtime.sendMessage({ type: 'FLOWWORD_SETTINGS_EMBED_REVOKE', token: issued }).catch(() => {});
    }).catch((failure) => { if (active) setError(failure instanceof Error ? failure.message : '设置暂时无法打开'); });
    return () => { active = false; if (issued) void browser.runtime.sendMessage({ type: 'FLOWWORD_SETTINGS_EMBED_REVOKE', token: issued }).catch(() => {}); };
  }, []);
  if (!token) return <p className="fw-learning-note" role="status">{error || '正在打开模型设置…'}</p>;
  return <iframe ref={frame} className="fw-provider-frame" src={`${browser.runtime.getURL('/settings.html')}?embedded=1&token=${encodeURIComponent(token)}&view=${view}&theme=${theme}&palette=${encodeURIComponent(palette)}`} title="模型与快捷键设置" />;
}
