export interface SelectionRect { left: number; top: number; right: number; bottom: number; width: number; height: number }
export interface PageSelection { text: string; exact: string; context: string[]; rect: SelectionRect; range: Range; url: string; title: string }
// englishSelectionText 校验选区text，最多一千五百字符且拉丁字母主导，不把字符规则冒充语言识别模型
export function englishSelectionText(text: string): string | null {
  if (typeof text !== 'string' || text.length > 1500) return null;
  const cleaned = text.replace(/\s+/g, ' ').trim(); const latin = (cleaned.match(/[a-z]/gi) ?? []).length; const letters = (cleaned.match(/\p{L}/gu) ?? []).length;
  return latin >= 2 && !/[\u3400-\u9fff]/.test(cleaned) && latin / Math.max(1, letters) >= 0.9 ? cleaned : null;
}
// selectionNodeExcluded 判断node是否属于编辑器或插件，跨ShadowRoot向host追溯，不读取输入框中的值
export function selectionNodeExcluded(node: Node | null): boolean {
  if (!node) return true;
  let element = node.nodeType === 1 ? node as Element : node.parentElement;
  while (element) {
    if (element.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],flowword-ui,flowword-selection-ui')) return true;
    const root = element.getRootNode(); element = 'host' in root ? (root as ShadowRoot).host : null;
  }
  return false;
}
// selectionPlacement 根据rect和屏幕尺寸摆放浮层，panel尺寸为预计值，始终限制在可视窗口内
export function selectionPlacement(rect: SelectionRect, viewport: { width: number; height: number }, panel: { width: number; height: number }): { left: number; top: number; width: number; maxHeight: number } {
  const margin = 12; const width = Math.max(0, Math.min(panel.width, viewport.width - margin * 2)); const maxHeight = Math.max(0, viewport.height - margin * 2); const height = Math.min(panel.height, maxHeight);
  return { left: Math.max(margin, Math.min(rect.left, viewport.width - width - margin)), top: Math.max(margin, Math.min(rect.bottom + 8 + height <= viewport.height - margin ? rect.bottom + 8 : rect.top - height - 8, viewport.height - height - margin)), width, maxHeight };
}
// capturePageSelection 读取selection真实Range，viewport只用于拒绝屏外选区，不读取整页或敏感编辑内容
export function capturePageSelection(selection: Selection | null, viewport: { width: number; height: number }, source: { url: string; title: string }): PageSelection | null {
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  if (selectionNodeExcluded(range.startContainer) || selectionNodeExcluded(range.endContainer) || selectionNodeExcluded(range.commonAncestorContainer)) return null;
  const ancestor = range.commonAncestorContainer as Node & Partial<ParentNode>;
  if (ancestor.querySelectorAll) for (const element of ancestor.querySelectorAll('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],flowword-ui,flowword-selection-ui')) if (range.intersectsNode(element)) return null;
  const exact = selection.toString().trim(); const text = englishSelectionText(exact); if (!text) return null;
  const rect = range.getBoundingClientRect();
  if (![rect.left, rect.top, rect.right, rect.bottom, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 || rect.right < 0 || rect.top > viewport.height || rect.left > viewport.width) return null;
  const context: string[] = [];
  if (range.startContainer === range.endContainer && range.startContainer.nodeType === 3) {
    const raw = range.startContainer.textContent ?? ''; const before = raw.slice(Math.max(0, range.startOffset - 250), range.startOffset); const after = raw.slice(range.endOffset, range.endOffset + 250);
    const sentence = (before.split(/[.!?]\s+/).at(-1) ?? '') + exact + (after.split(/(?<=[.!?])\s+/)[0] ?? '');
    const normalized = englishSelectionText(sentence); if (normalized && normalized !== text && normalized.length <= 600) context.push(normalized);
  }
  return { text, exact, context, rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }, range: range.cloneRange(), url: source.url, title: source.title };
}
