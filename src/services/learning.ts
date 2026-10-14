import { browser } from 'wxt/browser';
import type { SentenceContext } from '../core/types';

export async function enrichLearning(context: SentenceContext, signal: AbortSignal): Promise<SentenceContext> {
  if (!context.learning || context.learning.status !== 'loading') return context;
  try {
    const response = await browser.runtime.sendMessage({ type: 'FLOWWORD_TRANSLATE', sentence: context.text,
      words: context.learning.candidates.slice(0, 3).map((candidate) => ({ text: candidate.lemma, meaning: candidate.meaning })) });
    if (signal.aborted) return context;
    if (!response?.ok) throw new Error(response?.error || '翻译服务暂不可用');
    return { ...context, learning: { ...context.learning, status: response.translation ? 'ready' : 'error',
      translation: response.translation, segmented: response.segmented, error: response.error,
      candidates: context.learning.candidates.map((candidate) => ({ ...candidate, translation: candidate.meaning || response.words?.[candidate.lemma] })) } };
  } catch (error) {
    return { ...context, learning: { ...context.learning, status: 'error', error: error instanceof Error ? error.message : '翻译失败，请重试' } };
  }
}
