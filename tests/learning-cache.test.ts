import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ cache: new Map<string,string>(), cloud: vi.fn(), config: { mode: 'cloud', endpoint: 'https://api.deepseek.com/chat/completions', model: 'test', apiKey: 'synthetic-test-key', prefetch: true, prefetchExpressions: true } }));
vi.mock('wxt/browser', () => ({ browser: { storage: { local: { get: async () => ({ 'flowword.onlineTranslation.v1': true }) } }, permissions: { contains: async () => true } } }));
vi.mock('../src/storage/provider', () => ({ DEFAULT_PROVIDER: {}, readProvider: async () => state.config, cachedTranslation: async (key: string) => state.cache.get(key), cacheTranslation: async (key: string, value: string) => { state.cache.set(key,value); } }));
vi.mock('../src/services/cloud', async (original) => ({ ...await original<typeof import('../src/services/cloud')>(), requestCloud: state.cloud }));
import { learningRequest, prefetchLearning } from '../src/services/learning-background';
describe('整句和语境双持久缓存', () => {
  beforeEach(() => { state.cache.clear(); state.cloud.mockReset(); });
  it('预处理两任务后点击不再调用模型', async () => {
    state.cloud.mockImplementation(async (_config, _sentence, _context, task) => task === 'translate' ? { translation: '长焦镜头' } : { expressions: [{ text: 'telephoto lens', meaning: '长焦镜头', kind: 'phrase', partOfSpeech: '名词短语', reason: '专业词' }] });
    await Promise.all([learningRequest('telephoto lens', ['previous'], 'translate', 'prefetch'), learningRequest('telephoto lens', ['previous'], 'context', 'prefetch')]);
    expect(state.cloud).toHaveBeenCalledTimes(2);
    expect(await learningRequest('telephoto lens', ['previous'], 'translate')).toMatchObject({ cached: true, translation: '长焦镜头' });
    expect(await learningRequest('telephoto lens', ['previous'], 'context')).toMatchObject({ cached: true, expressions: [{ text: 'telephoto lens' }] });
    expect(state.cloud).toHaveBeenCalledTimes(2);
  });
  it('损坏语境缓存不能作为有效结果展示', async () => {
    const key = JSON.stringify(['context-v4-quality', 'zh-CN', 'thinking-disabled', state.config.mode, state.config.endpoint, state.config.model, 'context', 'standard', []]);
    state.cache.set(key, '{"expressions":"838222"}');
    state.cloud.mockResolvedValue({ expressions: [] });
    expect(await learningRequest('standard', [], 'context')).toMatchObject({ expressions: [] });
    expect(state.cloud).toHaveBeenCalledTimes(1);
  });
});

it('旧预译授权不产生表达调用，独立表达授权才准备双字段', async () => {
  const request = vi.fn().mockImplementation(async (_sentence, _context, task) => task === 'translate' ? { translation: '长焦镜头' } : { expressions: [{ text: 'telephoto lens', meaning: '长焦镜头' }] });
  expect(await prefetchLearning('telephoto lens', [], false, request)).toEqual({ text: 'telephoto lens', translation: '长焦镜头' });
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0]![2]).toBe('translate');
  request.mockClear();
  expect(await prefetchLearning('telephoto lens', [], true, request)).toMatchObject({ translation: '长焦镜头', expressions: [{ text: 'telephoto lens' }] });
  expect(request).toHaveBeenCalledTimes(2);
});

it('实际后台请求器也拒绝未经独立授权的语境预解析', async () => {
  state.config.prefetchExpressions = false;
  try {
    expect(await learningRequest('telephoto lens', [], 'context', 'prefetch')).toEqual({ skipped: true });
    expect(state.cloud).not.toHaveBeenCalled();
  } finally { state.config.prefetchExpressions = true; }
});

it('仅空白变化命中缓存，不合并不同语境或删除真实重复邻句', async () => {
  state.cloud.mockResolvedValue({ expressions: [{ text: 'standard', meaning: '标准版型号', kind: 'word', partOfSpeech: '名词', reason: '型号表达' }] });
  await learningRequest(' standard ', ['Phone\n review', 'Phone review'], 'context');
  const before = state.cloud.mock.calls.length;
  await learningRequest('standard', ['Phone review', 'Phone review'], 'context');
  expect(state.cloud.mock.calls.length).toBe(before);
  await learningRequest('standard', ['Phone review'], 'context');
  expect(state.cloud.mock.calls.length).toBe(before + 1);
  await learningRequest('standard', ['A laboratory reference standard.'], 'context');
  expect(state.cloud.mock.calls.length).toBe(before + 2);
});

it('字形大小写与标点不被缓存规范化压平', async () => {
  const { normalizeLearningInput } = await import('../src/services/learning-background');
  expect(normalizeLearningInput('ｘ²  =  ４', ['A.', 'a.'])).toEqual({ sentence: 'ｘ² = ４', context: ['A.', 'a.'] });
  expect(normalizeLearningInput('current', [' current ', 'current context'])).toEqual({ sentence: 'current', context: ['current context'] });
});
