import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface HudDropdownProps {
  /** What the chip shows. */
  chip: ReactNode;
  /** Accessible name for the chip and its dropdown. */
  label: string;
  title?: string;
  chipClassName?: string;
  disabled?: boolean;
  /**
   * Open the panel centred under this chip (moved in as far as needed to stay on screen), rather than
   * where the CSS puts it (centred under the whole chip row).
   */
  underChip?: boolean;
  /** Panel contents; a function gets `close`, to dismiss the panel after a choice. */
  children: ReactNode | ((close: () => void) => ReactNode);
}

/** Gap kept between the panel and the window edge (or the tab bar). */
const EDGE_MARGIN = 12;
/** The panel's offset from the chip (`top: calc(100% + 8px)` in CSS). */
const PANEL_GAP = 8;

// A HUD chip that opens a small panel centred under the HUD row (or under the chip itself, with `underChip`). It closes on a second tap, a tap
// outside, Escape, or when it becomes disabled (e.g. a round starts). The panel always fits on screen:
// it is capped to the room below the chip, or opens upwards when there is more room above, and scrolls.
export function HudDropdown({
  chip,
  label,
  title,
  chipClassName,
  disabled = false,
  underChip = false,
  children,
}: HudDropdownProps) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<{ above: boolean; maxHeight: number; left?: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    const place = () => {
      const panel = panelRef.current;
      // The wrapper is `display: contents`; the panel hangs off its positioned container (the chip row).
      const rowRect = panel?.offsetParent?.getBoundingClientRect();
      if (!rowRect || !panel) return;
      // The tab bar covers the bottom of the window, so the panel has to stop above it (it's hidden during a
      // round).
      const bottomLimit =
        document.querySelector('.tab-bar:not([hidden])')?.getBoundingClientRect().top ?? window.innerHeight;
      const below = bottomLimit - rowRect.bottom - PANEL_GAP - EDGE_MARGIN;
      const above = rowRect.top - PANEL_GAP - EDGE_MARGIN;
      const needed = panel.scrollHeight;
      const up = needed > below && above > below;
      // Centred on the chip, kept inside the window; relative to the row the panel is positioned in.
      let left: number | undefined;
      const button = chipRef.current?.getBoundingClientRect();
      if (underChip && button) {
        const width = panel.offsetWidth;
        const centred = button.left + button.width / 2 - width / 2;
        const onScreen = Math.min(Math.max(centred, EDGE_MARGIN), window.innerWidth - EDGE_MARGIN - width);
        left = onScreen - rowRect.left;
      }
      setPlacement({ above: up, maxHeight: Math.max(0, Math.floor(up ? above : below)), left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, underChip]);

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
        ref={chipRef}
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
          style={
            placement
              ? {
                  maxHeight: placement.maxHeight,
                  ...(placement.left !== undefined ? { left: placement.left, transform: 'none' } : {}),
                }
              : { visibility: 'hidden' }
          }
          role="dialog"
          aria-label={label}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}
