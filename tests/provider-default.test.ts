import { describe, expect, it } from 'vitest';
import { DEFAULT_PROVIDER, validateProvider } from '../src/storage/provider';
describe('默认服务预填不自动启用', () => {
  it('新安装预填DeepSeek但保持关闭无密钥无预译', () => {
    expect(DEFAULT_PROVIDER).toMatchObject({ endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash', mode: 'off', apiKey: '', prefetch: false, prefetchExpressions: false });
  });
  it('已保存自定义服务仍按原选择校验，不强制改为DeepSeek', () => {
    const existing = { ...DEFAULT_PROVIDER, mode: 'cloud' as const, endpoint: 'https://existing.example/v1/chat/completions', model: 'existing-model', apiKey: 'synthetic-test-key', prefetch: true };
    expect(validateProvider(existing)).toMatchObject(existing);
  });
});
