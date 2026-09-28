// Pieces of the per-stream tables (the Stats screen's By mode table and the Play screen's last round): a
// header row of symbols over the columns, then a row per stream (`.stream-table` in CSS).
import { Icon, type IconName } from './icon';
import { STREAM_ICONS } from './response-buttons';
import type { StreamId, StreamOutcome } from '@/game/types';
import { STREAM_LABELS } from '@/game/types';

/** A stream's name, led by its icon from the Play screen's answer buttons. */
export function StreamName({ stream }: { stream: StreamId }) {
  return (
    <span className="stream-name t-small">
      <Icon name={STREAM_ICONS[stream]} size={16} />
      <span className="stream-name-text">{STREAM_LABELS[stream]}</span>
    </span>
  );
}

/** The round tables' key symbols (✓ 〇 ✕ ■), as icons: see OUTCOME_HIT in the icons. */
const OUTCOME_ICONS: Record<StreamOutcome, IconName> = {
  hit: 'outcome-hit',
  correctRejection: 'outcome-no-match',
  miss: 'outcome-miss',
  falseAlarm: 'outcome-false',
};

/** What each outcome is called, as in the round tables' key. */
export const OUTCOME_LABELS: Record<StreamOutcome, string> = {
  hit: 'matched',
  correctRejection: 'no match',
  miss: 'missed',
  falseAlarm: 'false match',
};

/** An answer's outcome as its symbol, in its colour: green for right answers, red for wrong ones. */
export function OutcomeIcon({ outcome }: { outcome: StreamOutcome }) {
  return (
    <span className={outcome === 'hit' || outcome === 'correctRejection' ? 'outcome-mark good' : 'outcome-mark bad'}>
      <Icon name={OUTCOME_ICONS[outcome]} size={14} />
    </span>
  );
}

/** A column heading led by the outcome's symbol, as in the round tables' key. */
export function OutcomeHeading({ outcome, label }: { outcome: StreamOutcome; label: string }) {
  return (
    <span className="outcome-heading">
      <OutcomeIcon outcome={outcome} />
      <span className="heading-long">{label}</span>
    </span>
  );
}

/** The accuracy column's heading, led by a pie chart. */
export function AccuracyHeading() {
  return (
    <span className="outcome-heading">
      <span className="outcome-mark accuracy">
        <Icon name="pie" size={13} />
      </span>
      <span className="heading-long">Accuracy</span>
    </span>
  );
}
