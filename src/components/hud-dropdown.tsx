import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface HudDropdownProps {
  /** What the chip shows. */
  chip: ReactNode;
  /** Accessible name for the chip and its dropdown. */
  label: string;
  title?: string;
  chipClassName?: string;
  disabled?: boolean;
  /** Panel contents; a function gets `close`, to dismiss the panel after a choice. */
  children: ReactNode | ((close: () => void) => ReactNode);
}

/** Gap kept between the panel and the window edge (or the tab bar). */
const EDGE_MARGIN = 12;
/** The panel's offset from the chip (`top: calc(100% + 8px)` in CSS). */
const PANEL_GAP = 8;

// A HUD chip that opens a small panel centred under the HUD row. It closes on a second tap, a tap
// outside, Escape, or when it becomes disabled (e.g. a round starts). The panel always fits on screen:
// it is capped to the room below the chip, or opens upwards when there is more room above, and scrolls.
export function HudDropdown({ chip, label, title, chipClassName, disabled = false, children }: HudDropdownProps) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<{ above: boolean; maxHeight: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    const place = () => {
      const panel = panelRef.current;
      // The wrapper is `display: contents`; the panel hangs off its positioned container (the chip row).
      const chipRect = panel?.offsetParent?.getBoundingClientRect();
      if (!chipRect || !panel) return;
      // The tab bar covers the bottom of the window, so the panel has to stop above it.
      const bottomLimit = document.querySelector('.tab-bar')?.getBoundingClientRect().top ?? window.innerHeight;
      const below = bottomLimit - chipRect.bottom - PANEL_GAP - EDGE_MARGIN;
      const above = chipRect.top - PANEL_GAP - EDGE_MARGIN;
      const needed = panel.scrollHeight;
      const up = needed > below && above > below;
      setPlacement({ above: up, maxHeight: Math.max(0, Math.floor(up ? above : below)) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="hud-dropdown" ref={rootRef}>
      <button
        type="button"
        className={`hud-chip t-code interactive${chipClassName ? ` ${chipClassName}` : ''}`}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={title}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}>
        {chip}
      </button>
      {open && (
        <div
          ref={panelRef}
          className={placement?.above ? 'hud-popover above' : 'hud-popover'}
          style={placement ? { maxHeight: placement.maxHeight } : { visibility: 'hidden' }}
          role="dialog"
          aria-label={label}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}
