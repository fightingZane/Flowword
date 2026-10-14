export type Phase = 'IDLE' | 'CAPTURING' | 'ANALYZING' | 'READY' | 'RESUME' | 'ERROR';
export type SubtitleSource = 'text-track' | 'youtube-dom';

export interface SubtitleSegment {
  text: string;
  start: number;   // 视频时间轴上的开始秒数
  end: number;   // DOM 字幕的结束时间只是最后一次观测时间
  source: SubtitleSource;
  language: 'en' | 'und';   // 页面字幕不能仅靠拉丁字母确认是英语
}

export interface SubtitleSnapshot {
  segments: SubtitleSegment[];
  selected: SubtitleSegment;
  capturedTime: number;
  targetTime: number;
  offset: number;
  videoKey: string;
  title: string;
  url: string;
}

export interface SentenceContext extends SubtitleSnapshot {
  text: string;
  isPartial: boolean;   // 无句末标点时只声明捕获到字幕片段
  learning?: {
    status: 'disabled' | 'loading' | 'ready' | 'error';
    translation?: string;
    segmented?: boolean;
    error?: string;
    candidates: (VocabularyCandidate & { translation?: string })[];
  };
}

export interface InteractionState {
  phase: Phase;
  context: SentenceContext | null;
  error: string | null;
  canResume: boolean;
}

export interface BallPosition {
  x: number;   // 取值 0 到 1，按可移动区域保存位置
  y: number;
}

export interface Point { x: number; y: number }
export interface Viewport { width: number; height: number }

export interface Settings {
  enabled: boolean;
  position: BallPosition;
  offset: number;
  appearance: Appearance;
  onlineTranslation: boolean;
}

export interface Appearance {
  fontSize: number;
  panelTheme: 'auto' | 'light' | 'dark' | 'warm' | 'blue';
  ballColor: string;
  ballStyle: 'glass' | 'solid' | 'outline';
  ballOpacity: number;
  panelWidth: number;
}

export interface WordbookEntry {
  id: string;
  kind: 'word' | 'phrase' | 'sentence';
  text: string;
  lemma?: string;
  translation: string;
  partOfSpeech: string;
  examTags: string[];
  tags: string[];
  createdAt: number;
  updatedAt: number;
  contexts: { sentence: string; url: string; time: number }[];
}

// 播放接口仅操作适配器选中的主视频，测试可以替换接口验证竞态
export interface VideoHandle {
  key: string;
  time: number;
  paused: boolean;
  pause(): void;
  play(): Promise<void>;
  isCurrent(): boolean;
}

export interface VideoPort {
  capture(): VideoHandle;
}

export interface SubtitlePort {
  capture(handle: VideoHandle, offset: number): SubtitleSnapshot;
  previous(context: SentenceContext): SubtitleSnapshot;
}

export type SentenceProcessor = (snapshot: SubtitleSnapshot, signal: AbortSignal) => Promise<SentenceContext>;

export interface PageStatus {
  type: 'FLOWWORD_STATUS';
  isVideoPage: boolean;
  enabled: boolean;
  phase: Phase;
  version: string;
}
import type { VocabularyCandidate } from './vocabulary';
