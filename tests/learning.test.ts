import { describe, expect, it, vi } from 'vitest';
import type { SentenceContext } from '../src/core/types';
const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage: mocks.send } } }));
import { prefetchItems } from '../src/adapters/html5-subtitles';
import { assembleSentence } from '../src/core/sentence';
import { enrichLearning, learningContext } from '../src/services/learning';
const context = { text: 'a telephoto lens', segments: [], selected: {text:'a telephoto lens',start:0,end:3,source:'generic-track',language:'en'}, targetTime:1, learning: { status: 'loading', candidates: [] } } as unknown as SentenceContext;
describe('整句优先与取消旧结果', () => {
  it('表达仍在处理时已经展示整句译文', async () => {
    let finish: (value: unknown) => void = () => {};
    const delayed = new Promise((resolve) => { finish = resolve; });
    mocks.send.mockImplementation((message) => message.type === 'FLOWWORD_PROVIDER_PUBLIC' ? Promise.resolve({ ok: true, prefetch: false }) : message.type === 'FLOWWORD_TRANSLATE' ? Promise.resolve({ ok: true, translation: '一个长焦镜头', provider: 'cloud' }) : delayed);
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
    mocks.send.mockImplementation(async () => { abort.abort(); return { ok: true, prefetch: false }; });
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
