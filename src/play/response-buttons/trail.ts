import { useEffect, useRef } from 'react';

import { TRAIL_FADE_MS, TRAIL_WIDTH } from '@/config/ui';

/**
 * The swipe's path, drawn on a canvas over the buttons: the whole path stays while the finger is down, then fades
 * out once it lifts.
 */
export function useSwipeTrail() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const points = useRef<{ x: number; y: number }[]>([]);
  const frame = useRef(0);
  const origin = useRef({ left: 0, top: 0, scale: 1 });
  /** When the finger lifted; null while the swipe goes on. */
  const endedAt = useRef<number | null>(null);

  const draw = () => {
    frame.current = 0;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const fade = endedAt.current === null ? 0 : (performance.now() - endedAt.current) / TRAIL_FADE_MS;
    const pts = points.current;
    if (fade >= 1 || pts.length === 0) {
      points.current = [];
      return;
    }
    ctx.globalAlpha = 1 - fade;
    ctx.lineWidth = TRAIL_WIDTH * origin.current.scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // One path, so the joins don't overlap into darker dots. A lone point draws as a dot (the round cap).
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts.length > 1 ? pts.slice(1) : pts) {
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    if (endedAt.current !== null) {
      frame.current = requestAnimationFrame(draw);
    }
  };
  const redraw = () => {
    if (!frame.current) {
      frame.current = requestAnimationFrame(draw);
    }
  };

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  return {
    canvasRef,
    /** Sizes the canvas to the buttons and takes the trail colour (the canvas's CSS colour). */
    start: () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) {
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * scale);
      canvas.height = Math.round(rect.height * scale);
      origin.current = { left: rect.left, top: rect.top, scale };
      ctx.strokeStyle = getComputedStyle(canvas).color;
      points.current = [];
      endedAt.current = null;
    },
    add: (clientX: number, clientY: number) => {
      const { left, top, scale } = origin.current;
      points.current.push({ x: (clientX - left) * scale, y: (clientY - top) * scale });
      redraw();
    },
    end: () => {
      endedAt.current = performance.now();
      redraw();
    },
  };
}
