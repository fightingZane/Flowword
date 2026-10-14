import { describe, expect, it, vi } from 'vitest';
import { requestTranslation, splitTranslation, translationText, validTranslationInput } from '../src/services/translation';

describe('真实翻译适配器的协议边界', () => {
  it('服务成功结果只保留纯文本内容', () => expect(translationText({ responseStatus: 200, responseData: { translatedText: '&quot;中文&#x4e2d;&#25991;&quot;' } }, 'English')).toBe('"中文中文"'));
  it('额度耗尽不能假装有译文', () => expect(() => translationText({ responseStatus: 200, quotaFinished: true, responseData: { translatedText: 'LIMIT REACHED' } }, 'English')).toThrow());
  it('HTTP层成功但服务报错也不能显示错误字符串为译文', () => expect(() => translationText({ responseStatus: 429, responseData: { translatedText: 'RATE LIMIT' } }, 'English')).toThrow());
  it('服务回显英文原句视为没有中文译文', () => expect(() => translationText({ responseStatus: 200, responseData: { translatedText: 'Hello' } }, 'hello')).toThrow());
  it('数字垃圾与HTML不是中文释义', () => {
    for (const translatedText of ['838,222', '<b>中文</b>', 'unrelated English']) expect(() => translationText({ responseStatus: 200, responseData: { translatedText } }, 'standard')).toThrow();
  });
  it('UTF-8按字节限制，不能用字符长度冒充字节长度', () => {
    expect(validTranslationInput('a'.repeat(480))).toBe(true);
    expect(validTranslationInput('中'.repeat(161))).toBe(false);
    expect(validTranslationInput('')).toBe(false);
    expect(validTranslationInput({ text: 'hello' })).toBe(false);
  });
  it('长字幕分段保留全部词语且每段符合字节限额', () => {
    const original = Array.from({ length: 150 }, (_, index) => `word${index}`).join(' ');
    const chunks = splitTranslation(original);
    expect(chunks.length).toBeGreaterThan(1); expect(chunks.join(' ')).toBe(original);
    expect(chunks.every(validTranslationInput)).toBe(true);
    expect(() => splitTranslation('word '.repeat(1000))).toThrow();
  });
  it('请求只发送文本与语种，固定域名且不带cookie或referrer', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: '你好' } }), { status: 200 }));
    expect(await requestTranslation('Hello', fetcher)).toBe('你好');
    const [url, options] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.origin).toBe('https://api.mymemory.translated.net');
    expect([...url.searchParams.keys()].sort()).toEqual(['langpair', 'q']);
    expect(options.credentials).toBe('omit'); expect(options.referrerPolicy).toBe('no-referrer');
  });
});
