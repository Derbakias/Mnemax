import { TRIALS_PER_ROUND } from '@/game/config';
import { summarizeRound } from '@/game/scoring';
import type { RoundResult } from '@/game/types';
import { STREAM_LABELS } from '@/game/types';
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
      {summary.scores.map((score) => {
        const streamPct = Math.round(score.accuracy * 100);
        const targets = score.hits + score.misses;
        return (
          <div key={score.stream} className="row-between">
            <span className="t-small">{STREAM_LABELS[score.stream]}</span>
            <span className="t-code" style={{ color: accuracyColor(streamPct, theme) }}>
              {streamPct}% · <span className="good">✓ {score.hits}/{targets}</span>
              {' · '}
              <span className="good">〇 {score.correctRejections}</span>
              {' · '}
              <span className="bad">✕ {score.misses}</span>
              {' · '}
              <span className="bad">■ {score.falseAlarms}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
