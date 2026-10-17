import { expect, it } from 'vitest';
import { parseThemePalette } from '../src/core/theme-palette';
it('只传固定颜色字段，不允许URL、CSS表达式和其他页面数据', () => {
  expect(parseThemePalette({ paper:'rgb(29, 33, 34)', ink:'#cbdce8', green:'url(https://example.test)', wash:'var(--secret)', token:'secret', line:'red;display:none' })).toEqual({ paper:'rgb(29, 33, 34)', ink:'#cbdce8' });
});
it('损坏快照不覆盖现有主题', () => {
  expect(parseThemePalette(null)).toEqual({}); expect(parseThemePalette(['#fff'])).toEqual({}); expect(parseThemePalette({paper:123})).toEqual({});
});
