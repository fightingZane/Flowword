import { describe, expect, it, vi } from 'vitest';
import { InteractionController } from '../src/core/interaction-controller';
import { assembleSentence } from '../src/core/sentence';
import type { SentenceContext, SubtitleSnapshot, VideoHandle } from '../src/core/types';

function setup(paused = false) {
  let current = true;
  const handle: VideoHandle = { key: 'test', time: 5, paused, pause: vi.fn(), play: vi.fn(async () => {}), isCurrent: () => current };
  const selected = { text: 'An obscure reference.', start: 4, end: 6, source: 'youtube-dom' as const, language: 'und' as const };
  const snapshot: SubtitleSnapshot = { segments: [selected], selected, capturedTime: 5, targetTime: 5, offset: 0, videoKey: 'test', title: 'test', url: 'https://www.youtube.com/watch?v=test' };
  const video = { capture: vi.fn(() => handle) };
  const subtitles = { capture: vi.fn(() => snapshot), previous: vi.fn(() => snapshot) };
  const controller = new InteractionController(video, subtitles);
  return { controller, video, subtitles, handle, snapshot, invalidate: () => { current = false; } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('暂停归属和显式状态机', () => {
  it('点击后在等待分析之前立即暂停', async () => {
    const { video, subtitles, handle, snapshot } = setup();
    const pending = deferred<SentenceContext>();
    const controller = new InteractionController(video, subtitles, () => pending.promise);
    const operation = controller.capture();
    expect(handle.pause).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().phase).toBe('ANALYZING');
    pending.resolve(assembleSentence(snapshot));
    await operation;
    expect(controller.getSnapshot().phase).toBe('READY');
    controller.dispose();
  });
  it('只在用户点击继续时恢复插件暂停的视频', async () => {
    const { controller, handle } = setup();
    await controller.capture();
    expect(controller.getSnapshot().canResume).toBe(true);
    expect(handle.play).not.toHaveBeenCalled();
    await controller.resume();
    expect(handle.play).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().phase).toBe('IDLE');
  });
  it('原本暂停的视频保持暂停', async () => {
    const { controller, handle } = setup(true);
    await controller.capture();
    expect(controller.getSnapshot().canResume).toBe(false);
    await controller.resume();
    expect(handle.play).not.toHaveBeenCalled();
  });
  it('没有字幕时仍能继续观看', async () => {
    const { controller, subtitles, handle } = setup();
    subtitles.capture.mockImplementation(() => { throw new Error('无字幕'); });
    await controller.capture();
    expect(controller.getSnapshot().phase).toBe('ERROR');
    expect(controller.getSnapshot().canResume).toBe(true);
    await controller.resume();
    expect(handle.play).toHaveBeenCalledOnce();
  });
  it('快速连续点击只执行一次捕获', async () => {
    const { video, subtitles, handle, snapshot } = setup();
    const pending = deferred<SentenceContext>();
    const controller = new InteractionController(video, subtitles, () => pending.promise);
    const first = controller.capture();
    await controller.capture();
    expect(handle.pause).toHaveBeenCalledOnce();
    pending.resolve(assembleSentence(snapshot));
    await first;
    controller.dispose();
  });
  it('关闭面板后晚到的结果不重新打开气泡', async () => {
    const { video, subtitles, snapshot, handle } = setup();
    const pending = deferred<SentenceContext>();
    const controller = new InteractionController(video, subtitles, () => pending.promise);
    const first = controller.capture();
    controller.close();
    pending.resolve(assembleSentence(snapshot));
    await first;
    expect(controller.getSnapshot().phase).toBe('IDLE');
    expect(handle.play).not.toHaveBeenCalled();
    controller.dispose();
  });
  it('再次打开面板不丢失先前暂停归属', async () => {
    const { controller, handle } = setup();
    await controller.capture();
    controller.close();
    handle.paused = true;
    await controller.capture();
    expect(controller.getSnapshot().canResume).toBe(true);
    await controller.resume();
    expect(handle.play).toHaveBeenCalledOnce();
  });
  it('视频已换源或移除时不恢复旧视频', async () => {
    const { controller, handle, invalidate } = setup();
    await controller.capture();
    invalidate();
    await controller.resume();
    expect(handle.play).not.toHaveBeenCalled();
  });
  it('整理超时后进入 ERROR 并保留继续观看能力', async () => {
    const { video, subtitles, handle } = setup();
    const controller = new InteractionController(video, subtitles, () => new Promise(() => {}), 8);
    await controller.capture();
    expect(controller.getSnapshot().phase).toBe('ERROR');
    expect(controller.getSnapshot().error).toContain('超时');
    await controller.resume();
    expect(handle.play).toHaveBeenCalledOnce();
  });
  it('取消旧操作后它的计时器不能取消新操作', async () => {
    vi.useFakeTimers();
    try {
      const { video, subtitles, snapshot } = setup();
      const second = deferred<SentenceContext>();
      let calls = 0;
      const controller = new InteractionController(video, subtitles, () => ++calls === 1 ? new Promise(() => {}) : second.promise, 100);
      const first = controller.capture();
      await vi.advanceTimersByTimeAsync(70);
      controller.close();
      await first;
      const next = controller.capture();
      await vi.advanceTimersByTimeAsync(40);
      second.resolve(assembleSentence(snapshot));
      await next;
      expect(controller.getSnapshot().phase).toBe('READY');
      controller.dispose();
    } finally { vi.useRealTimers(); }
  });
  it('手动播放或导航 reset 后放弃旧暂停归属', async () => {
    const { controller, handle } = setup();
    await controller.capture();
    controller.reset();
    await controller.resume();
    expect(handle.play).not.toHaveBeenCalled();
  });
  it('上一条字幕不存在时保留原文并显示提示', async () => {
    const { controller, subtitles } = setup();
    await controller.capture();
    subtitles.previous.mockImplementation(() => { throw new Error('没有上一条字幕'); });
    await controller.previous();
    expect(controller.getSnapshot().phase).toBe('READY');
    expect(controller.getSnapshot().context?.text).toBe('An obscure reference.');
    expect(controller.getSnapshot().error).toBe('没有上一条字幕');
    controller.dispose();
  });
  it('分析中也允许用户主动继续播放', async () => {
    const { video, subtitles, handle } = setup();
    const controller = new InteractionController(video, subtitles, () => new Promise(() => {}));
    const first = controller.capture();
    await controller.resume();
    await first;
    expect(handle.play).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().phase).toBe('IDLE');
  });
  it('浏览器拒绝 play 时给出可恢复的错误', async () => {
    const { controller, handle } = setup();
    vi.mocked(handle.play).mockRejectedValue(new Error('NotAllowedError'));
    await controller.capture();
    await controller.resume();
    expect(controller.getSnapshot().phase).toBe('ERROR');
    expect(controller.getSnapshot().error).toContain('播放按钮');
    controller.dispose();
  });
});
