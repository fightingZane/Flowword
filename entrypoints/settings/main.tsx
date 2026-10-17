import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import { CODEX_BRIDGE_ENDPOINT, DEFAULT_PROVIDER, readProvider, saveProvider, validateProvider, clearTranslationCache, type ProviderConfig } from '../../src/storage/provider';
import { STORAGE } from '../../src/storage/settings';
import { requestCloud } from '../../src/services/cloud';
import { requestCodex } from '../../src/services/codex-cli';
import { checkCliStatus, cloudPreset, matchingEndpoint, parseCliConnection } from './connection-config';
import { ScopeSettings } from '../../src/ui/ScopeSettings';
import { SelectionSettings } from '../../src/ui/SelectionSettings';
import '../../src/ui/floating.css';
import { parseThemePalette } from '../../src/core/theme-palette';
import { THEMES } from '../../src/ui/themes';
import './style.css';
const embedded = new URLSearchParams(location.search).get('embedded') === '1';
document.documentElement.dataset.embedded = embedded ? 'true' : 'false';
const requestedTheme = new URLSearchParams(location.search).get('theme');
document.documentElement.classList.add('fw-app');
document.documentElement.dataset.theme = embedded && THEMES.some((theme) => theme.value === requestedTheme) ? requestedTheme! : 'dark';
// 仅同步父框实际颜色，避免深色模式或主题覆盖让内外面板出现两套配色
if (embedded) { try { const palette = parseThemePalette(JSON.parse(new URLSearchParams(location.search).get('palette') || '{}')); for (const [key, color] of Object.entries(palette)) document.documentElement.style.setProperty('--fw-' + key, color); } catch { /* 无效快照仍使用白名单主题 */ } }
// checkAccess 校验当前设置访问，无参数，顶层扩展页可用，嵌入页必须持有后台绑定的会话
async function checkAccess(): Promise<void> {
  if (window.top === window) return;
  const token = new URLSearchParams(location.search).get('token');
  const result = await browser.runtime.sendMessage({ type: 'FLOWWORD_SETTINGS_EMBED_CHECK', token });
  if (!result?.ok) throw new Error(result?.error || '请从FlowWord面板打开模型设置');
}
// Settings 是独立扩展配置页，无参数，从扩展数据库读取服务配置
// 顶层页面或嵌入框都保持chrome-extension来源，不把密钥交给父页面或postMessage
function Settings() {
  const [config, setConfig] = useState<ProviderConfig>({ ...DEFAULT_PROVIDER, mode: 'cloud' });
  const savedSecret = useRef({ endpoint: '', apiKey: '' });
  const importedCli = useRef({ endpoint: '', token: '' });
  const cloudDraft = useRef<ProviderConfig | null>(null);
  const connectionFile = useRef<HTMLInputElement>(null);
  const [connectionImported, setConnectionImported] = useState(false);
  const [hasSavedKey, setHasSavedKey] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [configReady, setConfigReady] = useState(false);
  const [activeService, setActiveService] = useState('正在读取实际服务');
  // refreshService 从后台读取实际生效的公开配置，无参数，不读取或显示密钥
  async function refreshService() {
    const service = await browser.runtime.sendMessage({ type: 'FLOWWORD_PROVIDER_PUBLIC' });
    if (!service?.ok) { setActiveService('实际服务读取失败，请重试'); return; }
    setActiveService(service.mode === 'codex-cli' ? `当前实际服务：本机 Codex CLI · ${service.model || 'CLI 默认模型'}` : service.mode === 'cloud' ? `当前实际服务：云端模型 · ${service.model}` : service.mode === 'mymemory' ? '当前实际服务：MyMemory 参考机译 · 无语境分析' : '当前实际服务：联网已关闭');
  }
  useEffect(() => { void refreshService().catch(() => setActiveService('实际服务读取失败，请重试')); }, []);
  const [shortcuts, setShortcuts] = useState<{ name?: string; shortcut?: string }[]>([]);
  useEffect(() => { void browser.commands.getAll().then(setShortcuts).catch(() => setNotice('快捷键读取失败，请在浏览器扩展管理页检查')); }, []);
  useEffect(() => { void readProvider().then(async (stored) => stored ?? { ...DEFAULT_PROVIDER, mode: 'cloud' as const }).then((stored) => { savedSecret.current = { endpoint: stored.endpoint, apiKey: stored.apiKey }; setHasSavedKey(!!stored.apiKey); setConfig({ ...stored, apiKey: '' }); }).catch(() => setNotice('配置读取失败')).finally(() => setConfigReady(true)); }, []);
  const update = (patch: Partial<ProviderConfig>) => setConfig((previous) => ({ ...previous, ...patch }));
  // chooseMode 表示切换服务，mode 是用户下拉选择，不立即保存或发请求
  // 离开 CLI 时恢复公开云端字段并清空表单凭据，令牌不作为云端 API Key 复用
  function chooseMode(mode: ProviderConfig['mode']) {
    setNotice('');
    if (mode === 'codex-cli') {
      if (config.mode === 'cloud') cloudDraft.current = { ...config, apiKey: '' };
      setConfig({ ...config, mode, endpoint: CODEX_BRIDGE_ENDPOINT, model: '', apiKey: '', prefetch: false, prefetchExpressions: false });
    } else if (config.mode === 'codex-cli' || matchingEndpoint(config.endpoint, CODEX_BRIDGE_ENDPOINT)) {
      const draft = cloudDraft.current || DEFAULT_PROVIDER;
      setConfig({ ...draft, mode, apiKey: '', protocol: draft.protocol || 'chat-completions' });
    } else update({ mode });
  }
  // usePreset 表示主动填入公开预设，name 是供应商，不影响已保存数据库或已存密钥
  // 切换主机清空正在输入的凭据，保存时仍需通过完整接口一致性检查
  function usePreset(name: 'deepseek' | 'openai') { update({ ...cloudPreset(name, config.protocol), apiKey: '' }); setNotice('已填入预设，检查模型与密钥后保存才生效'); }
  // chooseProtocol 表示切换云端协议，protocol 决定请求结构
  // 官方 OpenAI 两种完整路径随明确选择切换，自定义地址保留给用户核对
  function chooseProtocol(protocol: ProviderConfig['protocol']) {
    const openAi = ['https://api.openai.com/v1/chat/completions', 'https://api.openai.com/v1/responses'].includes(config.endpoint);
    update({ protocol, ...(openAi ? { endpoint: protocol === 'responses' ? 'https://api.openai.com/v1/responses' : 'https://api.openai.com/v1/chat/completions' } : {}) });
  }
  // importConnection 表示读取本机连接文件，file 是用户选取的 JSON，不会自动保存或联网
  // 令牌保留在引用内存，不回填输入值，不显示原始文件或错误响应
  async function importConnection(file?: File) {
    if (!file) return;
    try {
      await checkAccess();
      if (file.size > 16384) throw new Error('连接文件过大，请选择桥接生成的本机连接文件');
      const connection = parseCliConnection(await file.text()); importedCli.current = connection; setConnectionImported(true);
      setConfig((previous) => ({ ...previous, mode: 'codex-cli', endpoint: CODEX_BRIDGE_ENDPOINT, apiKey: '', model: '', prefetch: false, prefetchExpressions: false }));
      setNotice('连接文件已导入，点击保存或测试连接后才会访问本机桥接');
    } catch (error) { setNotice(error instanceof Error ? error.message : '连接文件读取失败'); }
    finally { if (connectionFile.current) connectionFile.current.value = ''; }
  }
  // resolvedConfig 表示取得本次操作的有效凭据，无参数，不把凭据写回表单 DOM
  // CLI 只使用同回环地址的配对令牌，云端空密钥只在完整地址相同时复用旧值
  function resolvedConfig(): ProviderConfig {
    const sameEndpoint = matchingEndpoint(config.endpoint, savedSecret.current.endpoint);
    if (config.mode === 'cloud' && !config.apiKey.trim() && savedSecret.current.apiKey && !sameEndpoint) throw new Error('修改接口地址后请重新输入 API Key，避免把旧密钥发送给其他服务');
    const secret = config.mode === 'codex-cli' ? matchingEndpoint(config.endpoint, importedCli.current.endpoint) ? importedCli.current.token : sameEndpoint ? savedSecret.current.apiKey : '' : config.apiKey.trim() || (sameEndpoint ? savedSecret.current.apiKey : '');
    return validateProvider({ ...config, apiKey: secret, ...(config.mode === 'codex-cli' ? { prefetch: false, prefetchExpressions: false } : {}) });
  }
  // authorize 表示申请明确选择的服务域名，value 必须已通过配置校验
  // 关闭模式不请求权限，CLI 只能申请固定回环地址，不会主动调用模型
  async function authorize(value: ProviderConfig) {
    const origin = value.mode === 'mymemory' ? 'https://api.mymemory.translated.net' : new URL(value.endpoint).origin;
    if (value.mode !== 'off' && !await browser.permissions.contains({ origins: [origin + '/*'] }) && !await browser.permissions.request({ origins: [origin + '/*'] })) throw new Error('接口访问未授权，配置尚未保存');
  }
  // save 校验当前表单并请求选定接口域名授权，无参数，由可信按钮点击调用
  // 授权成功才保存，密钥不通过公开消息返回给内容脚本
  async function save() {
    setBusy(true); setNotice('');
    try {
      await checkAccess();
      const value = resolvedConfig(); await authorize(value);
      await saveProvider(value);
      savedSecret.current = { endpoint: value.endpoint, apiKey: value.apiKey }; setHasSavedKey(!!value.apiKey); setConnectionImported(false); setConfig({ ...value, apiKey: '' });
      await browser.storage.local.set({ [STORAGE.onlineTranslation]: value.mode !== 'off' });
      await browser.runtime.sendMessage({ type: 'FLOWWORD_PROVIDER_CHANGED' });
      await refreshService();
      setNotice(embedded ? '配置已保存，关闭设置即可继续学习' : '配置已保存，返回网页重新点击翻译即可');
    } catch (error) { setNotice(error instanceof Error ? error.message : '保存失败'); }
    finally { setBusy(false); }
  }
  // clearSecret 清除已保存密钥并关闭联网，无参数，按钮明确操作后调用
  // 从数据库读取有效旧配置，未保存的错误输入不能阻止清除
  async function clearSecret() {
    setBusy(true);
    try {
      await checkAccess();
      const stored = await readProvider() ?? DEFAULT_PROVIDER;
      const cleared: ProviderConfig = { ...stored, mode: 'off', apiKey: '', ...(matchingEndpoint(stored.endpoint, CODEX_BRIDGE_ENDPOINT) ? { endpoint: DEFAULT_PROVIDER.endpoint, model: DEFAULT_PROVIDER.model } : {}) };
      await saveProvider(cleared); await browser.storage.local.set({ [STORAGE.onlineTranslation]: false });
      savedSecret.current = { endpoint: cleared.endpoint, apiKey: '' }; importedCli.current = { endpoint: '', token: '' }; setConnectionImported(false); setHasSavedKey(false); setConfig(cleared); await browser.runtime.sendMessage({ type: 'FLOWWORD_PROVIDER_CHANGED' }); await refreshService(); setNotice('密钥已清除，联网已关闭');
    } catch { setNotice('清除失败，请重试'); }
    finally { setBusy(false); }
  }   // 从已保存配置清除，未保存的错误地址不能阻止删除密钥
  // testConnection 测试表单中已授权模型，无参数，使用自编短句且不写学习缓存，用户点击才发请求
  // 空密钥只在同一接口复用本机配置，结果不证明所有视频译文质量
  async function testConnection() {
    setBusy(true); setNotice('正在测试连接…');
    const start = performance.now();
    try {
      await checkAccess();
      const value = resolvedConfig();
      if (value.mode !== 'cloud' && value.mode !== 'codex-cli') throw new Error('连接测试用于云端模型或本机 CLI，请先选择对应服务');
      await authorize(value);
      if (value.mode === 'codex-cli') { await checkCliStatus(value); setNotice('桥接连接成功 · 已确认 ChatGPT 登录；未调用模型，未修改配置'); }
      else { await requestCloud(value, 'This is a connection test.', [], 'translate'); setNotice(`连接成功 · ${value.model} · ${Math.round(performance.now() - start)} ms；未修改已保存配置`); }
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : '网络连接失败';
      setNotice(/HTTP 401|HTTP 403/.test(message) ? '认证或权限失败，请检查 API Key 和模型访问权限' : /HTTP 429/.test(message) ? '服务限流或额度不足，请检查供应商账户' : /HTTP 404/.test(message) ? '接口或模型不存在，请检查完整地址和模型名称' : message);
    } finally { setBusy(false); }
  }
  // testCliTranslation 表示用户明确发起一次 CLI 试译，无参数，使用自编小句且不写学习缓存
  // CLI 冷启动可能较慢并使用账户额度，保存配置和状态测试不会调用本函数
  async function testCliTranslation() {
    setBusy(true); setNotice('正在调用本机 CLI 试译，可能需要等待…');
    try { await checkAccess(); const value = resolvedConfig(); if (value.mode !== 'codex-cli') throw new Error('请先选择 Codex CLI'); await authorize(value); const result = await requestCodex(value, 'This is a connection test.', [], 'translate'); setNotice(`CLI 试译成功：${result.translation}；未修改已保存配置`); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'CLI 试译失败'); }
    finally { setBusy(false); }
  }
  return <main><header>FlowWord · 翻译服务</header><h1>让翻译理解当前语境</h1><p>{embedded ? "密钥保存在本机扩展中，仅向所选服务发送待译文本与必要语境；调用可能收费" : "密钥只保存于本机扩展数据库，仅向你授权的接口发送。视频发送当前字幕与最多两句邻句，网页发送选区与最多一条短语境，不发送来源网址。默认预填 DeepSeek，填写密钥并保存才启用。服务可能收费，请确认接口提供方可信。"}</p>
    <p className="active-service" aria-live="polite">{activeService}</p><label>服务<select disabled={busy || !configReady} aria-label="服务" value={config.mode} onChange={(event) => chooseMode(event.target.value as ProviderConfig['mode'])}><option value="off">关闭联网</option><option value="cloud">云端模型 · Chat Completions / Responses</option><option value="codex-cli">Codex CLI · 本机 ChatGPT 登录</option><option value="mymemory">MyMemory · 整句参考翻译，无语境词义</option></select></label>
    {config.mode === 'cloud' && <><div className="provider-presets"><span>接口预设</span><button type="button" disabled={busy} onClick={() => usePreset('deepseek')}>填入 DeepSeek 预设</button><button type="button" disabled={busy} onClick={() => usePreset('openai')}>填入 OpenAI 预设</button></div><label>接口协议<select aria-label="接口协议" value={config.protocol || 'chat-completions'} onChange={(event) => chooseProtocol(event.target.value as ProviderConfig['protocol'])}><option value="chat-completions">Chat Completions</option><option value="responses">Responses</option></select></label><label>HTTPS 接口完整地址<input aria-label="HTTPS 接口完整地址" value={config.endpoint} onChange={(event) => update({ endpoint: event.target.value })}/></label><label>模型名称<input aria-label="模型名称" value={config.model} onChange={(event) => update({ model: event.target.value })} placeholder="提供方支持的模型名称"/></label><label>API Key<input aria-label="API Key" type="password" autoComplete="off" placeholder={hasSavedKey && matchingEndpoint(config.endpoint, savedSecret.current.endpoint) ? "已配置 · 留空保留，输入则替换" : "请输入 API Key"} value={config.apiKey} onChange={(event) => update({ apiKey: event.target.value })}/></label><label className="check"><input type="checkbox" checked={config.prefetch} onChange={(event) => update({ prefetch: event.target.checked })}/>允许播放中预译已出现的当前字幕及已加载邻句，每次最多两句，每标签页会话最多二十句，可能增加费用</label><label className="check"><input type="checkbox" aria-label="提前准备词组释义" disabled={!config.prefetch} checked={config.prefetchExpressions === true} onChange={(event) => update({ prefetchExpressions: event.target.checked })}/>提前准备词组释义：每个新句最多额外一次模型调用，已准备时点开可同时看到整句和词组</label><p>先开启播放预译，再按需开启词组预解析；默认沿用旧版只预译整句。首次新字幕或未完成的请求仍可能等待</p></>}
    {config.mode === 'codex-cli' && <section className="cli-connection" aria-label="Codex CLI 连接配置"><h2>连接本机 Codex</h2><ol><li>先在本机使用 ChatGPT 账户登录 Codex CLI</li><li>在项目目录运行 <code>npm run bridge</code></li><li>导入桥接生成的 <code>.local</code> 目录中的连接文件</li></ol><p>CLI 可能需要明显等待，不适合即时低延迟翻译；此模式始终关闭自动预译</p><div className="cli-import-row"><button type="button" disabled={busy} onClick={() => connectionFile.current?.click()}>导入 CLI 连接文件</button><span>{connectionImported ? '连接文件已导入，尚需保存' : hasSavedKey && matchingEndpoint(config.endpoint, savedSecret.current.endpoint) ? '已保存本机连接，令牌不回显' : '尚未导入连接文件'}</span></div><input ref={connectionFile} aria-label="导入 CLI 连接文件" type="file" accept=".json,application/json" hidden onChange={(event) => void importConnection(event.target.files?.[0])} /><label>固定本机地址<input aria-label="固定本机地址" value={CODEX_BRIDGE_ENDPOINT} readOnly /></label><label>CLI 模型名称（可留空）<input aria-label="CLI 模型名称" value={config.model} onChange={(event) => update({ model: event.target.value })} placeholder="留空跟随 CLI 默认模型" /></label><p className="cli-test-note">保存只配对，不调用模型；「测试连接」只检查本机状态，「试译一句」会实际调用 CLI 并使用账户额度</p></section>}
    {config.mode === 'mymemory' && <p>MyMemory 匿名额度有限，可能保存文本并交给第三方机译处理。不会自动降级到此服务，也不逐词查询。</p>}
    <section><h2>键盘快捷键</h2>{shortcuts.filter((item) => item.name?.startsWith('flowword-')).map((item) => <p key={item.name}>{item.name === 'flowword-toggle' ? '暂停 / 恢复' : '重听当前句'}：{item.shortcut || '未绑定或组合键冲突，请在浏览器中设置'}</p>)}</section>
    <div className="buttons"><button onClick={() => void save()} disabled={busy || !configReady}>授权接口并保存</button><button disabled={busy || !configReady} onClick={() => void testConnection()}>测试连接</button>{config.mode === 'codex-cli' && <button disabled={busy || !configReady} onClick={() => void testCliTranslation()}>试译一句（调用CLI）</button>}<button disabled={busy} onClick={() => void clearSecret()}>清除密钥</button><button onClick={() => void clearTranslationCache().then(() => setNotice('本地译文缓存已清除')).catch(() => setNotice('缓存清除失败，请重试'))}>清除译文缓存</button><button onClick={() => void browser.tabs.create({ url: 'chrome://extensions/shortcuts' })}>修改键盘快捷键</button></div><p role="status">{notice}</p></main>;
}
// SettingsEntry 提供总设置与划词配置入口，模型页仍保留原服务表单，不复制秘密到网页
function SettingsEntry() {
  const [view, setView] = useState(new URLSearchParams(location.search).get('view') || 'model');
  return <><nav className="settings-entry-tabs" aria-label="设置分类" data-embedded={embedded}>{(embedded ? [['scope','网站范围'],['model','模型服务']] : [['scope','总设置'],['selection','划词翻译'],['model','模型服务']]).map(([id,label]) => <button key={id} aria-pressed={view === id} onClick={() => setView(id || 'model')}>{label}</button>)}</nav>{view === 'scope' ? <main><ScopeSettings /></main> : view === 'selection' ? <main><SelectionSettings /></main> : <Settings />}</>;
}
// SettingsAccess 先校验嵌入来源再挂载秘密配置，无参数，拒绝时不读取本机模型配置
function SettingsAccess() {
  const [allowed, setAllowed] = useState(false);
  const [failure, setFailure] = useState('');
  useEffect(() => {
    let active = true;
    void checkAccess().then(() => { if (active) setAllowed(true); }).catch((error) => { if (active) setFailure(error instanceof Error ? error.message : '访问校验失败'); });
    return () => { active = false; };
  }, []);
  return allowed ? <SettingsEntry /> : <main><p role="status">{failure || '正在校验设置入口…'}</p></main>;
}
createRoot(document.getElementById('root')!).render(<SettingsAccess/>);
