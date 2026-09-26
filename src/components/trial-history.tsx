import { COLOR_PALETTE, POSITION_ARROWS } from '@/game/config';
import type { TrialStimulus } from '@/game/types';

export interface TrialHistoryItem {
  index: number;
  stimulus: TrialStimulus;
}

interface TrialHistoryProps {
  trials: TrialHistoryItem[];
  highlightIndex?: number;
  showPosition: boolean;
  showColor: boolean;
  showNumbers: boolean;
  showLetters: boolean;
}

export function TrialHistory({
  trials,
  highlightIndex,
  showPosition,
  showColor,
  showNumbers,
  showLetters,
}: TrialHistoryProps) {
  const lines = [showPosition, showColor, showNumbers, showLetters].filter(Boolean).length;
  const pillClass = lines > 1 ? 'pill two-columns' : 'pill';
  return (
    <div className="trial-history">
      {trials.map((trial) => (
        <div key={trial.index} className={trial.index === highlightIndex ? `${pillClass} highlighted` : pillClass}>
          {showPosition && <span className="t-code arrow">{POSITION_ARROWS[trial.stimulus.position] ?? ''}</span>}
          {showColor && (
            <span
              className="swatch"
              style={{ backgroundColor: COLOR_PALETTE[trial.stimulus.color % COLOR_PALETTE.length] }}
            />
          )}
          {showNumbers && <span className="t-code">{trial.stimulus.number}</span>}
          {showLetters && <span className="t-code">{trial.stimulus.letter}</span>}
        </div>
      ))}
    </div>
  );
}
