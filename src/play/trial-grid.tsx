import type { CSSProperties } from 'react';

import { COLOR_PALETTE, COLOR_SHADES, GRID_CELLS, NEUTRAL_COLOR, NEUTRAL_SHADE } from '@/config/game';
import type { TrialStimulus } from '@/game/types';
import { cn } from '@/lib/cn';

const styles = {
  // Square, so the cells are square: as big as the round's stage allows (--stage-grid, see RoundView). --cell is
  // one cell's size (the grid less its two 8px gaps, over three), which the digits are sized by. Solo: the one
  // box fills the grid.
  grid: [
    'grid size-(--stage-grid) grid-cols-[repeat(3,1fr)] grid-rows-[repeat(3,1fr)] gap-2',
    '[--cell:calc((var(--stage-grid)_-_16px)/3)]',
    'data-[solo=true]:grid-cols-[1fr] data-[solo=true]:grid-rows-[1fr] data-[solo=true]:[--cell:var(--stage-grid)]',
  ],
  // The empty tiles lie almost flat (a soft face and a faint shadow), so the lit one can rise out of them. No
  // border: a see-through one shows as a pale line.
  cell: [
    'flex items-center justify-center rounded-[14px]',
    '[background:linear-gradient(160deg,var(--color-tile-top)_20%,var(--color-tile-bottom))]',
    'shadow-[inset_0_-6px_10px_-8px_var(--color-tile-inner-shade),var(--shadow-tile-rest)]',
  ],
  box: [
    'group flex size-full items-center justify-center rounded-[13px]',
    // Settles back quicker than it rises.
    '[transition:transform_0.09s_ease-in,box-shadow_0.09s_ease-in] motion-reduce:transition-none',
    // The lit tile rises out of the grid: lifted and a touch bigger, soft 3D in its own colour (a face from a
    // lighter tint at the top left to its deeper shade, --box-shade, at the bottom right; soft light and shade
    // inside) over a deep shadow tinted with the colour. The empty slot under it shows as its socket.
    'data-[lit=true]:rounded-[14px] data-[lit=true]:transform-[translateY(-3px)_scale(1.025)]',
    'data-[lit=true]:bg-[linear-gradient(160deg,color-mix(in_srgb,var(--box-color)_72%,var(--color-light))_0%,var(--box-color)_50%,color-mix(in_srgb,var(--box-color)_70%,var(--box-shade))_100%)]',
    'data-[lit=true]:shadow-[inset_0_6px_12px_-6px_color-mix(in_srgb,var(--color-light)_55%,transparent),inset_0_-10px_16px_-8px_color-mix(in_srgb,var(--box-shade)_70%,transparent),var(--shadow-tile-lift),0_16px_28px_-10px_var(--box-shade)]',
    // A slight overshoot as it comes up.
    'data-[lit=true]:[transition:transform_0.16s_cubic-bezier(0.34,1.3,0.64,1),box-shadow_0.16s_ease-out]',
    'motion-reduce:data-[lit=true]:transition-none',
  ],
  digit: [
    'text-[length:calc(var(--cell)*0.6)] leading-none font-extrabold text-light',
    '[text-shadow:var(--shadow-digit)]',
    'group-data-[lit=true]:[text-shadow:0_2px_4px_color-mix(in_srgb,var(--box-shade)_80%,transparent)]',
  ],
};

interface TrialGridProps {
  stimulus: TrialStimulus | null;
  visible: boolean;
  varyColor: boolean;
  showNumbers: boolean;
  showPosition: boolean;
}

// Grid size and digit size follow the round's stage (see styles.grid), so the grid fits both a phone width and a
// short desktop window.
export function TrialGrid({ stimulus, visible, varyColor, showNumbers, showPosition }: TrialGridProps) {
  const shown = stimulus && visible ? stimulus : null;
  const color = shown ? (varyColor ? COLOR_PALETTE[shown.color % COLOR_PALETTE.length] : NEUTRAL_COLOR) : undefined;
  const shade = shown ? (varyColor ? COLOR_SHADES[shown.color % COLOR_SHADES.length] : NEUTRAL_SHADE) : undefined;

  // Every cell keeps the same box and digit elements for the whole round; only their color and text
  // change. Mounting a fresh element per trial made webviews repaint the cell a frame late (flicker).
  const renderCell = (key: number, active: boolean) => (
    <div key={key} className={cn(styles.cell)}>
      <div
        className={cn(styles.box)}
        data-lit={active && !!color}
        style={
          active && color
            ? ({ backgroundColor: color, '--box-color': color, '--box-shade': shade } as CSSProperties)
            : undefined
        }
      >
        {showNumbers && <span className={cn(styles.digit)}>{active ? shown?.number : null}</span>}
      </div>
    </div>
  );

  if (!showPosition) {
    return (
      <div className={cn(styles.grid)} data-solo>
        {renderCell(0, shown !== null)}
      </div>
    );
  }

  const cells = [];
  for (let i = 0; i < GRID_CELLS; i++) {
    cells.push(renderCell(i, shown?.position === i));
  }
  return <div className={cn(styles.grid)}>{cells}</div>;
}
