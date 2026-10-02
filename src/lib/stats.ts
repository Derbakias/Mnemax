import type { RoundResult, StreamId, TrialRecord } from '../game/types';
import { STREAM_IDS } from '../game/types';
import { TRIALS_PER_ROUND } from '@/config/game';
import { COUNTDOWN_MS } from '@/config/stats';
import { balancedAccuracy, summarizeRound } from '../game/scoring';

export function roundDurationMs(round: RoundResult): number {
  if (typeof round.durationMs === 'number') {
    return round.durationMs;
  }
  return COUNTDOWN_MS + TRIALS_PER_ROUND * round.settings.trialDurationMs;
}

/** Total play time of the rounds finished on the same local calendar day as `day`. */
export function playedOnDayMs(rounds: RoundResult[], day: Date): number {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
  let total = 0;
  for (const round of rounds) {
    if (round.finishedAt >= start && round.finishedAt < end) {
      total += roundDurationMs(round);
    }
  }
  return total;
}

export interface TrendPoint {
  index: number;
  accuracy: number;
  nLevel: number;
}

export function computeTrend(rounds: RoundResult[]): TrendPoint[] {
  const chronological = [...rounds].reverse();
  return chronological.map((round, i) => ({
    index: i + 1,
    accuracy: Math.round(summarizeRound(round).overallAccuracy * 100),
    nLevel: round.settings.nLevel,
  }));
}

export interface StreamAggregate {
  stream: StreamId;
  roundsPlayed: number;
  hits: number;
  misses: number;
  falseAlarms: number;
  correctRejections: number;
  accuracy: number;
}

export function aggregateStreams(rounds: RoundResult[]): StreamAggregate[] {
  const totals = new Map<StreamId, StreamAggregate>();
  for (const stream of STREAM_IDS) {
    totals.set(stream, {
      stream,
      roundsPlayed: 0,
      hits: 0,
      misses: 0,
      falseAlarms: 0,
      correctRejections: 0,
      accuracy: 0,
    });
  }
  for (const round of rounds) {
    const summary = summarizeRound(round);
    for (const score of summary.scores) {
      const agg = totals.get(score.stream)!;
      agg.roundsPlayed++;
      if (round.stopped) {
        // Pooled counts would otherwise credit a stopped round's good answers; it scores 0, so every one
        // of its trials counts as wrong.
        agg.misses += score.hits + score.misses;
        agg.falseAlarms += score.correctRejections + score.falseAlarms;
        continue;
      }
      agg.hits += score.hits;
      agg.misses += score.misses;
      agg.falseAlarms += score.falseAlarms;
      agg.correctRejections += score.correctRejections;
    }
  }
  for (const agg of totals.values()) {
    agg.accuracy = balancedAccuracy(agg.hits, agg.misses, agg.correctRejections, agg.falseAlarms);
  }
  return [...totals.values()];
}

export interface CollectionSummary {
  totalRounds: number;
  totalTimeMs: number;
}

export function collectionSummary(rounds: RoundResult[]): CollectionSummary {
  return {
    totalRounds: rounds.length,
    totalTimeMs: rounds.reduce((sum, r) => sum + roundDurationMs(r), 0),
  };
}

// ---------------------------------------------------------------------------
// Progress points (per-round metrics for the progress chart)
// ---------------------------------------------------------------------------

export function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Exponential moving average "of n": each new value counts for 2 / (n + 1), older ones less and less, so
 * the trend follows recent rounds without jumping when an old outlier drops out of a window. It starts
 * once there are n values, from their plain average; before that it's null. Nulls are skipped (the
 * average carries over them).
 */
export function exponentialAverage(values: (number | null)[], n: number): (number | null)[] {
  const alpha = 2 / (n + 1);
  const seed: number[] = [];
  let ema: number | null = null;
  return values.map((v) => {
    if (v != null) {
      if (ema != null) {
        ema = alpha * v + (1 - alpha) * ema;
      } else if (seed.push(v) === n) {
        ema = seed.reduce((a, b) => a + b, 0) / n;
      }
    }
    return ema;
  });
}

export function rollingAverage(values: (number | null)[], window: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1);
    let sum = 0;
    let count = 0;
    for (let j = start; j <= i; j++) {
      const v = values[j];
      if (v != null) {
        sum += v;
        count++;
      }
    }
    out.push(count > 0 ? sum / count : null);
  }
  return out;
}

export interface RoundPoint {
  round: RoundResult;
  index: number;
  nLevel: number;
  finishedAt: number;
  durationMs: number;
  accuracy: number;
  streamAccuracy: Partial<Record<StreamId, number>>;
  speedMs: number | null;
  streamSpeedMs: Partial<Record<StreamId, number>>;
}

function hitRts(trial: TrialRecord, stream: StreamId): number | null {
  if (trial.outcome[stream] !== 'hit') {
    return null;
  }
  const rt = trial.responseTimesMs?.[stream];
  return typeof rt === 'number' && rt >= 0 ? rt : null;
}

export function computeRoundPoints(rounds: RoundResult[]): RoundPoint[] {
  const chronological = [...rounds].reverse();
  return chronological.map((round, i) => {
    const summary = summarizeRound(round);
    const streamAccuracy: Partial<Record<StreamId, number>> = {};
    const streamSpeedMs: Partial<Record<StreamId, number>> = {};
    const allHitRts: number[] = [];
    for (const score of summary.scores) {
      streamAccuracy[score.stream] = score.accuracy * 100;
      const rts: number[] = [];
      for (const trial of round.trials) {
        const rt = hitRts(trial, score.stream);
        if (rt != null) {
          rts.push(rt);
        }
      }
      const streamMedian = median(rts);
      if (streamMedian != null) {
        streamSpeedMs[score.stream] = streamMedian;
        allHitRts.push(...rts);
      }
    }
    const overallSpeed = median(allHitRts);
    return {
      round,
      index: i + 1,
      nLevel: round.settings.nLevel,
      finishedAt: round.finishedAt,
      durationMs: roundDurationMs(round),
      accuracy: summary.overallAccuracy * 100,
      streamAccuracy,
      speedMs: overallSpeed,
      streamSpeedMs,
    };
  });
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface RoundFilter {
  days?: number;
  nLevel?: number;
}

export function filterRounds(rounds: RoundResult[], filter: RoundFilter): RoundResult[] {
  const minTime = filter.days != null ? Date.now() - filter.days * 86400000 : null;
  return rounds.filter((round) => {
    if (minTime != null && round.finishedAt < minTime) {
      return false;
    }
    if (filter.nLevel != null && round.settings.nLevel !== filter.nLevel) {
      return false;
    }
    return true;
  });
}
