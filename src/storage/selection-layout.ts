import { browser } from 'wxt/browser';
export const SELECTION_LAYOUT_KEY = 'flowword.selectionLayout.v1';
export interface SelectionLayout { width: number; height?: number; left?: number; top?: number; fixed: boolean }
export const DEFAULT_SELECTION_LAYOUT: SelectionLayout = { width: 430, fixed: false };
// sanitizeSelectionLayout 校验value划词框几何信息，不允许非有限数或任意CSS进入页面
// 缺少手动高度时沿用内容自适应，旧安装不会因此改变默认尺寸
export function sanitizeSelectionLayout(value: unknown): SelectionLayout {
  const input = value && typeof value === 'object' ? value as Partial<SelectionLayout> : {};
  const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
  const positioned = number(input.left) && number(input.top);
  return { width: number(input.width) ? Math.min(1000, Math.max(300, input.width)) : 430,
    ...(number(input.height) ? { height: Math.min(1000, Math.max(260, input.height)) } : {}),
    ...(positioned ? { left: Math.max(0, input.left!), top: Math.max(0, input.top!) } : {}), fixed: input.fixed === true && positioned };
}
let queue = Promise.resolve();
// saveSelectionLayout 保存value本机划词框尺寸与固定位置，串行写入，不保存选文或来源
export function saveSelectionLayout(value: SelectionLayout): Promise<void> {
  const operation = queue.then(() => browser.storage.local.set({ [SELECTION_LAYOUT_KEY]: sanitizeSelectionLayout(value) }));
  queue = operation.catch(() => {}); return operation;
}
