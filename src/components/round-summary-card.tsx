import { AccuracyHeading, OutcomeHeading, StreamName } from './stream-table';
import { TRIALS_PER_ROUND } from '@/game/config';
import { summarizeRound } from '@/game/scoring';
import type { RoundResult } from '@/game/types';
import { accuracyColor, useTheme } from '@/theme';

interface RoundSummaryCardProps {
  result: RoundResult;
  compact?: boolean;
}

export function RoundSummaryCard({ result, compact = false }: RoundSummaryCardProps) {
  const theme = useTheme();
  const summary = summarizeRound(result);
  const pct = Math.round(summary.overallAccuracy * 100);

  if (compact) {
    return (
      <span className="t-small" style={{ color: accuracyColor(pct, theme), fontWeight: 700 }}>
        {pct}%
      </span>
    );
  }

  return (
    <div className="card summary-card">
      <div className="overall-row">
        <span className="t-subtitle" style={{ color: accuracyColor(pct, theme) }}>
          {pct}%
        </span>
        <span className="t-small secondary">overall accuracy</span>
      </div>
      {result.stopped && (
        <p className="t-small secondary">
          Stopped after {result.trials.length} of {TRIALS_PER_ROUND} trials, so this round scores 0.
        </p>
      )}
      {/* Like the Stats screen's stream table: the symbols head the columns, the rows hold just the numbers. */}
      <div className="stream-table five">
        <div className="stream-table-row header t-code">
          <span>Stream</span>
          <AccuracyHeading />
          <OutcomeHeading outcome="hit" label="Matched" />
          <OutcomeHeading outcome="correctRejection" label="No match" />
          <OutcomeHeading outcome="miss" label="Missed" />
          <OutcomeHeading outcome="falseAlarm" label="False" />
        </div>
        {summary.scores.map((score) => {
          const streamPct = Math.round(score.accuracy * 100);
          return (
            <div key={score.stream} className="stream-table-row">
              <StreamName stream={score.stream} />
              <span className="t-code" style={{ color: accuracyColor(streamPct, theme) }}>
                {streamPct}%
              </span>
              <span className="t-code good">
                {score.hits}/{score.hits + score.misses}
              </span>
              <span className="t-code good">{score.correctRejections}</span>
              <span className="t-code bad">{score.misses}</span>
              <span className="t-code bad">{score.falseAlarms}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
