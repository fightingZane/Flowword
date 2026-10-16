import { SubtitleCache } from '../core/subtitle-cache';
import type { SentenceContext, SubtitlePort, SubtitleSnapshot, VideoHandle, VideoPort } from '../core/types';
import { readTrackSegments, selectEnglishTrack } from './html5-subtitles';

// visibleVideo 意为检查视频是否可见，video 是候选 HTML5 视频元素
// 主视频选择前调用，排除隐藏祖先、视口外元素和微小预览，不改变播放器状态
function visibleVideo(video: HTMLVideoElement): boolean {
  if (!video.isConnected || video.hidden) return false;
  const rect = video.getBoundingClientRect();
  if (rect.width < 80 || rect.height < 45 || rect.right <= 0 || rect.bottom <= 0
    || rect.left >= window.innerWidth || rect.top >= window.innerHeight) return false;
  for (let node: Element | null = video; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  }
  return true;
}

// selectMainVideo 意为保守选择主视频，videos 是顶层候选，fullscreen 是可选全屏容器
// 仅选择唯一可见或面积明显最大的对象，多视频不明确时返回 null，避免暂停错误的视频
export function selectMainVideo(videos: HTMLVideoElement[], fullscreen: Element | null = null): HTMLVideoElement | null {
  let visible = videos.filter(visibleVideo);
  if (fullscreen) visible = visible.filter((video) => fullscreen === video || fullscreen.contains(video));
  visible.sort((left, right) => {
    const a = left.getBoundingClientRect(); const b = right.getBoundingClientRect();
    return b.width * b.height - a.width * a.height;
  });
  if (visible.length === 1) return visible[0]!;
  if (visible.length < 2) return null;
  const a = visible[0]!.getBoundingClientRect(); const b = visible[1]!.getBoundingClientRect();
  return a.width * a.height >= b.width * b.height * 1.8 ? visible[0]! : null;
}   // 页面存在多个面积接近的视频时拒绝选择，暂停后也不会切换到其他播放对象

// sourceFingerprint 意为生成媒体来源指纹，source 是完整 currentSrc
// 只用于本地来源区分，不保存原始媒体签名，签名变化可能形成新的通用媒体记录
function sourceFingerprint(source: string): string {
  let hash = 2166136261;
  for (const char of source) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}   // 仅存源指纹，避免同一路径不同查询参数的视频被合并，签名更新可能形成新来源

// genericVideoKey 意为生成通用视频身份，video 给出媒体源，url 默认为当前页面
// 捕获与导航检测共用页面及媒体指纹，无法保证各网站 blob 或签名地址跨会话身份稳定
export function genericVideoKey(video: HTMLVideoElement, url = location.href): string {
  const page = new URL(url);
  page.username = ''; page.password = '';
  return `html5:${page.href}|${sourceFingerprint(video.currentSrc || video.getAttribute('src') || '')}`;
}

export class GenericVideoController implements VideoPort {
  // current 意为取得当前主视频，无参数，供播放器操作与字幕采样共用
  // 只扫描顶层普通 DOM，闭合 Shadow DOM 和 iframe 需要后续站点专用适配
  current(): HTMLVideoElement | null {
    return selectMainVideo(Array.from(document.querySelectorAll<HTMLVideoElement>('video')), document.fullscreenElement);
  }

  // key 意为读取当前视频标识，无参数，供悬浮球挂载与页面切换检测使用
  // 没有明确主视频时返回 null，不使用旧对象身份继续操作
  key(): string | null { const video = this.current(); return video ? genericVideoKey(video) : null; }

  // capture 意为建立当前视频句柄，无参数，点击捕获或重听时调用
  // 验证有限时间轴后才交给控制器暂停，恢复前再次核验来源和位置
  capture(): VideoHandle {
    const video = this.current();
    if (!video) throw new Error('没有找到唯一可见的主视频，多视频页面请先让主播放器进入容器全屏');
    if (video.duration === Infinity) throw new Error('暂不支持直播字幕，请使用有时间轴的普通视频');
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error('视频还未加载完成，请播放几秒后重试');
    if (video.ended) throw new Error('视频已结束，请回到需要理解的位置');
    const key = genericVideoKey(video); const time = video.currentTime;
    const source = video.currentSrc; const url = location.href;
    return { key, time, paused: video.paused, pause: () => video.pause(), play: () => video.play(),
      isCurrent: () => video.isConnected && this.current() === video && location.href === url
        && video.currentSrc === source && genericVideoKey(video) === key && Math.abs(video.currentTime - time) < 1 };
  }   // 恢复播放仍需同一元素、页面、媒体源和暂停时间，避免旧页面操作新视频
}

// pageVideoThumbnail 读取video已有封面或当前页封面元数据，不额外请求页面或浏览历史
// 只接受可公开加载的HTTP图片地址，缺失时由词本使用本地占位
function pageVideoThumbnail(video: HTMLVideoElement): string | undefined {
  const candidate = video.poster || document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content;
  if (!candidate) return;
  try { const url = new URL(candidate, location.href); if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return url.href; } catch { return; }
}

export class GenericSubtitleAdapter implements SubtitlePort {
  readonly cache = new SubtitleCache();
  private video: HTMLVideoElement | null = null;
  private key: string | null = null;
  private track: TextTrack | undefined;

  // constructor 构造字幕适配器，videos 提供统一主视频选择
  // 与同一个 GenericVideoController 配对使用，避免字幕和暂停对象不一致
  constructor(private readonly videos: GenericVideoController) {}

  // reset 意为清除字幕身份与短时样本，无参数，导航、换源和关闭插件时调用
  // 只释放本地字幕状态，不改变任何视频的播放或暂停状态
  reset(): void { this.video = null; this.key = null; this.track = undefined; this.cache.clear(); }

  // sample 意为采样当前英文 cue，无参数，启用插件后周期调用
  // 观测结束只延长到当前媒体时间，切换轨道或页面立即清空旧来源
  sample(): void {
    const video = this.videos.current();
    if (!video) { this.reset(); return; }
    const key = genericVideoKey(video); const track = selectEnglishTrack(video);
    if (video !== this.video || key !== this.key || track !== this.track) this.cache.clear();
    this.video = video; this.key = key; this.track = track;
    const time = video.currentTime;
    const cue = readTrackSegments(track, 'generic-track', true).findLast((item) => item.start <= time && item.end >= time);
    this.cache.observe(cue ? { ...cue, end: Math.min(cue.end, time) } : null, time);
  }   // 关闭或切换字幕立即清除旧来源，只缓存已经观测的时段

  // capture 意为读取指定时刻字幕，handle 提供暂停时刻，offset 是用户选择的秒偏移
  // 点击后调用，仅精确命中或短时回退过去字幕，无轨道时返回可理解的能力提示
  capture(handle: VideoHandle, offset: number): SubtitleSnapshot {
    this.sample();
    const video = this.videos.current();
    if (!video || handle.key !== genericVideoKey(video)) throw new Error('视频已经切换，请重新捕获');
    const targetTime = Math.max(0, handle.time + offset);
    const segments = readTrackSegments(selectEnglishTrack(video));
    const selected = segments.findLast((item) => item.start <= targetTime && item.end >= targetTime) ?? this.cache.select(targetTime);
    if (!selected) throw new Error('这个网站没有可读取的英文字幕轨道，请启用 English 字幕；页面自绘字幕需专用网站适配');
    return { selected: { ...selected }, segments, capturedTime: handle.time, targetTime, offset, videoKey: handle.key,
      title: document.title, url: location.href, thumbnail: pageVideoThumbnail(video) };
  }

  // previous 意为取得上一条字幕，context 给出当前原句及视频身份
  // 面板上一条按钮调用，先确认来源再读取，不能把新轨道与旧缓存混用
  previous(context: SentenceContext): SubtitleSnapshot {
    this.sample();
    const video = this.videos.current();
    if (!video || context.videoKey !== genericVideoKey(video)) throw new Error('视频已经切换，请重新捕获');
    const segments = readTrackSegments(selectEnglishTrack(video));
    const selected = segments.findLast((item) => item.end <= context.selected.start + 0.01 && item.start < context.selected.start - 0.12)
      ?? this.cache.previous(context.selected.start);
    if (!selected) throw new Error('没有可读取的上一条字幕，请先播放几秒');
    return { ...context, selected: { ...selected }, segments, targetTime: selected.start, offset: selected.start - context.capturedTime };
  }
}
