import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';

// EmbeddedSettings 在原悬浮框打开模型设置，无参数，先取得当前标签的短期授权再挂载扩展iframe
// 不接触密钥，关闭或切换面板撤销授权，异步回复晚于卸载时也立即回收
export function EmbeddedSettings() {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
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
  return <iframe className="fw-provider-frame" src={`${browser.runtime.getURL('/settings.html')}?embedded=1&token=${encodeURIComponent(token)}`} title="模型与快捷键设置" />;
}
