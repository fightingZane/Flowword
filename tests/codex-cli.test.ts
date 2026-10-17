import { describe, expect, it, vi } from 'vitest';
import { requestCodex } from '../src/services/codex-cli';
import { CODEX_BRIDGE_ENDPOINT, DEFAULT_PROVIDER, validateProvider, type ProviderConfig } from '../src/storage/provider';
const config: ProviderConfig = { ...DEFAULT_PROVIDER, mode: 'codex-cli', endpoint: CODEX_BRIDGE_ENDPOINT, model: '', apiKey: 'a'.repeat(64), prefetch: true };

describe('本机 CLI 配置与结果边界', () => {
  it('固定回环地址，拒绝任意主机、端口、路径和弱凭据', () => {
    for (const endpoint of ['http://localhost:17863', 'http://127.0.0.1:17864', CODEX_BRIDGE_ENDPOINT + '/evil', CODEX_BRIDGE_ENDPOINT + '?key=x', 'https://external.example']) expect(() => validateProvider({ ...config, endpoint })).toThrow();
    expect(() => validateProvider({ ...config, apiKey: 'short' })).toThrow();
    expect(validateProvider(config)).toMatchObject({ prefetch: false, prefetchExpressions: false, endpoint: CODEX_BRIDGE_ENDPOINT + '/' });
  });
  it('旧云配置默认协议不变，新协议严格白名单', () => {
    expect(validateProvider({ ...DEFAULT_PROVIDER, mode: 'cloud', model: 'test', apiKey: 'test' }).protocol).toBeUndefined();
    expect(validateProvider({ ...DEFAULT_PROVIDER, protocol: 'responses' }).protocol).toBe('responses');
    expect(() => validateProvider({ ...DEFAULT_PROVIDER, protocol: 'arbitrary' as any })).toThrow();
  });
  it('只将token放认证头，不传网址或命令，结果仍经过中文校验', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ translation: '这是均热板' }) });
    expect(await requestCodex(config, 'a vapor chamber', [], 'translate', fetcher)).toEqual({ translation: '这是均热板' });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(CODEX_BRIDGE_ENDPOINT + '/translate');
    expect(init.headers.Authorization).toBe('Bearer ' + config.apiKey);
    expect(init.body).not.toContain(config.apiKey);
    expect(JSON.parse(init.body)).not.toHaveProperty('model');
    expect(init.redirect).toBe('error'); expect(init.credentials).toBe('omit');
  });
  it('桥接原始错误不得泄漏密钥，断线提示可操作', async () => {
    const denied = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => config.apiKey });
    await expect(requestCodex(config, 'Hello', [], 'translate', denied)).rejects.toThrow('重新导入');
    const disconnected = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(requestCodex(config, 'Hello', [], 'translate', disconnected)).rejects.toThrow('npm run bridge');
  });
  it('取消向底层传播，不能退到其他计费服务', async () => {
    const owner = new AbortController();
    const fetcher = vi.fn().mockImplementation((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    const pending = requestCodex(config, 'Hello', [], 'translate', fetcher, owner.signal);
    owner.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
