import { expect, it } from 'vitest';
import { sanitizeSelectionLayout } from '../src/storage/selection-layout';
it('旧安装保留自适应高度和选区旁默认位置', () => {
  expect(sanitizeSelectionLayout(undefined)).toEqual({ width: 430, fixed: false });
  expect(sanitizeSelectionLayout({ fixed: true, left: 30 })).toEqual({ width: 430, fixed: false });
});
it('拒绝非有限坐标和任意CSS，尺寸有界', () => {
  expect(sanitizeSelectionLayout({ width: Infinity, height: '600px', left: NaN, top: -10, fixed: true })).toEqual({ width: 430, fixed: false });
  expect(sanitizeSelectionLayout({ width: 9999, height: 0, left: -5, top: 40, fixed: true })).toEqual({ width: 1000, height: 260, left: 0, top: 40, fixed: true });
});
