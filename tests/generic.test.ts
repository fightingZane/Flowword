import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GenericSubtitleAdapter, GenericVideoController, genericVideoKey, selectMainVideo } from '../src/adapters/generic';
import { latestObservedRange, observedSentenceRange, prefetchItems, readTrackSegments, selectEnglishTrack, subtitleTimeline } from '../src/adapters/html5-subtitles';
import { assembleSentence } from '../src/core/sentence';
import type { SubtitleSegment, SubtitleSnapshot } from '../src/core/types';

// cue 意为构造字幕单元替身，text 是原文，两个时间参数限定片段范围，仅供逻辑测试
function cue(text: string, startTime = 0, endTime = 4) { return { text, startTime, endTime }; }
// track 意为构造轨道替身，语言类型模式和 cues 模拟选择输入，不冒充浏览器真实轨道
function track(language = 'en', kind = 'captions', mode = 'showing', cues = [cue('An obscure reference.')]) {
  return { language, kind, mode, cues, activeCues: cues } as unknown as TextTrack;
}
// video 意为构造视频接口替身，宽高用于可见性判断，tracks 提供字幕输入，仅用于单元测试
function video(width = 640, height = 360, tracks = [track()]) {
  return { isConnected: true, hidden: false, parentElement: null, currentSrc: 'https://media.example/movie.webm', currentTime: 1,
    duration: 90, ended: false, paused: false, textTracks: tracks, pause: vi.fn(), play: vi.fn(async () => {}),
    getAttribute: () => null, getBoundingClientRect: () => ({ width, height, left: 0, top: 0, right: width, bottom: height }) } as unknown as HTMLVideoElement;
}
// setTracks 意为替换测试轨道，value 是替身视频，tracks 是新的候选列表，不用于生产视频
function setTracks(value: HTMLVideoElement, tracks: TextTrack[]) {
  Object.defineProperty(value, 'textTracks', { value: tracks, configurable: true });
}   // 单元测试替身只验证选择逻辑，真实原生轨道由浏览器集成测试验证
let elements: HTMLVideoElement[];
beforeEach(() => {
  elements = [video()];
  vi.stubGlobal('document', { querySelector: () => null, querySelectorAll: () => elements, fullscreenElement: null, title: 'Lecture' });
  vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 800 });
  vi.stubGlobal('location', { href: 'https://video.example/lesson?id=4' });
  vi.stubGlobal('getComputedStyle', () => ({ display: 'block', visibility: 'visible', opacity: '1' }));
});
afterEach(() => vi.unstubAllGlobals());

describe('通用 HTML5 视频与英文字幕选择', () => {
  it('只选择唯一明显主视频，捕获不触及隐藏的小视频', () => {
    const secondary = video(1, 1); elements.push(secondary);
    const port = new GenericVideoController(); const handle = port.capture(); handle.pause();
    expect(elements[0]!.pause).toHaveBeenCalledOnce(); expect(secondary.pause).not.toHaveBeenCalled();
  });
  it('多主视频同等面积时拒绝，不因为另一视频还在播放而更换暂停对象', () => {
    elements.push(video()); expect(selectMainVideo(elements)).toBeNull();
    expect(() => new GenericVideoController().capture()).toThrow('唯一可见');
  });
  it('容器全屏明确限定主视频', () => {
    const other = video(); elements.push(other);
    expect(selectMainVideo(elements, { contains: (value: Element) => value === other } as unknown as Element)).toBe(other);
  });
  it('隐藏祖先及视口外的视频不参加选择', () => {
    vi.stubGlobal('getComputedStyle', () => ({ display: 'block', visibility: 'hidden', opacity: '1' }));
    expect(selectMainVideo(elements)).toBeNull();
  });
  it.each([Infinity, NaN, 0])('拒绝直播或尚无时间轴的视频 %s，捕获前不暂停', (duration) => {
    Object.defineProperty(elements[0], 'duration', { value: duration });
    expect(() => new GenericVideoController().capture()).toThrow(); expect(elements[0]!.pause).not.toHaveBeenCalled();
  });
  it('恢复句柄同时核验当前时间、源和页面', () => {
    const handle = new GenericVideoController().capture(); expect(handle.isCurrent()).toBe(true);
    elements[0]!.currentTime = 4; expect(handle.isCurrent()).toBe(false);
    elements[0]!.currentTime = 1; Object.defineProperty(elements[0], 'currentSrc', { value: 'https://media.example/other.webm' });
    expect(handle.isCurrent()).toBe(false);
  });
  it('源地址只存指纹，媒体查询参数变化仍可识别换视频', () => {
    Object.defineProperty(elements[0], 'currentSrc', { value: 'https://media.example/play?id=one&token=secret', configurable: true });
    const first = genericVideoKey(elements[0]!); expect(first).not.toContain('secret');
    Object.defineProperty(elements[0], 'currentSrc', { value: 'https://media.example/play?id=two&token=secret' });
    expect(genericVideoKey(elements[0]!)).not.toBe(first);
  });
  it('忽略英文 metadata，并允许唯一隐藏的真实字幕轨道', () => {
    const english = track('en-GB', 'subtitles', 'hidden');
    setTracks(elements[0]!, [track('en', 'metadata'), english]);
    expect(selectEnglishTrack(elements[0]!)).toBe(english);
  });
  it('多个正在显示的英文字幕轨道会被拒绝', () => {
    setTracks(elements[0]!, [track(), track()]);
    expect(selectEnglishTrack(elements[0]!)).toBeUndefined();
  });
  it('显示轨道优先于隐藏轨道，不启用其他语言', () => {
    const english = track(); setTracks(elements[0]!, [track('fr'), track('en', 'subtitles', 'hidden'), english]);
    expect(selectEnglishTrack(elements[0]!)).toBe(english);
  });
  it('原生 VTT 文本由 getCueAsHTML 的 textContent 读取', () => {
    const vtt = { ...cue('ignored'), getCueAsHTML: () => ({ textContent: 'A safe reference.' }) };
    const result = readTrackSegments(track('en', 'captions', 'showing', [vtt]));
    expect(result[0]!.text).toBe('A safe reference.'); expect(result[0]!.source).toBe('generic-track');
  });
  it('样本缓存只记录观测结束，关闭字幕后不沿用长 cue 的未来时段', () => {
    const port = new GenericVideoController(); const subtitles = new GenericSubtitleAdapter(port);
    subtitles.sample(); expect(subtitles.cache.all()[0]!.end).toBe(1);
    elements[0]!.textTracks[0]!.mode = 'disabled'; elements[0]!.currentTime = 2;
    expect(() => subtitles.capture(port.capture(), 0)).toThrow('英文字幕轨道'); expect(subtitles.cache.all()).toEqual([]);
  });
  it('换轨道只读取新来源，上一条也不会沿用旧缓存', () => {
    const port = new GenericVideoController(); const subtitles = new GenericSubtitleAdapter(port);
    const context = assembleSentence(subtitles.capture(port.capture(), 0));
    setTracks(elements[0]!, [track('en', 'captions', 'showing', [cue('New subtitle.', 0, 4)])]);
    expect(subtitles.capture(port.capture(), 0).selected.text).toBe('New subtitle.');
    expect(() => subtitles.previous(context)).toThrow('上一条');
  });
  it('native snapshot 含真实下一条，但不在目标时间提前选择它', () => {
    setTracks(elements[0]!, [track('en', 'captions', 'showing', [cue('Past.', 0, 1.4), cue('Future.', 1.6, 3)])]);
    const port = new GenericVideoController(); const subtitles = new GenericSubtitleAdapter(port);
    elements[0]!.currentTime = 1.4; subtitles.sample(); elements[0]!.currentTime = 1.5;
    const snapshot = subtitles.capture(port.capture(), 0);
    expect(snapshot.selected.text).toBe('Past.'); expect(snapshot.segments.some((item) => item.text === 'Future.')).toBe(true);
  });
});

// snapshot 意为构造捕获快照，segments 是输入字幕，index 指定选中条目，供时间线验证使用
function snapshot(segments: SubtitleSegment[], index: number): SubtitleSnapshot {
  const selected = segments[index]!;
  return { selected, segments, capturedTime: selected.start + 0.2, targetTime: selected.start + 0.2,
    offset: 0, videoKey: 'test', title: 'test', url: 'https://video.example/test' };
}
// segment 意为构造片段，原文时间和来源都是测试输入，不能据此证明真实网站读取能力
const segment = (text: string, start: number, end: number, source: SubtitleSegment['source'] = 'generic-track'): SubtitleSegment => ({ text, start, end, source, language: 'en' });
describe('字幕上下文与已观测重听范围', () => {
  it('当前句的前后各一条保持真实时间，DOM 没有未来时留空', () => {
    const clips = [segment('Before.', 0, 2), segment('Current.', 2, 4), segment('After.', 4, 6)];
    expect(subtitleTimeline(snapshot(clips, 1)).map((item) => item.text)).toEqual(['Before.', 'Current.', 'After.']);
    expect(subtitleTimeline(snapshot(clips.slice(0, 2), 1)).map((item) => item.text)).toEqual(['Before.', 'Current.']);
  });
  it('拼接当前句时重听范围包括参与拼接的过去片段，前句不重复显示', () => {
    const clips = [segment('Previous.', 0, 1), segment('I came across', 1, 3), segment('a reference.', 3, 5), segment('Next.', 5, 7)];
    const current = snapshot(clips, 2);
    expect(observedSentenceRange(current)).toEqual({ start: 1, end: 5 });
    expect(subtitleTimeline(current).map((item) => item.text)).toEqual(['Previous.', 'I came across a reference.', 'Next.']);
  });
  it('不越过句末、长间隔或超过两条过去字幕扩大重听范围', () => {
    const clips = [segment('Ended.', 0, 2), segment('Current.', 4, 6)];
    expect(observedSentenceRange(snapshot(clips, 1))).toEqual({ start: 4, end: 6 });
  });
  it('下一句预译上下文与稍后真正捕获该句完全一致', () => {
    const clips = [segment('Before.', 0, 2), segment('Current.', 2, 4), segment('After.', 4, 6), segment('Last.', 6, 8)];
    const predicted = prefetchItems(snapshot(clips, 1))[0]!;
    const actual = snapshot(clips, 2); const text = assembleSentence(actual).text;
    expect(predicted).toEqual({ sentence: text, context: subtitleTimeline(actual).filter((item) => item.text !== text).map((item) => item.text) });
  });
  it('DOM 片段不会被当成尚未观测的可预读字幕', () => {
    expect(prefetchItems(snapshot([segment('DOM text.', 1, 1.5, 'youtube-dom')], 0))).toEqual([]);
  });
  it('DOM 跟随稳定原句后，重听可延长到最新真实观测终点', () => {
    const current = snapshot([segment('Stable caption.', 1, 1.1, 'youtube-dom')], 0);
    expect(latestObservedRange(current, [segment('Stable caption.', 1, 3.2, 'youtube-dom')])).toEqual({ start: 1, end: 3.2 });
  });
  it('相同文字但时间或来源不同不能扩大原句重听范围', () => {
    const current = snapshot([segment('Stable caption.', 1, 1.1, 'youtube-dom')], 0);
    expect(latestObservedRange(current, [segment('Stable caption.', 2, 4, 'youtube-dom'), segment('Stable caption.', 1, 8)])).toEqual({ start: 1, end: 1.1 });
  });
});
