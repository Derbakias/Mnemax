import { Icon } from '../ui/icon';
import { STREAM_ICONS } from '@/config/ui';
import { OutcomeIcon } from './stream-table';
import { roundsCopy } from '@/copy/rounds';
import { COLOR_NAMES, COLOR_PALETTE, TRIALS_PER_ROUND } from '@/config/game';
import type { RoundResult, StreamId, StreamOutcome, TrialRecord } from '@/game/types';
import { STREAM_IDS } from '@/game/types';
import { cn } from '@/lib/cn';

const styles = {
  // Scrolls sideways on narrow screens, with no scrollbar showing.
  scroll: 'overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
  // Fills the width; the column widths below are minimums (narrow screens scroll sideways). The code font, as
  // t-code gives it.
  table: ['w-full border-separate border-spacing-0 text-center whitespace-nowrap', 'font-mono text-[12px] font-medium'],
  heading: 'border-b border-table-rule px-0 py-[5px] font-bold',
  // Every other row on a grey band with rounded ends.
  row: [
    '[&:nth-child(even)>td]:bg-background-element',
    '[&:nth-child(even)>td:first-child]:rounded-l-[6px] [&:nth-child(even)>td:last-child]:rounded-r-[6px]',
  ],
  // One height for every row, with or without a reaction time under the symbol, all centred.
  cell: 'h-9 px-0 py-0.5 align-middle',
  trialCell: 'inline-flex min-h-4 items-center justify-center gap-1.5',
  reactionTime: 'h-[11px] text-[9px] leading-[11px] opacity-75',
  // The key: one symbol and word under another, or (data-inline) on one wrapping line with the note on a line
  // of its own.
  legend: [
    'group flex flex-col gap-2 self-start',
    'data-[inline=true]:flex-row data-[inline=true]:flex-wrap data-[inline=true]:items-center',
    'data-[inline=true]:gap-x-3.5 data-[inline=true]:gap-y-1',
  ],
};

/** What a trial showed in a stream: the cell, a colour swatch, the digit or the letter. */
function Shown({ stream, trial }: { stream: StreamId; trial: TrialRecord }) {
  const { stimulus } = trial;
  if (stream === 'position') {
    return <span>{stimulus.position + 1}</span>;
  }
  if (stream === 'number') {
    return <span>{stimulus.number}</span>;
  }
  if (stream === 'audio') {
    return <span>{stimulus.letter}</span>;
  }
  const index = stimulus.color % COLOR_PALETTE.length;
  return (
    <>
      <span
        className="inline-block h-3.5 w-[22px] rounded-[4px] align-middle"
        style={{ backgroundColor: COLOR_PALETTE[index] }}
        aria-hidden
      />
      <span className="visually-hidden">{COLOR_NAMES[index]}</span>
    </>
  );
}

/**
 * A round, trial by trial: a column per stream, each cell with what the trial showed beside how it was
 * answered (and the reaction time under it). The position always has a column, as a cell lights up every
 * trial; the other streams only when they were on.
 *
 * `legend`: show the key to the outcome symbols; lists of rounds turn it off and show `OutcomeLegend` once.
 */
export function RoundDetailTable({ result, legend = true }: { result: RoundResult; legend?: boolean }) {
  const s = result.settings;
  const columns = STREAM_IDS.filter((stream) => stream === 'position' || s.activeStreams[stream]);
  // A round stopped before its first trial has no rows: the table (and its key) would be headings only.
  const played = result.trials.length > 0;

  return (
    <div className="flex flex-col gap-2 self-stretch">
      {played && (
        <div className={cn(styles.scroll)}>
          <table className={cn(styles.table)}>
            <thead>
              <tr>
                <th className={cn(styles.heading, 'w-[38px] pl-1')}>#</th>
                {/* A stream's column: its icon and short name over cells of what the trial showed beside how it
                    was answered. */}
                {columns.map((stream) => (
                  <th key={stream} className={cn(styles.heading, 'w-16')}>
                    <span className="inline-flex items-center gap-1">
                      <Icon name={STREAM_ICONS[stream]} size={14} />
                      {roundsCopy.columns[stream]}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.trials.map((trial) => (
                <tr key={trial.index} className={cn(styles.row)}>
                  <td className={cn(styles.cell)}>{String(trial.index + 1).padStart(2, '0')}</td>
                  {columns.map((stream) => {
                    const outcome = s.activeStreams[stream] ? trial.outcome[stream] : undefined;
                    const rt = trial.responseTimesMs?.[stream];
                    return (
                      <td key={stream} className={cn(styles.cell)}>
                        <div className={cn(styles.trialCell)}>
                          <Shown stream={stream} trial={trial} />
                          {outcome && (
                            <>
                              <OutcomeIcon outcome={outcome} />
                              <span className="visually-hidden">{roundsCopy.outcomes[outcome]}</span>
                            </>
                          )}
                        </div>
                        {rt != null && <div className={cn(styles.reactionTime)}>{Math.round(rt)} ms</div>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="t-small secondary">
        {roundsCopy.detail.footer(
          result.stopped ? roundsCopy.detail.stoppedAfter(result.trials.length) : TRIALS_PER_ROUND,
          s.nLevel,
          Math.round(s.trialDurationMs),
        )}
      </p>
      {legend && played && <OutcomeLegend />}
    </div>
  );
}

/** What the symbols in a round's table mean; `inline` lays it out on one wrapping line. */
export function OutcomeLegend({ inline = false }: { inline?: boolean }) {
  return (
    <div className={cn(styles.legend)} data-inline={inline}>
      <LegendItem outcome="hit" />
      <LegendItem outcome="correctRejection" />
      <LegendItem outcome="miss" />
      <LegendItem outcome="falseAlarm" />
      <span className="t-small secondary group-data-[inline=true]:basis-full">{roundsCopy.legendNote}</span>
    </div>
  );
}

function LegendItem({ outcome }: { outcome: StreamOutcome }) {
  return (
    <div className="flex items-center gap-1">
      <OutcomeIcon outcome={outcome} />
      <span className="t-small secondary">{roundsCopy.outcomes[outcome]}</span>
    </div>
  );
}
