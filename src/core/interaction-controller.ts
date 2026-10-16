import { assembleSentence } from './sentence';
import type { InteractionState, SentenceContext, SentenceProcessor, SubtitlePort, SubtitleSnapshot, VideoHandle, VideoPort } from './types';

export class InteractionController {
  private state: InteractionState = { phase: 'IDLE', context: null, error: null, canResume: false };
  private listeners = new Set<() => void>();
  private operation = 0;
  private abort: AbortController | null = null;
  private handle: VideoHandle | null = null;
  private pausedByUs = false;

  // constructor 创建交互控制器，video和subtitles提供播放器与字幕接口
  // process整理原句，timeout约束本地整理时间，enrich允许分步发布网络结果
  // 内容脚本创建一次并在失效时dispose，不能把网络耗时当作本地采样超时
  constructor(
    private readonly video: VideoPort,
    private readonly subtitles: SubtitlePort,
    private readonly process: SentenceProcessor = async (snapshot) => assembleSentence(snapshot),
    private readonly timeout = 2500,
    private readonly enrich?: (context: SentenceContext, signal: AbortSignal, emit?: (context: SentenceContext) => void, task?: 'translate' | 'context' | 'both') => Promise<SentenceContext>,
  ) {}

  getSnapshot = (): InteractionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(phase: InteractionState['phase'], context = this.state.context, error: string | null = null): void {
    this.state = { phase, context, error, canResume: this.pausedByUs && Boolean(this.handle?.isCurrent()) };
    this.listeners.forEach((listener) => listener());
  }

  private cancel(): number {
    this.abort?.abort();
    this.abort = new AbortController();
    return ++this.operation;   // 旧异步结果不能覆盖新操作或已经关闭的气泡
  }

  async capture(offset = 0): Promise<void> {
    if (['CAPTURING', 'ANALYZING', 'RESUME'].includes(this.state.phase)) return;
    const operation = this.cancel();
    this.publish('CAPTURING', null);
    try {
      const next = this.video.capture();
      if (!this.handle?.isCurrent() || this.handle.key !== next.key) {
        this.pausedByUs = false;
      }
      this.handle = next;
      const wasPlaying = !next.paused;
      next.pause();   // 不等待任何存储或分析请求，先立即暂停主视频
      this.pausedByUs ||= wasPlaying;   // 原本就暂停的视频不会被插件擅自恢复
      const snapshot = this.subtitles.capture(next, offset);
      await this.analyze(snapshot, operation);
    } catch (error) {
      if (operation === this.operation) this.publish('ERROR', null, this.message(error));
    }
  }

  async previous(): Promise<void> {
    if (this.state.phase !== 'READY' || !this.state.context) return;
    const context = this.state.context;
    const operation = this.cancel();
    try {
      await this.analyze(this.subtitles.previous(context), operation);
    } catch (error) {
      if (operation === this.operation) this.publish('READY', context, this.message(error));
    }
  }

  // follow 表示跟随当前字幕，snapshot是正在播放的真实字幕快照
  // localOnly用于收藏来源重听，跳过模型请求，不暂停视频且旧结果不能覆盖新句
  async follow(snapshot: SubtitleSnapshot, localOnly = false): Promise<void> {
    if (this.state.context?.selected.start === snapshot.selected.start && this.state.context?.selected.text === snapshot.selected.text) return;
    const operation = this.cancel();
    this.pausedByUs = false; this.handle = null;
    try { await this.analyze(snapshot, operation, localOnly); }
    catch (error) { if (operation === this.operation) this.publish('ERROR', null, this.message(error)); }
  }   // 跟随模式只整理正在播放的字幕，不调用pause、不拥有视频暂停状态

  // rebaseHandle 刷新内部播放句柄，无参数，用于重听自己改变时间之后
  // 只允许同一视频刷新，保留原暂停归属，外部跳转仍必须reset
  rebaseHandle(): void {
    if (!this.handle) return;
    const next = this.video.capture();
    if (next.key !== this.handle.key) { this.reset(); return; }
    this.handle = next;
    this.publish(this.state.phase);   // 内部重听改变时间后刷新句柄，保持原先暂停归属
  }

  // adoptReplayPause 接管重听句末的暂停，无参数，由重听完成回调调用
  // 只有当前视频确实暂停才接管，不用于普通手动暂停或其他视频
  adoptReplayPause(): void {
    const next = this.video.capture();
    if (!next.paused) return;
    this.handle = next; this.pausedByUs = true;
    this.publish(this.state.phase);   // 用户明确重听后，由插件在句末暂停的新归属
  }

  private async analyze(snapshot: SubtitleSnapshot, operation: number, localOnly = false): Promise<void> {
    this.publish('ANALYZING', null);
    const abort = this.abort!;
    const signal = abort.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled: (() => void) | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('字幕整理超时，可以重试或继续观看'));
          abort.abort();   // 只取消本次分析，不触及之后新建的操作
        }, this.timeout);
        cancelled = () => reject(new Error('操作已取消'));
        signal.addEventListener('abort', cancelled, { once: true });
      });
      const processed = await Promise.race([this.process(snapshot, signal), deadline]);
      const context: SentenceContext = localOnly && processed.learning ? { ...processed, learning: { ...processed.learning, status: 'disabled', contextStatus: 'ready' } } : processed;
      clearTimeout(timer);
      if (cancelled) signal.removeEventListener('abort', cancelled);
      if (operation !== this.operation || signal.aborted) return;
      this.publish('READY', context);   // 先显示本地字幕和排序，不让网络阻塞原文
      if (this.enrich && !localOnly) {
        const updated = await this.enrich(context, signal, (partial) => {
          if (operation === this.operation && !signal.aborted) this.publish('READY', partial);   // 整句先呈现，表达解析不阻塞它
        });
        if (operation === this.operation && !signal.aborted) this.publish('READY', updated);
      }
    } finally {
      clearTimeout(timer);   // 成功、失败和超时都回收定时器
      if (cancelled) signal.removeEventListener('abort', cancelled);
    }
  }

  close(): void {
    this.cancel();
    this.publish('IDLE', null);   // 关闭面板不自动播放，继续观看由用户明确决定
  }

  // retryLearning 重试当前句学习任务，task选择整句或表达，不重新采样、不改变播放时间
  // 只在已有字幕时调用，旧回复仍受操作序号保护，单任务失败不抹去另一成功结果
  async retryLearning(task: 'translate' | 'context' | 'both' = 'both'): Promise<void> {
    const context = this.state.context;
    if (!context?.learning || !this.enrich) return;
    const operation = this.cancel();
    const signal = this.abort!.signal;
    const next: SentenceContext = { ...context, learning: { ...context.learning, status: task === 'context' ? context.learning.status : 'loading', ...(task !== 'context' ? { error: undefined, cached: false, elapsedMs: undefined, translationState: 'requesting' as const } : {}), ...(task !== 'translate' ? { contextStatus: 'loading' as const, contextError: undefined } : {}) } };
    this.publish('READY', next);
    try {
      const result = await this.enrich(next, signal, (partial) => { if (operation === this.operation && !signal.aborted) this.publish('READY', partial); }, task);
      if (operation === this.operation && !signal.aborted) this.publish('READY', result);
    } catch (failure) {
      if (operation === this.operation && !signal.aborted) this.publish('READY', context, this.message(failure));
    }
  }

  async resume(): Promise<void> {
    if (this.state.phase === 'RESUME') return;
    const operation = this.cancel();
    this.publish('RESUME');
    try {
      if (this.pausedByUs && this.handle?.isCurrent()) await this.handle.play();
      if (operation !== this.operation) return;
      this.pausedByUs = false;
      this.handle = null;
      this.publish('IDLE', null);
    } catch {
      if (operation === this.operation) this.publish('ERROR', this.state.context, '浏览器未允许恢复播放，请点击视频的播放按钮');
    }
  }

  reset(): void {
    this.cancel();
    this.pausedByUs = false;
    this.handle = null;
    this.publish('IDLE', null);   // 导航、换源和手动播放之后立即放弃旧视频的暂停归属
  }

  dispose(): void {
    this.reset();
    this.abort?.abort();
    this.listeners.clear();
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : '没有成功读取字幕，请重试';
  }
}
