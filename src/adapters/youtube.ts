import { SubtitleCache } from '../core/subtitle-cache';
import { normalizeText } from '../core/sentence';
import type { SentenceContext, SubtitlePort, SubtitleSegment, SubtitleSnapshot, VideoHandle, VideoPort } from '../core/types';

// 平台选择器集中在一个文件中，YouTube 改版时只修改适配器
export const YOUTUBE = {
  player: '#movie_player',
  video: '#movie_player video.html5-main-video',
  captions: '.ytp-caption-window-container .ytp-caption-segment',
  advertisement: '.ad-showing, .ad-interrupting',
};

export function videoKey(url = location.href): string | null {
  const parsed = new URL(url);
  const id = parsed.searchParams.get('v');
  return parsed.hostname === 'www.youtube.com' && parsed.pathname === '/watch' && id
    ? id : null;   // 首版只在标准视频页启用，首页和 Shorts 不采样
}

export class YouTubeVideoController implements VideoPort {
  current(): HTMLVideoElement | null {
    return document.querySelector<HTMLVideoElement>(YOUTUBE.video);
  }

  capture(): VideoHandle {
    const player = document.querySelector(YOUTUBE.player);
    const video = this.current();
    const key = videoKey();
    if (!key || !video || !video.isConnected) throw new Error('没有找到当前 YouTube 视频，请打开标准视频页面');
    if (player?.matches(YOUTUBE.advertisement)) throw new Error('广告播放期间暂不捕获字幕，请在正片开始后重试');
    if (video.duration === Infinity || player?.classList.contains('ytp-live')) throw new Error('第一版暂不支持直播，请使用普通英文视频');
    if (video.ended) throw new Error('视频已结束，请回到需要理解的位置');
    const source = video.currentSrc;
    const time = video.currentTime;
    return {
      key,
      time,
      paused: video.paused,
      pause: () => video.pause(),
      play: () => video.play(),
      isCurrent: () => video.isConnected && this.current() === video && videoKey() === key
        && video.currentSrc === source && Math.abs(video.currentTime - time) < 1,
    };   // 元素、视频编号、媒体源和时间同时匹配才允许恢复播放
  }
}

function englishTrack(video: HTMLVideoElement): TextTrack | undefined {
  const english = Array.from(video.textTracks).filter((track) =>
    ['subtitles', 'captions'].includes(track.kind) && /^en(?:-|$)/i.test(track.language));
  const showing = english.filter((track) => track.mode === 'showing');
  const hidden = english.filter((track) => track.mode === 'hidden');
  return showing.length === 1 ? showing[0] : showing.length === 0 && hidden.length === 1 ? hidden[0] : undefined;
}

function cueSegments(selected: TextTrack | undefined, activeOnly = false): SubtitleSegment[] {
  const segments: SubtitleSegment[] = [];
  if (!selected) return segments;
  for (const track of [selected]) {
    for (const cue of Array.from((activeOnly ? track.activeCues : track.cues) ?? [])) {
      if (!('text' in cue)) continue;
      const vtt = cue as VTTCue;
      const text = normalizeText(typeof vtt.getCueAsHTML === 'function'
        ? vtt.getCueAsHTML().textContent ?? '' : String(cue.text).replace(/<[^>]*>/g, ''));
      if (text) segments.push({ text, start: cue.startTime, end: cue.endTime, source: 'text-track', language: 'en' });
    }
  }
  return segments.sort((a, b) => a.start - b.start);
}

// readVisibleYouTubeCaption 读取当前可见字幕文本，无参数，仅观察真实 DOM，不返回缓存或补造下一句
export function readVisibleYouTubeCaption(): string {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(YOUTUBE.captions));
  return normalizeText(nodes.filter((node) => node.getClientRects().length > 0).map((node) => node.textContent).join(' '));
}

function readableLatin(text: string): boolean {
  const latin = (text.match(/[a-z]/gi) ?? []).length;
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  return latin >= 2 && latin / Math.max(1, letters) > 0.85;
}

export class YouTubeSubtitleAdapter implements SubtitlePort {
  readonly cache = new SubtitleCache();
  private key: string | null = null;
  private video: HTMLVideoElement | null = null;
  private source: TextTrack | 'youtube-dom' | null = null;

  constructor(private readonly videos: YouTubeVideoController) {}

  reset(): void {
    this.key = null;
    this.video = null;
    this.source = null;
    this.cache.clear();
  }

  sample(): void {
    const video = this.videos.current();
    const key = videoKey();
    if (!video || !key || document.querySelector(YOUTUBE.player)?.matches(YOUTUBE.advertisement)) {
      this.reset();
      return;
    }
    if (key !== this.key || video !== this.video) this.cache.clear();
    this.key = key;
    this.video = video;
    const time = video.currentTime;
    const track = englishTrack(video);
    const source = track ?? 'youtube-dom';
    if (source !== this.source) this.cache.clear();   // 切换或关闭字幕轨道后不沿用旧来源
    this.source = source;
    const cue = cueSegments(track, true).findLast((segment) => segment.start <= time && segment.end >= time);
    const text = track ? '' : readVisibleYouTubeCaption();
    this.cache.observe(cue ? { ...cue, end: Math.min(cue.end, time) } : readableLatin(text)
      ? { text, start: time, end: time, source: 'youtube-dom', language: 'und' } : null, time);
    // 缓存只记录已经观测的区间，不把轨道中的未来结束时间当成可回退字幕
    // 同一轨道的正常字幕间隙保持来源身份，让短时边界回退仍可用
  }

  capture(handle: VideoHandle, offset: number): SubtitleSnapshot {
    this.sample();   // 点击时额外采样，降低定时采样落在字幕边界的误差
    const video = this.videos.current();
    if (!video || handle.key !== videoKey()) throw new Error('视频已经切换，请重新捕获');
    const capturedTime = video.currentTime;
    const targetTime = Math.max(0, capturedTime + offset);   // 以实际暂停后的时间命中当前采样，避免微小时间差回退到旧字幕
    const cues = cueSegments(englishTrack(video));
    const selected = cues.findLast((segment) => segment.start <= targetTime && segment.end >= targetTime)
      ?? this.cache.select(targetTime);
    if (!selected) {
      throw new Error(offset
        ? '这个时间附近没有缓存字幕，请调回 0 秒或继续播放后再试'
        : '没有读到英文字幕，请在播放器中开启 CC，并选择 English 字幕');
    }
    return this.snapshot(selected, capturedTime, targetTime, offset, cues);
  }

  previous(context: SentenceContext): SubtitleSnapshot {
    this.sample();   // 立即确认字幕来源，避免轨道刚切换时沿用旧缓存
    const video = this.videos.current();
    if (!video || context.videoKey !== videoKey()) throw new Error('视频已经切换，请重新捕获');
    const cues = cueSegments(englishTrack(video));
    const selected = cues.findLast((segment) => segment.end <= context.selected.start + 0.01 && segment.start < context.selected.start - 0.12)
      ?? this.cache.previous(context.selected.start);
    if (!selected) throw new Error('还没有上一条字幕缓存，先播放几秒再试');
    return this.snapshot(selected, context.capturedTime, selected.start, selected.start - context.capturedTime, cues);
  }

  private snapshot(selected: SubtitleSegment, capturedTime: number, targetTime: number, offset: number, cues: SubtitleSegment[]): SubtitleSnapshot {
    return {
      selected: { ...selected },
      segments: selected.source === 'text-track' ? cues.filter((cue) => cue.start <= targetTime) : this.cache.all(),
      capturedTime,
      targetTime,
      offset,
      videoKey: videoKey()!,
      title: document.querySelector('h1.ytd-watch-metadata')?.textContent?.trim() || document.title.replace(/ - YouTube$/, ''),
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoKey()!)}`,
    };
  }
}
