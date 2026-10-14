import type { Theme } from '../core/types';

export const THEMES: { value: Theme; label: string }[] = [
  { value: 'auto', label: '跟随系统' }, { value: 'light', label: '纸页 · 清晨' },
  { value: 'dark', label: '午夜 · 静读' }, { value: 'warm', label: '米纸 · 暖灯' },
  { value: 'blue', label: '海盐 · 微风' }, { value: 'forest', label: '森林 · 苔绿' },
  { value: 'purple', label: '暮紫 · 星云' }, { value: 'sunset', label: '落日 · 琥珀' },
  { value: 'rose', label: '玫瑰 · 雾粉' }, { value: 'ink', label: '墨金 · 夜航' },
];   // 所有主题共用可读对比度，字体与面板尺寸独立设置
