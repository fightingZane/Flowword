import { browser } from 'wxt/browser';
export const SCOPE_KEY = 'flowword.scope.v1';
export interface SiteScope { allSites: boolean; allowed: string[]; blocked: string[] }
// cleanOrigins 校验value网站清单，只保存http(s)来源，不记录网页标题或完整浏览地址
function cleanOrigins(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, 2000).flatMap((item) => { try { const url = new URL(item); return /^https?:$/.test(url.protocol) && url.origin === item ? [item] : []; } catch { return []; } }))];
}
// sanitizeScope 校验value范围设置，未配置时保留旧版已授权站行为，不静默取得全站权限
export function sanitizeScope(value: unknown): SiteScope | undefined {
  if (!value || typeof value !== 'object') return;
  const input = value as Partial<SiteScope>;
  return { allSites: input.allSites === true, allowed: cleanOrigins(input.allowed), blocked: cleanOrigins(input.blocked) };
}
// scopeAllows 根据scope与当前url判断网站选择，黑名单优先，同一来源下次打开仍沿用
export function scopeAllows(scope: SiteScope | undefined, url: string): boolean {
  try { const origin = new URL(url).origin; return !scope || !scope.blocked.includes(origin) && (scope.allSites || scope.allowed.includes(origin) || origin === 'https://www.youtube.com'); } catch { return false; }
}
// readScope 读取本机网站范围，无参数，未配置返回undefined以兼容旧版逐站授权
export async function readScope() { return sanitizeScope((await browser.storage.local.get(SCOPE_KEY))[SCOPE_KEY]); }
