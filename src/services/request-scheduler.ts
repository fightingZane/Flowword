// RequestScheduler 管理前台优先槽位，参数为并发数和等待上限，取消的排队任务不会再启动
export class RequestScheduler {
  private active = 0;
  private waiting: { run: () => void }[] = [];
  // constructor 初始化槽位上限，capacity用于所有任务，maxWaiting只限制前台等待数量
  constructor(private capacity = 4, private maxWaiting = 12) {}
  // canPrefetch 判断是否有预译空位，无参数，始终保留两个前台槽并避让正在等待的前台
  canPrefetch(): boolean { return this.active < this.capacity - 2 && this.waiting.length === 0; }
  // run 调度task，priority区分前台与预译，signal取消等待任务；在途任务应同时把signal传给网络
  run<T>(task: () => Promise<T>, priority: 'foreground' | 'prefetch', signal?: AbortSignal): Promise<T | { skipped: true }> {
    if (signal?.aborted) return Promise.reject(new DOMException('请求已取消', 'AbortError'));
    if (priority === 'prefetch' && !this.canPrefetch()) return Promise.resolve({ skipped: true });
    if (this.active >= this.capacity && this.waiting.length >= this.maxWaiting) return Promise.reject(new Error('等待请求较多，请稍后重试'));
    return new Promise((resolve, reject) => {
      const entry = { run: () => {} };
      // abortWaiting 删除尚未开始的本任务，无参数，运行中的取消由网络信号负责
      const abortWaiting = () => { const index = this.waiting.indexOf(entry); if (index >= 0) { this.waiting.splice(index, 1); reject(new DOMException('请求已取消', 'AbortError')); } };
      entry.run = () => {
        signal?.removeEventListener('abort', abortWaiting);
        if (signal?.aborted) { reject(new DOMException('请求已取消', 'AbortError')); this.waiting.shift()?.run(); return; }
        this.active++;
        void task().then(resolve, reject).finally(() => { this.active--; this.waiting.shift()?.run(); });
      };
      if (this.active < this.capacity) entry.run();
      else { this.waiting.push(entry); signal?.addEventListener('abort', abortWaiting, { once: true }); }
    });
  }
}
