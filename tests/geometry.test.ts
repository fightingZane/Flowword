import { describe, expect, it } from 'vitest';
import { BALL_SIZE, bubblePosition, constrain, rememberPosition, restorePosition, snapToEdge } from '../src/core/geometry';

describe('悬浮球边界和位置记忆', () => {
  const screen = { width: 1280, height: 720 };
  it('限制拖动边界', () => expect(constrain({ x: -50, y: 1000 }, screen)).toEqual({ x: 14, y: 652 }));
  it('按当前屏幕最近侧贴边', () => {
    expect(snapToEdge({ x: 100, y: 300 }, screen).x).toBe(14);
    expect(snapToEdge({ x: 1000, y: 300 }, screen).x).toBe(screen.width - BALL_SIZE - 14);
  });
  it('保存相对坐标并在另一屏幕恢复', () => {
    const relative = rememberPosition({ x: 1212, y: 333 }, screen);
    expect(relative.x).toBe(1);
    const restored = restorePosition(relative, { width: 1920, height: 1080 });
    expect(restored.x).toBe(1852);
    expect(restored.y).toBeGreaterThan(333);
  });
  it('面板在右下角也不超出窗口', () => {
    const point = bubblePosition({ x: 1212, y: 652 }, screen, 384, 390);
    expect(point.x + 384).toBeLessThanOrEqual(1268);
    expect(point.y + 390).toBeLessThanOrEqual(708);
  });
  it('窄窗口将面板限制在可见区域', () => {
    expect(bubblePosition({ x: 180, y: 600 }, { width: 320, height: 640 }, 296, 400)).toEqual({ x: 12, y: 228 });
  });
});
