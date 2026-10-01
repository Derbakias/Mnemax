// TODO: !IMPORTANT! This one needs to be broken down it's too large
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

import { Icon } from '../ui/icon';
import {
  AXIS_DRAG_SCALE,
  AXIS_FONT,
  AXIS_VALUE_PAD,
  CHART_RANGES,
  DATE_LABEL_SPACE,
  MIN_ZOOM_ROUNDS,
  PAGE_SCROLL_GRACE_MS,
  PAN_Y_THRESHOLD,
  WHEEL_ZOOM,
  Y_HANDLE_WIDTH,
  Y_MAX_SHARE,
  Y_MIN_SHARE,
} from '@/config/charts';
import { useElementWidth } from '@/hooks/use-element-width';
import { DATE_LOCALE } from '@/lib/stats';
import type { Theme } from '@/lib/theme';

interface UPlotChartProps {
  /** Memoize these: a new object rebuilds the chart. */
  options: Omit<uPlot.Options, 'width' | 'height'>;
  data: uPlot.AlignedData;
  height: number;
  /** Receives the live chart, e.g. to show or hide series without rebuilding it. */
  plotRef?: RefObject<uPlot | null>;
  /** For a chart built with `chartInteraction`: its crosshair switch (see CrosshairToggle) applies. */
  zoom?: ChartZoom;
}

// uPlot draws on a canvas, so it can't follow CSS: the chart is rebuilt whenever its options or data
// change (theme colors come in through the options), and only resized when the width changes.
export function UPlotChart({ options, data, height, plotRef: externalRef, zoom }: UPlotChartProps) {
  const [boxRef, width] = useElementWidth<HTMLDivElement>();
  const plotRef = useRef<uPlot | null>(null);
  const externalRefRef = useRef(externalRef);
  externalRefRef.current = externalRef;
  const widthRef = useRef(width);
  widthRef.current = width;
  const hasWidth = width > 0;

  useEffect(() => {
    const el = boxRef.current;
    if (!el || !hasWidth) {
      return;
    }
    const plot = new uPlot({ ...options, width: widthRef.current, height }, data, el);
    plotRef.current = plot;
    if (externalRefRef.current) {
      externalRefRef.current.current = plot;
    }
    return () => {
      plot.destroy();
      plotRef.current = null;
      if (externalRefRef.current) {
        externalRefRef.current.current = null;
      }
    };
  }, [boxRef, options, data, height, hasWidth]);

  useEffect(() => {
    if (width > 0) {
      plotRef.current?.setSize({ width, height });
    }
  }, [width, height]);

  // Turning the crosshair off takes it (and the tooltip) away at once.
  const crosshair = zoom?.crosshair ?? false;
  useEffect(() => {
    if (!crosshair) {
      plotRef.current?.setCursor({ left: -10, top: -10 });
    }
  }, [crosshair]);

  // The box holds the chart's height before uPlot has drawn into it (a new chart waits a render for its
  // width), so rebuilding one, like picking another mode, doesn't move the page under it.
  const box = <div ref={boxRef} className="uplot-box" style={{ minHeight: height }} />;
  if (!zoom) {
    return box;
  }
  // The touch gestures read the switch from `data-crosshair` (see chartInteraction), so flipping it
  // doesn't rebuild the chart.
  return (
    <div className="uplot-frame" data-crosshair={crosshair ? 'on' : 'off'}>
      {box}
    </div>
  );
}

/**
 * The time range chips every chart has (the last `days` days, or all of them for null). While zoomed the
 * view is no range in particular, so none is shown as picked; picking one (even the same) starts unzoomed.
 */
export function RangeChips({
  days,
  zoom,
  onPick,
}: {
  days: number | null;
  zoom: ChartZoom;
  onPick: (days: number | null) => void;
}) {
  return (
    <div className="chip-row">
      {CHART_RANGES.map((range) => (
        <button
          key={range.label}
          type="button"
          className={days === range.days && !zoom.zoomed ? 'filter-chip t-code on' : 'filter-chip t-code'}
          onClick={() => {
            onPick(range.days);
            zoom.reset();
          }}
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}

/**
 * What goes in the header of a section with a chart built with `chartInteraction`: the crosshair switch, and
 * Reset zoom beside it while zoomed.
 */
export function ChartZoomActions({ zoom }: { zoom: ChartZoom }) {
  return (
    <>
      <CrosshairToggle zoom={zoom} />
      {zoom.zoomed && (
        <button type="button" className="filter-chip t-code" onClick={zoom.reset}>
          Reset zoom
        </button>
      )}
    </>
  );
}

/**
 * The crosshair switch, shown on touch screens only (with a mouse, the crosshair simply follows the pointer).
 * One finger moves the crosshair while it's on, and the chart while it's off.
 */
function CrosshairToggle({ zoom }: { zoom: ChartZoom }) {
  return (
    <button
      type="button"
      className={zoom.crosshair ? 'crosshair-toggle on' : 'crosshair-toggle'}
      aria-label="Crosshair"
      aria-pressed={zoom.crosshair}
      title={zoom.crosshair ? 'Crosshair on: one finger reads values' : 'Crosshair off: one finger moves the chart'}
      onClick={() => zoom.setCrosshair((v) => !v)}
    >
      <Icon name="locate-outline" size={22} />
    </button>
  );
}

/** Axis styling shared by all charts. */
export function axisStyle(theme: Theme, extra: Partial<uPlot.Axis> = {}): uPlot.Axis {
  return {
    stroke: theme.textSecondary,
    font: AXIS_FONT,
    grid: { stroke: theme.backgroundSelected, width: 1 },
    ticks: { show: false },
    gap: 4,
    ...extra,
  };
}

let measureContext: CanvasRenderingContext2D | null = null;

/**
 * An axis `size` just wide enough for its widest value, so the axis title sits close to the numbers
 * however many digits they have (a fixed size left a wide gap beside short ones).
 */
export function fitAxisSize(min = 16): uPlot.Axis.Size {
  return (_u, values) => {
    if (!values?.length) {
      return min;
    }
    measureContext ??= document.createElement('canvas').getContext('2d');
    if (!measureContext) {
      return min;
    }
    measureContext.font = AXIS_FONT;
    const widest = Math.max(...values.map((v) => measureContext!.measureText(String(v)).width));
    return Math.max(min, Math.ceil(widest) + 4 + AXIS_VALUE_PAD);
  };
}

/**
 * X axis for charts that place rounds one after another (x = 1, 2, 3…, one per round, like Monkeytype's
 * tests): instead of round numbers it labels the first round of each day with its date, thinned out to fit
 * the width. When every round is from the same day, each round is labelled with its time instead.
 */
export function roundDateAxis(theme: Theme, times: number[]): uPlot.Axis {
  const dayOf = (x: number) => new Date(times[x - 1]).toDateString();
  return axisStyle(theme, {
    grid: { show: false },
    // Only the rounds in view (the chart may be zoomed in).
    splits: (u, _axis, min, max) => {
      const visible = times.map((_, i) => i + 1).filter((x) => x >= min && x <= max);
      const firsts = visible.filter((x, j) => j === 0 || dayOf(x) !== dayOf(visible[j - 1]));
      const candidates = firsts.length === 1 ? visible : firsts;
      // Rounds aren't spread evenly over days, so thin by on-screen distance rather than by count,
      // starting from the newest so the latest day always has a label. None sticks out past the plot's
      // left end, where it would run into the lowest value.
      const plotWidth = u.bbox.width / uPlot.pxRatio;
      const pos = (x: number) => ((x - min) / (max - min || 1)) * plotWidth;
      const kept: number[] = [];
      let lastPos = Infinity;
      for (let j = candidates.length - 1; j >= 0; j--) {
        const p = pos(candidates[j]);
        if (p < DATE_LABEL_SPACE / 2) {
          break;
        }
        if (lastPos - p >= DATE_LABEL_SPACE) {
          kept.unshift(candidates[j]);
          lastPos = p;
        }
      }
      return kept;
    },
    values: (_u, splits) => {
      const oneDay = splits.length > 1 && splits.every((x) => dayOf(x) === dayOf(splits[0]));
      return splits.map((x) => {
        const time = times[x - 1];
        if (time == null) {
          return '';
        }
        const date = new Date(time);
        return oneDay
          ? date.toLocaleTimeString(DATE_LOCALE, { hour: '2-digit', minute: '2-digit' })
          : date.toLocaleDateString(DATE_LOCALE, { month: 'short', day: 'numeric' });
      });
    },
  });
}

/**
 * X axis for charts with one x step per calendar day (x in seconds, each day's value at its midnight): labels
 * days in the same format as `roundDateAxis` ("27 Aug" in the reader's language, not uPlot's own "8/27"),
 * thinned to fit the width the same way.
 */
export function dayDateAxis(theme: Theme): uPlot.Axis {
  return axisStyle(theme, {
    grid: { show: false },
    splits: (u, _axis, min, max) => {
      const days: number[] = [];
      const day = new Date(min * 1000);
      day.setHours(0, 0, 0, 0);
      if (day.getTime() / 1000 < min) {
        day.setDate(day.getDate() + 1);
      }
      for (; day.getTime() / 1000 <= max; day.setDate(day.getDate() + 1)) {
        days.push(day.getTime() / 1000);
      }
      // As on the round axis: from the newest day back, so the latest has a label, and none sticking out
      // past the plot's left end.
      const plotWidth = u.bbox.width / uPlot.pxRatio;
      const pos = (x: number) => ((x - min) / (max - min || 1)) * plotWidth;
      const kept: number[] = [];
      let lastPos = Infinity;
      for (let j = days.length - 1; j >= 0; j--) {
        const p = pos(days[j]);
        if (p < DATE_LABEL_SPACE / 2) {
          break;
        }
        if (lastPos - p >= DATE_LABEL_SPACE) {
          kept.unshift(days[j]);
          lastPos = p;
        }
      }
      return kept;
    },
    values: (_u, splits) =>
      splits.map((x) => new Date(x * 1000).toLocaleDateString(DATE_LOCALE, { month: 'short', day: 'numeric' })),
  });
}

/**
 * A magnetic crosshair (`cursor.move`): the vertical line jumps to the nearest data point on x, and the
 * horizontal line to whichever visible series value there is closest to the pointer.
 */
export const snapToNearestPoint: uPlot.Cursor.MousePosRefiner = (u, left, top) => {
  if (left < 0) {
    return [left, top];
  }
  const idx = u.posToIdx(left);
  const x = u.data[0][idx];
  if (x == null) {
    return [left, top];
  }
  let bestTop = top;
  let bestDistance = Infinity;
  u.series.forEach((series, i) => {
    if (i === 0 || !series.show) {
      return;
    }
    const value = (u.data[i] as (number | null | undefined)[])[idx];
    if (value == null) {
      return;
    }
    const pos = u.valToPos(value, series.scale ?? 'y');
    if (Math.abs(pos - top) < bestDistance) {
      bestDistance = Math.abs(pos - top);
      bestTop = pos;
    }
  });
  return [u.valToPos(x, 'x'), bestTop];
};

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

  /**
   * Drags an element with the primary button (mouse or pen), calling `move` with the offset so far. With
   * `touch`, a finger drags it too: the axis handles, where the element's `touch-action` leaves the drag's
   * direction to it. The chart itself handles touch on its own (below).
   */
  const onDrag = (el: HTMLElement, move: (dx: number, dy: number) => void, touch = false) => {
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.pointerType === 'touch' && !touch)) {
        return;
      }
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startY = e.clientY;
      const onMove = (ev: PointerEvent) => move(ev.clientX - startX, ev.clientY - startY);
      const onUp = () => {
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
        el.classList.remove('dragging');
      };
      el.classList.add('dragging');
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
    });
  };

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

        // Touch (the mouse controls above skip it). One finger moves the crosshair and tooltip when the
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

        // Invisible strips over the axes (uPlot draws axes on the canvas, so they have no elements).
        const xHandle = document.createElement('div');
        xHandle.className = 'axis-handle x';
        xHandle.title = 'Drag left or right to stretch the time axis';
        over.parentElement?.append(xHandle);
        let xStart: readonly [number, number] = [0, 0];
        xHandle.addEventListener('pointerdown', () => (xStart = xRange()));
        // Right or up zooms in; left or down zooms out, around the middle of the axis.
        onDrag(
          xHandle,
          (dx) => {
            const [x0, x1] = xStart;
            const width = (x1 - x0) * Math.exp(-dx / AXIS_DRAG_SCALE);
            const mid = (x0 + x1) / 2;
            setX(u, mid - width / 2, mid + width / 2);
            notify();
          },
          true,
        );

        // One handle per y axis; stretching one moves only that axis.
        const yHandles = yScales.map((y) => {
          const handle = document.createElement('div');
          handle.className = 'axis-handle y';
          handle.title = 'Drag up or down to stretch the value axis';
          over.parentElement?.append(handle);
          let yStart: readonly [number, number] = [0, 0];
          handle.addEventListener('pointerdown', () => (yStart = range(u, y.key)));
          onDrag(
            handle,
            (_dx, dy) => {
              const [y0, y1] = yStart;
              const height = (y1 - y0) * Math.exp(dy / AXIS_DRAG_SCALE);
              const mid = (y0 + y1) / 2;
              setYs(u, (other) => (other.key === y.key ? [mid - height / 2, mid + height / 2] : range(u, other.key)));
              notify();
            },
            true,
          );
          return { y, handle };
        });

        placeHandles = () => {
          const left = u.bbox.left / uPlot.pxRatio;
          const top = u.bbox.top / uPlot.pxRatio;
          const width = u.bbox.width / uPlot.pxRatio;
          const height = u.bbox.height / uPlot.pxRatio;
          Object.assign(xHandle.style, { left: `${left}px`, top: `${top + height}px`, width: `${width}px` });
          for (const { y, handle } of yHandles) {
            const x = y.side === 'right' ? left + width : Math.max(0, left - Y_HANDLE_WIDTH);
            Object.assign(handle.style, { left: `${x}px`, top: `${top}px`, height: `${height}px` });
          }
        };
        placeHandles();
      },
    },
  };

  const cursor: uPlot.Cursor = { move: snapToNearestPoint, drag: { x: false, y: false, setScale: false } };
  return { scales, cursor, plugin };
}

/** A y range fitted to the data in view: padded, snapped to `step`, and kept within [floor, ceiling]. */
export function fittedRange(step: number, floor: number, ceiling = Infinity): uPlot.Range.Function {
  return (_u, min, max) => {
    if (min == null || max == null) {
      return [floor, Math.min(ceiling, floor + step * 4)];
    }
    const pad = Math.max(step / 2, (max - min) * 0.1);
    const lo = Math.max(floor, Math.floor((min - pad) / step) * step);
    const hi = Math.min(ceiling, Math.ceil((max + pad) / step) * step);
    return [lo, Math.max(hi, lo + step)];
  };
}

/** Adds an alpha channel to a #rrggbb color. */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

/** A series drawn as dots only (one per round); smaller once there are many, so they don't merge into a band. */
export function dotSeries(label: string, color: string, value: uPlot.Series['value'], count = 0): uPlot.Series {
  return {
    label,
    stroke: withAlpha(color, 0.5),
    fill: withAlpha(color, 0.5),
    paths: () => null,
    points: { show: true, size: count > 60 ? 4 : 6, width: 0, fill: withAlpha(color, 0.45) },
    value,
  };
}

/**
 * Draws a trend line through every point, as a monotone cubic curve: it bends smoothly but never
 * overshoots, so it doesn't show values that aren't there, and it shows the same values at every zoom.
 * Gaps (nulls) are bridged.
 */
const smoothLinePaths: uPlot.Series.PathBuilder = (u, seriesIdx, idx0, idx1) => {
  const xs = u.data[0];
  const ys = u.data[seriesIdx] as (number | null | undefined)[];
  const scale = u.series[seriesIdx].scale ?? 'y';
  // One point either side of the view too, so the line runs off the edges instead of stopping short.
  const from = Math.max(0, idx0 - 1);
  const to = Math.min(xs.length - 1, idx1 + 1);
  const px: number[] = [];
  const py: number[] = [];
  for (let i = from; i <= to; i++) {
    const y = ys[i];
    if (y == null) {
      continue;
    }
    px.push(u.valToPos(xs[i], 'x', true));
    py.push(u.valToPos(y, scale, true));
  }

  const stroke = new Path2D();
  const n = px.length;
  if (n > 0) {
    stroke.moveTo(px[0], py[0]);
  }
  if (n === 2) {
    stroke.lineTo(px[1], py[1]);
  }
  if (n > 2) {
    // Fritsch–Carlson tangents: the curve stays monotone between points, so it can't overshoot.
    const slope = px.slice(1).map((x, i) => (py[i + 1] - py[i]) / (x - px[i] || 1));
    const tangent = px.map((_, i) =>
      i === 0
        ? slope[0]
        : i === n - 1
          ? slope[n - 2]
          : slope[i - 1] * slope[i] <= 0
            ? 0
            : (slope[i - 1] + slope[i]) / 2,
    );
    for (let i = 0; i < n - 1; i++) {
      if (slope[i] === 0) {
        tangent[i] = tangent[i + 1] = 0;
        continue;
      }
      const a = tangent[i] / slope[i];
      const b = tangent[i + 1] / slope[i];
      const h = a * a + b * b;
      if (h > 9) {
        const t = 3 / Math.sqrt(h);
        tangent[i] = t * a * slope[i];
        tangent[i + 1] = t * b * slope[i];
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const third = (px[i + 1] - px[i]) / 3;
      stroke.bezierCurveTo(
        px[i] + third,
        py[i] + tangent[i] * third,
        px[i + 1] - third,
        py[i + 1] - tangent[i + 1] * third,
        px[i + 1],
        py[i + 1],
      );
    }
  }
  // Kept inside the plot, as the line now reaches past the view's edges.
  const clip = new Path2D();
  clip.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height);
  return { stroke, fill: null, clip, flags: 0 };
};

/** A smooth trend line (a rolling average), bridging gaps where there is no data; see `smoothLinePaths`. */
export function lineSeries(
  label: string,
  color: string,
  value: uPlot.Series['value'],
  extra: Partial<uPlot.Series> = {},
): uPlot.Series {
  return {
    label,
    stroke: color,
    width: 2,
    points: { show: false },
    spanGaps: true,
    paths: smoothLinePaths,
    value,
    ...extra,
  };
}

export interface TooltipContent {
  title: string;
  rows: [label: string, value: string][];
}

/**
 * A floating tooltip that follows the cursor (or a tap) and shows details for the data point under it.
 * Charts using it usually hide uPlot's legend (`legend: { show: false }`).
 */
export function tooltipPlugin(render: (idx: number) => TooltipContent | null): uPlot.Plugin {
  let tip: HTMLDivElement | null = null;
  return {
    hooks: {
      init: (u) => {
        tip = document.createElement('div');
        tip.className = 'chart-tooltip';
        tip.style.display = 'none';
        u.over.appendChild(tip);
      },
      setCursor: (u) => {
        if (!tip) {
          return;
        }
        const { idx, left, top } = u.cursor;
        const content = idx == null || left == null || left < 0 ? null : render(idx);
        if (!content || left == null) {
          tip.style.display = 'none';
          return;
        }
        const title = document.createElement('div');
        title.className = 'chart-tooltip-title';
        title.textContent = content.title;
        const rows = content.rows.map(([label, value]) => {
          const row = document.createElement('div');
          row.className = 'chart-tooltip-row';
          const l = document.createElement('span');
          l.textContent = label;
          const v = document.createElement('span');
          v.textContent = value;
          row.append(l, v);
          return row;
        });
        tip.replaceChildren(title, ...rows);
        tip.style.display = 'block';

        // Right of the cursor, or left of it near the right edge; vertically centred, kept inside.
        const width = u.over.clientWidth;
        const height = u.over.clientHeight;
        const x = left + 14 + tip.offsetWidth > width ? left - 14 - tip.offsetWidth : left + 14;
        const y = Math.min(Math.max(0, (top ?? 0) - tip.offsetHeight / 2), Math.max(0, height - tip.offsetHeight));
        tip.style.transform = `translate(${Math.max(0, x)}px, ${y}px)`;
      },
    },
  };
}
