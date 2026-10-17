import { browser } from 'wxt/browser';
import type { SentenceContext } from '../core/types';
import { subtitleTimeline, prefetchItems } from '../adapters/html5-subtitles';
// learningContext 从context真实字幕快照取得稳定邻句，用于统一点击与预译缓存，不虚构未来字幕
export function learningContext(context: SentenceContext): string[] { return subtitleTimeline(context, context).filter((item) => item.text !== context.text).slice(0, 2).map((item) => item.text); }
// requestLearningMessage 给message附本操作requestId，signal取消时通知后台移除订阅，已付费计算不保证退款
export async function requestLearningMessage(message: Record<string, unknown>, signal: AbortSignal): Promise<any> {
  if (signal.aborted) throw new DOMException('请求已取消', 'AbortError');
  const requestId = crypto.randomUUID();
  // cancelled 通知后台取消本请求，无参数，后台引用计数保留其他使用者
  const cancelled = () => { void browser.runtime.sendMessage({ type: 'FLOWWORD_CANCEL', requestId }).catch(() => {}); };
  signal.addEventListener('abort', cancelled, { once: true });
  try { return await browser.runtime.sendMessage({ ...message, requestId }); }
  finally { signal.removeEventListener('abort', cancelled); }
}
// enrichLearning 并行补全context整句和语境表达，signal阻止旧结果展示，emit独立发布成功字段
// 取消会移除本次后台订阅，只有最后使用者离开才中止共享网络，一种任务失败不抹另一种成功结果
export async function enrichLearning(context: SentenceContext, signal: AbortSignal, emit?: (context: SentenceContext) => void, task: 'translate' | 'context' | 'both' = 'both'): Promise<SentenceContext> {
  if (!context.learning || task === 'both' && context.learning.status !== 'loading') return context;
  let current = context;
  // publish 发布合并后的current，无参数，signal取消后不再触碰当前页面
  const publish = () => { if (!signal.aborted) emit?.(current); };
  try {
    const nearby = learningContext(context);
    const info = await browser.runtime.sendMessage({ type: 'FLOWWORD_PROVIDER_PUBLIC' });
    if (signal.aborted) return context;
    const supportsContext = info.mode === 'cloud' || info.mode === 'codex-cli';
    current = { ...context, learning: { ...context.learning, provider: info.mode, translationState: task === 'context' ? context.learning.translationState : 'requesting', candidates: task === 'context' ? context.learning.candidates : supportsContext ? [] : context.learning.candidates, contextStatus: task === 'translate' ? context.learning.contextStatus : supportsContext ? 'loading' : 'ready' } };
    // translationTask 独立整句任务，无参数，使用当前context文本，失败只更新译文错误
    const translationTask = (async () => {
      if (task === 'context') return;
      try {
        const response = await requestLearningMessage({ type: 'FLOWWORD_TRANSLATE', sentence: context.text, context: nearby }, signal);
        if (signal.aborted) return;
        if (!response?.ok) throw new Error(response?.error || '翻译服务暂不可用');
        current = { ...current, learning: { ...current.learning!, status: 'ready', translation: response.translation, segmented: response.segmented, provider: response.provider, cached: response.cached === true, elapsedMs: response.elapsedMs, translationState: response.cached ? 'cached' : 'ready', error: undefined } };
      } catch (error) { current = { ...current, learning: { ...current.learning!, status: 'error', translationState: 'error', error: error instanceof Error ? error.message : '整句翻译失败' } }; }
      publish();
    })();
    // expressionTask 独立词组任务，无参数，只有云模式运行，不能覆盖已经成功的整句字段
    const expressionTask = (async () => {
      if (task === 'translate') return;
      if (!supportsContext) { if (task === 'context') { current = { ...current, learning: { ...current.learning!, contextStatus: 'error', contextError: '请先配置并开启云端语境模型' } }; publish(); } return; }
      try {
        const details = await requestLearningMessage({ type: 'FLOWWORD_CONTEXT', sentence: context.text, context: nearby }, signal);
        if (signal.aborted) return;
        if (!details?.ok) throw new Error(details?.error || '语境分析失败');
        current = { ...current, learning: { ...current.learning!, expressions: details.expressions, contextStatus: 'ready', contextCached: details.cached === true, contextElapsedMs: details.elapsedMs, contextError: undefined } };
      } catch (error) { current = { ...current, learning: { ...current.learning!, contextStatus: 'error', contextError: error instanceof Error ? error.message : '语境分析失败' } }; }
      publish();
    })();
    // prefetchTask 准备真实邻句，无参数，受用户开关与预算限制，不虚构未来字幕
    const prefetchTask = (async () => {
      if (task !== 'both' || info.mode !== 'cloud' || !info.prefetch) return;
      try {
        const result = await requestLearningMessage({ type: 'FLOWWORD_PREFETCH', items: prefetchItems(context) }, signal);
        if (signal.aborted || !result?.ok) return;
        current = { ...current, learning: { ...current.learning!, timeline: current.learning?.timeline?.map((item) => ({ ...item, translation: result.results?.find((entry: { text: string; translation?: string }) => entry.text === item.text)?.translation ?? item.translation })) } };
        publish();
      } catch { /* 邻句失败保留当前成功译文与表达 */ }
    })();
    await Promise.all([translationTask, expressionTask, prefetchTask]);
    return signal.aborted ? context : current;
  } catch (error) { return { ...current, learning: { ...current.learning!, status: 'error', error: error instanceof Error ? error.message : '翻译失败，请重试' } }; }
}
