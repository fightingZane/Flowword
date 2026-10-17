export interface SourceReplayRequest { url: string; time: number; end?: number; videoKey?: string; sentence: string }

export interface WebReadingSource { url: string; sentence: string; source: { kind: 'web'; quote?: { exact: string; prefix?: string; suffix?: string } } }

// normalizeWebSource校验value网页收藏，保留原句定位，不允许把网页转换为视频时间
// 仅接受HTTP来源和有界文本，不执行原网页返回的指令，错误时直接拒绝打开
export function normalizeWebSource(value: unknown): WebReadingSource {
  const item = value as Partial<WebReadingSource> & { time?: unknown; end?: unknown; videoKey?: unknown };
  if (!item || item.source?.kind !== 'web' || typeof item.url !== 'string' || item.url.length > 2000 || typeof item.sentence !== 'string' || !item.sentence.trim() || item.sentence.length > 2000 || item.time !== undefined || item.end !== undefined || item.videoKey !== undefined) throw new Error('网页来源信息无效');
  const url = new URL(item.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('来源必须是有效网页地址');
  url.hash = url.hash.split(':~:')[0] ?? '';
  const quote = item.source.quote;
  if (quote && (typeof quote.exact !== 'string' || !quote.exact.trim() || quote.exact.length > 2000 || [quote.prefix, quote.suffix].some((part) => part !== undefined && (typeof part !== 'string' || part.length > 500)))) throw new Error('原文定位信息无效');
  return { url: url.href, sentence: item.sentence.trim(), source: { kind: 'web', ...(quote ? { quote: { exact: quote.exact, prefix: quote.prefix, suffix: quote.suffix } } : {}) } };
}

// webSourceLink为source生成文本片段链接，浏览器不支持时仍能正常回到网页
// 不保证网页改版后精确定位，不发送视频seek或play命令
export function webSourceLink(source: WebReadingSource): string {
  const url = new URL(source.url);
  const quote = source.source.quote;
  const exact = encodeURIComponent(quote?.exact || source.sentence).replaceAll('-', '%2D');
  const prefix = quote?.prefix ? `${encodeURIComponent(quote.prefix).replaceAll('-', '%2D')}-,` : '';
  const suffix = quote?.suffix ? `,-${encodeURIComponent(quote.suffix).replaceAll('-', '%2D')}` : '';
  url.hash = `${url.hash.slice(1).split(':~:')[0] ?? ''}:~:text=${prefix}${exact}${suffix}`;
  return url.href;
}

// normalizeReplaySource 校验value收藏来源，拒绝危险地址和无效时间，不接受来源页面指令
export function normalizeReplaySource(value: unknown): SourceReplayRequest {
  const source = value as Partial<SourceReplayRequest>;
  if (!source || typeof source.url !== 'string' || source.url.length > 2000 || !Number.isFinite(source.time) || source.time! < 0 || typeof source.sentence !== 'string' || !source.sentence.trim() || source.sentence.length > 2000) throw new Error('来源信息不完整，无法重听');
  const url = new URL(source.url);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('来源必须是有效视频网页地址');
  url.hash = '';
  return { url: url.href, time: source.time!, sentence: source.sentence.trim(), ...(typeof source.videoKey === 'string' ? { videoKey: source.videoKey.slice(0, 2000) } : {}), ...(Number.isFinite(source.end) && source.end! > source.time! ? { end: source.end } : {}) };
}

// sourceMatches 比较source收藏和当前网页/媒体键，不把其他视频误当作可操作来源
export function sourceMatches(source: SourceReplayRequest, currentUrl: string, currentKey: string | null): boolean {
  if (!currentKey) return false;
  try {
    const target = new URL(source.url); const current = new URL(currentUrl);
    if (target.origin !== current.origin) return false;
    if (target.hostname === 'www.youtube.com' && target.pathname === '/watch') return target.searchParams.get('v') === current.searchParams.get('v');
    for (const url of [target, current]) { url.hash = ''; url.searchParams.delete('t'); url.searchParams.delete('start'); }
    return target.href === current.href && (!source.videoKey || source.videoKey === currentKey);
  } catch { return false; }
}
