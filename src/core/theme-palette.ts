export const PALETTE_KEYS = ['paper', 'ink', 'muted', 'line', 'green', 'wash', 'on-green'] as const;
// parseThemePalette 校验value颜色快照，只接受七种固定颜色字段，不允许CSS表达式或其他配置
export function parseThemePalette(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(PALETTE_KEYS.flatMap((key) => { const color = (value as Record<string, unknown>)[key]; return typeof color === 'string' && color.length <= 80 && /^(?:#[0-9a-f]{3,8}|rgba?\([\d.,%\s/]+\))$/i.test(color) ? [[key, color]] : []; }));
}
