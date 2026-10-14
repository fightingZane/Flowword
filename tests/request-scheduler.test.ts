import { describe, expect, it } from 'vitest';
import { RequestScheduler } from '../src/services/request-scheduler';
// deferred 创建可控任务，无参数，测试只通过显式完成模拟慢网络
function deferred() { let resolve = () => {}; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
describe('前台优先请求队列', () => {
  it('两条预译占用后新预译跳过但仍能启动两条前台', async () => {
    const queue = new RequestScheduler();
    const delays = Array.from({ length: 4 }, deferred);
    const active = delays.slice(0, 2).map((item) => queue.run(() => item.promise, 'prefetch'));
    let prefetched = false;
    expect(await queue.run(async () => { prefetched = true; }, 'prefetch')).toEqual({ skipped: true });
    expect(prefetched).toBe(false);
    let foreground = 0;
    active.push(...delays.slice(2).map((item) => queue.run(() => { foreground++; return item.promise; }, 'foreground')));
    expect(foreground).toBe(2);
    delays.forEach((item) => item.resolve()); await Promise.all(active);
  });
  it('四条慢前台满载后新点击排队并在槽位释放后开始', async () => {
    const queue = new RequestScheduler();
    const delays = Array.from({ length: 4 }, deferred);
    const active = delays.map((item) => queue.run(() => item.promise, 'foreground'));
    let started = false;
    const clicked = queue.run(async () => { started = true; return '当前句译文'; }, 'foreground');
    expect(started).toBe(false);
    delays[0]!.resolve();
    expect(await clicked).toBe('当前句译文'); expect(started).toBe(true);
    delays.forEach((item) => item.resolve()); await Promise.all(active);
  });
  it('等待队列有界且预译不进入等待队列', async () => {
    const queue = new RequestScheduler(4, 1);
    const slow = deferred();
    const active = Array.from({ length: 4 }, () => queue.run(() => slow.promise, 'foreground'));
    const waiting = queue.run(async () => 'wait', 'foreground');
    expect(await queue.run(async () => 'unused', 'prefetch')).toEqual({ skipped: true });
    await expect(queue.run(async () => 'overflow', 'foreground')).rejects.toThrow('等待请求较多');
    slow.resolve(); await Promise.all([...active, waiting]);
  });
});
