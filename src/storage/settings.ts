import { browser } from 'wxt/browser';
import type { BallPosition, Settings } from '../core/types';

export const STORAGE = {
  enabled: 'flowword.enabled.v1',
  position: 'flowword.position.v1',
  offset: 'flowword.offset.v1',
} as const;

export const DEFAULT_SETTINGS: Settings = { enabled: false, position: { x: 1, y: 0.62 }, offset: 0 };

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
    position: sanitizePosition(stored[STORAGE.position]),
    offset: sanitizeOffset(stored[STORAGE.offset]),
  };
}

export async function writeSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  await browser.storage.local.set({ [STORAGE[key]]: value });   // 单独写入字段，避免多标签页覆盖其他设置
}
