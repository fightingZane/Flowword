import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ mode: 'cloud', permitted: true, cache: undefined as string | undefined, request: vi.fn(), write: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: { permissions: { contains: async () => state.permitted } } }));
vi.mock('../src/services/learning-background', () => ({ effectiveProvider: async () => ({ mode: state.mode, endpoint: 'https://api.example/v1', model: 'mock', apiKey: 'secret', prefetch: false }) }));
vi.mock('../src/storage/provider', () => ({ CODEX_BRIDGE_ENDPOINT: 'http://127.0.0.1:17863', cachedTranslation: async () => state.cache, cacheTranslation: state.write }));
vi.mock('../src/services/lookup', async (original) => ({ ...await original<typeof import('../src/services/lookup')>(), requestLookup: state.request }));
import { cancelLookupRequests, handleLookupMessage } from '../src/services/lookup-messages';
const result = { translation: '测试含义', examples: [{ sentence: 'This is a test.', translation: '这是一个测试' }], exampleSource: 'ai-generated' };
describe('查词后台消息', () => {
  beforeEach(() => { cancelLookupRequests(); state.mode = 'cloud'; state.permitted = true; state.cache = undefined; state.request.mockReset().mockResolvedValue(result); state.write.mockReset(); });
  it('损坏缓存重新请求，缓存写失败仍返回成功', async () => { state.cache = '{}'; state.write.mockRejectedValue(new Error('disk')); expect(await handleLookupMessage({ type: 'FLOWWORD_LOOKUP', text: 'test' }, {})).toMatchObject({ ok: true, translation: '测试含义', cached: false }); expect(state.request).toHaveBeenCalledTimes(1); });
  it('缓存命中不调用模型，响应不包含凭据', async () => { state.cache = JSON.stringify(result); const response = await handleLookupMessage({ type: 'FLOWWORD_LOOKUP', text: 'test' }, {}); expect(response).toMatchObject({ ok: true, cached: true }); expect(JSON.stringify(response)).not.toContain('secret'); expect(state.request).not.toHaveBeenCalled(); });
  it('关闭联网和撤权均不调用模型', async () => { state.mode = 'off'; expect(await handleLookupMessage({ type: 'FLOWWORD_LOOKUP', text: 'test' }, {})).toMatchObject({ ok: false }); state.mode = 'cloud'; state.permitted = false; expect(await handleLookupMessage({ type: 'FLOWWORD_LOOKUP', text: 'test' }, {})).toMatchObject({ ok: false }); expect(state.request).not.toHaveBeenCalled(); });
  it('取消仅影响所属标签页', async () => { state.request.mockImplementation((_config, _text, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('cancel', 'AbortError'))))); const pending = handleLookupMessage({ type: 'FLOWWORD_LOOKUP', text: 'test', requestId: 'id' }, { tab: { id: 1 } }); await vi.waitFor(() => expect(state.request).toHaveBeenCalled()); await handleLookupMessage({ type: 'FLOWWORD_LOOKUP_CANCEL', requestId: 'id' }, { tab: { id: 2 } }); cancelLookupRequests(1); expect(await pending).toMatchObject({ ok: false, cancelled: true }); });
});
