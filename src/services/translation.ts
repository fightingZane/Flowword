export const TRANSLATION_ORIGIN = 'https://api.mymemory.translated.net';

export function translationText(payload: unknown, original: string): string {
  const data = payload as { responseStatus?: number | string; responseData?: { translatedText?: string }; responseDetails?: string; quotaFinished?: boolean };
  if (!data || Number(data.responseStatus) !== 200 || data.quotaFinished) throw new Error(data?.responseDetails || '翻译服务暂不可用或额度已用完');
  const text = data.responseData?.translatedText;
  if (typeof text !== 'string' || !text.trim() || text.length > 6000) throw new Error('翻译服务没有返回有效译文');
  const entities: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
  const decoded = text.replace(/&(?:#(?:x[0-9a-f]+|\d+)|amp|quot|apos|lt|gt);/gi, (entity) => {
    if (entities[entity.toLowerCase()]) return entities[entity.toLowerCase()]!;
    const hexadecimal = entity[2]?.toLowerCase() === 'x';
    const number = parseInt(entity.slice(hexadecimal ? 3 : 2, -1), hexadecimal ? 16 : 10);
    return number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : entity;
  }).trim();
  if (decoded.toLowerCase() === original.trim().toLowerCase()) throw new Error('服务仅返回原文，暂没有可用中文翻译');
  return decoded;   // 仅输出文本，不将服务返回的 HTML 注入界面
}

export function validTranslationInput(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && new TextEncoder().encode(value).length <= 480;
}

export function splitTranslation(text: string): string[] {
  if (typeof text !== 'string' || !text.trim() || text.length > 6000) throw new Error('翻译文本无效或过长');
  const chunks: string[] = [];
  let current = '';
  for (const word of text.trim().split(/\s+/)) {
    if (!validTranslationInput(word)) throw new Error('字幕中有过长的连续文本，请选择较短片段');
    const joined = current ? `${current} ${word}` : word;
    if (!validTranslationInput(joined)) { chunks.push(current); current = word; }
    else current = joined;
  }
  if (current) chunks.push(current);
  if (chunks.length > 6) throw new Error('字幕过长，最多分成六段，请选择较短片段');
  return chunks;   // 保留每个已捕获词语，只按空白分段，不截断或补造原句
}

export async function requestTranslation(text: string, fetcher: typeof fetch = fetch): Promise<string> {
  if (!validTranslationInput(text)) throw new Error('这段字幕过长，请选择较短片段后翻译');
  const url = new URL('/get', TRANSLATION_ORIGIN);
  url.searchParams.set('q', text);
  url.searchParams.set('langpair', 'en|zh-CN');
  const response = await fetcher(url, { signal: AbortSignal.timeout(10000), credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error(`翻译服务暂不可用（HTTP ${response.status}）`);
  return translationText(await response.json(), text);
}
