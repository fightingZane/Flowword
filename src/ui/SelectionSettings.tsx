import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { DEFAULT_SELECTION, readSettings, sanitizeSelection, STORAGE, writeSetting } from '../storage/settings';
import type { SelectionSettings as Config } from '../core/types';
import { THEMES } from './themes';
// SelectionSettings 展示独立划词设置，无参数，仅保存本机开关、字号和主题，不调用模型
export function SelectionSettings() {
  const [value, setValue] = useState<Config>(DEFAULT_SELECTION); const [error, setError] = useState('');
  useEffect(() => { const refresh = () => { void readSettings().then((settings) => setValue(settings.selection ?? DEFAULT_SELECTION)).catch(() => setError('配置读取失败')); }; refresh(); const changed = (changes: Record<string, unknown>) => { if (STORAGE.selection in changes) refresh(); }; browser.storage.onChanged.addListener(changed); return () => browser.storage.onChanged.removeListener(changed); }, []);
  // update 从存储读取最新配置后合并patch，避免不同配置入口覆盖视频设置
  async function update(patch: Partial<Config>) { setValue((previous) => sanitizeSelection({ ...previous, ...patch })); try { const current = (await readSettings()).selection ?? DEFAULT_SELECTION; const next = sanitizeSelection({ ...current, ...patch }); await writeSetting('selection', next); setValue(next); setError(''); } catch { setError('划词配置保存失败'); } }
  return <section className="fw-preference-group"><h2>划词翻译</h2><label className="check"><input aria-label="启用划词翻译" type="checkbox" checked={value.enabled} onChange={(event) => { if (event.nativeEvent.isTrusted) void update({ enabled: event.target.checked }); }} />启用划词翻译</label><label className="check"><input aria-label="选中后自动翻译" type="checkbox" checked={value.autoTranslate} onChange={(event) => { if (event.nativeEvent.isTrusted) void update({ autoTranslate: event.target.checked }); }} />选中后自动翻译</label><p>默认点击翻译才联网。开启后，真实键鼠选中英文即请求当前服务，可能消耗API或CLI额度</p><label>划词字号<input aria-label="划词字号" type="range" min="14" max="24" value={value.fontSize} onChange={(event) => void update({ fontSize: Number(event.target.value) })} /><output>{value.fontSize}px</output></label><label>划词主题<select aria-label="划词主题" value={value.theme} onChange={(event) => void update({ theme: event.target.value as Config['theme'] })}>{THEMES.map((theme) => <option key={theme.value} value={theme.value}>{theme.label}</option>)}</select></label><p role="status">{error}</p></section>;
}
