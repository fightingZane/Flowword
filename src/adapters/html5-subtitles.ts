import { assembleSentence, normalizeText } from '../core/sentence';
import type { SentenceContext, SubtitleSegment, SubtitleSnapshot } from '../core/types';

// selectEnglishTrack 意为选择英文轨道，仅返回用户已启用的唯一 captions 或 subtitles
// video 是当前主视频，捕获与采样前调用，多轨道同等优先时返回 undefined 而不猜测
export function selectEnglishTrack(video: HTMLVideoElement): TextTrack | undefined {
  const tracks = Array.from(video.textTracks).filter((track) =>
    ['captions', 'subtitles'].includes(track.kind) && /^en(?:-|$)/i.test(track.language));
  const showing = tracks.filter((track) => track.mode === 'showing');
  const hidden = tracks.filter((track) => track.mode === 'hidden');
  return showing.length === 1 ? showing[0] : showing.length === 0 && hidden.length === 1 ? hidden[0] : undefined;
}   // 排除 metadata 和未启用轨道，有多个同等轨道时不猜测用户选择

// readTrackSegments 意为读取轨道片段，track 指定真实轨道，source 标记平台来源
// activeOnly 为 true 时只读当前激活 cue，捕获时可读已加载轨道，HTML 始终转成纯文本
export function readTrackSegments(track: TextTrack | undefined, source: 'generic-track' | 'text-track' = 'generic-track', activeOnly = false): SubtitleSegment[] {
  if (!track) return [];
  const segments: SubtitleSegment[] = [];
  for (const cue of Array.from((activeOnly ? track.activeCues : track.cues) ?? [])) {
    if (!('text' in cue) || !Number.isFinite(cue.startTime) || !Number.isFinite(cue.endTime)
      || cue.startTime < 0 || cue.endTime < cue.startTime) continue;
    const vtt = cue as VTTCue;
    const text = normalizeText(typeof vtt.getCueAsHTML === 'function'
      ? vtt.getCueAsHTML().textContent ?? '' : String(cue.text).replace(/<[^>]*>/g, ''));
    if (text) segments.push({ text, start: cue.startTime, end: cue.endTime, source, language: 'en' });
  }
  return segments.sort((left, right) => left.start - right.start);
}   // 只提取原生字幕文本，不把网页提供的 HTML 插入任何 DOM

export interface TimelineItem { text: string; start: number; end: number; translation?: string }
export interface PrefetchItem { sentence: string; context: string[] }

// sentenceStart 意为计算已捕获原句的开始时间，snapshot 提供选中 cue 与邻近实际片段
// 重听和收藏时与 assembleSentence 使用同一拼接规则，不跨越句末或较长字幕间隙
function sentenceStart(snapshot: SubtitleSnapshot): number {
  let start = snapshot.selected.start;
  const past = snapshot.segments.filter((segment) => segment.start < start - 0.05 && segment.end <= snapshot.targetTime + 0.2)
    .sort((left, right) => right.start - left.start);
  for (const segment of past.slice(0, 2)) {
    if (start - segment.end > 0.55 || snapshot.selected.start - segment.start > 8 || /[.!?]["'”’)]?$/.test(segment.text)) break;
    start = segment.start;
  }
  return start;
}   // 时间范围与现有原句拼接规则保持一致，只包含实际参与当前句的片段

// observedSentenceRange 意为取得原句真实时间范围，snapshot 是当前捕获快照
// 供重听和视频溯源共用，DOM 的 end 只是已观测终点，不能当成完整字幕结束时刻
export function observedSentenceRange(snapshot: SubtitleSnapshot): { start: number; end: number } {
  return { start: sentenceStart(snapshot), end: snapshot.selected.end };
}

// latestObservedRange 意为更新仍在显示的 DOM 片段终点，observed 是短时缓存的实际样本
// snapshot 保留当前原句，只有来源与开始时间及原文全部匹配才延长，重听前采样后使用
export function latestObservedRange(snapshot: SubtitleSnapshot, observed: SubtitleSegment[]): { start: number; end: number } {
  const range = observedSentenceRange(snapshot);
  if (snapshot.selected.source !== 'youtube-dom') return range;
  const latest = observed.findLast((item) => item.source === snapshot.selected.source && item.start === snapshot.selected.start
    && item.text === snapshot.selected.text && Number.isFinite(item.end) && item.end >= range.end);
  return latest ? { ...range, end: latest.end } : range;
}

// contextAt 意为按指定字幕建立原句，snapshot 提供真实邻句，selected 是目标字幕
// 用于邻句展示及预译，不创建新的字幕内容，DOM 未观测的未来字幕仍不存在
function contextAt(snapshot: SubtitleSnapshot, selected: SubtitleSegment): SentenceContext {
  return assembleSentence({ ...snapshot, selected, targetTime: selected.start });
}

// subtitleTimeline 意为构建上句当前句下句时间线，snapshot 提供字幕，current 可复用已整理原句
// 学习面板与预译共用，已经参与当前句的过去片段不再重复作为上句展示
export function subtitleTimeline(snapshot: SubtitleSnapshot, current = assembleSentence(snapshot)): TimelineItem[] {
  const { start, end } = observedSentenceRange(snapshot);
  const sorted = snapshot.segments.slice().sort((left, right) => left.start - right.start);
  const previous = sorted.findLast((segment) => segment.end <= start + 0.01 && segment.start < start - 0.05);
  const next = sorted.find((segment) => segment.start > snapshot.selected.start + 0.05 && segment.start >= end - 0.05);
  const items: TimelineItem[] = [];
  if (previous) items.push({ text: contextAt(snapshot, previous).text, ...observedSentenceRange({ ...snapshot, selected: previous, targetTime: previous.start }) });
  items.push({ text: current.text, start, end });
  if (next) items.push({ text: contextAt(snapshot, next).text, ...observedSentenceRange({ ...snapshot, selected: next, targetTime: next.start }) });
  return items;
}   // 原生轨道可以提供已加载的下句，页面 DOM 只能提供已观测到的片段

// prefetchItems 意为创建下一条字幕的预译请求，snapshot 只能包含实际加载或观测的字幕
// 调用方另加当前句并限制总数，只对真实轨道提供未来最多两条，DOM 返回空列表
export function prefetchItems(snapshot: SubtitleSnapshot): PrefetchItem[] {
  if (snapshot.selected.source === 'youtube-dom') return [];
  const next = snapshot.segments.filter((segment) => segment.start > snapshot.selected.start + 0.05)
    .sort((left, right) => left.start - right.start).slice(0, 2);
  return next.map((selected) => {
    const future = { ...snapshot, selected, targetTime: selected.start };
    const sentence = assembleSentence(future).text;
    return { sentence, context: subtitleTimeline(future).filter((item) => item.text !== sentence).slice(0, 2).map((item) => item.text) };
  });
}   // 每个预译请求使用该句自己的稳定邻句，避免缓存因上下文不同而失配

// createDomReplayBoundary 创建实时字幕结束探测器，snapshot 是被重听原句，两个读取函数仅观察当前 DOM 和媒体时间
// 先进入目标字幕再等待消失或切换，滚动累加保留为同片段，不能据此保证自动字幕的完整语义句末
export function createDomReplayBoundary(snapshot: SubtitleSnapshot, readCaption: () => string, readTime: () => number): () => boolean {
  const target = normalizeText(snapshot.selected.text);
  // words 提取text连续词形供回放覆盖比对，保留词序，不按任意子串判断已经听完目标
  const words = (text: string): string[] => text.toLowerCase().match(/[a-z0-9]+(?:['’-][a-z0-9]+)*/g) ?? [];
  const targetWords = words(target);
  let covered = 0; let lastObserved = ''; let entered = false; let previous = target; let emptyAt: number | undefined;
  return () => {
    const time = readTime(); if (time < snapshot.selected.start - 0.1) return false;
    const current = normalizeText(readCaption());
    if (!entered) {
      if (!current || current === lastObserved) return false;
      lastObserved = current;
      const currentWords = words(current);
      if (current === target || current.includes(target)) covered = targetWords.length;
      else {
        const start = currentWords.indexOf(targetWords[covered] ?? '');
        if (start >= 0) for (let index = start; index < currentWords.length && currentWords[index] === targetWords[covered]; index++) covered++;
      }
      if (targetWords.length && covered >= targetWords.length) { entered = true; previous = current; }
      return false;
    }
    if (!current) { emptyAt ??= time; return time - emptyAt >= 0.12; }
    emptyAt = undefined;
    if (current === previous) return false;
    if (/[.!?]["'”’)]?$/.test(previous)) return true;
    const oldWords = words(previous); const newWords = words(current);
    const overlap = Array.from({ length: Math.min(oldWords.length, newWords.length) }, (_, index) => index + 1).some((count) => oldWords.slice(-count).every((word, index) => word === newWords[index]));
    const rolling = current.includes(previous) || previous.includes(current) || overlap;
    if (rolling) { previous = current; return false; }
    return true;
  };
}
