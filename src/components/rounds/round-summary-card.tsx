import { AccuracyHeading, OutcomeHeading, StreamName, streamTableStyles } from './stream-table';
import { roundsCopy } from '@/copy/rounds';
import { summarizeRound } from '@/game/scoring';
import type { RoundResult } from '@/game/types';
import { cn } from '@/lib/cn';
import { accuracyColor, useTheme } from '@/lib/theme';

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
    // `card` is still styled in index.css (its grey and corners), shared with other screens.
    <div className="card flex flex-col gap-2 self-stretch p-3.5">
      <div className="flex items-baseline gap-2.5">
        <span className="t-subtitle" style={{ color: accuracyColor(pct, theme) }}>
          {pct}%
        </span>
        <span className="t-small secondary">overall accuracy</span>
      </div>
      {result.stopped && <p className="t-small secondary">{roundsCopy.summary.stopped(result.trials.length)}</p>}
      {/* Like the Stats screen's stream table: the symbols head the columns, the rows hold just the numbers. */}
      <div className={cn(streamTableStyles.table)} data-five>
        <div className={cn(streamTableStyles.row, streamTableStyles.header)}>
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
            <div key={score.stream} className={cn(streamTableStyles.row)}>
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
