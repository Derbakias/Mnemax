import uPlot from 'uplot';

import { AXIS_DRAG_SCALE, Y_HANDLE_WIDTH } from '@/config/charts';
import type { InteractiveYScale } from './zoom';

/**
 * Drags an element with the primary button (mouse or pen), calling `move` with the offset so far. With
 * `touch`, a finger drags it too: the axis handles, where the element's `touch-action` leaves the drag's
 * direction to it. The chart itself handles touch on its own (see addTouchControls).
 */
export const onDrag = (el: HTMLElement, move: (dx: number, dy: number) => void, touch = false) => {
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

/** What the axis handles share with `chartInteraction`, which made them. */
export interface AxisHandlesContext {
  yScales: InteractiveYScale[];
  setX: (u: uPlot, lo: number, hi: number) => void;
  setYs: (u: uPlot, to: (scale: InteractiveYScale) => readonly [number, number]) => void;
  range: (u: uPlot, key: string) => readonly [number, number];
  xRange: () => readonly [number, number];
  notify: () => void;
}

/**
 * Adds a strip over each axis that stretches it when dragged: `over` is the chart's plot area, and `ctx`
 * the zoom it moves. Gives back `placeHandles`, which lines the strips up with the axes again.
 */
export function addAxisHandles(u: uPlot, over: HTMLElement, ctx: AxisHandlesContext) {
  const { yScales, setX, setYs, range, xRange, notify } = ctx;

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

  const placeHandles = () => {
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
  return placeHandles;
}
