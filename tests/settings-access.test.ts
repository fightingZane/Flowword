import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ session: {} as Record<string, any>, enabled: true, permitted: false }));
vi.mock('wxt/browser', () => ({ browser: {
  runtime: { getURL: (path: string) => `chrome-extension://fixture${path}` },
  storage: { local: { get: async () => ({ 'flowword.enabled.v1': state.enabled }) }, session: {
    get: async (key: string | null) => key === null ? { ...state.session } : { [key]: state.session[key] },
    set: async (values: object) => { Object.assign(state.session, values); },
    remove: async (key: string | string[]) => { for (const value of Array.isArray(key) ? key : [key]) delete state.session[value]; },
  } }, permissions: { contains: async () => state.permitted },
} }));
import { clearSettingsGrants, handleSettingsAccess, isSettingsFrameGranted } from '../src/services/settings-access';
const content = { tab: { id: 3 }, frameId: 0, url: 'https://www.youtube.com/watch?v=fixture' };
const frame = { tab: { id: 3 }, frameId: 2, url: 'chrome-extension://fixture/settings.html?embedded=1' };
beforeEach(() => { state.session = {}; state.enabled = true; state.permitted = false; });
describe('模型设置嵌入授权', () => {
  it('未开启站点和无token的设置框均不能取得授权', async () => {
    expect(await handleSettingsAccess({ type: 'FLOWWORD_SETTINGS_EMBED_CREATE' }, { ...content, url: 'https://ungranted.test/' })).toMatchObject({ ok: false });
    expect(await handleSettingsAccess({ type: 'FLOWWORD_SETTINGS_EMBED_CHECK' }, frame)).toMatchObject({ ok: false });
    state.enabled = false;
    expect(await handleSettingsAccess({ type: 'FLOWWORD_SETTINGS_EMBED_CREATE' }, content)).toMatchObject({ ok: false });
  });
  it('token绑定当前标签与首次设置框，其他标签或框不能复用', async () => {
    const issued = await handleSettingsAccess({ type: 'FLOWWORD_SETTINGS_EMBED_CREATE' }, content) as { token: string };
    expect(await isSettingsFrameGranted(frame)).toBe(false);
    expect(await handleSettingsAccess({ type: 'FLOWWORD_SETTINGS_EMBED_CHECK', token: issued.token }, { ...frame, tab: { id: 4 } })).toMatchObject({ ok: false });
    expect(await handleSettingsAccess({ type: 'FLOWWORD_SETTINGS_EMBED_CHECK', token: issued.token }, frame)).toMatchObject({ ok: true });
    expect(await isSettingsFrameGranted(frame)).toBe(true);
    expect(await handleSettingsAccess({ type: 'FLOWWORD_SETTINGS_EMBED_CHECK', token: issued.token }, { ...frame, frameId: 8 })).toMatchObject({ ok: false });
    await handleSettingsAccess({ type: 'FLOWWORD_SETTINGS_EMBED_REVOKE', token: issued.token }, content);
    expect(await isSettingsFrameGranted(frame)).toBe(false);
  });
  it('清除关闭标签的记录，不影响其他会话', async () => {
    await handleSettingsAccess({ type: 'FLOWWORD_SETTINGS_EMBED_CREATE' }, content);
    await handleSettingsAccess({ type: 'FLOWWORD_SETTINGS_EMBED_CREATE' }, { ...content, tab: { id: 4 } });
    await clearSettingsGrants(3);
    expect(Object.values(state.session)).toHaveLength(1);
    expect(Object.values(state.session)[0].tabId).toBe(4);
  });
});
