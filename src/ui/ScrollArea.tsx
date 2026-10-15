import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

// ScrollArea 提供主题一致的滚动区域，children是原有全部内容，busy标记加载状态
// 隐藏原生轨道但保留滚轮触摸和键盘操作，自绘滑块按实际内容高度计算，不改变面板尺寸
export function ScrollArea({ children, busy }: { children: ReactNode; busy: boolean }) {
  const body = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: number; y: number; top: number } | null>(null);
  const id = useId();
  const [metrics, setMetrics] = useState({ top: 0, viewport: 1, total: 1, rail: 1 });
  useEffect(() => {
    const element = body.current;
    if (!element) return;
    // sync 同步实际滚动尺寸，无参数，滚动或内容变化后调用，相同尺寸不重复渲染
    const sync = () => {
      const next = { top: element.scrollTop, viewport: element.clientHeight, total: element.scrollHeight, rail: rail.current?.clientHeight ?? element.clientHeight };
      setMetrics((previous) => Object.keys(next).every((key) => next[key as keyof typeof next] === previous[key as keyof typeof next]) ? previous : next);
    };
    const resize = new ResizeObserver(sync);
    // observe 重新观察内容节点，无参数，文字字号和新内容导致的尺寸变化也要更新轨道
    const observe = () => { resize.disconnect(); resize.observe(element); if (rail.current) resize.observe(rail.current); for (const child of element.children) resize.observe(child); sync(); };
    const mutations = new MutationObserver(observe);
    observe(); mutations.observe(element, { childList: true, subtree: true, characterData: true });
    element.addEventListener('scroll', sync, { passive: true });
    return () => { resize.disconnect(); mutations.disconnect(); element.removeEventListener('scroll', sync); };
  }, []);
  const range = Math.max(0, metrics.total - metrics.viewport);
  const height = Math.min(metrics.rail, Math.max(28, metrics.rail * metrics.viewport / Math.max(1, metrics.total)));
  const travel = Math.max(1, metrics.rail - height);
  // finish 结束滑块指针拖动，event携带本次指针身份，失去捕获时同样清理手势
  function finish(event: React.PointerEvent<HTMLDivElement>) {
    if (gesture.current?.id === event.pointerId) gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return <div className="fw-scroll-area">
    <div className="fw-body" id={id} ref={body} aria-live="polite" aria-busy={busy}>{children}</div>
    <div ref={rail} className="fw-scrollbar" data-visible={range > 1} role="scrollbar" aria-label="面板滚动条" aria-controls={id} aria-orientation="vertical" aria-valuemin={0} aria-valuemax={Math.round(range)} aria-valuenow={Math.min(Math.round(range), Math.round(metrics.top))} tabIndex={range > 1 ? 0 : -1}
      onKeyDown={(event) => {
        if (!body.current) return;
        const steps: Record<string, number> = { ArrowDown: 40, ArrowUp: -40, PageDown: metrics.viewport * .85, PageUp: -metrics.viewport * .85, Home: -range, End: range };
        if (!(event.key in steps)) return;
        event.preventDefault(); event.stopPropagation(); body.current.scrollTop += steps[event.key]!;
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || !body.current) return;
        event.preventDefault(); event.stopPropagation();
        if (!(event.target as HTMLElement).closest('.fw-scrollbar-thumb')) {
          const offset = event.clientY - event.currentTarget.getBoundingClientRect().top - height / 2;
          body.current.scrollTop = offset / travel * range;
        }
        gesture.current = { id: event.pointerId, y: event.clientY, top: body.current.scrollTop };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const active = gesture.current;
        if (active?.id === event.pointerId && body.current) body.current.scrollTop = active.top + (event.clientY - active.y) / travel * range;
      }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={() => { gesture.current = null; }}>
      <div className="fw-scrollbar-thumb" style={{ height, transform: `translateY(${range ? metrics.top / range * travel : 0}px)` }} />
    </div>
  </div>;
}
