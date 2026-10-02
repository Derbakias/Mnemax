import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

import { SWIPE_DEAD_ZONE, SWIPE_STEP } from '@/config/ui';
import type { StreamId } from '@/game/types';

import { useSwipeTrail } from './trail';

interface SwipeGesture {
  pointerId: number;
  /** The buttons' boxes, and the meeting points, taken when the swipe starts (the layout holds still during it). */
  buttons: { stream: StreamId; rect: DOMRect }[];
  junctions: { x: number; y: number }[];
  deadZone: number;
  /** The button under the pointer; null in a gap or a dead zone. */
  current: StreamId | null;
  /** Lit until the swipe ends. */
  visited: Set<StreamId>;
  /** The last pointer sample, where the line to the next one starts. */
  last: { x: number; y: number };
}

/** The points where the rows of two per row meet the middle column gap. */
function swipeJunctions(buttons: { rect: DOMRect }[]): { x: number; y: number }[] {
  const rows: DOMRect[][] = [];
  for (const { rect } of [...buttons].sort((a, b) => a.rect.top - b.rect.top)) {
    const row = rows.find((r) => Math.abs(r[0].top - rect.top) < 1);
    if (row) {
      row.push(rect);
    } else {
      rows.push([rect]);
    }
  }
  const pair = rows.find((r) => r.length === 2)?.sort((a, b) => a.left - b.left);
  if (!pair) {
    return [];
  }
  const x = (pair[0].right + pair[1].left) / 2;
  const out: { x: number; y: number }[] = [];
  for (let i = 1; i < rows.length; i++) {
    out.push({ x, y: (Math.max(...rows[i - 1].map((r) => r.bottom)) + rows[i][0].top) / 2 });
  }
  return out;
}

interface UseSwipeOptions {
  streams: StreamId[];
  responded: Record<StreamId, boolean>;
  onPress: (stream: StreamId) => void;
  trial?: number;
  /** Lights a button, or turns it off again. */
  hold: (stream: StreamId, on: boolean) => void;
  /** The box around all the buttons; it takes the pointer for the whole swipe. */
  container: RefObject<HTMLDivElement | null>;
  buttonEls: RefObject<Map<StreamId, HTMLButtonElement>>;
  /** Whether the buttons are off right now, read fresh each time so a pause mid-swipe counts at once. */
  latest: RefObject<{ disabled: boolean }>;
}

/**
 * Press one button and slide the finger over others to answer them too. Gives back the canvas for the swipe's line,
 * a way to start a swipe from a button, a check for whether one is going on, and the handlers the buttons' box
 * needs to follow the finger and to notice when it lifts.
 */
export function useSwipe({ streams, responded, onPress, trial, hold, container, buttonEls, latest }: UseSwipeOptions) {
  const gesture = useRef<SwipeGesture | null>(null);
  const trail = useSwipeTrail();

  const startSwipe = (stream: StreamId, e: ReactPointerEvent) => {
    const el = container.current;
    if (!el) {
      return false;
    }
    const buttons = streams.flatMap((s) => {
      const b = buttonEls.current.get(s);
      return b ? [{ stream: s, rect: b.getBoundingClientRect() }] : [];
    });
    const minSide = Math.min(...buttons.map((b) => Math.min(b.rect.width, b.rect.height)));
    gesture.current = {
      pointerId: e.pointerId,
      buttons,
      junctions: swipeJunctions(buttons),
      deadZone: minSide * SWIPE_DEAD_ZONE,
      current: stream,
      visited: new Set([stream]),
      last: { x: e.clientX, y: e.clientY },
    };
    trail.start();
    trail.add(e.clientX, e.clientY);
    // The container takes the pointer, so it sees the slide across every button.
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // Without capture the moves still reach the container while the pointer is over it.
    }
    return true;
  };

  /**
   * Looks at one spot the finger passed through. If it's in a new button, that button is answered. If it's in the
   * same button as before, or between buttons, nothing happens.
   */
  const swipeAt = (g: SwipeGesture, x: number, y: number) => {
    const inside = (r: DOMRect) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    // Leaving the current button's box frees it; an edge wobble doesn't count as a new entry.
    if (g.current) {
      const cur = g.buttons.find((b) => b.stream === g.current);
      if (!cur || !inside(cur.rect)) {
        g.current = null;
      }
    }
    if (g.junctions.some((j) => Math.abs(x - j.x) < g.deadZone && Math.abs(y - j.y) < g.deadZone)) {
      return;
    }
    const hit = g.buttons.find((b) => inside(b.rect))?.stream;
    if (!hit || hit === g.current) {
      return;
    }
    g.current = hit;
    if (latest.current.disabled) {
      return;
    }
    g.visited.add(hit);
    hold(hit, true);
    if (!responded[hit]) {
      onPress(hit);
    }
  };

  const swipeTo = (x: number, y: number) => {
    const g = gesture.current;
    if (!g) {
      return;
    }
    trail.add(x, y);
    // On a fast slide the finger can jump over a button between two positions, so check every few px of the line
    // from the last position to this one.
    const { x: x0, y: y0 } = g.last;
    const steps = Math.max(1, Math.ceil(Math.hypot(x - x0, y - y0) / SWIPE_STEP));
    for (let i = 1; i <= steps; i++) {
      swipeAt(g, x0 + ((x - x0) * i) / steps, y0 + ((y - y0) * i) / steps);
    }
    g.last = { x, y };
  };

  /** Ends the swipe; with a pointer, only if it's the one swiping. */
  const endSwipe = (pointerId?: number) => {
    const g = gesture.current;
    if (!g || (pointerId !== undefined && g.pointerId !== pointerId)) {
      return;
    }
    gesture.current = null;
    g.visited.forEach((s) => hold(s, false));
    trail.end();
  };

  // A swipe only answers one box: end it when the next box appears.
  const endSwipeRef = useRef(endSwipe);
  endSwipeRef.current = endSwipe;
  useEffect(() => {
    endSwipeRef.current();
  }, [trial]);

  return {
    canvasRef: trail.canvasRef,
    isSwiping: () => gesture.current !== null,
    startSwipe,
    containerHandlers: {
      onPointerMove: (e: ReactPointerEvent) => {
        if (gesture.current?.pointerId !== e.pointerId) {
          return;
        }
        // Every point since the last event, so the trail follows the finger closely.
        const moves = e.nativeEvent.getCoalescedEvents?.() ?? [];
        for (const m of moves.length ? moves : [e.nativeEvent]) {
          swipeTo(m.clientX, m.clientY);
        }
      },
      onPointerUp: (e: ReactPointerEvent) => endSwipe(e.pointerId),
      onPointerCancel: (e: ReactPointerEvent) => endSwipe(e.pointerId),
      onLostPointerCapture: (e: ReactPointerEvent) => endSwipe(e.pointerId),
    },
  };
}
