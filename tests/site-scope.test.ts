import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ stored: {} as Record<string, unknown>, registered: [] as any[], granted: true, inject: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: { storage: { local: { get: async () => state.stored, set: async (patch: object) => Object.assign(state.stored, patch) } }, permissions: { contains: async () => state.granted }, tabs: { query: async () => [{ id: 1, url: 'https://example.test/article', title: 'Reading lesson' }], sendMessage: async () => { throw new Error('not injected'); } }, scripting: { getRegisteredContentScripts: async () => state.registered, registerContentScripts: async (items: any[]) => state.registered.push(...items), unregisterContentScripts: async ({ ids }: { ids: string[] }) => { state.registered = state.registered.filter((item) => !ids.includes(item.id)); }, executeScript: state.inject } } }));
import { sanitizeScope, scopeAllows, SCOPE_KEY } from '../src/storage/site-scope';
import { handleSiteScope } from '../src/services/site-scope';
beforeEach(() => { state.stored = {}; state.registered = []; state.granted = true; state.inject.mockClear(); });
it('旧站点保持兼容，黑名单优先，网站规则忽略网页路径', () => {
  expect(scopeAllows(undefined, 'https://example.test/old')).toBe(true);
  expect(scopeAllows({ allSites: true, allowed: [], blocked: ['https://example.test'] }, 'https://example.test/other')).toBe(false);
  expect(scopeAllows({ allSites: false, allowed: ['https://example.test'], blocked: [] }, 'https://example.test/next')).toBe(true);
  expect(sanitizeScope({ allSites: 'true', blocked: ['https://example.test/path', 'javascript:bad', 'https://example.test'] })).toEqual({ allSites: false, blocked: ['https://example.test'], allowed: [] });
});
it('未授权不能全站启用，授权后注册持久全站脚本并即时注入', async () => {
  state.granted = false;
  await expect(handleSiteScope({ type: 'FLOWWORD_SCOPE_ALL', enabled: true })).rejects.toThrow('授权');
  expect(state.registered).toHaveLength(0);
  state.granted = true;
  await handleSiteScope({ type: 'FLOWWORD_SCOPE_ALL', enabled: true });
  expect(state.registered).toMatchObject([{ id: 'flowword-site-all', persistAcrossSessions: true, matches: ['http://*/*', 'https://*/*'] }]);
  expect(state.inject).toHaveBeenCalledTimes(1);
});
it('禁用网站保存在本机，下次同站路径仍关闭，重开仅移除该站黑名单', async () => {
  await handleSiteScope({ type: 'FLOWWORD_SCOPE_ALL', enabled: true });
  await handleSiteScope({ type: 'FLOWWORD_SCOPE_SITE', origin: 'https://example.test', enabled: false });
  expect(scopeAllows(state.stored[SCOPE_KEY] as any, 'https://example.test/next')).toBe(false);
  const listed = await handleSiteScope({ type: 'FLOWWORD_SCOPE_LIST' }) as any;
  expect(listed.sites[0]).toMatchObject({ enabled: false });
  expect(JSON.stringify(state.stored)).not.toContain('Reading lesson');
  await handleSiteScope({ type: 'FLOWWORD_SCOPE_SITE', origin: 'https://example.test', enabled: true });
  expect(scopeAllows(state.stored[SCOPE_KEY] as any, 'https://example.test/next')).toBe(true);
});
it('关闭全站范围移除全站注册，保留逐站授权与既有黑名单', async () => {
  await handleSiteScope({ type: 'FLOWWORD_SCOPE_ALL', enabled: true });
  await handleSiteScope({ type: 'FLOWWORD_SCOPE_SITE', origin: 'https://example.test', enabled: true });
  await handleSiteScope({ type: 'FLOWWORD_SCOPE_ALL', enabled: false });
  expect(state.registered.some((item) => item.id === 'flowword-site-all')).toBe(false);
  expect(scopeAllows(state.stored[SCOPE_KEY] as any, 'https://example.test')).toBe(true);
  expect(scopeAllows(state.stored[SCOPE_KEY] as any, 'https://other.test')).toBe(false);
});

it('停用网站不会暗中打开已关闭的插件总开关', async () => {
  state.stored['flowword.enabled.v1'] = false;
  await handleSiteScope({ type: 'FLOWWORD_SCOPE_SITE', origin: 'https://example.test', enabled: false });
  expect(state.stored['flowword.enabled.v1']).toBe(false);
});
