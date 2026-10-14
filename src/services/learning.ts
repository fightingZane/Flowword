import { browser } from 'wxt/browser';
import type { SentenceContext } from '../core/types';
import { subtitleTimeline, prefetchItems } from '../adapters/html5-subtitles';
// learningContext 从context真实字幕快照取得稳定邻句，用于统一点击与预译缓存，不虚构未来字幕
export function learningContext(context: SentenceContext): string[] { return subtitleTimeline(context, context).filter((item) => item.text !== context.text).slice(0, 2).map((item) => item.text); }
// enrichLearning 并行补全context整句和语境表达，signal阻止旧结果展示，emit独立发布成功字段
// 已发送的云端请求不保证撤销，一种任务失败不会抹掉另一种成功结果
export async function enrichLearning(context: SentenceContext, signal: AbortSignal, emit?: (context: SentenceContext) => void): Promise<SentenceContext> {
  if (!context.learning || context.learning.status !== 'loading') return context;
  let current = context;
  // publish 发布合并后的current，无参数，signal取消后不再触碰当前页面
  const publish = () => { if (!signal.aborted) emit?.(current); };
  try {
    const nearby = learningContext(context);
    const info = await browser.runtime.sendMessage({ type: 'FLOWWORD_PROVIDER_PUBLIC' });
    if (signal.aborted) return context;
    current = { ...context, learning: { ...context.learning, provider: info.mode, candidates: info.mode === 'cloud' ? [] : context.learning.candidates, contextStatus: info.mode === 'cloud' ? 'loading' : 'ready' } };
    // translationTask 独立整句任务，无参数，使用当前context文本，失败只更新译文错误
    const translationTask = (async () => {
      try {
        const response = await browser.runtime.sendMessage({ type: 'FLOWWORD_TRANSLATE', sentence: context.text, context: nearby });
        if (signal.aborted) return;
        if (!response?.ok) throw new Error(response?.error || '翻译服务暂不可用');
        current = { ...current, learning: { ...current.learning!, status: 'ready', translation: response.translation, segmented: response.segmented, provider: response.provider, error: undefined } };
      } catch (error) { current = { ...current, learning: { ...current.learning!, status: 'error', error: error instanceof Error ? error.message : '整句翻译失败' } }; }
      publish();
    })();
    // expressionTask 独立词组任务，无参数，只有云模式运行，不能覆盖已经成功的整句字段
    const expressionTask = (async () => {
      if (info.mode !== 'cloud') return;
      try {
        const details = await browser.runtime.sendMessage({ type: 'FLOWWORD_CONTEXT', sentence: context.text, context: nearby });
        if (signal.aborted) return;
        if (!details?.ok) throw new Error(details?.error || '语境分析失败');
        current = { ...current, learning: { ...current.learning!, expressions: details.expressions, contextStatus: 'ready', contextError: undefined } };
      } catch (error) { current = { ...current, learning: { ...current.learning!, contextStatus: 'error', contextError: error instanceof Error ? error.message : '语境分析失败' } }; }
      publish();
    })();
    // prefetchTask 准备真实邻句，无参数，受用户开关与预算限制，不虚构未来字幕
    const prefetchTask = (async () => {
      if (info.mode !== 'cloud' || !info.prefetch) return;
      try {
        const result = await browser.runtime.sendMessage({ type: 'FLOWWORD_PREFETCH', items: prefetchItems(context) });
        if (signal.aborted || !result?.ok) return;
        current = { ...current, learning: { ...current.learning!, timeline: current.learning?.timeline?.map((item) => ({ ...item, translation: result.results?.find((entry: { text: string; translation?: string }) => entry.text === item.text)?.translation ?? item.translation })) } };
        publish();
      } catch { /* 邻句失败保留当前成功译文与表达 */ }
    })();
    await Promise.all([translationTask, expressionTask, prefetchTask]);
    return signal.aborted ? context : current;
  } catch (error) { return { ...current, learning: { ...current.learning!, status: 'error', error: error instanceof Error ? error.message : '翻译失败，请重试' } }; }
}
