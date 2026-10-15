export type ProviderMode = 'off' | 'cloud' | 'mymemory';
export interface ProviderConfig { mode: ProviderMode; endpoint: string; model: string; apiKey: string; prefetch: boolean; prefetchExpressions?: boolean }
export const DEFAULT_PROVIDER: ProviderConfig = { mode: 'off', endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash', apiKey: '', prefetch: false, prefetchExpressions: false };
let database: Promise<IDBDatabase> | undefined;
// open 打开扩展来源的服务数据库，无参数，后台和独立设置页复用
// 网页内容脚本不得导入调用，密钥不写入它可读取的storage.local
function open() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('flowword-provider', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('config'); request.result.createObjectStore('cache'); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(new Error('无法打开本地服务配置')); };
  });   // 密钥仅存在扩展来源数据库，不写入内容脚本可读取的 storage.local
  return database;
}
// operation 执行数据库事务，store为表名，mode为读写方式，run创建一次IDB请求
// 泛型T是请求结果类型，等待事务完成才返回，失败不泄露密钥内容
async function operation<T>(store: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const request = run(transaction.objectStore(store));
    transaction.oncomplete = () => resolve(request.result as T);
    transaction.onerror = transaction.onabort = () => reject(new Error('本地配置操作失败'));
  });
}
// validateProvider 校验value服务配置并规范化，保存前调用
// 只允许HTTPS完整接口，不允许URL携带密钥参数，云模式要求模型与密钥齐全
export function validateProvider(value: ProviderConfig): ProviderConfig {
  if (!['off', 'cloud', 'mymemory'].includes(value.mode)) throw new Error('服务类型无效');
  const endpoint = new URL(value.endpoint);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('接口必须是无账号、参数的 HTTPS 地址');
  if (value.model.length > 150 || value.apiKey.length > 4096 || /[\r\n]/.test(value.apiKey)) throw new Error('模型或密钥格式无效');
  if (value.mode === 'cloud' && (!value.model.trim() || !value.apiKey.trim())) throw new Error('请填写模型和 API Key');
  return { mode: value.mode, endpoint: endpoint.href, model: value.model.trim(), apiKey: value.apiKey.trim(), prefetch: value.prefetch === true, prefetchExpressions: value.prefetchExpressions === true };
}
// readProvider 读取完整本地配置，无参数，仅扩展可信页面或后台可调用，不能经公开RPC返回
export async function readProvider(): Promise<ProviderConfig | undefined> { return operation('config', 'readonly', (store) => store.get('provider')); }
// saveProvider 保存config服务配置，先校验格式，网络域名授权由可信设置按钮单独完成
export async function saveProvider(config: ProviderConfig) { await operation('config', 'readwrite', (store) => store.put(validateProvider(config), 'provider')); }
// cachedTranslation 读取key对应的未过期译文，key包含任务和语境，不可跨语境套用
export async function cachedTranslation(key: string): Promise<string | undefined> {
  const record = await operation<{ text: string; expires: number } | undefined>('cache', 'readonly', (store) => store.get(key));
  return record && record.expires > Date.now() ? record.text : undefined;
}
// cacheTranslation 保存key对应的text译文并限制容量，七天过期，不保存密钥或接口认证头
export async function cacheTranslation(key: string, text: string) {
  await operation('cache', 'readwrite', (store) => store.put({ text, expires: Date.now() + 7 * 86400000 }, key));
  const db = await open();
  const transaction = db.transaction('cache', 'readwrite');
  const store = transaction.objectStore('cache');
  const count = store.count();
  count.onsuccess = () => { if (count.result > 1000) { const cursor = store.openCursor(); cursor.onsuccess = () => { cursor.result?.delete(); }; } };
}   // 缓存限制一千条，七天过期，用户可随时清除
// clearTranslationCache 清除本地译文缓存，无参数，由明确清除按钮调用，不删除词本或密钥
export async function clearTranslationCache() { await operation('cache', 'readwrite', (store) => store.clear()); }
