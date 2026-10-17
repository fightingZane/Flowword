import { describe, expect, it, vi } from 'vitest';
import { capturePageSelection, englishSelectionText, selectionNodeExcluded, selectionPlacement } from '../src/core/selection';
// fixture 构造真实Range接口最小替身，text为可见选区，hidden表示跨过的敏感元素，浏览器渲染另测
function fixture(text = 'vapor chamber', hidden = false) {
  const sensitive = { marker: 'editor' }; const element = { closest: () => null, getRootNode: () => ({}), querySelectorAll: () => hidden ? [sensitive] : [] };
  const node = { nodeType: 3, parentElement: element, textContent: 'The vapor chamber improves cooling.' };
  const range: any = { startContainer: node, endContainer: node, commonAncestorContainer: element, startOffset: 4, endOffset: 17, toString: vi.fn(() => text + 'hidden-secret'), cloneRange: () => range, getBoundingClientRect: () => ({ left: 20, top: 30, right: 130, bottom: 50, width: 110, height: 20 }), intersectsNode: () => hidden };
  const selection = { isCollapsed: false, rangeCount: 1, getRangeAt: () => range, toString: () => text } as unknown as Selection;
  return { selection, range };
}
const viewport = { width: 800, height: 600 }; const source = { url: 'https://example.test/lesson', title: 'Original title' };
describe('网页选区采样与隐私边界', () => {
  it('只接受有限英语候选，拒绝数字中文和过长内容', () => {
    expect(englishSelectionText('  vapor\nchamber  ')).toBe('vapor chamber'); expect(englishSelectionText('只有中文')).toBeNull(); expect(englishSelectionText('12345')).toBeNull(); expect(englishSelectionText('a'.repeat(1501))).toBeNull();
  });
  it('用Selection可见文字，不使用含隐藏节点的Range原始文字', () => {
    const { selection, range } = fixture(); const captured = capturePageSelection(selection, viewport, source);
    expect(captured?.text).toBe('vapor chamber'); expect(captured?.exact).toBe('vapor chamber'); expect(range.toString).not.toHaveBeenCalled();
  });
  it('中间跨过敏感编辑元素时在读取文本前直接拒绝', () => {
    const { selection, range } = fixture('normal lesson', true); expect(capturePageSelection(selection, viewport, source)).toBeNull(); expect(range.toString).not.toHaveBeenCalled();
  });
  it('保存捕获时来源快照，只提取同TextNode短语境', () => {
    const { selection } = fixture(); const mutable = { ...source }; const captured = capturePageSelection(selection, viewport, mutable); mutable.url = 'https://example.test/next';
    expect(captured?.url).toBe(source.url); expect(captured?.title).toBe(source.title); expect(captured?.context).toEqual(['The vapor chamber improves cooling.']);
  });
  it('输入和插件节点拒绝，即便位于ShadowRoot内', () => {
    expect(selectionNodeExcluded({ nodeType: 1, closest: () => ({}) } as unknown as Node)).toBe(true);
    const host = { closest: () => ({}), getRootNode: () => ({}) }; const inside = { nodeType: 1, closest: () => null, getRootNode: () => ({ host }) };
    expect(selectionNodeExcluded(inside as unknown as Node)).toBe(true);
  });
  it('空Range及屏外Range不展示浮层', () => {
    const { selection, range } = fixture(); range.getBoundingClientRect = () => ({ left: 900, right: 1000, top: 30, bottom: 50, width: 100, height: 20 }); expect(capturePageSelection(selection, viewport, source)).toBeNull();
    expect(capturePageSelection(null, viewport, source)).toBeNull();
  });
  it('底部右侧和窄屏卡片均限制在视窗范围', () => {
    for (const screen of [viewport, { width: 320, height: 420 }]) {
      const place = selectionPlacement({ left: screen.width - 20, right: screen.width, top: screen.height - 20, bottom: screen.height, width: 20, height: 20 }, screen, { width: 430, height: 470 });
      expect(place.left).toBeGreaterThanOrEqual(12); expect(place.left + place.width).toBeLessThanOrEqual(screen.width - 12); expect(place.top).toBeGreaterThanOrEqual(12); expect(place.top + Math.min(470, place.maxHeight)).toBeLessThanOrEqual(screen.height - 12);
    }
  });
});
