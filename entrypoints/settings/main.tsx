import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import { DEFAULT_PROVIDER, readProvider, saveProvider, validateProvider, clearTranslationCache, type ProviderConfig } from '../../src/storage/provider';
import { STORAGE } from '../../src/storage/settings';
import './style.css';
const embedded = new URLSearchParams(location.search).get('embedded') === '1';
document.documentElement.dataset.embedded = embedded ? 'true' : 'false';
// Settings 是独立扩展配置页，无参数，从扩展数据库读取服务配置
// 顶层页面或嵌入框都保持chrome-extension来源，不把密钥交给父页面或postMessage
function Settings() {
  const [config, setConfig] = useState<ProviderConfig>({ ...DEFAULT_PROVIDER, mode: 'cloud' });
  const savedSecret = useRef({ endpoint: '', apiKey: '' });
  const [hasSavedKey, setHasSavedKey] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [configReady, setConfigReady] = useState(false);
  const [activeService, setActiveService] = useState('正在读取实际服务');
  // refreshService 从后台读取实际生效的公开配置，无参数，不读取或显示密钥
  async function refreshService() {
    const service = await browser.runtime.sendMessage({ type: 'FLOWWORD_PROVIDER_PUBLIC' });
    if (!service?.ok) { setActiveService('实际服务读取失败，请重试'); return; }
    setActiveService(service.mode === 'cloud' ? `当前实际服务：云端模型 · ${service.model}` : service.mode === 'mymemory' ? '当前实际服务：MyMemory 参考机译 · 无语境分析' : '当前实际服务：联网已关闭');
  }
  useEffect(() => { void refreshService().catch(() => setActiveService('实际服务读取失败，请重试')); }, []);
  const [shortcuts, setShortcuts] = useState<{ name?: string; shortcut?: string }[]>([]);
  useEffect(() => { void browser.commands.getAll().then(setShortcuts).catch(() => setNotice('快捷键读取失败，请在浏览器扩展管理页检查')); }, []);
  useEffect(() => { void readProvider().then(async (stored) => stored ?? { ...DEFAULT_PROVIDER, mode: 'cloud' as const }).then((stored) => { savedSecret.current = { endpoint: stored.endpoint, apiKey: stored.apiKey }; setHasSavedKey(!!stored.apiKey); setConfig({ ...stored, apiKey: '' }); }).catch(() => setNotice('配置读取失败')).finally(() => setConfigReady(true)); }, []);
  const update = (patch: Partial<ProviderConfig>) => setConfig((previous) => ({ ...previous, ...patch }));
  // save 校验当前表单并请求选定接口域名授权，无参数，由可信按钮点击调用
  // 授权成功才保存，密钥不通过公开消息返回给内容脚本
  async function save() {
    setBusy(true); setNotice('');
    try {
      const sameEndpoint = new URL(config.endpoint).href === new URL(savedSecret.current.endpoint || config.endpoint).href;
      if (config.mode === 'cloud' && !config.apiKey.trim() && savedSecret.current.apiKey && !sameEndpoint) throw new Error('修改接口地址后请重新输入 API Key，避免把旧密钥发送给其他服务');
      const value = validateProvider({ ...config, apiKey: config.apiKey.trim() || (sameEndpoint ? savedSecret.current.apiKey : '') });
      const origin = value.mode === 'cloud' ? new URL(value.endpoint).origin : 'https://api.mymemory.translated.net';
      if (value.mode !== 'off' && !await browser.permissions.contains({ origins: [origin + '/*'] }) && !await browser.permissions.request({ origins: [origin + '/*'] })) throw new Error('接口访问未授权，配置尚未保存');
      await saveProvider(value);
      savedSecret.current = { endpoint: value.endpoint, apiKey: value.apiKey }; setHasSavedKey(!!value.apiKey); setConfig({ ...value, apiKey: '' });
      await browser.storage.local.set({ [STORAGE.onlineTranslation]: value.mode !== 'off' });
      await browser.runtime.sendMessage({ type: 'FLOWWORD_PROVIDER_CHANGED' });
      await refreshService();
      setNotice(embedded ? '配置已保存，关闭设置即可继续学习' : '配置已保存，返回视频重新点击悬浮球即可');
    } catch (error) { setNotice(error instanceof Error ? error.message : '保存失败'); }
    finally { setBusy(false); }
  }
  // clearSecret 清除已保存密钥并关闭联网，无参数，按钮明确操作后调用
  // 从数据库读取有效旧配置，未保存的错误输入不能阻止清除
  async function clearSecret() {
    setBusy(true);
    try {
      const stored = await readProvider() ?? DEFAULT_PROVIDER;
      const cleared: ProviderConfig = { ...stored, mode: 'off', apiKey: '' };
      await saveProvider(cleared); await browser.storage.local.set({ [STORAGE.onlineTranslation]: false });
      savedSecret.current = { endpoint: cleared.endpoint, apiKey: '' }; setHasSavedKey(false); setConfig(cleared); await browser.runtime.sendMessage({ type: 'FLOWWORD_PROVIDER_CHANGED' }); await refreshService(); setNotice('密钥已清除，联网已关闭');
    } catch { setNotice('清除失败，请重试'); }
    finally { setBusy(false); }
  }   // 从已保存配置清除，未保存的错误地址不能阻止删除密钥
  return <main><header>FlowWord · 翻译服务</header><h1>让翻译理解当前语境</h1><p>{embedded ? "密钥仅保存在本机扩展中，向所选服务发送字幕；填写并保存后启用，调用可能收费" : "密钥只保存于本机扩展数据库，仅向你授权的接口发送。云端收到当前字幕与最多两句相邻字幕，不发送视频网址。默认预填 DeepSeek，填写密钥并保存才启用。服务可能收费，请确认接口提供方可信。"}</p>
    <p className="active-service" aria-live="polite">{activeService}</p><label>服务<select disabled={!configReady} aria-label="服务" value={config.mode} onChange={(event) => update({ mode: event.target.value as ProviderConfig['mode'] })}><option value="off">关闭联网</option><option value="cloud">云端模型 · Chat Completions 兼容接口</option><option value="mymemory">MyMemory · 整句参考翻译，无语境词义</option></select></label>
    {config.mode === 'cloud' && <><label>HTTPS 接口完整地址<input aria-label="HTTPS 接口完整地址" value={config.endpoint} onChange={(event) => update({ endpoint: event.target.value })}/></label><label>模型名称<input aria-label="模型名称" value={config.model} onChange={(event) => update({ model: event.target.value })} placeholder="提供方支持的模型名称"/></label><label>API Key<input aria-label="API Key" type="password" autoComplete="off" placeholder={hasSavedKey ? "已配置 · 留空保留，输入则替换" : "请输入 API Key"} value={config.apiKey} onChange={(event) => update({ apiKey: event.target.value })}/></label><label className="check"><input type="checkbox" checked={config.prefetch} onChange={(event) => update({ prefetch: event.target.checked })}/>允许播放中预译已出现的当前字幕及已加载邻句，每次最多两句，每标签页会话最多二十句，可能增加费用</label><label className="check"><input type="checkbox" aria-label="提前准备词组释义" disabled={!config.prefetch} checked={config.prefetchExpressions === true} onChange={(event) => update({ prefetchExpressions: event.target.checked })}/>提前准备词组释义：每个新句最多额外一次模型调用，已准备时点开可同时看到整句和词组</label><p>先开启播放预译，再按需开启词组预解析；默认沿用旧版只预译整句。首次新字幕或未完成的请求仍可能等待</p></>}
    {config.mode === 'mymemory' && <p>MyMemory 匿名额度有限，可能保存文本并交给第三方机译处理。不会自动降级到此服务，也不逐词查询。</p>}
    <section><h2>键盘快捷键</h2>{shortcuts.filter((item) => item.name?.startsWith('flowword-')).map((item) => <p key={item.name}>{item.name === 'flowword-toggle' ? '暂停 / 恢复' : '重听当前句'}：{item.shortcut || '未绑定或组合键冲突，请在浏览器中设置'}</p>)}</section>
    <div className="buttons"><button onClick={() => void save()} disabled={busy || !configReady}>授权接口并保存</button><button disabled={busy} onClick={() => void clearSecret()}>清除密钥</button><button onClick={() => void clearTranslationCache().then(() => setNotice('本地译文缓存已清除')).catch(() => setNotice('缓存清除失败，请重试'))}>清除译文缓存</button><button onClick={() => void browser.tabs.create({ url: 'chrome://extensions/shortcuts' })}>修改键盘快捷键</button></div><p role="status">{notice}</p></main>;
}
createRoot(document.getElementById('root')!).render(<Settings/>);
