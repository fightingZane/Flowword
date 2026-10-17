import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ create: vi.fn(), query: vi.fn(), send: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: { runtime: { getURL: () => 'chrome-extension://fixture/' }, tabs: { create: calls.create, query: calls.query, sendMessage: calls.send } } }));
import { handleSourceReplay } from '../src/services/source-replay';

beforeEach(() => { vi.clearAllMocks(); calls.create.mockResolvedValue({ id: 3 }); });

describe('网页来源打开边界', () => {
  it('回到网页原文不探测其他标签或触发视频控制', async () => {
    const source = { url: 'https://example.test/article', sentence: 'A useful expression.', source: { kind: 'web' } };
    expect(await handleSourceReplay({ type: 'FLOWWORD_REPLAY_SOURCE', source }, { url: 'chrome-extension://fixture/wordbook.html' })).toMatchObject({ ok: true, opened: true });
    expect(calls.create).toHaveBeenCalledWith({ url: 'https://example.test/article#:~:text=A%20useful%20expression.' });
    expect(calls.query).not.toHaveBeenCalled(); expect(calls.send).not.toHaveBeenCalled();
  });
});
