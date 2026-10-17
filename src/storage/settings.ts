import { browser } from 'wxt/browser';
import type { Appearance, BallPosition, Settings } from '../core/types';

export const STORAGE = {
  enabled: 'flowword.enabled.v1',
  scope: 'flowword.scope.v1',
  selection: 'flowword.selection.v1',
  position: 'flowword.position.v1',
  offset: 'flowword.offset.v1',
  appearance: 'flowword.appearance.v1',
  onlineTranslation: 'flowword.onlineTranslation.v1',
} as const;

export const DEFAULT_APPEARANCE: Appearance = { fontSize: 16, panelTheme: 'dark', ballColor: '#355f47', ballStyle: 'glass', ballPlacement: 'free', ballOpacity: 90, panelWidth: 460, panelHeight: 620 };
export const DEFAULT_SELECTION = { enabled: true, autoTranslate: false, fontSize: 16, theme: 'dark' as const };
// sanitizeSelection 校验划词独立设置，旧安装保留手动划词，不因升级自动上传
export function sanitizeSelection(value: unknown): import('../core/types').SelectionSettings {
  const input = value && typeof value === 'object' ? value as Partial<import('../core/types').SelectionSettings> : {};
  const appearance = sanitizeAppearance({ fontSize: input.fontSize, panelTheme: input.theme });
  return { enabled: input.enabled !== false, autoTranslate: input.autoTranslate === true, fontSize: appearance.fontSize, theme: appearance.panelTheme };
}
export const DEFAULT_SETTINGS: Settings = { enabled: false, selection: DEFAULT_SELECTION, position: { x: 1, y: 0.62 }, offset: 0, appearance: DEFAULT_APPEARANCE, onlineTranslation: false };

export function sanitizeAppearance(value: unknown): Appearance {
  const input = value && typeof value === 'object' ? value as Partial<Appearance> : {};
  const number = (value: unknown, min: number, max: number, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  return {
    fontSize: number(input.fontSize, 14, 24, 16),
    panelTheme: ['auto', 'light', 'dark', 'warm', 'blue', 'forest', 'purple', 'sunset', 'rose', 'ink'].includes(input.panelTheme ?? '') ? input.panelTheme! : 'dark',
    ballColor: /^#[0-9a-f]{6}$/i.test(input.ballColor ?? '') ? input.ballColor! : '#355f47',
    ballStyle: ['glass', 'solid', 'outline'].includes(input.ballStyle ?? '') ? input.ballStyle! : 'glass',
    ballPlacement: input.ballPlacement === 'edge' ? 'edge' : 'free',
    ballOpacity: number(input.ballOpacity, 40, 100, 90),
    panelWidth: number(input.panelWidth, 300, 1200, 460),
    panelHeight: number(input.panelHeight, 280, 1200, 620),
  };   // 升级或损坏的旧设置使用默认值，不让任意 CSS 字符串进入页面
}

export function sanitizePosition(value: unknown): BallPosition {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SETTINGS.position };
  const position = value as Partial<BallPosition>;
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return { ...DEFAULT_SETTINGS.position };
  return { x: Math.max(0, Math.min(1, position.x!)), y: Math.max(0, Math.min(1, position.y!)) };
}

export function sanitizeOffset(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(-2, Math.min(2, Math.round(value * 2) / 2)) : 0;
}

export async function readSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(Object.values(STORAGE));
  return {
    enabled: stored[STORAGE.enabled] === true,
    selection: sanitizeSelection(stored[STORAGE.selection]),
    position: sanitizePosition(stored[STORAGE.position]),
    offset: sanitizeOffset(stored[STORAGE.offset]),
    appearance: sanitizeAppearance(stored[STORAGE.appearance]),
    onlineTranslation: stored[STORAGE.onlineTranslation] === true,
  };
}

export async function writeSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  await browser.storage.local.set({ [STORAGE[key]]: value });   // 单独写入字段，避免多标签页覆盖其他设置
}

let appearanceQueue = Promise.resolve();
export function writeAppearance(patch: Partial<Appearance>): Promise<void> {
  const operation = appearanceQueue.then(async () => {
    const current = await readSettings();
    await writeSetting('appearance', sanitizeAppearance({ ...current.appearance, ...patch }));
  });   // 按字段串行合并，快速调整多个控件时不以旧对象覆盖刚保存的设置
  appearanceQueue = operation.catch(() => {});
  return operation;
}
