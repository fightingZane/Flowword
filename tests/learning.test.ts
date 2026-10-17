import { describe, expect, it, vi } from 'vitest';
import type { SentenceContext } from '../src/core/types';
const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage: mocks.send } } }));
import { prefetchItems } from '../src/adapters/html5-subtitles';
import { assembleSentence } from '../src/core/sentence';
import { enrichLearning, learningContext, requestLearningMessage } from '../src/services/learning';
const context = { text: 'a telephoto lens', segments: [], selected: {text:'a telephoto lens',start:0,end:3,source:'generic-track',language:'en'}, targetTime:1, learning: { status: 'loading', candidates: [] } } as unknown as SentenceContext;

it('CLI模式也展示语境表达且不发自动预译', async () => {
  mocks.send.mockClear();
  mocks.send.mockImplementation((message) => Promise.resolve(message.type === 'FLOWWORD_PROVIDER_PUBLIC' ? { ok: true, mode: 'codex-cli', prefetch: true } : message.type === 'FLOWWORD_TRANSLATE' ? { ok: true, translation: '一个长焦镜头', provider: 'codex-cli' } : { ok: true, expressions: [{ text: 'telephoto lens', meaning: '长焦镜头' }] }));
  const result = await enrichLearning(context, new AbortController().signal);
  expect(result.learning?.translation).toBe('一个长焦镜头');
  expect(result.learning?.expressions).toMatchObject([{ text: 'telephoto lens' }]);
  expect(mocks.send.mock.calls.some((call) => call[0].type === 'FLOWWORD_PREFETCH')).toBe(false);
});
describe('整句优先与取消旧结果', () => {
  it('表达仍在处理时已经展示整句译文', async () => {
    let finish: (value: unknown) => void = () => {};
    const delayed = new Promise((resolve) => { finish = resolve; });
    mocks.send.mockImplementation((message) => message.type === 'FLOWWORD_PROVIDER_PUBLIC' ? Promise.resolve({ ok: true, mode: 'cloud', prefetch: false }) : message.type === 'FLOWWORD_TRANSLATE' ? Promise.resolve({ ok: true, translation: '一个长焦镜头', provider: 'cloud' }) : delayed);
    const emit = vi.fn();
    const operation = enrichLearning(context, new AbortController().signal, emit);
    await vi.waitFor(() => expect(emit).toHaveBeenCalled());
    expect(emit.mock.calls[0]![0].learning.translation).toBe('一个长焦镜头');
    expect(emit.mock.calls[0]![0].learning.contextStatus).toBe('loading');
    finish({ ok: true, expressions: [{ text: 'telephoto lens', meaning: '长焦镜头' }] });
    expect((await operation).learning?.contextStatus).toBe('ready');
  });
  it('恢复播放后旧结果不emit覆盖', async () => {
    const abort = new AbortController();
    mocks.send.mockImplementation(async () => { abort.abort(); return { ok: true, mode: 'cloud', prefetch: false }; });
    const emit = vi.fn();
    expect(await enrichLearning(context, abort.signal, emit)).toBe(context);
    expect(emit).not.toHaveBeenCalled();
  });
});


it('预译与点击拼接字幕使用完全一致的原句和邻上下文缓存键', () => {
  const segments = [
    { text: 'Previous sentence.', start: 0, end: 2 },
    { text: 'A telephoto', start: 2, end: 4 },
    { text: 'lens captures distant objects.', start: 4, end: 6 },
    { text: 'The next sentence.', start: 6, end: 8 },
  ].map((cue) => ({ ...cue, source: 'generic-track' as const, language: 'en' as const }));
  const snapshot = { segments, selected: segments[0]!, targetTime: 1, capturedTime: 1, offset: 0, title: 'Test', videoKey: 'test', url: 'https://example.test/video' };
  for (const item of prefetchItems(snapshot)) {
    const selected = segments.find((cue) => assembleSentence({ ...snapshot, selected: cue, targetTime: cue.start }).text === item.sentence)!;
    const clicked = assembleSentence({ ...snapshot, selected, targetTime: selected.start });
    expect(JSON.stringify([clicked.text, learningContext(clicked)])).toBe(JSON.stringify([item.sentence, item.context]));
  }
});

it('整句与表达同时发出，表达先返回也保留稍后译文', async () => {
  let translate = (value: unknown) => {};
  const delayed = new Promise((resolve) => { translate = resolve; });
  mocks.send.mockImplementation((message) => message.type === 'FLOWWORD_PROVIDER_PUBLIC' ? Promise.resolve({ ok: true, mode: 'cloud', prefetch: false }) : message.type === 'FLOWWORD_TRANSLATE' ? delayed : Promise.resolve({ ok: true, expressions: [{ text: 'telephoto lens', meaning: '长焦镜头' }] }));
  const emit = vi.fn();
  const operation = enrichLearning(context, new AbortController().signal, emit);
  await vi.waitFor(() => expect(emit.mock.calls.some((call) => call[0].learning.contextStatus === 'ready')).toBe(true));
  expect(emit.mock.calls.at(-1)![0].learning.status).toBe('loading');
  translate({ ok: true, translation: '一个长焦镜头', provider: 'cloud' });
  const result = await operation;
  expect(result.learning?.translation).toBe('一个长焦镜头'); expect(result.learning?.expressions).toHaveLength(1);
});

it('表达失败不抹整句成功译文', async () => {
  mocks.send.mockImplementation((message) => Promise.resolve(message.type === 'FLOWWORD_PROVIDER_PUBLIC' ? { ok: true, mode: 'cloud', prefetch: false } : message.type === 'FLOWWORD_TRANSLATE' ? { ok: true, translation: '一个长焦镜头', provider: 'cloud' } : { ok: false, error: 'mock failure' }));
  const result = await enrichLearning(context, new AbortController().signal);
  expect(result.learning?.status).toBe('ready'); expect(result.learning?.translation).toBe('一个长焦镜头'); expect(result.learning?.contextStatus).toBe('error');
});

it('只重试语境不重请求成功译文也不触发预译', async () => {
  mocks.send.mockImplementation((message) => Promise.resolve(message.type === 'FLOWWORD_PROVIDER_PUBLIC' ? { ok: true, mode: 'cloud', prefetch: true } : { ok: true, expressions: [], cached: true, elapsedMs: 3 }));
  mocks.send.mockClear();
  const previous = { ...context, learning: { ...context.learning!, status: 'ready' as const, translation: '保留成功译文', elapsedMs: 123, translationState: 'ready' as const } };
  const result = await enrichLearning(previous, new AbortController().signal, undefined, 'context');
  expect(result.learning?.translation).toBe('保留成功译文'); expect(result.learning?.status).toBe('ready'); expect(result.learning?.elapsedMs).toBe(123);
  expect(mocks.send.mock.calls.map((call) => call[0].type)).toEqual(['FLOWWORD_PROVIDER_PUBLIC', 'FLOWWORD_CONTEXT']);
  expect(result.learning?.contextCached).toBe(true);
});

it('取消正在等待的RPC会发送匹配requestId取消消息', async () => {
  let finish = (value: unknown) => {};
  const waiting = new Promise((resolve) => { finish = resolve; });
  mocks.send.mockClear(); mocks.send.mockImplementation((message) => message.type === 'FLOWWORD_CANCEL' ? Promise.resolve({ ok: true }) : waiting);
  const abort = new AbortController(); const operation = requestLearningMessage({ type: 'FLOWWORD_TRANSLATE', sentence: 'test' }, abort.signal);
  const requestId = mocks.send.mock.calls[0]![0].requestId;
  abort.abort(); expect(mocks.send.mock.calls[1]![0]).toEqual({ type: 'FLOWWORD_CANCEL', requestId });
  finish({ ok: false, cancelled: true }); await operation;
});
