import { assembleSentence } from './sentence';
import type { InteractionState, SentenceProcessor, SubtitlePort, SubtitleSnapshot, VideoHandle, VideoPort } from './types';

export class InteractionController {
  private state: InteractionState = { phase: 'IDLE', context: null, error: null, canResume: false };
  private listeners = new Set<() => void>();
  private operation = 0;
  private abort: AbortController | null = null;
  private handle: VideoHandle | null = null;
  private pausedByUs = false;

  constructor(
    private readonly video: VideoPort,
    private readonly subtitles: SubtitlePort,
    private readonly process: SentenceProcessor = async (snapshot) => assembleSentence(snapshot),
    private readonly timeout = 2500,
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

  private async analyze(snapshot: SubtitleSnapshot, operation: number): Promise<void> {
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
      const context = await Promise.race([this.process(snapshot, signal), deadline]);
      if (operation === this.operation && !signal.aborted) this.publish('READY', context);
    } finally {
      clearTimeout(timer);   // 成功、失败和超时都回收定时器
      if (cancelled) signal.removeEventListener('abort', cancelled);
    }
  }

  close(): void {
    this.cancel();
    this.publish('IDLE', null);   // 关闭面板不自动播放，继续观看由用户明确决定
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
