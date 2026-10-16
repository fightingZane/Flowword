import { describe, expect, it, vi } from 'vitest';
vi.mock('wxt/browser', () => ({ browser: {} }));
import { quickWordbookQuery } from '../src/ui/QuickWordbook';

describe('快捷词本分页请求边界', () => {
  it('空搜索仍固定分页，不请求全量词本', () => { expect(quickWordbookQuery('', 0)).toEqual({ search: '', sort: 'recent', offset: 0, limit: 20 }); });
  it('搜索保留原文但规范空白和全角字形，不截断分页之后的结果', () => { expect(quickWordbookQuery('  Ｃａｍｅ across  ', 40)).toEqual({ search: 'Came across', sort: 'recent', offset: 40, limit: 20 }); });
  it('异常分页偏移回到安全位置', () => { expect(quickWordbookQuery('测试', -5).offset).toBe(0); expect(quickWordbookQuery('', NaN).offset).toBe(0); expect(quickWordbookQuery('', 21.8).offset).toBe(21); });
});
