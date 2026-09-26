import { useEffect, useRef, useState } from 'react';

import { Icon, type IconName } from './icon';
import type { StreamId } from '@/game/types';
import { STREAM_LABELS } from '@/game/types';
import { keyLabel, normalizeKey, type ButtonLayout } from '@/prefs';

export const STREAM_ICONS: Record<StreamId, IconName> = {
  position: 'grid-outline',
  color: 'color-palette-outline',
  number: 'calculator-outline',
  audio: 'volume-high-outline',
};

interface ResponseButtonsProps {
  streams: StreamId[];
  responded: Record<StreamId, boolean>;
  disabled: boolean;
  layout: ButtonLayout;
  /** The key that answers each stream (shown as a hint; holding it lights the button). */
  keys: Record<StreamId, string>;
  onPress: (stream: StreamId) => void;
}

export function ResponseButtons({ streams, responded, disabled, layout, keys, onPress }: ResponseButtonsProps) {
  const compact = layout === 'grid' && streams.length > 3;
  // Buttons stay lit while held (pointer or the stream's key). Tracked by hand because `:active` doesn't
  // fire reliably once pointerdown is cancelled, which it is to respond on press-down.
  const [held, setHeld] = useState<ReadonlySet<StreamId>>(new Set());
  const hold = (stream: StreamId, on: boolean) =>
    setHeld((prev) => {
      if (prev.has(stream) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(stream);
      else next.delete(stream);
      return next;
    });

  // A disabled button gets no pointerup, so drop any hold when the buttons turn off (pause, round end).
  useEffect(() => {
    if (disabled) setHeld(new Set());
  }, [disabled]);

  // The key listeners are attached once and read the latest props from a ref. Re-attaching them on
  // every render broke real key presses: the Play screen's own keydown listener records the answer
  // first, React re-renders before the next listener runs, and a listener removed mid-dispatch is
  // skipped, so this one never saw the key.
  const latest = useRef({ streams, disabled, keys });
  latest.current = { streams, disabled, keys };
  useEffect(() => {
    const keyStream = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return undefined;
      const { streams: active, keys: bound } = latest.current;
      return active.find((s) => bound[s] === normalizeKey(e.key));
    };
    const onDown = (e: KeyboardEvent) => {
      const stream = keyStream(e);
      if (stream && !latest.current.disabled) hold(stream, true);
    };
    const onUp = (e: KeyboardEvent) => {
      const stream = keyStream(e);
      if (stream) hold(stream, false);
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

  const renderButton = (stream: StreamId) => (
    <button
      key={stream}
      type="button"
      className={`response-button${held.has(stream) ? ' held' : ''}${compact ? ' compact' : ''}`}
      disabled={disabled}
      // Answers come from the assigned keys, so these never need focus (a focused button would keep its ring).
      tabIndex={-1}
      // Respond on press-down, not release: the response time is part of the score.
      onPointerDown={(e) => {
        // Only a mouse has other buttons; touch and pen contacts are always answers.
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        answeredOnDown.current = true;
        hold(stream, true);
        if (!responded[stream]) onPress(stream);
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
        if (!answeredOnDown.current && !responded[stream]) onPress(stream);
        answeredOnDown.current = false;
      }}>
      <Icon name={STREAM_ICONS[stream]} size={compact ? 20 : 22} />
      <span className="t-small">{STREAM_LABELS[stream]}</span>
      <kbd className="key-hint">{keyLabel(keys[stream])}</kbd>
    </button>
  );

  return <div className={`response-buttons ${layout}`}>{streams.map(renderButton)}</div>;
}

/**
 * On a phone, sits under the controls and takes the height of the answer buttons that aren't shown (fewer
 * than four streams), so the grid stays where it is with four and the spare room ends up at the bottom.
 * Hidden and empty; its boxes are sized like the buttons by the phone styles.
 */
export function ButtonRoomFiller({ layout, count }: { layout: ButtonLayout; count: number }) {
  const missingRows = layout === 'rows' ? 4 - count : 2 - Math.ceil(count / 2);
  if (missingRows <= 0) return null;
  const boxes = layout === 'rows' ? missingRows : missingRows * 2;
  return (
    <div className={`response-buttons ${layout} stage-filler`} aria-hidden>
      {Array.from({ length: boxes }, (_, i) => (
        <div key={i} className="response-button" />
      ))}
    </div>
  );
}
