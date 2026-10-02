import { useCallback, useState } from 'react';
import type uPlot from 'uplot';

import {
  MIN_ZOOM_ROUNDS,
  PAGE_SCROLL_GRACE_MS,
  PAN_Y_THRESHOLD,
  WHEEL_ZOOM,
  Y_MAX_SHARE,
  Y_MIN_SHARE,
} from '@/config/charts';
import { addAxisHandles, onDrag } from './axis-handles';
import { snapToNearestPoint } from './tooltip';
import { addTouchControls } from './touch';

let lastPageScroll = 0;
if (typeof document !== 'undefined') {
  // Scroll events don't bubble, but a capturing listener on the document sees every scrolling element.
  document.addEventListener('scroll', () => (lastPageScroll = performance.now()), { capture: true, passive: true });
}

/** Zoom state for a chart built with `roundChartInteraction`: pass `chartKey` as the chart's React key. */
export type ChartZoom = ReturnType<typeof useChartZoom>;

export function useChartZoom() {
  const [zoomed, setZoomed] = useState(false);
  const [chartKey, setChartKey] = useState(0);
  // Touch screens only: whether one finger moves the crosshair (on) or the chart (off). Kept here so a
  // reset, which rebuilds the chart, leaves it as it was.
  const [crosshair, setCrosshair] = useState(false);
  const reset = useCallback(() => {
    setZoomed(false);
    setChartKey((k) => k + 1);
  }, []);
  return { zoomed, setZoomed, chartKey, reset, crosshair, setCrosshair };
}

/**
 * Scales, cursor and plugin for a chart with one x step per round (x = 1…count), controlled like a map;
 * see `chartInteraction`. The y axis fits the data in view (`yFit`) until it is panned or stretched.
 */
export function roundChartInteraction(
  count: number,
  yFit: uPlot.Range.Function,
  onZoomed: (zoomed: boolean) => void,
  onReset: () => void,
  /** Values the y axis can never go beyond when moved by hand (e.g. 0–100 for a percentage). */
  yBounds: { min?: number; max?: number } = {},
) {
  // Half a round of room at each end, so edge dots aren't clipped.
  return chartInteraction({
    xFull: [0.5, count + 0.5],
    xTime: false,
    minXSpan: MIN_ZOOM_ROUNDS,
    yScales: [{ key: 'y', fit: yFit, bounds: yBounds }],
    onZoomed,
    onReset,
  });
}

export interface InteractiveYScale {
  key: string;
  /** Range while the axis follows the data (until it is panned or stretched by hand). */
  fit: uPlot.Range.Function;
  /** Values the axis can never go beyond when moved by hand. */
  bounds?: { min?: number; max?: number };
  /** Which side its axis is drawn on, for the stretch handle (default left). */
  side?: 'left' | 'right';
}

/**
 * Scales, cursor and plugin for a chart controlled like a map:
 * - scroll over the chart zooms the x axis and every y axis around the pointer (x only without `panZoomY`);
 * - click and hold, then move, pans;
 * - dragging along the x axis (left/right) or a y axis (up/down) stretches that axis;
 * - double-click resets.
 * The x axis shows `xFull` until zoomed; the y axes fit the data in view until moved by hand.
 */
export function chartInteraction({
  xFull,
  xTime,
  minXSpan,
  panZoomY = true,
  yScales,
  onZoomed,
  onReset,
}: {
  xFull: readonly [number, number];
  /** Whether x holds timestamps (in seconds), for uPlot's time axis. */
  xTime: boolean;
  /** The narrowest x window zooming in allows. */
  minXSpan: number;
  /**
   * Whether the wheel and panning move the y axes too. Bar charts turn this off: their y axes keep the
   * baseline and refit to the data in view. The y axis handles still stretch them either way.
   */
  panZoomY?: boolean;
  yScales: InteractiveYScale[];
  onZoomed: (zoomed: boolean) => void;
  onReset: () => void;
}) {
  // xWindow: the x range zoomed or panned to (null: the full range). manualY: the y axes were moved by
  // hand (they all move together). fittedSpan: each y axis's span when that happened, which limits how far
  // it can be stretched.
  const state = {
    xWindow: null as readonly [number, number] | null,
    manualY: false,
    fittedSpan: new Map<string, number>(),
  };
  const [fullMin, fullMax] = xFull;

  const scales: uPlot.Scales = {
    // uPlot runs this on every x change, later (in a microtask) rather than inside setScale, so it returns
    // the window kept in `state` instead of trusting the values it is given.
    x: { time: xTime, range: () => (state.xWindow ? [...state.xWindow] : [fullMin, fullMax]) },
  };
  for (const y of yScales) {
    scales[y.key] = { auto: () => !state.manualY, range: y.fit };
  }

  const setXScale = (u: uPlot, min: number, max: number) => {
    const full = min <= fullMin && max >= fullMax;
    state.xWindow = full ? null : [min, max];
    u.setScale('x', { min, max });
  };
  const setX = (u: uPlot, lo: number, hi: number) => {
    let width = Math.min(fullMax - fullMin, Math.max(minXSpan, hi - lo));
    const mid = (lo + hi) / 2;
    lo = mid - width / 2;
    if (lo < fullMin) {
      lo = fullMin;
    }
    if (lo + width > fullMax) {
      lo = fullMax - width;
    }
    width = Math.min(width, fullMax - lo);
    setXScale(u, lo, lo + width);
  };
  /** Moves every y axis: `to` gives each one's new [lo, hi] from its current range. */
  const setYs = (u: uPlot, to: (scale: InteractiveYScale) => readonly [number, number]) => {
    if (!state.manualY) {
      for (const y of yScales) {
        const [y0, y1] = range(u, y.key);
        state.fittedSpan.set(y.key, y1 - y0);
      }
    }
    const targets = yScales.map((y) => [y, to(y)] as const);
    state.manualY = true;
    for (const [y, [lo, hi]] of targets) {
      setY(u, y, lo, hi);
    }
  };
  const setY = (u: uPlot, y: InteractiveYScale, lo: number, hi: number) => {
    const fitted = state.fittedSpan.get(y.key) ?? hi - lo;
    const floor = y.bounds?.min ?? -Infinity;
    const ceiling = y.bounds?.max ?? Infinity;
    let span = Math.min(fitted * Y_MAX_SHARE, Math.max(fitted * Y_MIN_SHARE, hi - lo));
    span = Math.min(span, ceiling - floor);
    // Shift the window back inside the bounds rather than squashing it.
    let min = (lo + hi) / 2 - span / 2;
    min = Math.max(floor, Math.min(min, ceiling - span));
    u.setScale(y.key, { min, max: min + span });
  };
  // The chart's plot area, once uPlot has made it.
  let overEl: HTMLElement | null = null;
  // uPlot applies scale changes in a microtask, so this reads the zoom from `state`, not `u.scales`.
  const notify = () => {
    const zoomed = state.xWindow != null || state.manualY;
    onZoomed(zoomed);
    // A zoomed-in chart takes vertical touch drags too (`.zoomed` in CSS), so a finger can move it up and
    // down; until then they scroll the page. Only where panning moves the y axes.
    if (panZoomY) {
      overEl?.classList.toggle('zoomed', zoomed);
    }
  };
  const range = (u: uPlot, key: string) => [u.scales[key].min ?? 0, u.scales[key].max ?? 1] as const;
  const xRange = () => state.xWindow ?? ([fullMin, fullMax] as const);

  let placeHandles: (() => void) | null = null;

  const plugin: uPlot.Plugin = {
    hooks: {
      setSize: () => placeHandles?.(),
      ready: (u) => {
        const over = u.over;
        overEl = over;
        over.classList.add('pannable');

        // Scroll: zoom all axes around the pointer. Zooming all the way out restores the fitted y axes.
        over.addEventListener(
          'wheel',
          (e) => {
            if (e.deltaY === 0 || performance.now() - lastPageScroll < PAGE_SCROLL_GRACE_MS) {
              return;
            }
            e.preventDefault();
            const factor = e.deltaY < 0 ? WHEEL_ZOOM : 1 / WHEEL_ZOOM;
            const [x0, x1] = xRange();
            const atX = u.posToVal(e.offsetX, 'x');
            const fullyOut = factor > 1 && (x1 - x0) * factor >= fullMax - fullMin;
            setX(u, atX - (atX - x0) * factor, atX + (x1 - atX) * factor);
            if (fullyOut) {
              state.manualY = false;
              setXScale(u, fullMin, fullMax); // re-fits y, now that it's automatic again
            } else if (panZoomY) {
              setYs(u, (y) => {
                const [y0, y1] = range(u, y.key);
                const atY = u.posToVal(e.offsetY, y.key);
                return [atY - (atY - y0) * factor, atY + (y1 - atY) * factor];
              });
            }
            notify();
          },
          { passive: false },
        );

        // Click and hold: pan (x always; y once the pointer has moved vertically a little).
        let panStart: { x: readonly [number, number]; y: Map<string, readonly [number, number]> } | null = null;
        over.addEventListener('pointerdown', () => {
          panStart = { x: xRange(), y: new Map(yScales.map((y) => [y.key, range(u, y.key)])) };
        });
        onDrag(over, (dx, dy) => {
          if (!panStart) {
            return;
          }
          const start = panStart;
          const [x0, x1] = start.x;
          const shiftX = (-dx / over.clientWidth) * (x1 - x0);
          const lo = Math.min(Math.max(fullMin, x0 + shiftX), fullMax - (x1 - x0));
          setXScale(u, lo, lo + (x1 - x0));
          if (state.manualY || (panZoomY && Math.abs(dy) > PAN_Y_THRESHOLD)) {
            setYs(u, (y) => {
              const [y0, y1] = start.y.get(y.key) ?? range(u, y.key);
              const shiftY = (dy / over.clientHeight) * (y1 - y0);
              return [y0 + shiftY, y1 + shiftY];
            });
          }
          notify();
        });

        over.addEventListener('dblclick', onReset);

        addTouchControls(u, over, {
          state,
          fullMin,
          fullMax,
          panZoomY,
          yScales,
          setX,
          setXScale,
          setYs,
          range,
          xRange,
          notify,
          onReset,
        });

        placeHandles = addAxisHandles(u, over, { yScales, setX, setYs, range, xRange, notify });
      },
    },
  };

  const cursor: uPlot.Cursor = { move: snapToNearestPoint, drag: { x: false, y: false, setScale: false } };
  return { scales, cursor, plugin };
}
