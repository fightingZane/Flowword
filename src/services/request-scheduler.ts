// RequestScheduler 管理前台优先请求槽位，参数为总并发和等待上限，预译不排队且至少预留两个前台槽
export class RequestScheduler {
  private active = 0;
  private waiting: { run: () => void }[] = [];
  // constructor 初始化调度器，capacity是并发数，maxWaiting是前台排队上限，后台复用一个实例
  constructor(private capacity = 4, private maxWaiting = 12) {}
  // canPrefetch 判断预译是否可用，无参数，前台有等待或槽位不足时禁止新预译
  canPrefetch(): boolean { return this.active < this.capacity - 2 && this.waiting.length === 0; }
  // run 执行一次网络任务，参数为任务和优先级，前台满载时有界排队而预译直接跳过
  run<T>(task: () => Promise<T>, priority: 'foreground' | 'prefetch'): Promise<T | { skipped: true }> {
    if (priority === 'prefetch' && (this.active >= this.capacity - 2 || this.waiting.length > 0)) return Promise.resolve({ skipped: true });
    if (this.active >= this.capacity && this.waiting.length >= this.maxWaiting) return Promise.reject(new Error('等待请求较多，请稍后重试'));
    return new Promise((resolve, reject) => {
      const run = () => {
        this.active++;
        void task().then(resolve, reject).finally(() => {
          this.active--;
          this.waiting.shift()?.run();
        });
      };
      if (this.active < this.capacity) run(); else this.waiting.push({ run });
    });
  }
}
