import { CODEX_BRIDGE_ENDPOINT, type ProviderConfig } from '../storage/provider';
import { parseCloudOutput } from './cloud';

// requestCodex 将sentence与邻句交给已配对本机桥接，task限定翻译或释义，signal取消当前订阅
// 只访问固定回环地址，不接受网页指定的命令或认证信息，CLI冷启动可能明显慢于云端API
export async function requestCodex(config: ProviderConfig, sentence: string, context: string[], task: 'translate' | 'context', fetcher: typeof fetch = fetch, signal?: AbortSignal) {
  const endpoint = new URL(config.endpoint);
  if (endpoint.href !== CODEX_BRIDGE_ENDPOINT + '/' || !/^[a-f0-9]{64}$/.test(config.apiKey)) throw new Error('请重新导入本机桥接连接文件');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, 90000);
  try {
    const response = await fetcher(CODEX_BRIDGE_ENDPOINT + '/translate', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ sentence, context: context.slice(0, 2), task, ...(config.model.trim() ? { model: config.model.trim() } : {}) }),
      credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal,
    });
    if (!response.ok) throw new Error(response.status === 401 ? '桥接配对已失效，请重新导入连接文件' : response.status === 503 ? 'CLI 尚未使用 ChatGPT 登录，请在本机检查登录状态' : `本机 CLI 请求失败（${response.status}），请检查桥接窗口`);
    const output = await response.json();
    return parseCloudOutput({ choices: [{ message: { content: JSON.stringify(output) } }] }, sentence, task);
  } catch (error) {
    if (signal?.aborted) throw new DOMException('请求已取消', 'AbortError');
    if (controller.signal.aborted) throw new Error('CLI 等待超时，请重试或切换云端 API');
    if (error instanceof TypeError) throw new Error('本机桥接未连接，请先运行 npm run bridge');
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
