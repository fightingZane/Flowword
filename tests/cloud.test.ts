import { describe, expect, it, vi } from 'vitest';
import { parseCloudOutput, requestCloud } from '../src/services/cloud';
import { validateProvider, DEFAULT_PROVIDER } from '../src/storage/provider';
const envelope = (value: unknown) => ({ choices: [{ message: { content: JSON.stringify(value) } }] });
describe('云端语境结果与密钥边界', () => {
  it('数字错误不是中文翻译', () => expect(() => parseCloudOutput(envelope({ translation: '838,222' }), 'standard', 'translate')).toThrow());
  it('整句译文独立于表达结果', () => expect(parseCloudOutput(envelope({ translation: '这是长焦镜头' }), 'a telephoto lens', 'translate')).toEqual({ translation: '这是长焦镜头' }));
  it('拒绝空结构，并且不从单词内部截取假表达', () => {
    expect(() => parseCloudOutput(envelope(null), 'Hello', 'translate')).toThrow();
    expect(parseCloudOutput(envelope({ expressions: [{ text: 'stand', meaning: '站立' }] }), 'I understand.', 'context').expressions).toEqual([]);
  });
  it('筛除原句不存在的表达，保留真实跨度并去重', () => {
    const expressions = [{ text: 'telephoto lens', meaning: '长焦镜头，用于远距离拍摄', kind: 'phrase', partOfSpeech: '名词短语', reason: '摄影专业词' }, { text: 'foo', meaning: '虚构词' }, { text: 'TELEPHOTO LENS', meaning: '重复' }];
    expect(parseCloudOutput(envelope({ expressions }), 'a telephoto lens', 'context').expressions).toHaveLength(1);
  });
  it('拒绝HTML和损坏格式', () => {
    expect(() => parseCloudOutput(envelope({ translation: '<b>中文</b>' }), 'Hello', 'translate')).toThrow();
    expect(() => parseCloudOutput({ choices: [{ message: { content: 'not json' } }] }, 'Hello', 'translate')).toThrow();
  });
  it('接口不允许HTTP或URL嵌入密钥', () => {
    expect(() => validateProvider({ ...DEFAULT_PROVIDER, endpoint: 'http://local/v1' })).toThrow();
    expect(() => validateProvider({ ...DEFAULT_PROVIDER, endpoint: 'https://site/v1?key=secret' })).toThrow();
    expect(() => validateProvider({ ...DEFAULT_PROVIDER, mode: 'cloud' })).toThrow();
  });
  it('仅在Authorization带密钥，不发视频网址且不跟随重定向', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => envelope({ translation: '你好' }) });
    await requestCloud({ ...DEFAULT_PROVIDER, mode: 'cloud', model: 'test-model', apiKey: 'local-test-only' }, 'Hello', ['previous sentence'], 'translate', fetcher);
    const init = fetcher.mock.calls[0]![1];
    expect(init.headers.Authorization).toBe('Bearer local-test-only');
    expect(init.body).not.toContain('local-test-only');
    expect(init.redirect).toBe('error'); expect(init.credentials).toBe('omit');
  });
  it('服务错误内容不能泄露到界面', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'secret-key' });
    await expect(requestCloud({ ...DEFAULT_PROVIDER, mode: 'cloud', model: 'model', apiKey: 'secret-key' }, 'Hello', [], 'translate', fetcher)).rejects.toThrow('HTTP 401');
  });
});
