// Pieces of the per-stream tables (the Stats screen's By mode table and the Play screen's last round): a
// header row of symbols over the columns, then a row per stream.
import { Icon } from '../ui/icon';
import { OUTCOME_ICONS, STREAM_ICONS } from '@/config/ui';
import type { StreamId, StreamOutcome } from '@/game/types';
import { STREAM_LABELS } from '@/game/types';
import { cn } from '@/lib/cn';

/**
 * The per-stream tables' look, shared by the Stats screen's By mode table and the last round's card. Put
 * `table` on the table, `row` on every row, and `header` too on the first. data-five on the table: the last
 * round's table (see below). data-off on a row: a stream the mode doesn't use.
 */
export const streamTableStyles = {
  // Every number column is --stat-col wide, as in the Stats screen's modes table (.mode-table in index.css), so
  // the two tables line up alike; small phones narrow the columns, leaving the stream names room.
  table: [
    'group flex flex-col p-1.5',
    '[--stat-col:64px] max-[480px]:[--stat-col:56px] max-[400px]:[--stat-col:42px]',
    // The last round's table: five number columns, so a little narrower (wide enough for "〇 No match" from
    // 600px), and its headings are symbols only below that. It sits in the card, lined up with the card's edges.
    'data-[five=true]:p-0 data-[five=true]:[--stat-count:5] data-[five=true]:[--stat-col:44px]',
    'data-[five=true]:min-[600px]:[--stat-col:72px] data-[five=true]:max-[400px]:[--stat-col:36px]',
  ],
  row: [
    // Stream | Accuracy | Matched | (No match, in the last round's table) | Missed | False. The name column
    // never grows past its share (a long name is cut short instead), so the numbers line up from row to row:
    // each row is its own grid.
    'grid grid-cols-[minmax(0,1fr)_repeat(var(--stat-count,4),var(--stat-col))] items-center',
    'gap-1.5 p-2 text-center [&>:first-child]:justify-self-start',
    // Small phones: the stream names need the room. The last round's rows line up with the card's edges.
    'max-[400px]:gap-x-1 max-[340px]:px-1 group-data-[five=true]:px-0',
    'border-surface-border not-first:border-t',
    // Every stream has a row, so the table keeps its height from mode to mode; the ones the mode doesn't use
    // are dashed out, in grey (not faded, which left the name too faint to read).
    'data-[off=true]:text-text-secondary',
  ],
  // Grey words rather than a faded row, so the symbols keep their full colour. The code font, as t-code gives
  // it, a size down so "Accuracy" fits a narrow column.
  header: 'py-1.5 font-mono text-[11px] font-medium text-text-secondary',
};

const styles = {
  name: 'inline-flex max-w-full min-w-0 items-center gap-2 max-[340px]:gap-1.5',
  // The smallest phones, in the last round's table: the stream icons alone, which are the answer buttons' own
  // (the names stay for screen readers).
  nameText: 'truncate group-data-[five=true]:max-[360px]:sr-only',
  // A heading's symbol is a 14px icon, bigger than the headings' small type so it reads at a glance. All the same
  // even size, so centred in their columns they land on whole pixels and stay sharp, and share a middle.
  heading: 'inline-flex items-center justify-center gap-0.5 whitespace-nowrap',
  // Small phones (the last round's table: below 600px): the headings shrink to their symbols (a pie chart for
  // accuracy, ✓ ✕ ■ for the outcomes). The words stay for screen readers.
  headingLong: 'max-[400px]:sr-only group-data-[five=true]:max-[600px]:sr-only',
};

/** A stream's name, led by its icon from the Play screen's answer buttons. */
export function StreamName({ stream }: { stream: StreamId }) {
  return (
    <span className={cn('t-small', styles.name)}>
      <Icon name={STREAM_ICONS[stream]} size={16} />
      <span className={cn(styles.nameText)}>{STREAM_LABELS[stream]}</span>
    </span>
  );
}

/** An answer's outcome as its symbol, in its colour: green for right answers, red for wrong ones. */
export function OutcomeIcon({ outcome }: { outcome: StreamOutcome }) {
  return (
    <span className={outcome === 'hit' || outcome === 'correctRejection' ? 'good inline-flex' : 'bad inline-flex'}>
      <Icon name={OUTCOME_ICONS[outcome]} size={14} />
    </span>
  );
}

/** A column heading led by the outcome's symbol, as in the round tables' key. */
export function OutcomeHeading({ outcome, label }: { outcome: StreamOutcome; label: string }) {
  return (
    <span className={cn(styles.heading)}>
      <OutcomeIcon outcome={outcome} />
      <span className={cn(styles.headingLong)}>{label}</span>
    </span>
  );
}

/** The accuracy column's heading, led by a pie chart. */
export function AccuracyHeading() {
  return (
    <span className={cn(styles.heading)}>
      {/* Blue: green and red mean good and bad here, and accuracy is neither. */}
      <span className="inline-flex text-accent">
        <Icon name="pie" size={13} />
      </span>
      <span className={cn(styles.headingLong)}>Accuracy</span>
    </span>
  );
}
