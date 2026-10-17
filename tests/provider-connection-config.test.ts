import { describe, expect, it } from 'vitest';
import { checkCliStatus, cloudPreset, matchingEndpoint, parseCliConnection } from '../entrypoints/settings/connection-config';
import { CODEX_BRIDGE_ENDPOINT, DEFAULT_PROVIDER } from '../src/storage/provider';

const token = 'a'.repeat(64);
describe('本机连接文件与云端预设', () => {
  it('仅接受固定本机地址，忽略额外字段而不把内容带回界面', () => expect(parseCliConnection(JSON.stringify({ endpoint: CODEX_BRIDGE_ENDPOINT + '/', token, ignored: 'data' }))).toEqual({ endpoint: CODEX_BRIDGE_ENDPOINT, token }));
  it('拒绝远程主机、其他端口、URL参数和无效令牌', () => {
    for (const endpoint of ['https://example.com', 'http://localhost:17863', 'http://127.0.0.1:17864', CODEX_BRIDGE_ENDPOINT + '/?token=secret']) expect(() => parseCliConnection(JSON.stringify({ endpoint, token }))).toThrow();
    expect(() => parseCliConnection(JSON.stringify({ endpoint: CODEX_BRIDGE_ENDPOINT, token: 'short' }))).toThrow();
  });
  it('错误文件不回显其原始内容', () => { try { parseCliConnection('secret-invalid-json'); } catch (error) { expect(String(error)).not.toContain('secret-invalid-json'); } });
  it('预设只包含公开字段，Responses与Chat路径区分', () => {
    expect(cloudPreset('openai', 'responses')).toEqual({ endpoint: 'https://api.openai.com/v1/responses', model: '', protocol: 'responses' });
    expect(cloudPreset('deepseek', 'responses')).toEqual({ endpoint: DEFAULT_PROVIDER.endpoint, model: DEFAULT_PROVIDER.model, protocol: 'chat-completions' });
    expect(matchingEndpoint('https://example.com/a', 'https://example.com/b')).toBe(false);
  });
  it('状态检查只请求status且必须确认ChatGPT登录', async () => {
    const calls: string[] = [];
    const config = { ...DEFAULT_PROVIDER, mode: 'codex-cli' as const, endpoint: CODEX_BRIDGE_ENDPOINT, apiKey: token };
    await checkCliStatus(config, (async (url, init) => { calls.push(String(url)); expect(init?.method).toBe('GET'); expect(init?.redirect).toBe('error'); return new Response(JSON.stringify({ ok: true, auth: 'chatgpt' })); }) as typeof fetch);
    expect(calls).toEqual([CODEX_BRIDGE_ENDPOINT + '/status']);
    await expect(checkCliStatus(config, (async () => new Response(JSON.stringify({ ok: true, auth: 'api-key' }))))).rejects.toThrow('ChatGPT');
  });
});
