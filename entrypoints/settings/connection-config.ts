import { CODEX_BRIDGE_ENDPOINT, DEFAULT_PROVIDER, type ProviderConfig } from '../../src/storage/provider';

// matchingEndpoint 表示同一完整接口，left 和 right 是表单与已保存地址
// 无效地址返回假，只有完整地址一致才允许复用已保存凭据
export function matchingEndpoint(left: string, right: string): boolean { try { return !!left && !!right && new URL(left).href === new URL(right).href; } catch { return false; } }

// parseCliConnection 表示读取本机配对文件，text 是用户主动选择的 JSON 文本
// 只接受固定回环地址与六十四位小写十六进制令牌，不回显文件内容或接受远程主机
export function parseCliConnection(text: string): { endpoint: string; token: string } {
  if (text.length > 16384) throw new Error('连接文件过大，请选择桥接生成的本机连接文件');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('连接文件不是有效 JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('连接文件格式无效');
  const connection = value as { endpoint?: unknown; token?: unknown };
  if (typeof connection.endpoint !== 'string' || !matchingEndpoint(connection.endpoint, CODEX_BRIDGE_ENDPOINT)) throw new Error('连接文件只能指向 http://127.0.0.1:17863');
  if (typeof connection.token !== 'string' || !/^[a-f0-9]{64}$/.test(connection.token)) throw new Error('连接令牌格式无效，请重新运行桥接并导入生成的文件');
  return { endpoint: CODEX_BRIDGE_ENDPOINT, token: connection.token };
}

// cloudPreset 表示用户主动选择的云端预设，name 区分服务，protocol 选择请求协议
// 仅返回公开字段，不修改任何已保存配置，OpenAI 模型由用户填写
export function cloudPreset(name: 'deepseek' | 'openai', protocol: ProviderConfig['protocol']): Pick<ProviderConfig, 'endpoint' | 'model' | 'protocol'> {
  if (name === 'deepseek') return { endpoint: DEFAULT_PROVIDER.endpoint, model: DEFAULT_PROVIDER.model, protocol: 'chat-completions' };
  return { endpoint: protocol === 'responses' ? 'https://api.openai.com/v1/responses' : 'https://api.openai.com/v1/chat/completions', model: '', protocol: protocol || 'chat-completions' };
}

// checkCliStatus 表示无模型调用的桥接检查，config 提供仅本机使用的令牌，fetcher 可注入测试
// 只访问固定 status 路径，严格要求 ChatGPT 登录状态，不展示原始响应和凭据
export async function checkCliStatus(config: ProviderConfig, fetcher: typeof fetch = fetch): Promise<void> {
  if (!matchingEndpoint(config.endpoint, CODEX_BRIDGE_ENDPOINT) || !/^[a-f0-9]{64}$/.test(config.apiKey)) throw new Error('请先导入本机桥接连接文件');
  let response: Response;
  try { response = await fetcher(CODEX_BRIDGE_ENDPOINT + '/status', { method: 'GET', headers: { Authorization: `Bearer ${config.apiKey}` }, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(5000) }); }
  catch { throw new Error('本机桥接未连接或响应超时，请先运行 npm run bridge'); }
  if (!response.ok) throw new Error(response.status === 401 ? '桥接配对已失效，请重新导入连接文件' : response.status === 503 ? 'CLI 尚未使用 ChatGPT 登录，请检查本机登录状态' : `桥接检查失败（HTTP ${response.status}）`);
  let status: unknown;
  try { status = await response.json(); } catch { throw new Error('桥接状态响应无效'); }
  if (!status || typeof status !== 'object' || !('ok' in status) || status.ok !== true || !('auth' in status) || status.auth !== 'chatgpt') throw new Error('CLI 尚未确认 ChatGPT 登录，请检查本机登录状态');
}
