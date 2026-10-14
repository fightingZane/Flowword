export interface ReplayRange { start: number; end: number }
export interface ReplayVideo extends EventTarget {
  currentTime: number;
  readonly currentSrc: string;
  readonly duration: number;
  readonly isConnected: boolean;
  readonly paused: boolean;
  play(): Promise<void>;
  pause(): void;
}

interface ReplaySession {
  video: ReplayVideo;
  source: string;
  range: ReplayRange;
  isCurrent(): boolean;
  ownSeek: boolean;
  ownPlay: boolean;
  started: boolean;
  onFinished?: () => void;
}

export class ReplayController {
  private session: ReplaySession | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  // active 意为是否存在重听会话，无参数，只供界面和内部事件识别读取
  // 不直接据此恢复播放，具体操作仍需同一视频和来源身份
  get active(): boolean { return this.session !== null; }

  // repeat 意为重听一次，video 是主视频，range 是真实或已观测时间范围
  // isCurrent 复核页面与视频身份，onFinished 在句末主动暂停后通知归属控制器
  // 调用会替换旧会话并立即跳到句首，Promise 只等待开始播放，不等待整段结束
  async repeat(video: ReplayVideo, range: ReplayRange, isCurrent: () => boolean, onFinished?: () => void): Promise<void> {
    this.cancel();
    if (!video.isConnected || !isCurrent()) throw new Error('视频已切换，请重新捕获后重听');
    if (!Number.isFinite(video.duration) || !Number.isFinite(range.start) || !Number.isFinite(range.end)
      || range.start < 0 || range.end - range.start < 0.08 || range.start >= video.duration) {
      throw new Error('还没有足够的字幕时间范围，先播放这段字幕后再重听');
    }
    const session: ReplaySession = { video, source: video.currentSrc, range: { start: range.start, end: Math.min(range.end, video.duration) },
      isCurrent, ownSeek: true, ownPlay: video.paused, started: false, onFinished };
    this.session = session;
    for (const name of ['seeking', 'seeked', 'play', 'pause', 'ended', 'emptied', 'loadstart']) video.addEventListener(name, this.mediaEvent);
    this.timer = setInterval(this.check, 30);
    try {
      video.currentTime = session.range.start;   // 自己的跳转通过目标时间与会话身份识别
      await video.play();
      if (this.session !== session) return;
      session.started = true;
      this.check();
    } catch (error) {
      if (this.session === session) { this.cancel(); throw error instanceof Error ? error : new Error('浏览器未允许重听，请点击视频播放后重试'); }
    }
  }

  // ownsEvent 意为识别本次重听产生的事件，event 是视频的 seek 或 play 事件
  // 内容脚本在重听监听器之前调用，只跳过匹配的内部事件，外部 seek 仍需取消
  ownsEvent(event: Event): boolean {
    const session = this.session;
    if (!session || event.target !== session.video) return false;
    if (event.type === 'play') return session.ownPlay;
    return ['seeking', 'seeked'].includes(event.type) && session.ownSeek && Math.abs(session.video.currentTime - session.range.start) < 0.16;
  }   // 仅放行本次重听产生的跳转与播放，用户新的跳转不会被全局忽略

  // cancel 意为退出重听，无参数，外部跳转、页面变化或插件关闭时调用
  // 清理监听和计时器后不再碰旧视频，不自动暂停或恢复播放
  cancel(): void {
    const session = this.session;
    this.session = null;
    clearInterval(this.timer); this.timer = undefined;
    if (session) for (const name of ['seeking', 'seeked', 'play', 'pause', 'ended', 'emptied', 'loadstart']) session.video.removeEventListener(name, this.mediaEvent);
  }   // 取消后不再控制旧视频，也不自动恢复播放

  // mediaEvent 意为处理视频事件，event 来自当前会话视频
  // 内部 seek/play 只消费一次标记，用户暂停、换源和其他跳转立即退出会话
  private mediaEvent = (event: Event): void => {
    const session = this.session;
    if (!session) return;
    if (this.ownsEvent(event)) {
      if (event.type === 'play') session.ownPlay = false;
      if (event.type === 'seeked') session.ownSeek = false;
      return;
    }
    if (['pause', 'ended', 'emptied', 'loadstart', 'seeking'].includes(event.type)) this.cancel();
  };

  // check 意为按媒体时间检查句末，无参数，由本会话短周期计时器调用
  // 缓冲不推进 currentTime 时继续等待，来源变化则取消，绝不按墙钟估算片段结束
  private check = (): void => {
    const session = this.session;
    if (!session) return;
    const video = session.video;
    if (!video.isConnected || !session.isCurrent() || video.currentSrc !== session.source) { this.cancel(); return; }
    if (session.started && video.currentTime >= session.range.end) {
      this.cancel();
      video.pause();
      session.onFinished?.();
    }
  };   // 依据视频时间而不是墙钟停在句末，变速和缓冲不会缩短重听片段
}
