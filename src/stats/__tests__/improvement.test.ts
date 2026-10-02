import { improvementRate } from '../improvement';
import type { RoundResult } from '../../game/types';

const NOW = Date.now();

function round(
  overrides: Partial<Omit<RoundResult, 'settings'>> & {
    settings?: Partial<RoundResult['settings']>;
  } = {},
): RoundResult {
  const { settings, ...rest } = overrides;
  return {
    id: `round-${Math.random()}`,
    finishedAt: NOW,
    settings: {
      activeStreams: { position: true, color: false, number: false, audio: true },
      nLevel: 2,
      speed: 'normal',
      trialDurationMs: 2000,
      matchCounts: { position: 6, color: 6, number: 6, audio: 6 },
      ...settings,
    },
    trials: [],
    ...rest,
  };
}

describe('improvementRate', () => {
  /** Rounds of `minutes` each with the given accuracies, oldest first. */
  const pointsFor = (accuracies: number[], minutes = 6) =>
    accuracies.map((accuracy, i) => ({
      round: round({ id: `r${i}` }),
      index: i + 1,
      nLevel: 2,
      finishedAt: NOW + i,
      durationMs: minutes * 60000,
      accuracy,
      streamAccuracy: {},
      speedMs: null,
      streamSpeedMs: {},
    }));

  it('estimates the play left to reach 100% on a learning curve that levels off', () => {
    // The gap to 100% halves every ~1.4 hours of play (k = 0.5 per hour); rounds of 6 minutes.
    const k = 0.5;
    const accuracies = Array.from({ length: 30 }, (_, i) => 100 - 40 * Math.exp(-k * (i + 1) * 0.1));
    const current = accuracies.slice(-10).reduce((a, b) => a + b, 0) / 10;
    const expected = Math.log((100 - current) / 0.5) / k;
    const estimate = improvementRate(pointsFor(accuracies)).toPerfect;
    expect(estimate?.kind).toBe('eta');
    if (estimate?.kind !== 'eta') {
      return;
    }
    expect(estimate.hours).toBeGreaterThan(expected * 0.9);
    expect(estimate.hours).toBeLessThan(expected * 1.1);
  });

  it('reports no progress for flat or falling accuracy', () => {
    const flat = Array.from({ length: 30 }, (_, i) => (i % 2 ? 70 : 74));
    expect(improvementRate(pointsFor(flat)).toPerfect).toEqual({ kind: 'noProgress' });
    const falling = Array.from({ length: 30 }, (_, i) => 90 - i);
    expect(improvementRate(pointsFor(falling)).toPerfect).toEqual({ kind: 'noProgress' });
  });

  it('reports 100% as reached when the latest rounds are perfect', () => {
    const accuracies = [...Array.from({ length: 20 }, () => 80), ...Array.from({ length: 10 }, () => 100)];
    expect(improvementRate(pointsFor(accuracies)).toPerfect).toEqual({ kind: 'reached' });
  });

  it('returns nulls with too little data', () => {
    expect(improvementRate([])).toEqual({ toPerfect: null, speedMsPerHour: null });
  });
});
