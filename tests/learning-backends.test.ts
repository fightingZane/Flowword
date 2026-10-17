import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderConfig } from '../src/storage/provider';
const state = vi.hoisted(() => ({ config: { mode: 'codex-cli', endpoint: 'http://127.0.0.1:17863/', model: '', apiKey: 'a'.repeat(64), prefetch: true } as ProviderConfig, cache: new Map<string, string>(), cli: vi.fn(), cloud: vi.fn(), permitted: true }));
vi.mock('wxt/browser', () => ({ browser: { storage: { local: { get: async () => ({ 'flowword.onlineTranslation.v1': true }) } }, permissions: { contains: async () => state.permitted } } }));
vi.mock('../src/storage/provider', () => ({ DEFAULT_PROVIDER: {}, readProvider: async () => state.config, cachedTranslation: async (key: string) => state.cache.get(key), cacheTranslation: async (key: string, text: string) => state.cache.set(key, text) }));
vi.mock('../src/services/codex-cli', () => ({ requestCodex: state.cli }));
vi.mock('../src/services/cloud', async (original) => ({ ...await original<typeof import('../src/services/cloud')>(), requestCloud: state.cloud }));
import { cancelAllLearningRequests, learningRequest } from '../src/services/learning-background';

describe('后端路由与缓存隔离', () => {
  beforeEach(() => { cancelAllLearningRequests(); state.cache.clear(); state.cli.mockReset(); state.cloud.mockReset(); state.permitted = true; state.config = { mode: 'codex-cli', endpoint: 'http://127.0.0.1:17863/', model: '', apiKey: 'a'.repeat(64), prefetch: true }; });
  it('CLI即使旧快照开启预译也不调用模型', async () => {
    expect(await learningRequest('Hello', [], 'translate', 'prefetch')).toMatchObject({ skipped: true });
    expect(state.cli).not.toHaveBeenCalled();
  });
  it('CLI支持整句与释义，重复前台请求使用缓存', async () => {
    state.cli.mockImplementation(async (_config, _sentence, _context, task) => task === 'translate' ? { translation: '你好' } : { expressions: [{ text: 'Hello', meaning: '你好，打招呼的用语', kind: 'word', partOfSpeech: '感叹词', reason: '问候表达' }] });
    expect(await learningRequest('Hello', [], 'translate')).toMatchObject({ translation: '你好', provider: 'codex-cli' });
    expect(await learningRequest('Hello', [], 'context')).toMatchObject({ expressions: [{ text: 'Hello' }] });
    expect(await learningRequest('Hello', [], 'translate')).toMatchObject({ cached: true });
    expect(state.cli).toHaveBeenCalledTimes(2); expect(state.cloud).not.toHaveBeenCalled();
  });
  it('CLI故障不自动退回API，撤权后不调用桥接', async () => {
    state.cli.mockRejectedValue(new Error('离线'));
    await expect(learningRequest('Hello', [], 'translate')).rejects.toThrow('离线');
    expect(state.cloud).not.toHaveBeenCalled();
    state.permitted = false;
    await expect(learningRequest('Other', [], 'translate')).rejects.toThrow('授权');
    expect(state.cli).toHaveBeenCalledTimes(1);
  });
  it('不同API协议不共用译文缓存', async () => {
    state.config = { ...state.config, mode: 'cloud', endpoint: 'https://api.example/v1', model: 'model' };
    state.cloud.mockResolvedValue({ translation: '你好' });
    await learningRequest('Hello', [], 'translate');
    state.config = { ...state.config, protocol: 'responses' };
    await learningRequest('Hello', [], 'translate');
    expect(state.cloud).toHaveBeenCalledTimes(2);
  });
});
