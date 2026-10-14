import type { Appearance, Settings } from '../core/types';
import { DEFAULT_APPEARANCE } from '../storage/settings';
import { useEffect, useState } from 'react';

interface Props { settings: Settings; onAppearance(value: Partial<Appearance>): Promise<void>; onOnline(value: boolean): Promise<void>; onError(message: string): void }

export function SettingsPanel({ settings, onAppearance, onOnline, onError }: Props) {
  const appearance = settings.appearance;
  const [online, setOnline] = useState(settings.onlineTranslation);
  useEffect(() => setOnline(settings.onlineTranslation), [settings.onlineTranslation]);
  const update = (value: Partial<Appearance>) => void onAppearance(value).catch(() => onError('配置保存失败，请重试'));
  return <div className="fw-settings">
    <p className="fw-settings-intro">右键配置 · 自动保存，下次打开仍然生效</p>
    <label htmlFor="fw-font-size">字体大小 <output>{appearance.fontSize}px</output><input id="fw-font-size" type="range" min="14" max="24" step="1" value={appearance.fontSize} onChange={(event) => update({ fontSize: Number(event.target.value) })} /></label>
    <label htmlFor="fw-panel-width">翻译框宽度 <output>{appearance.panelWidth}px</output><input id="fw-panel-width" type="range" min="360" max="640" step="20" value={appearance.panelWidth} onChange={(event) => update({ panelWidth: Number(event.target.value) })} /></label>
    <label>翻译框主题<select value={appearance.panelTheme} onChange={(event) => update({ panelTheme: event.target.value as Appearance['panelTheme'] })}>
      <option value="auto">跟随系统</option><option value="light">浅色 · 清爽</option><option value="dark">深色 · 夜间</option><option value="warm">暖色 · 米纸</option><option value="blue">蓝色 · 柔和</option>
    </select></label>
    <label>悬浮球颜色<input type="color" value={appearance.ballColor} onChange={(event) => update({ ballColor: event.target.value })} /></label>
    <label>悬浮球风格<select value={appearance.ballStyle} onChange={(event) => update({ ballStyle: event.target.value as Appearance['ballStyle'] })}>
      <option value="glass">磨砂透明</option><option value="solid">纯色</option><option value="outline">线框</option>
    </select></label>
    <label htmlFor="fw-ball-opacity">悬浮球不透明度 <output>{appearance.ballOpacity}%</output><input id="fw-ball-opacity" type="range" min="40" max="100" step="5" value={appearance.ballOpacity} onChange={(event) => update({ ballOpacity: Number(event.target.value) })} /></label>
    <div className="fw-network-setting">
      <label><span>联网翻译 · MyMemory</span><input type="checkbox" checked={online} onChange={(event) => {
        const value = event.target.checked; setOnline(value);
        void onOnline(value).catch(() => { setOnline(settings.onlineTranslation); onError('联网设置保存失败'); });
      }} /></label>
      <p>开启后，将本次英语字幕及待释义表达发送至 MyMemory，获取参考译文<br />服务方可能长期保存，并交给第三方机译服务处理，请勿用于敏感内容<br />不发送视频地址或浏览历史，匿名服务有每日额度</p>
    </div>
    <button type="button" className="fw-retry" onClick={() => void onAppearance({ ...DEFAULT_APPEARANCE }).catch(() => onError('重置失败'))}>恢复默认外观</button>
  </div>;
}
