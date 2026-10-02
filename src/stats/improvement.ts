import { ESTIMATE_CURRENT_WINDOW, LEARNING_RATES, MIN_FIT_GAIN, PERFECT_ACCURACY } from '@/config/stats';
import type { RoundPoint } from '@/lib/stats';

/** How far off 100% accuracy is: reached, an estimated amount of play to get there, or no progress. */
export type PerfectEstimate = { kind: 'reached' } | { kind: 'eta'; hours: number } | { kind: 'noProgress' };

export interface ImprovementRate {
  toPerfect: PerfectEstimate | null;
  speedMsPerHour: number | null;
}

function slopePerHour(points: { hours: number; value: number }[]): number | null {
  const n = points.length;
  if (n < 5) {
    return null;
  }
  const totalHours = points[n - 1].hours;
  if (totalHours < 0.08) {
    return null;
  }
  const meanX = points.reduce((s, p) => s + p.hours, 0) / n;
  const meanY = points.reduce((s, p) => s + p.value, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.hours - meanX) * (p.value - meanY);
    den += (p.hours - meanX) ** 2;
  }
  if (den === 0) {
    return null;
  }
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
  if (n < 5 || points[n - 1].hours < 0.08) {
    return null;
  }
  const recent = points.slice(-ESTIMATE_CURRENT_WINDOW);
  const current = recent.reduce((s, p) => s + p.value, 0) / recent.length;
  if (current >= PERFECT_ACCURACY) {
    return { kind: 'reached' };
  }

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
    if (den === 0) {
      continue;
    }
    const g = num / den;
    let error = 0;
    for (const p of gaps) {
      error += (p.gap - g * Math.exp(-k * p.hours)) ** 2;
    }
    if (error < best.error) {
      best = { k, error };
    }
  }
  if (best.k === 0 || best.error > flatError * (1 - MIN_FIT_GAIN)) {
    return { kind: 'noProgress' };
  }
  const hours = Math.log((100 - current) / (100 - PERFECT_ACCURACY)) / best.k;
  return { kind: 'eta', hours };
}

export function improvementRate(points: RoundPoint[]): ImprovementRate {
  if (points.length < 5) {
    return { toPerfect: null, speedMsPerHour: null };
  }
  let cumMs = 0;
  const acc: { hours: number; value: number }[] = [];
  const speed: { hours: number; value: number }[] = [];
  for (const point of points) {
    cumMs += point.durationMs;
    const hours = cumMs / 3600000;
    acc.push({ hours, value: point.accuracy });
    if (point.speedMs != null) {
      speed.push({ hours, value: point.speedMs });
    }
  }
  return {
    toPerfect: perfectEstimate(acc),
    speedMsPerHour: slopePerHour(speed),
  };
}
