import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReplayController, type ReplayVideo } from '../src/core/replay-controller';

class TestVideo extends EventTarget implements ReplayVideo {
  private time = 5;
  currentSrc = 'test.webm'; duration = 90; isConnected = true; paused = true;
  // currentTime 读取替身媒体时间，无参数，不表示真实浏览器播放证据
  get currentTime() { return this.time; }
  // currentTime 写入替身时间，time 给出目标秒数，并触发同步 seek 事件验证内部令牌
  set currentTime(time: number) { this.time = time; this.dispatchEvent(new Event('seeking')); this.dispatchEvent(new Event('seeked')); }
  // advance 意为模拟媒体时间自然推进，time 是测试时刻，不派发用户跳转事件
  advance(time: number) { this.time = time; }
  // play 模拟播放开始，无参数，派发一次事件供事件归属验证，真实 API 另由浏览器测试
  play = vi.fn(async () => { if (this.paused) { this.paused = false; this.dispatchEvent(new Event('play')); } });
  // pause 模拟用户暂停，无参数，派发事件以验证重听清理，不模拟真实网站结果
  pause = vi.fn(() => { this.paused = true; this.dispatchEvent(new Event('pause')); });
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { expect(vi.getTimerCount()).toBe(0); vi.useRealTimers(); });

describe('明确的单次字幕重听会话', () => {
  it('内部 seek 和 play 被准确识别，字幕句末按媒体时间暂停一次', async () => {
    const controller = new ReplayController(); const video = new TestVideo(); const finished = vi.fn();
    const owned: boolean[] = [];
    video.addEventListener('seeking', (event) => owned.push(controller.ownsEvent(event)));
    video.addEventListener('play', (event) => owned.push(controller.ownsEvent(event)));
    await controller.repeat(video, { start: 2, end: 4 }, () => true, finished);
    expect(owned).toEqual([true, true]); expect(controller.active).toBe(true);
    video.advance(4); vi.advanceTimersByTime(30);
    expect(video.pause).toHaveBeenCalledOnce(); expect(finished).toHaveBeenCalledOnce(); expect(controller.active).toBe(false);
  });
  it('缓冲时墙钟过了很久也不会提前结束', async () => {
    const controller = new ReplayController(); const video = new TestVideo();
    await controller.repeat(video, { start: 2, end: 4 }, () => true); vi.advanceTimersByTime(10_000);
    expect(video.pause).not.toHaveBeenCalled(); controller.cancel();
  });
  it('播放倍速只改变媒体时间推进，不改变结束范围', async () => {
    const controller = new ReplayController(); const video = new TestVideo();
    await controller.repeat(video, { start: 2, end: 4 }, () => true);
    video.advance(3.99); vi.advanceTimersByTime(30); expect(video.pause).not.toHaveBeenCalled();
    video.advance(4.2); vi.advanceTimersByTime(30); expect(video.pause).toHaveBeenCalledOnce();
  });
  it('用户跳到其他时间立即退出，不再操作旧视频', async () => {
    const controller = new ReplayController(); const video = new TestVideo();
    await controller.repeat(video, { start: 2, end: 4 }, () => true); video.currentTime = 10;
    expect(controller.active).toBe(false); vi.advanceTimersByTime(3000); expect(video.pause).not.toHaveBeenCalled();
  });
  it('用户手动暂停结束重听会话', async () => {
    const controller = new ReplayController(); const video = new TestVideo();
    await controller.repeat(video, { start: 2, end: 4 }, () => true); video.pause(); expect(controller.active).toBe(false);
  });
  it.each(['source', 'element', 'page'])('媒体源、视频元素和页面变化分别取消：%s', async (kind) => {
    const controller = new ReplayController(); const video = new TestVideo(); let current = true;
    await controller.repeat(video, { start: 2, end: 4 }, () => current);
    if (kind === 'source') video.currentSrc = 'other.webm';
    if (kind === 'element') video.isConnected = false;
    if (kind === 'page') current = false;
    vi.advanceTimersByTime(30); expect(controller.active).toBe(false); expect(video.pause).not.toHaveBeenCalled();
  });
  it.each([{ start: 2, end: 2 }, { start: -1, end: 3 }, { start: 2, end: Infinity }])('范围不足或不可靠时拒绝播放 %j', async (range) => {
    const controller = new ReplayController(); const video = new TestVideo();
    await expect(controller.repeat(video, range, () => true)).rejects.toThrow('字幕时间范围'); expect(video.play).not.toHaveBeenCalled();
  });
  it('已结束的旧 play Promise 不影响新会话', async () => {
    const controller = new ReplayController(); const first = new TestVideo(); const next = new TestVideo();
    let resolve!: () => void;
    first.play.mockImplementation(() => new Promise<void>((done) => { resolve = done; }));
    const old = controller.repeat(first, { start: 2, end: 4 }, () => true);
    await controller.repeat(next, { start: 10, end: 12 }, () => true); resolve(); await old;
    expect(controller.active).toBe(true); next.advance(12); vi.advanceTimersByTime(30);
    expect(first.pause).not.toHaveBeenCalled(); expect(next.pause).toHaveBeenCalledOnce();
  });
  it('浏览器拒绝播放时清理计时器，允许用户重试', async () => {
    const controller = new ReplayController(); const video = new TestVideo();
    video.play.mockRejectedValue(new Error('Autoplay denied'));
    await expect(controller.repeat(video, { start: 2, end: 4 }, () => true)).rejects.toThrow('Autoplay denied');
    expect(controller.active).toBe(false);
  });
});

it('DOM重听忽略点击终点，只在实时目标字幕转换后暂停', async () => {
  const controller = new ReplayController(); const video = new TestVideo(); let changed = false;
  await controller.repeat(video, { start: 2, end: 2.2 }, () => true, undefined, () => changed);
  video.advance(4); vi.advanceTimersByTime(60);
  expect(video.pause).not.toHaveBeenCalled(); expect(controller.active).toBe(true);
  changed = true; vi.advanceTimersByTime(30);
  expect(video.pause).toHaveBeenCalledOnce(); expect(controller.active).toBe(false);
});

it('DOM首次观测的零长度片段也允许等待真实转换，外部seek仍取消', async () => {
  const controller = new ReplayController(); const video = new TestVideo();
  await controller.repeat(video, { start: 2, end: 2 }, () => true, undefined, () => false);
  video.currentTime = 9;
  expect(controller.active).toBe(false); vi.advanceTimersByTime(1000); expect(video.pause).not.toHaveBeenCalled();
});
