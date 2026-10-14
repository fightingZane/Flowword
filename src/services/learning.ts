import { browser } from 'wxt/browser';
import type { SentenceContext } from '../core/types';
import { subtitleTimeline, prefetchItems } from '../adapters/html5-subtitles';
// learningContext 从context真实字幕快照取得稳定邻句，用于统一点击与预译缓存，不虚构未来字幕
export function learningContext(context: SentenceContext): string[] { return subtitleTimeline(context, context).filter((item) => item.text !== context.text).slice(0, 2).map((item) => item.text); }
// enrichLearning 补全context学习结果，signal表示当前操作是否取消，emit分步发布整句和表达
// 内容脚本只发送字幕文本，取消后忽略旧结果，已发出的服务请求不保证被撤销
export async function enrichLearning(context: SentenceContext, signal: AbortSignal, emit?: (context: SentenceContext) => void): Promise<SentenceContext> {
  if (!context.learning || context.learning.status !== 'loading') return context;
  let current = context;
  const publish = () => { if (!signal.aborted) emit?.(current); };
  try {
    const nearby = learningContext(context);
    const info = await browser.runtime.sendMessage({ type: 'FLOWWORD_PROVIDER_PUBLIC' });
    if (signal.aborted) return context;
    const response = await browser.runtime.sendMessage({ type: 'FLOWWORD_TRANSLATE', sentence: context.text, context: nearby });
    if (signal.aborted) return context;
    if (!response?.ok) throw new Error(response?.error || '翻译服务暂不可用');
    current = { ...context, learning: { ...context.learning, candidates: response.provider === 'cloud' ? [] : context.learning.candidates, status: 'ready', translation: response.translation, segmented: response.segmented, provider: response.provider, contextStatus: response.provider === 'cloud' ? 'loading' : 'ready' } };
    publish();   // 整句先展示，表达与临近预译均不阻塞当前译文
    if (response.provider !== 'cloud') return current;
    const expressionTask = (async () => {
      try {
        const details = await browser.runtime.sendMessage({ type: 'FLOWWORD_CONTEXT', sentence: context.text, context: nearby });
        if (signal.aborted) return;
        if (!details?.ok) throw new Error(details?.error || '语境分析失败');
        current = { ...current, learning: { ...current.learning!, expressions: details.expressions, contextStatus: 'ready' } };
      } catch (error) { current = { ...current, learning: { ...current.learning!, contextStatus: 'error', contextError: error instanceof Error ? error.message : '语境分析失败' } }; }
      publish();
    })();
    const prefetchTask = (async () => {
      if (!info?.prefetch || !nearby.length) return;
      try {
        const result = await browser.runtime.sendMessage({ type: 'FLOWWORD_PREFETCH', items: prefetchItems(context) });
        if (signal.aborted || !result?.ok) return;
        current = { ...current, learning: { ...current.learning!, timeline: current.learning?.timeline?.map((item) => ({ ...item, translation: result.results?.find((entry: { text: string; translation?: string }) => entry.text === item.text)?.translation ?? item.translation })) } };
        publish();
      } catch { /* 临近字幕失败保留当前成功译文 */ }
    })();
    await Promise.all([expressionTask, prefetchTask]);
    return signal.aborted ? context : current;
  } catch (error) { return { ...current, learning: { ...current.learning!, status: 'error', error: error instanceof Error ? error.message : '翻译失败，请重试' } }; }
}
