import { describe, expect, it, vi } from 'vitest';
import { requestCloud } from '../src/services/cloud';
import { responsesOutputText } from '../src/services/responses-adapter';
import { DEFAULT_PROVIDER } from '../src/storage/provider';
const config = { ...DEFAULT_PROVIDER, mode: 'cloud' as const, endpoint: 'https://api.openai.com/v1/responses', protocol: 'responses' as const, model: 'user-configured-model', apiKey: 'synthetic-test-key' };
// envelope 创建官方Responses形状的模拟文本，value只用于本地测试，不调用任何外部模型
function envelope(value: unknown) { return { status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }; }
describe('Responses协议适配与共享校验', () => {
  it('请求使用instructions/input且禁用远程会话存储，不发送Chat专属参数', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => envelope({ translation: '这是均热板' }) });
    expect(await requestCloud(config, 'A vapor chamber.', ['A cooling review.'], 'translate', fetcher)).toEqual({ translation: '这是均热板' });
    const init = fetcher.mock.calls[0]![1]; const body = JSON.parse(init.body);
    expect(fetcher.mock.calls[0]![0]).toBe(config.endpoint); expect(body).toMatchObject({ model: config.model, store: false });
    expect(JSON.parse(body.input)).toEqual({ current: 'A vapor chamber.', nearby: ['A cooling review.'] });
    expect(body.instructions).toContain('Translate ONLY'); expect(body).not.toHaveProperty('messages'); expect(body).not.toHaveProperty('temperature'); expect(body).not.toHaveProperty('thinking'); expect(body).not.toHaveProperty('previous_response_id'); expect(JSON.stringify(body)).not.toContain(config.apiKey);
    expect(init.headers.Authorization).toBe('Bearer ' + config.apiKey); expect(init.redirect).toBe('error'); expect(init.credentials).toBe('omit');
  });
  it('语境结果复用同一中文释义与原句跨度验证', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => envelope({ expressions: [{ text: 'vapor chamber', meaning: '电子散热中的均热板', kind: 'phrase', partOfSpeech: '名词短语', reason: '专业表达' }, { text: 'imagined phrase', meaning: '不在原句' }] }) });
    const result = await requestCloud(config, 'A vapor chamber.', [], 'context', fetcher); expect(result.expressions).toHaveLength(1); expect(result.expressions?.[0]?.text).toBe('vapor chamber');
    expect(JSON.parse(fetcher.mock.calls[0]![1].body).instructions).toContain('Explain up to 5');
  });
  it('忽略reasoning和commentary，只提取assistant最终output_text', () => {
    const payload = envelope({ translation: '最终译文' });
    payload.output.unshift({ type: 'reasoning', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'not JSON reasoning' }] });
    payload.output.unshift({ type: 'message', role: 'assistant', status: 'completed', phase: 'commentary', content: [{ type: 'output_text', text: 'intermediate text' }] } as typeof payload.output[number]);
    expect(responsesOutputText(payload)).toBe(JSON.stringify({ translation: '最终译文' }));
  });
  it.each(['incomplete','failed','in_progress','cancelled'])('非完成状态%s不展示部分结果也不自动再调用', async (status) => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...envelope({ translation: '部分译文' }), status }) });
    await expect(requestCloud(config, 'Sentence.', [], 'translate', fetcher)).rejects.toThrow('未完整完成'); expect(fetcher).toHaveBeenCalledOnce();
  });
  it('拒绝结果与服务错误不回显可能含密钥的原始正文', () => {
    expect(() => responsesOutputText({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: config.apiKey }] }] })).toThrow('模型未提供可用结果');
    expect(() => responsesOutputText({ error: { message: config.apiKey } })).toThrow('未完整完成');
    expect(() => responsesOutputText({ status: 'completed', output_text: '{"translation":"不能只信SDK便利字段"}' })).toThrow('没有返回有效文本');
  });
  it('错误格式或非中文结果不能绕过原翻译校验', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => envelope({ translation: '838,222' }) });
    await expect(requestCloud(config, 'standard', [], 'translate', fetcher)).rejects.toThrow('有效中文译文');
    expect(() => responsesOutputText(null)).toThrow('结构无效');
  });
  it('外部取消信号仍传给Responses请求', async () => {
    const abort = new AbortController();
    const fetcher = vi.fn().mockImplementation((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true })));
    const request = requestCloud(config, 'Cancel sentence.', [], 'translate', fetcher, abort.signal); abort.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' }); expect(fetcher).toHaveBeenCalledOnce();
  });
});
