import type { RoundResult, RoundSummary, StreamId, StreamOutcome, StreamScore, TrialRecord } from './types';
import { STREAM_IDS } from './types';

export function evaluateTrial(
  activeStreams: Record<StreamId, boolean>,
  isMatch: Record<StreamId, boolean>,
  responded: Partial<Record<StreamId, boolean>>,
): Partial<Record<StreamId, StreamOutcome>> {
  const outcome: Partial<Record<StreamId, StreamOutcome>> = {};
  for (const stream of STREAM_IDS) {
    if (!activeStreams[stream]) continue;
    const didRespond = responded[stream] === true;
    if (isMatch[stream] && didRespond) outcome[stream] = 'hit';
    else if (isMatch[stream]) outcome[stream] = 'miss';
    else if (didRespond) outcome[stream] = 'falseAlarm';
    else outcome[stream] = 'correctRejection';
  }
  return outcome;
}

export function balancedAccuracy(
  hits: number,
  misses: number,
  correctRejections: number,
  falseAlarms: number,
): number {
  const matchTrials = hits + misses;
  const nonMatchTrials = correctRejections + falseAlarms;
  const components: number[] = [];
  if (matchTrials > 0) components.push(hits / matchTrials);
  if (nonMatchTrials > 0) components.push(correctRejections / nonMatchTrials);
  if (components.length === 0) return 0;
  if (components.length === 1) return components[0];
  const balanced = (components[0] + components[1]) / 2;
  return Math.min(1, Math.max(0, balanced * 2 - 1));
}

export function computeStreamScore(trials: TrialRecord[], stream: StreamId): StreamScore {
  const score: StreamScore = {
    stream,
    hits: 0,
    misses: 0,
    falseAlarms: 0,
    correctRejections: 0,
    accuracy: 0,
  };
  let scored = 0;
  for (const trial of trials) {
    const outcome = trial.outcome[stream];
    if (!outcome) continue;
    scored++;
    if (outcome === 'hit') score.hits++;
    else if (outcome === 'miss') score.misses++;
    else if (outcome === 'falseAlarm') score.falseAlarms++;
    else score.correctRejections++;
  }
  score.accuracy =
    scored > 0
      ? balancedAccuracy(score.hits, score.misses, score.correctRejections, score.falseAlarms)
      : 0;
  return score;
}

export function summarizeRound(result: RoundResult): RoundSummary {
  const active = STREAM_IDS.filter((s) => result.settings.activeStreams[s]);
  const scores = active.map((s) => computeStreamScore(result.trials, s));
  // A stopped round keeps its counts (what actually happened) but scores 0.
  if (result.stopped) {
    return { overallAccuracy: 0, scores: scores.map((s) => ({ ...s, accuracy: 0 })) };
  }
  const overallAccuracy =
    scores.length > 0 ? scores.reduce((sum, s) => sum + s.accuracy, 0) / scores.length : 0;
  return { overallAccuracy, scores };
}

export function buildTrials(
  stimuli: TrialRecord['stimulus'][],
  isMatch: Record<StreamId, boolean[]>,
  activeStreams: Record<StreamId, boolean>,
  responsesPerTrial: Partial<Record<StreamId, boolean>>[],
): TrialRecord[] {
  return stimuli.map((stimulus, i) =>
    buildTrial(i, stimulus, isMatch, activeStreams, responsesPerTrial[i] ?? {}),
  );
}

function buildTrial(
  index: number,
  stimulus: TrialRecord['stimulus'],
  isMatch: Record<StreamId, boolean[]>,
  activeStreams: Record<StreamId, boolean>,
  responded: Partial<Record<StreamId, boolean>>,
): TrialRecord {
  const row = {} as Record<StreamId, boolean>;
  for (const stream of STREAM_IDS) row[stream] = isMatch[stream][index];
  return {
    index,
    stimulus,
    isMatch: row,
    responded,
    outcome: evaluateTrial(activeStreams, row, responded),
  };
}
