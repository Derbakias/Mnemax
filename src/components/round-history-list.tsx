import { memo, useState } from 'react';

import { OutcomeLegend, RoundDetailTable } from './round-detail-table';
import { RoundSummaryCard } from './round-summary-card';
import { TRIALS_PER_ROUND } from '@/game/config';
import type { RoundResult } from '@/game/types';

interface RoundHistoryListProps {
  rounds: RoundResult[];
  scrollHeight?: number | null;
  emptyLabel?: string;
  /** Show the key to the outcome symbols above the list (once, not in every opened round). */
  legend?: boolean;
}

// Made once: toLocaleDateString and friends set up a new formatter on every call, which added up to most of
// the time a long history took to draw.
const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

function formatTimestamp(finishedAt: number): string {
  return `${DATE_FORMAT.format(finishedAt)}, ${TIME_FORMAT.format(finishedAt)}`;
}

function RoundEntry({ round }: { round: RoundResult }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <button type="button" className="history-row" onClick={() => setExpanded((e) => !e)}>
        <span className="t-small">
          {formatTimestamp(round.finishedAt)} · N={round.settings.nLevel}
          {round.stopped && (
            <span className="secondary">
              {' '}
              · stopped at {round.trials.length}/{TRIALS_PER_ROUND}
            </span>
          )}
        </span>
        <RoundSummaryCard result={round} compact />
      </button>
      {expanded && (
        <div className="history-detail">
          <RoundDetailTable result={round} legend={false} />
        </div>
      )}
    </div>
  );
}

// Memoized: the Stats screen stays mounted and re-renders on every settings change, while its rounds don't.
export const RoundHistoryList = memo(function RoundHistoryList({
  rounds,
  scrollHeight = 520,
  emptyLabel,
  legend = true,
}: RoundHistoryListProps) {
  if (rounds.length === 0) {
    return (
      <p className="t-small secondary">{emptyLabel ?? 'Finish a round to see its detailed trial history here.'}</p>
    );
  }
  return (
    <>
      {legend && <OutcomeLegend inline />}
      <div className="history-list" style={scrollHeight ? { maxHeight: scrollHeight } : undefined}>
        {rounds.map((round) => (
          <RoundEntry key={round.id} round={round} />
        ))}
      </div>
    </>
  );
});
