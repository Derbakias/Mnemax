import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import { cn } from '@/lib/cn';

import { Icon } from './icon';

const styles = {
  button: [
    'inline-flex cursor-pointer rounded-[50%] p-[3px] text-text-secondary',
    'hover:bg-background-element hover:text-text',
    'data-[pinned=true]:bg-background-element data-[pinned=true]:text-text',
    // Sized so the circle is as tall as the heading's capitals, and centred on them.
    'in-data-section-header:transform-[translateY(0.33px)]',
  ],
  // The note opens under the whole section header (not the icon), so it always fits the content width.
  panel: [
    'absolute top-[calc(100%+2px)] left-0 z-20 box-border w-[min(360px,100%)]',
    'flex flex-col gap-1.5 px-3.5 py-3 text-left text-text',
    'rounded-xl border border-background-selected bg-background shadow-(--shadow-popover)',
    '[&_p]:m-0 [&_strong]:font-semibold [&_.icon]:align-[-2px]',
  ],
};

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
    if (!open) {
      return;
    }
    if (closeOpenPopup !== close) {
      closeOpenPopup?.();
    }
    closeOpenPopup = close;
    return () => {
      if (closeOpenPopup === close) {
        closeOpenPopup = null;
      }
    };
  }, [open, close]);

  useEffect(() => {
    if (!open) {
      return;
    }
    // A click, not a press: a finger scrolling the page presses outside too, but a scroll or a drag never
    // ends in a click, so only a real tap or click elsewhere closes it. Captured, so it's seen before
    // anything on the page can stop it.
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        close();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
      }
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
    <span className="inline-flex" ref={rootRef} {...hoverHandlers}>
      <button
        type="button"
        className={cn(styles.button)}
        data-pinned={pinned}
        aria-label={`About ${label}`}
        aria-expanded={open}
        onClick={toggle}
      >
        <Icon name="information-circle-outline" size={18} />
      </button>
      {open && (
        <div className={cn('t-small', styles.panel)} role="tooltip">
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
      <p className="hidden [@media(hover:hover)_and_(pointer:fine)]:block">
        <strong>Chart:</strong> scroll to zoom, drag to move, drag an axis to stretch it, double-click to reset.
      </p>
      <p className="hidden [@media(hover:none)]:block">
        <strong>Chart:</strong> pinch to zoom, drag to move, drag along an axis to stretch it, double-tap to reset. Turn
        on the crosshair (the icon above the chart) to read values with one finger instead.
      </p>
    </>
  );
}
