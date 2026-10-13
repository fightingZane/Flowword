import type { BallPosition, Point, Viewport } from './types';

export const BALL_SIZE = 54;
export const EDGE_MARGIN = 14;
export const DRAG_THRESHOLD = 6;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function bounds(viewport: Viewport) {
  return {
    x: Math.max(EDGE_MARGIN, viewport.width - BALL_SIZE - EDGE_MARGIN),
    y: Math.max(EDGE_MARGIN, viewport.height - BALL_SIZE - EDGE_MARGIN),
  };
}

export function constrain(point: Point, viewport: Viewport): Point {
  const limit = bounds(viewport);
  return { x: clamp(point.x, EDGE_MARGIN, limit.x), y: clamp(point.y, EDGE_MARGIN, limit.y) };
}

export function restorePosition(position: BallPosition, viewport: Viewport): Point {
  const limit = bounds(viewport);
  return constrain({
    x: EDGE_MARGIN + position.x * (limit.x - EDGE_MARGIN),
    y: EDGE_MARGIN + position.y * (limit.y - EDGE_MARGIN),
  }, viewport);
}

export function rememberPosition(point: Point, viewport: Viewport): BallPosition {
  const limit = bounds(viewport);
  return {
    x: clamp((point.x - EDGE_MARGIN) / Math.max(1, limit.x - EDGE_MARGIN), 0, 1),
    y: clamp((point.y - EDGE_MARGIN) / Math.max(1, limit.y - EDGE_MARGIN), 0, 1),
  };
}

export function snapToEdge(point: Point, viewport: Viewport): Point {
  const safe = constrain(point, viewport);
  return { x: safe.x + BALL_SIZE / 2 < viewport.width / 2 ? EDGE_MARGIN : bounds(viewport).x, y: safe.y };
}

export function bubblePosition(ball: Point, viewport: Viewport, width: number, height: number): Point {
  const preferredX = ball.x > viewport.width / 2 ? ball.x - width - 14 : ball.x + BALL_SIZE + 14;
  return {
    x: clamp(preferredX, 12, Math.max(12, viewport.width - width - 12)),
    y: clamp(ball.y + BALL_SIZE / 2 - height / 2, 12, Math.max(12, viewport.height - height - 12)),
  };   // 按实际面板高度计算，缩放窗口后仍保持在可见区域
}
