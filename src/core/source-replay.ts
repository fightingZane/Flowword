export interface SourceReplayRequest { url: string; time: number; end?: number; videoKey?: string; sentence: string }

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
