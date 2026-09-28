import type { CSSProperties } from 'react';

import { COLOR_PALETTE, COLOR_SHADES, GRID_CENTER_INDEX, POSITION_ARROWS } from '@/game/config';
import type { TrialStimulus } from '@/game/types';

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
    <div className="trial-history">
      {trials.map((trial) => {
        const color = showColor ? COLOR_PALETTE[trial.stimulus.color % COLOR_PALETTE.length] : undefined;
        const shade = showColor ? COLOR_SHADES[trial.stimulus.color % COLOR_SHADES.length] : undefined;
        const className = ['pill', color ? 'coloured' : '', trial.index === highlightIndex ? 'highlighted' : '']
          .filter(Boolean)
          .join(' ');
        const text = [showNumbers ? trial.stimulus.number : '', showLetters ? trial.stimulus.letter : ''].join('');
        return (
          <div
            key={trial.index}
            className={className}
            style={
              color
                ? ({
                    backgroundColor: color,
                    color: textOn(color),
                    '--pill-color': color,
                    '--pill-shade': shade,
                  } as CSSProperties)
                : undefined
            }>
            {showPosition && (
              <span className={trial.stimulus.position === GRID_CENTER_INDEX ? 't-code arrow dot' : 't-code arrow'}>
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
