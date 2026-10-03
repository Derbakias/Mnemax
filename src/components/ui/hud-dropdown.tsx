import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { DROPDOWN_EDGE_MARGIN, DROPDOWN_PANEL_GAP } from '@/config/ui';
import { cn } from '@/lib/cn';

/**
 * A HUD chip's look: a grey pill with an icon and a short text in the code font. Sizes follow the window (full
 * size from about 420px wide), so the Play HUD stays on one line even on a 320px phone. Play's chips that aren't
 * dropdowns use it too (src/play/hud-chips.tsx).
 */
export const chipStyles = {
  base: [
    'inline-flex shrink-0 items-center gap-[clamp(3px,1vw,6px)] whitespace-nowrap',
    'rounded-full bg-background-element px-[clamp(6px,2.4vw,16px)] py-[clamp(7px,2.2vw,9px)]',
    // The code font, as t-code gives it, but at a size that grows with the window.
    'font-mono font-medium text-[length:clamp(10.5px,3.3vw,14px)] leading-[1.3]',
  ],
  // Chips that do something when tapped: grey a shade darker under the mouse and while their panel is open.
  interactive: ['enabled:cursor-pointer enabled:hover:bg-background-selected aria-expanded:bg-background-selected'],
};

const styles = {
  // Centred under the chip row, or opening upwards when there's more room above (data-above).
  popover: [
    'absolute top-[calc(100%+8px)] left-1/2 z-10 transform-[translateX(-50%)]',
    'data-[above=true]:top-auto data-[above=true]:bottom-[calc(100%+8px)]',
    'flex flex-col items-center gap-2 px-3.5 pt-2.5 pb-3.5',
    'rounded-[14px] border border-background-selected bg-background shadow-(--shadow-popover)',
    // max-height is set from the room left on screen, and the width stops at the screen less the page's 16px
    // sides; contents bigger than that scroll inside the panel, never the page.
    'max-w-[calc(100cqw-32px)] overflow-auto',
  ],
};

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
      if (!rowRect || !panel) {
        return;
      }
      // The tab bar covers the bottom of the window, so the panel has to stop above it (it's hidden during a
      // round).
      const bottomLimit =
        document.querySelector('.tab-bar:not([hidden])')?.getBoundingClientRect().top ?? window.innerHeight;
      const below = bottomLimit - rowRect.bottom - DROPDOWN_PANEL_GAP - DROPDOWN_EDGE_MARGIN;
      const above = rowRect.top - DROPDOWN_PANEL_GAP - DROPDOWN_EDGE_MARGIN;
      const needed = panel.scrollHeight;
      const up = needed > below && above > below;
      // Centred on the chip, kept inside the window; relative to the row the panel is positioned in.
      let left: number | undefined;
      const button = chipRef.current?.getBoundingClientRect();
      if (underChip && button) {
        const width = panel.offsetWidth;
        const centred = button.left + button.width / 2 - width / 2;
        const onScreen = Math.min(
          Math.max(centred, DROPDOWN_EDGE_MARGIN),
          window.innerWidth - DROPDOWN_EDGE_MARGIN - width,
        );
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
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="contents" ref={rootRef}>
      {/* `hud-chip` has no look of its own: it's the name the Play HUD row uses to find its chips (see
          src/play/hud-chips.tsx). chipClassName comes last, so its classes replace the look's where both set
          the same thing. */}
      <button
        ref={chipRef}
        type="button"
        className={cn('hud-chip', chipStyles.base, chipStyles.interactive, chipClassName)}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={title}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {chip}
      </button>
      {open && (
        // `hud-popover` has no look of its own: it's the name the Stats mode picker's CSS uses to place it.
        <div
          ref={panelRef}
          className={cn('hud-popover', styles.popover)}
          data-above={placement?.above}
          style={
            placement
              ? {
                  maxHeight: placement.maxHeight,
                  ...(placement.left !== undefined ? { left: placement.left, transform: 'none' } : {}),
                }
              : { visibility: 'hidden' }
          }
          role="dialog"
          aria-label={label}
        >
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}
