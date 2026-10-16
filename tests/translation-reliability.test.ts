import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ cache: new Map<string, string>(), session: {} as Record<string, number>, cloud: vi.fn(), writeFails: false, config: { mode: 'cloud', endpoint: 'https://api.deepseek.com/chat/completions', model: 'test', apiKey: 'synthetic', prefetch: true, prefetchExpressions: false } }));
vi.mock('wxt/browser', () => ({ browser: { storage: { local: { get: async () => ({ 'flowword.onlineTranslation.v1': true }) }, session: { get: async (key: string) => ({ [key]: state.session[key] }), set: async (value: Record<string, number>) => Object.assign(state.session, value) }, onChanged: { addListener: vi.fn() } }, permissions: { contains: async () => true } } }));
vi.mock('../src/storage/provider', () => ({ DEFAULT_PROVIDER: {}, readProvider: async () => state.config, cachedTranslation: async (key: string) => state.cache.get(key), cacheTranslation: async (key: string, value: string) => { if (state.writeFails) throw new Error('quota'); state.cache.set(key, value); } }));
vi.mock('../src/services/cloud', async (original) => ({ ...await original<typeof import('../src/services/cloud')>(), requestCloud: state.cloud }));
import { cancelAllLearningRequests, learningRequest } from '../src/services/learning-background';
import { cancelTranslationOwner, handleTranslationMessage } from '../src/services/translation-messages';
let nextTab = 100;
beforeEach(() => { cancelAllLearningRequests(); state.cache.clear(); state.cloud.mockReset(); state.writeFails = false; state.session = {}; state.config.prefetchExpressions = false; });
// slowCloud 创建可控模拟服务，无真实密钥，signal取消时结束假网络以验证共享归属
function slowCloud() {
  const releases: (() => void)[] = []; let aborted = 0;
  state.cloud.mockImplementation((_config, sentence, _context, task, _fetcher, signal: AbortSignal) => new Promise((resolve, reject) => {
    releases.push(() => resolve(task === 'translate' ? { translation: `模拟译文${sentence}` } : { expressions: [] }));
    signal.addEventListener('abort', () => { aborted++; reject(new DOMException('cancelled', 'AbortError')); }, { once: true });
  }));
  return { releases, aborted: () => aborted };
}
describe('取消共享请求与可靠缓存', () => {
  it('一个订阅取消不杀另一个，最后订阅取消才停止网络', async () => {
    const network = slowCloud(); const a = new AbortController(); const b = new AbortController();
    const first = learningRequest('shared sentence', [], 'translate', 'foreground', a.signal); const firstResult = first.catch((error) => error);
    await vi.waitFor(() => expect(state.cloud).toHaveBeenCalledTimes(1));
    const second = learningRequest('shared sentence', [], 'translate', 'foreground', b.signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    a.abort(); expect((await firstResult).name).toBe('AbortError'); expect(network.aborted()).toBe(0);
    network.releases[0]!(); expect(await second).toMatchObject({ translation: '模拟译文shared sentence', shared: true });
    const final = new AbortController(); const request = learningRequest('last subscriber', [], 'translate', 'foreground', final.signal); const caught = request.catch((error) => error);
    await vi.waitFor(() => expect(state.cloud).toHaveBeenCalledTimes(2)); final.abort();
    expect((await caught).name).toBe('AbortError'); expect(network.aborted()).toBe(1);
  });
  it('取消满载等待任务后不会启动过期的第五句', async () => {
    const network = slowCloud(); const active = Array.from({ length: 4 }, (_, index) => learningRequest('active ' + index, [], 'translate'));
    await vi.waitFor(() => expect(state.cloud).toHaveBeenCalledTimes(4));
    const abort = new AbortController(); const fifth = learningRequest('expired fifth', [], 'translate', 'foreground', abort.signal); const caught = fifth.catch((error) => error);
    await new Promise((resolve) => setTimeout(resolve, 0)); abort.abort();
    expect((await caught).name).toBe('AbortError'); network.releases.forEach((release) => release()); await Promise.all(active);
    expect(state.cloud).toHaveBeenCalledTimes(4);
  });
  it('缓存写失败仍返回有效译文和诊断字段', async () => {
    state.writeFails = true; state.cloud.mockResolvedValue({ translation: '有效中文译文' });
    expect(await learningRequest('valid sentence', [], 'translate')).toMatchObject({ translation: '有效中文译文', cacheWarning: true, cached: false, status: 'ready', elapsedMs: expect.any(Number) });
  });
  it('跨标签共享请求只取消已关闭标签的订阅', async () => {
    const network = slowCloud(); const tabA = nextTab++; const tabB = nextTab++;
    const a = handleTranslationMessage({ type: 'FLOWWORD_TRANSLATE', requestId: 'a', sentence: 'cross tab' }, { tab: { id: tabA }, frameId: 0 });
    await vi.waitFor(() => expect(state.cloud).toHaveBeenCalledTimes(1));
    const b = handleTranslationMessage({ type: 'FLOWWORD_TRANSLATE', requestId: 'b', sentence: 'cross tab' }, { tab: { id: tabB }, frameId: 0 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    cancelTranslationOwner(tabA); expect(await a).toMatchObject({ ok: false, cancelled: true }); expect(network.aborted()).toBe(0);
    network.releases[0]!(); expect(await b).toMatchObject({ ok: true, translation: '模拟译文cross tab', shared: true });
  });
});
describe('实际准备预算不惩罚缓存失败与跳过', () => {
  it('首次成功扣一个单元，重复缓存不扣，预算满仍可读缓存', async () => {
    const tab = nextTab++; state.cloud.mockResolvedValue({ translation: '预备成功译文' });
    const message = { type: 'FLOWWORD_PREFETCH', items: [{ sentence: 'prepared sentence', context: [] }] };
    expect(await handleTranslationMessage(message, { tab: { id: tab } })).toMatchObject({ ok: true, results: [{ complete: true }] });
    expect(state.session[`prefetch:${tab}`]).toBe(1);
    await handleTranslationMessage(message, { tab: { id: tab } }); expect(state.session[`prefetch:${tab}`]).toBe(1); expect(state.cloud).toHaveBeenCalledTimes(1);
    state.session[`prefetch:${tab}`] = 20;
    expect(await handleTranslationMessage(message, { tab: { id: tab } })).toMatchObject({ results: [{ cached: true, complete: true }] });
    await handleTranslationMessage({ type: 'FLOWWORD_PREFETCH', sentences: ['new unpaid sentence'] }, { tab: { id: tab } });
    expect(state.cloud).toHaveBeenCalledTimes(1); expect(state.session[`prefetch:${tab}`]).toBe(20);
  });
  it('模型失败不扣额度，重试成功才扣', async () => {
    const tab = nextTab++; const message = { type: 'FLOWWORD_PREFETCH', sentences: ['retry preparation'] };
    state.cloud.mockRejectedValueOnce(new Error('mock failure'));
    await handleTranslationMessage(message, { tab: { id: tab } }); expect(state.session[`prefetch:${tab}`] ?? 0).toBe(0);
    state.cloud.mockResolvedValue({ translation: '重试成功' }); await handleTranslationMessage(message, { tab: { id: tab } });
    expect(state.session[`prefetch:${tab}`]).toBe(1);
  });
  it('前台繁忙导致预译跳过不扣额度，稍后可重新准备', async () => {
    const network = slowCloud(); const active = [learningRequest('busy one', [], 'translate'), learningRequest('busy two', [], 'translate')];
    await vi.waitFor(() => expect(state.cloud).toHaveBeenCalledTimes(2)); const tab = nextTab++;
    const message = { type: 'FLOWWORD_PREFETCH', sentences: ['skipped preparation'] };
    expect(await handleTranslationMessage(message, { tab: { id: tab } })).toMatchObject({ results: [{ skipped: true }] });
    expect(state.session[`prefetch:${tab}`] ?? 0).toBe(0);
    network.releases.forEach((release) => release()); await Promise.all(active);
    state.cloud.mockResolvedValue({ translation: '稍后准备成功' }); await handleTranslationMessage(message, { tab: { id: tab } });
    expect(state.session[`prefetch:${tab}`]).toBe(1);
  });
});
