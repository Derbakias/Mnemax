import type { CSSProperties } from 'react';

import { COLOR_PALETTE, COLOR_SHADES, GRID_CENTER_INDEX, POSITION_ARROWS } from '@/config/game';
import type { TrialStimulus } from '@/game/types';
import { cn } from '@/lib/cn';

const styles = {
  // One slot per trial from N back to the current one (--history-slots, set by RoundView), oldest on the left.
  // The slots share the width, up to a bit narrower than they're tall.
  row: [
    'grid h-full grid-cols-[repeat(var(--history-slots),minmax(0,calc(var(--hud-h)*0.8)))] justify-center',
    'gap-[clamp(3px,1vw,6px)]',
  ],
  pill: [
    'flex h-(--hud-h) min-w-0 flex-col items-center justify-center rounded-[10px] px-0.5 leading-[1.15]',
    // Soft 3D like the grid's lit tile, a little flatter at this size: a grey tile face here.
    '[background:linear-gradient(160deg,var(--color-tile-top)_20%,var(--color-tile-bottom))]',
    'shadow-[inset_0_-5px_8px_-6px_var(--color-tile-inner-shade),var(--shadow-pill)]',
    // In the trial's colour: from a lighter tint at the top left to its deeper shade (--pill-shade), with soft
    // light and shade inside and a shadow tinted with the colour.
    'data-[coloured=true]:bg-[linear-gradient(160deg,color-mix(in_srgb,var(--pill-color)_72%,var(--color-light))_0%,var(--pill-color)_50%,color-mix(in_srgb,var(--pill-color)_70%,var(--pill-shade))_100%)]',
    'data-[coloured=true]:shadow-[inset_0_4px_8px_-5px_color-mix(in_srgb,var(--color-light)_50%,transparent),inset_0_-6px_10px_-6px_color-mix(in_srgb,var(--pill-shade)_70%,transparent),0_4px_8px_-4px_var(--pill-shade)]',
    // An outline with a gap, so it still shows around a chip that's the same blue.
    'data-[highlighted=true]:outline-2 data-[highlighted=true]:outline-offset-1 data-[highlighted=true]:outline-accent',
  ],
  // The code font, as t-code gives it, at the arrows' own size. The centre box's dot is a small glyph, so it gets
  // a bigger size to look as heavy as the arrows (same line height, so the chip doesn't change).
  arrow: ['font-mono text-[17px] leading-5 font-medium', 'data-[dot=true]:text-[24px]'],
};

export interface TrialHistoryItem {
  index: number;
  stimulus: TrialStimulus;
}

interface TrialHistoryProps {
  trials: TrialHistoryItem[];
  /** The trial outlined (the N-back one, when it matches the current trial). */
  highlightIndex?: number;
  showPosition: boolean;
  showColor: boolean;
  showNumbers: boolean;
  showLetters: boolean;
}

/** Dark text on the light palette colours (yellow), white on the rest. */
function textOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? '#000000' : '#ffffff';
}

// Tutorial chips above the grid, oldest on the left: each shows a trial in the grid's terms, its colour as the
// chip's background, its position as an arrow, and its number and letter.
export function TrialHistory({
  trials,
  highlightIndex,
  showPosition,
  showColor,
  showNumbers,
  showLetters,
}: TrialHistoryProps) {
  return (
    <div className={cn(styles.row)}>
      {trials.map((trial) => {
        const color = showColor ? COLOR_PALETTE[trial.stimulus.color % COLOR_PALETTE.length] : undefined;
        const shade = showColor ? COLOR_SHADES[trial.stimulus.color % COLOR_SHADES.length] : undefined;
        const text = [showNumbers ? trial.stimulus.number : '', showLetters ? trial.stimulus.letter : ''].join('');
        return (
          <div
            key={trial.index}
            className={cn(styles.pill)}
            data-coloured={!!color}
            data-highlighted={trial.index === highlightIndex}
            style={
              color
                ? ({
                    backgroundColor: color,
                    color: textOn(color),
                    '--pill-color': color,
                    '--pill-shade': shade,
                  } as CSSProperties)
                : undefined
            }
          >
            {showPosition && (
              <span className={cn(styles.arrow)} data-dot={trial.stimulus.position === GRID_CENTER_INDEX}>
                {POSITION_ARROWS[trial.stimulus.position] ?? ''}
              </span>
            )}
            {text && <span className="t-code">{text}</span>}
          </div>
        );
      })}
    </div>
  );
}
