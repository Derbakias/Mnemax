import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { Icon } from '../components/ui/icon';
import { STREAM_ICONS, SWIPE_DEAD_ZONE, SWIPE_STEP, TRAIL_FADE_MS, TRAIL_WIDTH } from '@/config/ui';
import type { StreamId } from '@/game/types';
import { STREAM_LABELS } from '@/game/types';
import { keyLabel, normalizeKey, type ButtonLayout } from '@/lib/prefs';

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

/**
 * The swipe's path, drawn on a canvas over the buttons: the whole path stays while the finger is down, then fades
 * out once it lifts.
 */
function useSwipeTrail() {
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

interface ResponseButtonsProps {
  streams: StreamId[];
  responded: Record<StreamId, boolean>;
  /** The current trial's matches: an answered button turns blue when right, red when wrong. */
  match: Record<StreamId, boolean>;
  /** Tutorial: outline the buttons that should be pressed this trial. */
  showSolution?: boolean;
  disabled: boolean;
  layout: ButtonLayout;
  /** Press a button and slide over the others to answer them too (two per row only, two or more buttons). */
  swipe?: boolean;
  /** The current trial. When the next box appears, a swipe still in progress ends, so it can't answer the new trial. */
  trial?: number;
  /** The key that answers each stream (shown as a hint; holding it lights the button). */
  keys: Record<StreamId, string>;
  onPress: (stream: StreamId) => void;
}

export function ResponseButtons({
  streams,
  responded,
  match,
  showSolution = false,
  disabled,
  layout,
  swipe = false,
  trial,
  keys,
  onPress,
}: ResponseButtonsProps) {
  const swipeOn = swipe && layout === 'grid' && streams.length >= 2;
  // The buttons share the room left under the grid, so with one or two they're big enough for a bigger label.
  const large = streams.length <= 2;
  // Buttons stay lit while held (pointer or the stream's key). Tracked by hand because `:active` doesn't
  // fire reliably once pointerdown is cancelled, which it is to respond on press-down.
  const [held, setHeld] = useState<ReadonlySet<StreamId>>(new Set());
  const hold = (stream: StreamId, on: boolean) =>
    setHeld((prev) => {
      if (prev.has(stream) === on) {
        return prev;
      }
      const next = new Set(prev);
      if (on) {
        next.add(stream);
      } else {
        next.delete(stream);
      }
      return next;
    });

  // A disabled button gets no pointerup, so drop any hold when the buttons turn off (pause, round end).
  useEffect(() => {
    if (disabled) {
      setHeld(new Set());
    }
  }, [disabled]);

  // The key listeners are attached once and read the latest props from a ref. Re-attaching them on
  // every render broke real key presses: the Play screen's own keydown listener records the answer
  // first, React re-renders before the next listener runs, and a listener removed mid-dispatch is
  // skipped, so this one never saw the key.
  const latest = useRef({ streams, disabled, keys });
  latest.current = { streams, disabled, keys };
  useEffect(() => {
    const keyStream = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return undefined;
      }
      const { streams: active, keys: bound } = latest.current;
      return active.find((s) => bound[s] === normalizeKey(e.key));
    };
    const onDown = (e: KeyboardEvent) => {
      const stream = keyStream(e);
      if (stream && !latest.current.disabled) {
        hold(stream, true);
      }
    };
    const onUp = (e: KeyboardEvent) => {
      const stream = keyStream(e);
      if (stream) {
        hold(stream, false);
      }
    };
    const clear = () => setHeld(new Set());
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', clear);
    };
  }, []);

  // Set when a press was answered on pointerdown, so the click that follows it doesn't answer again.
  const answeredOnDown = useRef(false);

  const container = useRef<HTMLDivElement>(null);
  const buttonEls = useRef(new Map<StreamId, HTMLButtonElement>());
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

  const renderButton = (stream: StreamId) => (
    <button
      key={stream}
      ref={(b) => {
        if (b) {
          buttonEls.current.set(stream, b);
        } else {
          buttonEls.current.delete(stream);
        }
      }}
      type="button"
      className={[
        'response-button',
        // Stays until the trial ends, so even a quick tap shows whether it was right.
        responded[stream] ? (match[stream] ? 'correct' : 'wrong') : '',
        showSolution && match[stream] ? 'solution' : '',
        held.has(stream) ? 'held' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      disabled={disabled}
      // Answers come from the assigned keys, so these never need focus (a focused button would keep its ring).
      tabIndex={-1}
      // Respond on press-down, not release: the response time is part of the score.
      onPointerDown={(e) => {
        // Only a mouse has other buttons; touch and pen contacts are always answers.
        if (e.pointerType === 'mouse' && e.button !== 0) {
          return;
        }
        e.preventDefault();
        answeredOnDown.current = true;
        hold(stream, true);
        if (!responded[stream]) {
          onPress(stream);
        }
        // One swipe at a time; another finger meanwhile is a plain tap.
        if (swipeOn && !gesture.current && startSwipe(stream, e)) {
          return;
        }
        // Capture so the release is seen even if the finger slides off the button. After answering, so a
        // webview that refuses the capture can't lose the answer.
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // The release still clears the hold (pointerup / pointercancel).
        }
      }}
      onPointerUp={() => hold(stream, false)}
      onPointerCancel={() => hold(stream, false)}
      onLostPointerCapture={() => hold(stream, false)}
      onClick={(e) => {
        e.preventDefault();
        // Fallback for a webview that delivers the tap as a click without a usable pointerdown.
        if (!answeredOnDown.current && !responded[stream]) {
          onPress(stream);
        }
        answeredOnDown.current = false;
      }}
    >
      <Icon name={STREAM_ICONS[stream]} />
      <span className={large ? 't-default response-label' : 't-small response-label'}>{STREAM_LABELS[stream]}</span>
      <kbd className="key-hint">{keyLabel(keys[stream])}</kbd>
    </button>
  );

  return (
    <div
      ref={container}
      className={`response-buttons ${layout}${swipeOn ? ' swipe' : ''}`}
      onPointerMove={(e) => {
        if (gesture.current?.pointerId !== e.pointerId) {
          return;
        }
        // Every point since the last event, so the trail follows the finger closely.
        const moves = e.nativeEvent.getCoalescedEvents?.() ?? [];
        for (const m of moves.length ? moves : [e.nativeEvent]) {
          swipeTo(m.clientX, m.clientY);
        }
      }}
      onPointerUp={(e) => endSwipe(e.pointerId)}
      onPointerCancel={(e) => endSwipe(e.pointerId)}
      onLostPointerCapture={(e) => endSwipe(e.pointerId)}
      // With the container holding the pointer the click lands here, not on the button, so reset here too.
      onClick={() => {
        answeredOnDown.current = false;
      }}
    >
      {swipeOn && <canvas ref={trail.canvasRef} className="swipe-trail" aria-hidden />}
      {streams.map(renderButton)}
    </div>
  );
}
