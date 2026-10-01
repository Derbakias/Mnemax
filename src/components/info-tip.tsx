import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import { Icon } from './icon';

/** Closes the popup open right now (see `useHoverOrTap`), so only one is ever open. */
let closeOpenPopup: (() => void) | null = null;

/**
 * Open state for a small popup that shows while a mouse hovers its trigger, and stays open after a click or
 * tap (touch screens have no hover) until a second one, a click or tap outside `rootRef`, Escape, or another
 * popup opening. Scrolling leaves it open, so a long note can be read while scrolling. Spread
 * `hoverHandlers` on the element wrapping trigger and popup; call `toggle` from the trigger.
 */
export function useHoverOrTap<T extends HTMLElement>() {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const rootRef = useRef<T>(null);
  const open = pinned || hovered;
  const close = useCallback(() => {
    setPinned(false);
    setHovered(false);
  }, []);

  // Opening closes whichever other one is open, whatever becomes of the press that opened this one.
  useEffect(() => {
    if (!open) return;
    if (closeOpenPopup !== close) closeOpenPopup?.();
    closeOpenPopup = close;
    return () => {
      if (closeOpenPopup === close) closeOpenPopup = null;
    };
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    // A click, not a press: a finger scrolling the page presses outside too, but a scroll or a drag never
    // ends in a click, so only a real tap or click elsewhere closes it. Captured, so it's seen before
    // anything on the page can stop it.
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  return {
    rootRef,
    open,
    pinned,
    toggle: () => {
      setPinned((v) => !v);
      setHovered(false);
    },
    hoverHandlers: {
      onPointerEnter: (e: ReactPointerEvent<T>) => e.pointerType === 'mouse' && setHovered(true),
      onPointerLeave: (e: ReactPointerEvent<T>) => e.pointerType === 'mouse' && setHovered(false),
    },
  };
}

/** An ⓘ button that explains the thing next to it, on hover or tap (see `useHoverOrTap`). */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const { rootRef, open, pinned, toggle, hoverHandlers } = useHoverOrTap<HTMLSpanElement>();

  return (
    <span className="info-tip" ref={rootRef} {...hoverHandlers}>
      <button
        type="button"
        className={pinned ? 'info-tip-button on' : 'info-tip-button'}
        aria-label={`About ${label}`}
        aria-expanded={open}
        onClick={toggle}
      >
        <Icon name="information-circle-outline" size={18} />
      </button>
      {open && (
        <div className="info-tip-panel t-small" role="tooltip">
          {children}
        </div>
      )}
    </span>
  );
}

/** How to move round charts around, for the notes of sections that have one: the mouse or the touch version. */
export function ChartControlsTip() {
  return (
    <>
      <p className="zoom-hint">
        <strong>Chart:</strong> scroll to zoom, drag to move, drag an axis to stretch it, double-click to reset.
      </p>
      <p className="zoom-hint-touch">
        <strong>Chart:</strong> pinch to zoom, drag to move, drag along an axis to stretch it, double-tap to reset. Turn
        on the crosshair (the icon above the chart) to read values with one finger instead.
      </p>
    </>
  );
}
