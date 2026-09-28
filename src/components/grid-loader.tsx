import type { CSSProperties } from 'react';

import { COLOR_PALETTE, GRID_CELLS, GRID_CENTER_INDEX } from '@/game/config';

/** The outer cells of the 3×3 grid in clockwise order, starting top-left. */
const CLOCKWISE = [0, 1, 2, 5, 8, 7, 6, 3];
/** One lap round the grid. */
const LAP_MS = 1600;

/**
 * A loading indicator in the game's own look: a small 3×3 grid (centre empty) where a
 * lit box travels clockwise round the outer cells, taking on a new colour at each one.
 */
export function GridLoader({ label = 'Loading', size = 'small' }: { label?: string; size?: 'small' | 'large' }) {
  const cells = [];
  for (let i = 0; i < GRID_CELLS; i++) {
    if (i === GRID_CENTER_INDEX) {
      cells.push(<span key={i} className="grid-loader-cell center" />);
      continue;
    }
    const step = CLOCKWISE.indexOf(i);
    const style = {
      '--loader-color': COLOR_PALETTE[step % COLOR_PALETTE.length],
      // Negative delays start every cell mid-cycle, so the box is already travelling on the first frame.
      '--loader-delay': `${(step / CLOCKWISE.length) * LAP_MS - LAP_MS}ms`,
      '--loader-lap': `${LAP_MS}ms`,
    } as CSSProperties;
    cells.push(<span key={i} className="grid-loader-cell" style={style} />);
  }
  return (
    <div className={`grid-loader ${size}`} role="status" aria-label={label}>
      <div className="grid-loader-grid">{cells}</div>
    </div>
  );
}
