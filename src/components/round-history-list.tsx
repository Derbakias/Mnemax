import { memo, useCallback, useState } from 'react';

import { Icon } from './icon';
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
const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});
const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
});

function formatTimestamp(finishedAt: number): string {
  return `${DATE_FORMAT.format(finishedAt)}, ${TIME_FORMAT.format(finishedAt)}`;
}

function RoundEntry({
  round,
  expanded,
  onToggle,
}: {
  round: RoundResult;
  expanded: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <div className={expanded ? 'history-entry open' : 'history-entry'}>
      <button type="button" className="history-row" aria-expanded={expanded} onClick={() => onToggle(round.id)}>
        <span className="t-small history-row-title">
          {formatTimestamp(round.finishedAt)} · N={round.settings.nLevel}
          {round.stopped && (
            <span className="secondary">
              {' '}
              · stopped at {round.trials.length}/{TRIALS_PER_ROUND}
            </span>
          )}
        </span>
        <span className="history-row-end">
          <RoundSummaryCard result={round} compact />
          <span className="history-chevron">
            <Icon name="chevron-down" size={16} />
          </span>
        </span>
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
  // One round open at a time: opening another closes the last, so a long history never has many trial
  // tables drawn at once.
  const [openId, setOpenId] = useState<string | null>(null);
  const toggle = useCallback((id: string) => setOpenId((open) => (open === id ? null : id)), []);
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
          <RoundEntry key={round.id} round={round} expanded={round.id === openId} onToggle={toggle} />
        ))}
      </div>
    </>
  );
});
