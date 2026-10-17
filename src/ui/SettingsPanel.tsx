import type { Appearance, Settings } from '../core/types';
import { DEFAULT_APPEARANCE } from '../storage/settings';
import { useEffect, useState } from 'react';
import { THEMES } from './themes';
import { EmbeddedSettings } from './EmbeddedSettings';
import { SelectionSettings } from './SelectionSettings';
import { browser } from 'wxt/browser';

interface Props { settings: Settings; onAppearance(value: Partial<Appearance>): Promise<void>; onOnline(value: boolean): Promise<void>; onError(message: string): void; onProvider(): void }

// SettingsPanel 渲染网页内的非敏感设置，settings是当前配置
// onAppearance和onOnline保存用户修改，onError显示失败，API密钥必须在独立扩展页输入
export function SettingsPanel({ settings, onAppearance, onOnline, onError, onProvider }: Props) {
  const appearance = settings.appearance;
  const [tab, setTab] = useState<'scope' | 'video' | 'selection'>('video');
  const [online, setOnline] = useState(settings.onlineTranslation);
  useEffect(() => setOnline(settings.onlineTranslation), [settings.onlineTranslation]);
  const update = (value: Partial<Appearance>) => void onAppearance(value).catch(() => onError('配置保存失败，请重试'));
  return <div className={`fw-settings${tab === 'scope' ? ' fw-settings-embedded' : ''}`}><nav className="fw-settings-tabs" aria-label="配置分类">{([ ['scope','总设置'],['video','视频学习'],['selection','划词翻译'] ] as const).map(([id, label]) => <button type="button" key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}</nav>{tab === 'scope' ? <EmbeddedSettings view="scope" /> : tab === 'selection' ? <SelectionSettings /> : <>
    <section className="fw-preference-group"><h2>阅读外观</h2>
    <label htmlFor="fw-font-size">字体大小 <output>{appearance.fontSize}px</output><input id="fw-font-size" type="range" min="14" max="24" step="1" value={appearance.fontSize} onChange={(event) => update({ fontSize: Number(event.target.value) })} /></label>
    <label htmlFor="fw-panel-width">翻译框宽度 <output>{appearance.panelWidth}px</output><input id="fw-panel-width" type="range" min="300" max="1200" step="10" value={appearance.panelWidth} onChange={(event) => update({ panelWidth: Number(event.target.value) })} /></label>
    <label htmlFor="fw-panel-height">翻译框高度 <output>{appearance.panelHeight ?? 620}px</output><input id="fw-panel-height" type="range" min="280" max="1200" step="10" value={appearance.panelHeight ?? 620} onChange={(event) => update({ panelHeight: Number(event.target.value) })} /></label>

    <label>翻译框主题<select value={appearance.panelTheme} onChange={(event) => update({ panelTheme: event.target.value as Appearance['panelTheme'] })}>
      {THEMES.map((theme) => <option key={theme.value} value={theme.value}>{theme.label}</option>)}
    </select></label>
    </section><section className="fw-preference-group"><h2>悬浮球</h2><label>悬浮球定位<select value={appearance.ballPlacement ?? 'free'} onChange={(event) => update({ ballPlacement: event.target.value as 'free' | 'edge' })}>
      <option value="free">自由放置</option><option value="edge">边缘吸附</option>
    </select></label>

    <label>悬浮球颜色<input type="color" value={appearance.ballColor} onChange={(event) => update({ ballColor: event.target.value })} /></label>
    <label>悬浮球风格<select value={appearance.ballStyle} onChange={(event) => update({ ballStyle: event.target.value as Appearance['ballStyle'] })}>
      <option value="glass">磨砂透明</option><option value="solid">纯色</option><option value="outline">线框</option>
    </select></label>
    <label htmlFor="fw-ball-opacity">悬浮球不透明度 <output>{appearance.ballOpacity}%</output><input id="fw-ball-opacity" type="range" min="40" max="100" step="5" value={appearance.ballOpacity} onChange={(event) => update({ ballOpacity: Number(event.target.value) })} /></label>
    </section><section className="fw-preference-group"><h2>翻译服务</h2><div className="fw-network-setting">
      <label><span>联网翻译总开关</span><input type="checkbox" checked={online} onChange={(event) => {
        const value = event.target.checked; setOnline(value);
        void onOnline(value).catch(() => { setOnline(settings.onlineTranslation); onError('联网设置保存失败'); });
      }} /></label>
      <details className="fw-result-details"><summary>发送范围与服务说明</summary><p>点击翻译时发送所选文本及必要语境，不发送来源网址或浏览历史<br />云端模型可能收费；MyMemory可能长期保存文本并交由第三方机译，请勿发送敏感内容</p></details>
    </div>
    <button type="button" className="fw-retry" onClick={onProvider}>云端模型与快捷键设置 ↗</button>
    </section>
    <button type="button" className="fw-retry" onClick={() => void onAppearance({ ...DEFAULT_APPEARANCE }).catch(() => onError('重置失败'))}>恢复默认外观</button>
  </>}</div>;
}
