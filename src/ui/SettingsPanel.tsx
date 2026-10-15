import type { Appearance, Settings } from '../core/types';
import { DEFAULT_APPEARANCE } from '../storage/settings';
import { useEffect, useState } from 'react';
import { THEMES } from './themes';
import { browser } from 'wxt/browser';

interface Props { settings: Settings; onAppearance(value: Partial<Appearance>): Promise<void>; onOnline(value: boolean): Promise<void>; onError(message: string): void }

// SettingsPanel 渲染网页内的非敏感设置，settings是当前配置
// onAppearance和onOnline保存用户修改，onError显示失败，API密钥必须在独立扩展页输入
export function SettingsPanel({ settings, onAppearance, onOnline, onError }: Props) {
  const appearance = settings.appearance;
  const [online, setOnline] = useState(settings.onlineTranslation);
  useEffect(() => setOnline(settings.onlineTranslation), [settings.onlineTranslation]);
  const update = (value: Partial<Appearance>) => void onAppearance(value).catch(() => onError('配置保存失败，请重试'));
  return <div className="fw-settings">
    <p className="fw-settings-intro">右键配置 · 自动保存，下次打开仍然生效</p>
    <label htmlFor="fw-font-size">字体大小 <output>{appearance.fontSize}px</output><input id="fw-font-size" type="range" min="14" max="24" step="1" value={appearance.fontSize} onChange={(event) => update({ fontSize: Number(event.target.value) })} /></label>
    <label htmlFor="fw-panel-width">翻译框宽度 <output>{appearance.panelWidth}px</output><input id="fw-panel-width" type="range" min="300" max="1200" step="10" value={appearance.panelWidth} onChange={(event) => update({ panelWidth: Number(event.target.value) })} /></label>
    <label htmlFor="fw-panel-height">翻译框高度 <output>{appearance.panelHeight ?? 620}px</output><input id="fw-panel-height" type="range" min="280" max="1200" step="10" value={appearance.panelHeight ?? 620} onChange={(event) => update({ panelHeight: Number(event.target.value) })} /></label>
    <p className="fw-context-note">拖动框标题移动，右下角调整宽高；字号不会改变外框尺寸</p>
    <label>翻译框主题<select value={appearance.panelTheme} onChange={(event) => update({ panelTheme: event.target.value as Appearance['panelTheme'] })}>
      {THEMES.map((theme) => <option key={theme.value} value={theme.value}>{theme.label}</option>)}
    </select></label>
    <label>悬浮球定位<select value={appearance.ballPlacement ?? 'free'} onChange={(event) => update({ ballPlacement: event.target.value as 'free' | 'edge' })}>
      <option value="free">自由放置</option><option value="edge">边缘吸附</option>
    </select></label>
    <p className="fw-context-note">拖动悬浮球可放在网页可视区域任意位置，位置自动保存</p>
    <label>悬浮球颜色<input type="color" value={appearance.ballColor} onChange={(event) => update({ ballColor: event.target.value })} /></label>
    <label>悬浮球风格<select value={appearance.ballStyle} onChange={(event) => update({ ballStyle: event.target.value as Appearance['ballStyle'] })}>
      <option value="glass">磨砂透明</option><option value="solid">纯色</option><option value="outline">线框</option>
    </select></label>
    <label htmlFor="fw-ball-opacity">悬浮球不透明度 <output>{appearance.ballOpacity}%</output><input id="fw-ball-opacity" type="range" min="40" max="100" step="5" value={appearance.ballOpacity} onChange={(event) => update({ ballOpacity: Number(event.target.value) })} /></label>
    <div className="fw-network-setting">
      <label><span>联网翻译总开关</span><input type="checkbox" checked={online} onChange={(event) => {
        const value = event.target.checked; setOnline(value);
        void onOnline(value).catch(() => { setOnline(settings.onlineTranslation); onError('联网设置保存失败'); });
      }} /></label>
      <p>开启后，字幕发送至独立设置页选定的服务，不发送视频地址或浏览历史<br />云端语境模型可能收费；MyMemory 可能长期保存文本，并交给第三方机译服务处理，请勿用于敏感内容<br />尚未配置时沿用 MyMemory 整句参考翻译，不逐词查询</p>
    </div>
    <button type="button" className="fw-retry" onClick={() => void browser.runtime.sendMessage({ type: 'FLOWWORD_SETTINGS_OPEN' })}>云端模型与快捷键设置 ↗</button>
    <p className="fw-context-note">密钥仅在独立扩展设置页输入；网页内不保存密钥</p>
    <button type="button" className="fw-retry" onClick={() => void onAppearance({ ...DEFAULT_APPEARANCE }).catch(() => onError('重置失败'))}>恢复默认外观</button>
  </div>;
}
