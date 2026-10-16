// Kosketusystävällinen 2D-canvas: yksi sormi panoroi, kaksi sormea zoomaa, napautus valitsee.
// Piirtää vain kun näkymä tai data muuttuu.

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { View2D } from '../../core/pick';

export interface PanZoomHandle {
  setView(v: Partial<View2D>): void;
  getView(): View2D;
  fit(): void;
  redraw(): void;
}

interface Props {
  draw: (g: CanvasRenderingContext2D, v: View2D) => void;
  fit: (w: number, h: number) => View2D;
  onTap: (sx: number, sy: number, v: View2D) => void;
  deps: unknown[];
  minScale?: number;
  maxScale?: number;
  testId?: string;
}

export const PanZoomCanvas = forwardRef<PanZoomHandle, Props>(function PanZoomCanvas(
  { draw, fit, onTap, deps, minScale = 0.05, maxScale = 400, testId },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View2D | null>(null);
  const drawRef = useRef(draw);
  const fitRef = useRef(fit);
  const tapRef = useRef(onTap);
  const raf = useRef(0);
  drawRef.current = draw;
  fitRef.current = fit;
  tapRef.current = onTap;

  const schedule = () => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const c = canvasRef.current;
      const v = viewRef.current;
      if (!c || !v) return;
      const g = c.getContext('2d');
      if (!g) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, v.width, v.height);
      drawRef.current(g, v);
    });
  };

  const clampScale = (s: number) => Math.min(maxScale, Math.max(minScale, s));

  useImperativeHandle(ref, () => ({
    setView(p) {
      if (!viewRef.current) return;
      viewRef.current = { ...viewRef.current, ...p, scale: clampScale(p.scale ?? viewRef.current.scale) };
      schedule();
    },
    getView: () => viewRef.current!,
    fit() {
      const h = hostRef.current;
      if (!h) return;
      viewRef.current = fitRef.current(h.clientWidth, h.clientHeight);
      schedule();
    },
    redraw: schedule,
  }));

  // koko
  useEffect(() => {
    const host = hostRef.current!;
    const c = canvasRef.current!;
    const resize = () => {
      const w = Math.max(1, host.clientWidth);
      const h = Math.max(1, host.clientHeight);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      if (!viewRef.current) viewRef.current = fitRef.current(w, h);
      else viewRef.current = { ...viewRef.current, width: w, height: h };
      schedule();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();
    return () => {
      ro.disconnect();
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(schedule, deps); // eslint-disable-line react-hooks/exhaustive-deps

  // eleet
  useEffect(() => {
    const c = canvasRef.current!;
    const pts = new Map<number, { x: number; y: number }>();
    let start: { x: number; y: number; t: number; moved: boolean } | null = null;
    let pinch: { d: number; mx: number; my: number; view: View2D } | null = null;
    const local = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const down = (e: PointerEvent) => {
      c.setPointerCapture(e.pointerId);
      const p = local(e);
      pts.set(e.pointerId, p);
      if (pts.size === 1) start = { ...p, t: performance.now(), moved: false };
      if (pts.size === 2 && viewRef.current) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, view: { ...viewRef.current } };
        if (start) start.moved = true;
      }
    };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId) || !viewRef.current) return;
      const prev = pts.get(e.pointerId)!;
      const p = local(e);
      pts.set(e.pointerId, p);
      const v = viewRef.current;
      if (pts.size === 1) {
        if (start && Math.hypot(p.x - start.x, p.y - start.y) > 6) start.moved = true;
        if (start?.moved) {
          viewRef.current = { ...v, cx: v.cx - (p.x - prev.x) / v.scale, cy: v.cy + (p.y - prev.y) / v.scale };
          schedule();
        }
      } else if (pts.size === 2 && pinch) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const pv = pinch.view;
        const scale = clampScale(pv.scale * (d / Math.max(1, pinch.d)));
        // maailmapiste nipistyksen alussa keskikohdassa pysyy sormien keskikohdassa
        const wx = pv.cx + (pinch.mx - pv.width / 2) / pv.scale;
        const wy = pv.cy - (pinch.my - pv.height / 2) / pv.scale;
        viewRef.current = { ...v, scale, cx: wx - (mx - v.width / 2) / scale, cy: wy + (my - v.height / 2) / scale };
        schedule();
      }
    };
    const up = (e: PointerEvent) => {
      const p = local(e);
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size === 0 && start && !start.moved && performance.now() - start.t < 600 && viewRef.current) {
        tapRef.current(p.x, p.y, viewRef.current);
      }
      if (pts.size === 0) start = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      if (!v) return;
      const r = c.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      const f = Math.exp(-e.deltaY * 0.0015);
      const scale = clampScale(v.scale * f);
      const wx = v.cx + (sx - v.width / 2) / v.scale;
      const wy = v.cy - (sy - v.height / 2) / v.scale;
      viewRef.current = { ...v, scale, cx: wx - (sx - v.width / 2) / scale, cy: wy + (sy - v.height / 2) / scale };
      schedule();
    };
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', wheel, { passive: false });
    return () => {
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      c.removeEventListener('pointercancel', up);
      c.removeEventListener('wheel', wheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="canvas-host" ref={hostRef} data-testid={testId}>
      <canvas ref={canvasRef} />
    </div>
  );
});
