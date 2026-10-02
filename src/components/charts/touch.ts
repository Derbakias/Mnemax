import type uPlot from 'uplot';

import { PAN_Y_THRESHOLD } from '@/config/charts';
import type { InteractiveYScale } from './zoom';

/** What the touch controls share with `chartInteraction`, which made them. */
export interface TouchContext {
  /** The zoom as it is now; `chartInteraction` changes it in place, so this always reads the latest. */
  state: { xWindow: readonly [number, number] | null; manualY: boolean };
  fullMin: number;
  fullMax: number;
  panZoomY: boolean;
  yScales: InteractiveYScale[];
  setX: (u: uPlot, lo: number, hi: number) => void;
  setXScale: (u: uPlot, min: number, max: number) => void;
  setYs: (u: uPlot, to: (scale: InteractiveYScale) => readonly [number, number]) => void;
  range: (u: uPlot, key: string) => readonly [number, number];
  xRange: () => readonly [number, number];
  notify: () => void;
  onReset: () => void;
}

/**
 * Lets fingers move and zoom the chart: `over` is the chart's plot area, and `ctx` the zoom it moves.
 * Called once by `chartInteraction` when uPlot has made the chart.
 */
export function addTouchControls(u: uPlot, over: HTMLElement, ctx: TouchContext) {
  const { state, fullMin, fullMax, panZoomY, yScales, setX, setXScale, setYs, range, xRange, notify, onReset } = ctx;

  // Touch (the mouse controls in chartInteraction skip it). One finger moves the crosshair and tooltip when the
  // chart's crosshair switch is on (see UPlotChart), and otherwise drags a zoomed-in chart about, as
  // the mouse does: sideways, and up and down too once it has moved a little that way (where panning
  // moves the y axes). Two fingers pinch to zoom the x axis around them and move it as they move. A
  // double tap resets. Until the chart is zoomed, vertical swipes stay with the page (`touch-action`
  // in CSS), so an untouched chart never traps the scroll. The y axes keep fitting the data in view
  // until moved.
  const touches = new Map<number, { x: number; y: number }>();
  // done: a pinch lost a finger; the one left does nothing until it lifts too, so nothing jumps to it.
  let mode: 'scrub' | 'pan' | 'pinch' | 'done' = 'pan';
  let pinch = { dist: 1, at: 0 };
  let pan = {
    x: 0,
    y: 0,
    range: [0, 0] as readonly [number, number],
    yRanges: new Map<string, readonly [number, number]>(),
  };
  let lastTap = { time: 0, x: 0, y: 0 };
  // A touch counts as a tap (for the double tap) only if it was one finger that barely moved.
  let tap: { x: number; y: number } | null = null;
  const crosshairOn = () => over.closest('[data-crosshair]')?.getAttribute('data-crosshair') === 'on';
  const hideCursor = () => u.setCursor({ left: -10, top: -10 });
  const local = (p: { x: number; y: number }) => {
    const rect = over.getBoundingClientRect();
    return { left: p.x - rect.left, top: p.y - rect.top };
  };
  const spread = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  over.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') {
      return;
    }
    // No emulated mouse events after it, which would move uPlot's cursor on their own.
    e.preventDefault();
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const [a, b] = [...touches.values()];
    if (touches.size === 1) {
      tap = { x: e.clientX, y: e.clientY };
      if (crosshairOn()) {
        mode = 'scrub';
        u.setCursor(local(a));
      } else {
        mode = 'pan';
        pan = { x: a.x, y: a.y, range: xRange(), yRanges: new Map(yScales.map((y) => [y.key, range(u, y.key)])) };
      }
    } else if (b) {
      mode = 'pinch';
      tap = null;
      pinch = { dist: spread(a, b), at: u.posToVal(local({ x: (a.x + b.x) / 2, y: 0 }).left, 'x') };
      hideCursor(); // no tooltip under the fingers while zooming
    }
  });
  over.addEventListener('pointermove', (e) => {
    if (!touches.has(e.pointerId)) {
      return;
    }
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 10) {
      tap = null;
    }
    const [a, b] = [...touches.values()];
    if (mode === 'scrub') {
      u.setCursor(local(a));
    } else if (mode === 'pan' && (state.xWindow || state.manualY)) {
      if (state.xWindow) {
        const [x0, x1] = pan.range;
        const shift = (-(a.x - pan.x) / over.clientWidth) * (x1 - x0);
        const lo = Math.min(Math.max(fullMin, x0 + shift), fullMax - (x1 - x0));
        setXScale(u, lo, lo + (x1 - x0));
      }
      const dy = a.y - pan.y;
      if (panZoomY && (state.manualY || Math.abs(dy) > PAN_Y_THRESHOLD)) {
        setYs(u, (y) => {
          const [y0, y1] = pan.yRanges.get(y.key) ?? range(u, y.key);
          const shiftY = (dy / over.clientHeight) * (y1 - y0);
          return [y0 + shiftY, y1 + shiftY];
        });
      }
      notify();
    } else if (mode === 'pinch' && b) {
      const [x0, x1] = xRange();
      const width = ((x1 - x0) * pinch.dist) / spread(a, b);
      if (width >= fullMax - fullMin) {
        // Pinched all the way out: back to the full range, with the y axes fitted again.
        state.manualY = false;
        setXScale(u, fullMin, fullMax);
      } else {
        // Keep the value that started under the fingers under their midpoint.
        const lo = pinch.at - (local({ x: (a.x + b.x) / 2, y: 0 }).left / over.clientWidth) * width;
        setX(u, lo, lo + width);
      }
      // Measured again from here, since the range just changed.
      pinch.dist = spread(a, b);
      notify();
    }
  });
  const endTouch = (e: PointerEvent) => {
    if (!touches.delete(e.pointerId)) {
      return;
    }
    if (mode === 'pinch') {
      mode = 'done';
    }
    if (e.type !== 'pointerup' || touches.size > 0 || !tap) {
      return;
    }
    tap = null;
    const now = performance.now();
    if (now - lastTap.time < 300 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
      lastTap.time = 0;
      onReset();
    } else {
      lastTap = { time: now, x: e.clientX, y: e.clientY };
    }
  };
  over.addEventListener('pointerup', endTouch);
  over.addEventListener('pointercancel', endTouch);
}
