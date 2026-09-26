// TODO: Rename to something else e.g. box grid
import { COLOR_PALETTE, GRID_CELLS, GRID_CENTER_INDEX, NEUTRAL_COLOR } from '@/game/config';
import type { TrialStimulus } from '@/game/types';

interface StimulusGridProps {
  stimulus: TrialStimulus | null;
  visible: boolean;
  varyColor: boolean;
  showNumbers: boolean;
  showPosition: boolean;
}

// Grid size and digit size are CSS-driven (see .stimulus-grid in index.css) so the
// grid fits both a phone width and a short desktop window.
export function StimulusGrid({ stimulus, visible, varyColor, showNumbers, showPosition }: StimulusGridProps) {
  const shown = stimulus && visible ? stimulus : null;
  const color = shown ? (varyColor ? COLOR_PALETTE[shown.color % COLOR_PALETTE.length] : NEUTRAL_COLOR) : undefined;

  // Every cell keeps the same box and digit elements for the whole round; only their color and text
  // change. Mounting a fresh element per trial made webviews repaint the cell a frame late (flicker).
  const renderCell = (key: number, className: string, active: boolean) => (
    <div key={key} className={className}>
      <div className="box" style={{ backgroundColor: active ? color : undefined }}>
        {showNumbers && <span className="digit">{active ? shown?.number : null}</span>}
      </div>
    </div>
  );

  if (!showPosition) {
    return <div className="stimulus-grid solo">{renderCell(0, 'cell', shown !== null)}</div>;
  }

  const cells = [];
  for (let i = 0; i < GRID_CELLS; i++) {
    cells.push(renderCell(i, i === GRID_CENTER_INDEX ? 'cell center' : 'cell', shown?.position === i));
  }
  return <div className="stimulus-grid">{cells}</div>;
}
