import { describe, expect, it } from 'vitest';
import { createDomReplayBoundary } from '../src/adapters/html5-subtitles';
import type { SubtitleSnapshot } from '../src/core/types';
const snapshot = { selected: { text: 'The vapor chamber', start: 4, end: 4.2, source: 'youtube-dom', language: 'und' } } as SubtitleSnapshot;
describe('DOM字幕重听实时边界', () => {
  it('回跳经过前文和空白不结束，进入目标后等真实转换', () => {
    let time = 2; let text = 'Earlier caption';
    const boundary = createDomReplayBoundary(snapshot, () => text, () => time);
    expect(boundary()).toBe(false);
    text = ''; time = 3; expect(boundary()).toBe(false);
    time = 4; text = 'The vapor chamber'; expect(boundary()).toBe(false);
    time = 5; expect(boundary()).toBe(false);
    text = 'Next unrelated caption'; time = 6; expect(boundary()).toBe(true);
  });
  it('滚动累加与连续重叠不是片段结束，句末后下一字幕才完成', () => {
    let text = 'The vapor chamber'; let time = 4;
    const boundary = createDomReplayBoundary(snapshot, () => text, () => time);
    expect(boundary()).toBe(false);
    text = 'The vapor chamber keeps cool'; time = 5; expect(boundary()).toBe(false);
    text = 'keeps cool during gaming.'; time = 6; expect(boundary()).toBe(false);
    text = 'Next sentence.'; time = 7; expect(boundary()).toBe(true);
  });
  it('已进入目标后字幕消失是实际可观察转换，不等待点击时刻', () => {
    let text = 'The vapor chamber'; let time = 4.3;
    const boundary = createDomReplayBoundary(snapshot, () => text, () => time);
    expect(boundary()).toBe(false); text = ''; expect(boundary()).toBe(false); time = 4.45; expect(boundary()).toBe(true);
  });
});

it('目标The Pro chip回放先The再Pro chip不会在半句停下', () => {
  let text = 'The'; let time = 4;
  const boundary = createDomReplayBoundary({ ...snapshot, selected: { ...snapshot.selected, text: 'The Pro chip' } }, () => text, () => time);
  expect(boundary()).toBe(false); time = 4.2; text = 'Pro chip'; expect(boundary()).toBe(false);
  time = 4.4; text = 'chip handles intensive games.'; expect(boundary()).toBe(false);
  time = 5; text = 'Another sentence.'; expect(boundary()).toBe(true);
});

it('目标尚未完整覆盖时无关字幕不能触发已完成暂停', () => {
  let text = 'The';
  const boundary = createDomReplayBoundary({ ...snapshot, selected: { ...snapshot.selected, text: 'The Pro chip' } }, () => text, () => 4);
  expect(boundary()).toBe(false); text = 'Unrelated caption'; expect(boundary()).toBe(false);
});
