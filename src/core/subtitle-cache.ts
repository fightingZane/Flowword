import { normalizeText } from './sentence';
import type { SubtitleSegment } from './types';

export class SubtitleCache {
  private segments: SubtitleSegment[] = [];
  private lastTime = -1;

  clear(): void {
    this.segments = [];
    this.lastTime = -1;
  }

  observe(segment: SubtitleSegment | null, time: number): void {
    if (this.lastTime >= 0 && (time < this.lastTime - 0.2 || time - this.lastTime > 1.5)) {
      this.clear();   // 跳转进度后丢弃旧片段，防止拼接不相邻的句子
    }
    this.lastTime = time;
    this.segments = this.segments.filter((item) => item.end >= time - 12);
    if (!segment || !normalizeText(segment.text)) return;
    const text = normalizeText(segment.text);
    const last = this.segments.at(-1);
    if (last?.text === text && last.source === segment.source && segment.start - last.end < 0.55) {
      last.end = Math.max(last.end, segment.end);   // 同一字幕只延长观测区间
    } else {
      this.segments.push({ ...segment, text });
    }
    this.segments = this.segments.slice(-80);   // 限制内存占用，不保存完整视频字幕
  }

  select(time: number): SubtitleSegment | undefined {
    return this.segments.findLast((segment) => segment.start <= time && segment.end >= time)
      ?? this.segments.findLast((segment) => segment.end <= time && time - segment.end <= 0.65);
  }

  previous(start: number): SubtitleSegment | undefined {
    return this.segments.findLast((segment) => segment.start < start - 0.12);
  }

  all(): SubtitleSegment[] {
    return this.segments.map((segment) => ({ ...segment }));   // 不让调用方修改正在采样的缓存
  }
}
