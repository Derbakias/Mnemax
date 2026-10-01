import { Icon } from '../ui/icon';
import { STREAM_ICONS } from '../../play/response-buttons';
import { OUTCOME_LABELS, OutcomeIcon } from './stream-table';
import { COLOR_NAMES, COLOR_PALETTE, TRIALS_PER_ROUND } from '@/game/config';
import type { RoundResult, StreamId, StreamOutcome, TrialRecord } from '@/game/types';
import { STREAM_IDS } from '@/game/types';

const COLUMN_LABEL: Record<StreamId, string> = {
  position: 'Pos',
  color: 'Col',
  number: 'Num',
  audio: 'Ltr',
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
      <span className="table-swatch" style={{ backgroundColor: COLOR_PALETTE[index] }} aria-hidden />
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
    <div className="detail-table">
      {played && (
        <div className="h-scroll">
          <table>
            <thead>
              <tr>
                <th className="c-idx">#</th>
                {columns.map((stream) => (
                  <th key={stream} className="c-stream">
                    <span className="detail-heading">
                      <Icon name={STREAM_ICONS[stream]} size={14} />
                      {COLUMN_LABEL[stream]}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.trials.map((trial) => (
                <tr key={trial.index}>
                  <td>{String(trial.index + 1).padStart(2, '0')}</td>
                  {columns.map((stream) => {
                    const outcome = s.activeStreams[stream] ? trial.outcome[stream] : undefined;
                    const rt = trial.responseTimesMs?.[stream];
                    return (
                      <td key={stream}>
                        <div className="trial-cell">
                          <Shown stream={stream} trial={trial} />
                          {outcome && (
                            <>
                              <OutcomeIcon outcome={outcome} />
                              <span className="visually-hidden">{OUTCOME_LABELS[outcome]}</span>
                            </>
                          )}
                        </div>
                        {rt != null && <div className="rt">{Math.round(rt)} ms</div>}
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
        {result.stopped ? `Stopped after ${result.trials.length} of ${TRIALS_PER_ROUND}` : TRIALS_PER_ROUND} trials · N=
        {s.nLevel} · {Math.round(s.trialDurationMs)} ms per trial
      </p>
      {legend && played && <OutcomeLegend />}
    </div>
  );
}

/** What the symbols in a round's table mean; `inline` lays it out on one wrapping line. */
export function OutcomeLegend({ inline = false }: { inline?: boolean }) {
  return (
    <div className={inline ? 'legend-list inline' : 'legend-list'}>
      <LegendItem outcome="hit" label="matched" />
      <LegendItem outcome="correctRejection" label="no match" />
      <LegendItem outcome="miss" label="missed" />
      <LegendItem outcome="falseAlarm" label="false match" />
      <span className="t-small secondary legend-note">Small numbers are reaction times</span>
    </div>
  );
}

function LegendItem({ outcome, label }: { outcome: StreamOutcome; label: string }) {
  return (
    <div className="legend-item">
      <OutcomeIcon outcome={outcome} />
      <span className="t-small secondary">{label}</span>
    </div>
  );
}
