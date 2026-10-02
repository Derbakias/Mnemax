import type { CSSProperties } from 'react';

import { COLOR_PALETTE, GRID_CELLS, GRID_CENTER_INDEX } from '@/config/game';
import { LOADER_CLOCKWISE, LOADER_LAP_MS } from '@/config/ui';
import { cn } from '@/lib/cn';

const styles = {
  // Only fades in if loading takes a moment, so a fast load doesn't flash it. The large one is the startup
  // screen: shown straight away, not a fallback for slow loads.
  root: [
    'group flex justify-center py-18 animate-grid-loader-in',
    'data-[size=large]:p-0 data-[size=large]:animate-none',
  ],
  grid: [
    'grid grid-cols-[repeat(3,22px)] grid-rows-[repeat(3,22px)] gap-[5px]',
    'group-data-[size=large]:grid-cols-[repeat(3,48px)] group-data-[size=large]:grid-rows-[repeat(3,48px)]',
    'group-data-[size=large]:gap-2.5',
  ],
  cell: [
    'relative rounded-md bg-background-element group-data-[size=large]:rounded-xl',
    // The lit box, in the cell's own colour, timed by its --loader-lap and --loader-delay.
    'after:absolute after:inset-0 after:rounded-[inherit] after:bg-(--loader-color) after:opacity-0',
    'after:animate-grid-loader-step motion-reduce:after:animate-none motion-reduce:after:opacity-35',
  ],
};

/**
 * A loading indicator in the game's own look: a small 3×3 grid (centre empty) where a
 * lit box travels clockwise round the outer cells, taking on a new colour at each one.
 */
export function GridLoader({ label = 'Loading', size = 'small' }: { label?: string; size?: 'small' | 'large' }) {
  const cells = [];
  for (let i = 0; i < GRID_CELLS; i++) {
    if (i === GRID_CENTER_INDEX) {
      cells.push(<span key={i} className={cn(styles.cell, 'bg-transparent')} />);
      continue;
    }
    const step = LOADER_CLOCKWISE.indexOf(i);
    const style = {
      '--loader-color': COLOR_PALETTE[step % COLOR_PALETTE.length],
      // Negative delays start every cell mid-cycle, so the box is already travelling on the first frame.
      '--loader-delay': `${(step / LOADER_CLOCKWISE.length) * LOADER_LAP_MS - LOADER_LAP_MS}ms`,
      '--loader-lap': `${LOADER_LAP_MS}ms`,
    } as CSSProperties;
    cells.push(<span key={i} className={cn(styles.cell)} style={style} />);
  }
  return (
    <div className={cn(styles.root)} data-size={size} role="status" aria-label={label}>
      <div className={cn(styles.grid)}>{cells}</div>
    </div>
  );
}
