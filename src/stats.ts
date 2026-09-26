import type { RoundResult, StreamId, TrialRecord } from './game/types';
import { STREAM_IDS } from './game/types';
import { TRIALS_PER_ROUND } from './game/config';
import { balancedAccuracy, summarizeRound } from './game/scoring';

const COUNTDOWN_MS = 2100;

export function roundDurationMs(round: RoundResult): number {
  if (typeof round.durationMs === 'number') return round.durationMs;
  return COUNTDOWN_MS + TRIALS_PER_ROUND * round.settings.trialDurationMs;
}

/** Total play time of the rounds finished on the same local calendar day as `day`. */
export function playedOnDayMs(rounds: RoundResult[], day: Date): number {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
  let total = 0;
  for (const round of rounds) {
    if (round.finishedAt >= start && round.finishedAt < end) total += roundDurationMs(round);
  }
  return total;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

// TODO: move to a config
const COUNT_UNITS: [suffix: string, size: number][] = [
  ['K', 1e3],
  ['M', 1e6],
  ['B', 1e9],
];

/**
 * A count in at most four characters, for narrow table columns: 999, 1.2K, 12K, 999K, 1.2M. One decimal
 * below 10 of a unit, whole numbers above; a value that rounds up to 1000 of a unit moves to the next.
 */
export function formatCount(n: number): string {
  if (Math.abs(n) < 1000) return String(Math.round(n));
  for (let i = 0; i < COUNT_UNITS.length; i++) {
    const [suffix, size] = COUNT_UNITS[i];
    const x = n / size;
    const rounded = Math.abs(x) < 10 ? Math.round(x * 10) / 10 : Math.round(x);
    if (Math.abs(rounded) < 1000 || i === COUNT_UNITS.length - 1) return `${rounded}${suffix}`;
  }
  return String(n);
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
  if (values.length === 0) return null;
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
      if (ema != null) ema = alpha * v + (1 - alpha) * ema;
      else if (seed.push(v) === n) ema = seed.reduce((a, b) => a + b, 0) / n;
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
  if (trial.outcome[stream] !== 'hit') return null;
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
        if (rt != null) rts.push(rt);
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
    if (minTime != null && round.finishedAt < minTime) return false;
    if (filter.nLevel != null && round.settings.nLevel !== filter.nLevel) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Improvement rate (per hour played)
// ---------------------------------------------------------------------------

/** How far off 100% accuracy is: reached, an estimated amount of play to get there, or no progress. */
export type PerfectEstimate = { kind: 'reached' } | { kind: 'eta'; hours: number } | { kind: 'noProgress' };

export interface ImprovementRate {
  toPerfect: PerfectEstimate | null;
  speedMsPerHour: number | null;
}

/** Current accuracy is the average of this many latest rounds (the chart's "Avg of 10" line). */
const CURRENT_WINDOW = 10;
/** Accuracy counts as 100% from here (it rounds to 100). */
const PERFECT_ACCURACY = 99.5;
/** The learning curve must fit at least this much better than a flat line to count as progress. */
const MIN_FIT_GAIN = 0.02;
/** Learning rates tried, per hour of play: 0.01 to 100, log-spaced. */
const LEARNING_RATES = Array.from({ length: 401 }, (_, i) => 0.01 * 10 ** (i / 100));

function slopePerHour(points: { hours: number; value: number }[]): number | null {
  const n = points.length;
  if (n < 5) return null;
  const totalHours = points[n - 1].hours;
  if (totalHours < 0.08) return null;
  const meanX = points.reduce((s, p) => s + p.hours, 0) / n;
  const meanY = points.reduce((s, p) => s + p.value, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.hours - meanX) * (p.value - meanY);
    den += (p.hours - meanX) ** 2;
  }
  if (den === 0) return null;
  return num / den;
}

/**
 * Hours of play until accuracy reaches 100%, at the pace so far. Accuracy can't pass 100% and gains slow
 * down near it, so a straight line would overshoot. Instead the gap to 100% is modelled as shrinking by
 * the same fraction every hour played: gap(t) = G·e^(−k·t). k is found by trying a range of rates (for
 * each one the best G has a closed form) and keeping the best fit. The estimate then runs from the
 * current accuracy (average of the latest rounds) until the gap is under half a percent.
 */
function perfectEstimate(points: { hours: number; value: number }[]): PerfectEstimate | null {
  const n = points.length;
  if (n < 5 || points[n - 1].hours < 0.08) return null;
  const recent = points.slice(-CURRENT_WINDOW);
  const current = recent.reduce((s, p) => s + p.value, 0) / recent.length;
  if (current >= PERFECT_ACCURACY) return { kind: 'reached' };

  const gaps = points.map((p) => ({ hours: p.hours, gap: Math.max(0, 100 - p.value) }));
  // A flat line (k = 0) fits best with G = the mean gap.
  const meanGap = gaps.reduce((s, p) => s + p.gap, 0) / n;
  const flatError = gaps.reduce((s, p) => s + (p.gap - meanGap) ** 2, 0);
  let best = { k: 0, error: flatError };
  for (const k of LEARNING_RATES) {
    let num = 0;
    let den = 0;
    for (const p of gaps) {
      const e = Math.exp(-k * p.hours);
      num += p.gap * e;
      den += e * e;
    }
    if (den === 0) continue;
    const g = num / den;
    let error = 0;
    for (const p of gaps) error += (p.gap - g * Math.exp(-k * p.hours)) ** 2;
    if (error < best.error) best = { k, error };
  }
  if (best.k === 0 || best.error > flatError * (1 - MIN_FIT_GAIN)) return { kind: 'noProgress' };
  const hours = Math.log((100 - current) / (100 - PERFECT_ACCURACY)) / best.k;
  return { kind: 'eta', hours };
}

export function improvementRate(points: RoundPoint[]): ImprovementRate {
  if (points.length < 5) return { toPerfect: null, speedMsPerHour: null };
  let cumMs = 0;
  const acc: { hours: number; value: number }[] = [];
  const speed: { hours: number; value: number }[] = [];
  for (const point of points) {
    cumMs += point.durationMs;
    const hours = cumMs / 3600000;
    acc.push({ hours, value: point.accuracy });
    if (point.speedMs != null) speed.push({ hours, value: point.speedMs });
  }
  return {
    toPerfect: perfectEstimate(acc),
    speedMsPerHour: slopePerHour(speed),
  };
}
