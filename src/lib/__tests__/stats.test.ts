import {
  aggregateStreams,
  computeRoundPoints,
  filterRounds,
  median,
  playedOnDayMs,
  exponentialAverage,
  rollingAverage,
} from '../stats';
import type { RoundResult, StreamId, TrialRecord } from '../../game/types';

const NOW = Date.now();

function trial(overrides: Partial<TrialRecord> = {}): TrialRecord {
  return {
    index: 0,
    stimulus: { position: 4, color: 0, number: 5, letter: 'K' },
    isMatch: { position: false, color: false, number: false, audio: false },
    responded: {},
    outcome: {},
    ...overrides,
  };
}

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

function hitTrial(index: number, stream: StreamId, rtMs: number): TrialRecord {
  return trial({
    index,
    isMatch: { position: stream === 'position', color: false, number: false, audio: stream === 'audio' },
    responded: { [stream]: true },
    outcome: { [stream]: 'hit' },
    responseTimesMs: { [stream]: rtMs },
  });
}

describe('median', () => {
  it('returns the middle value for odd counts', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('averages the middle two values for even counts', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('returns null for empty input', () => {
    expect(median([])).toBeNull();
  });
});

describe('rollingAverage', () => {
  it('computes the average of the last window values', () => {
    expect(rollingAverage([1, 2, 3, 4], 2)).toEqual([1, 1.5, 2.5, 3.5]);
  });

  it('skips null values inside the window', () => {
    expect(rollingAverage([1, null, 3], 2)).toEqual([1, 1, 3]);
  });

  it('yields null until any value appears', () => {
    expect(rollingAverage([null, null], 3)).toEqual([null, null]);
  });
});

describe('exponentialAverage', () => {
  it('starts at the nth value from the plain average of the first n', () => {
    expect(exponentialAverage([1, 2, 3], 3)).toEqual([null, null, 2]);
  });

  it('then weighs each new value by 2 / (n + 1)', () => {
    // n = 3: alpha = 0.5, so 2 then 0.5 * 6 + 0.5 * 2 = 4
    expect(exponentialAverage([1, 2, 3, 6], 3)).toEqual([null, null, 2, 4]);
  });

  it('skips nulls, carrying the average over them', () => {
    expect(exponentialAverage([1, null, 3, null], 2)).toEqual([null, null, 2, 2]);
  });
});

describe('computeRoundPoints', () => {
  it('returns chronological points with accuracy and speed', () => {
    const newest = round({
      finishedAt: NOW,
      trials: [hitTrial(0, 'position', 700), hitTrial(1, 'audio', 500)],
    });
    const older = round({
      finishedAt: NOW - 60000,
      trials: [hitTrial(0, 'position', 900)],
    });
    const points = computeRoundPoints([newest, older]);
    expect(points.map((p) => p.index)).toEqual([1, 2]);
    expect(points[0].speedMs).toBe(900);
    expect(points[1].speedMs).toBe(600);
    expect(points[0].streamSpeedMs.audio).toBeUndefined();
  });

  it('reports null speed for rounds without response times', () => {
    const points = computeRoundPoints([round({ trials: [trial({ outcome: { position: 'hit' } })] })]);
    expect(points[0].speedMs).toBeNull();
  });
});

describe('filterRounds', () => {
  it('filters by age and n-level', () => {
    const rounds = [
      round({ id: 'a', finishedAt: NOW, settings: { nLevel: 3 } }),
      round({ id: 'b', finishedAt: NOW - 10 * 86400000, settings: { nLevel: 2 } }),
    ];
    expect(filterRounds(rounds, { days: 7 }).map((r) => r.id)).toEqual(['a']);
    expect(filterRounds(rounds, { nLevel: 2 }).map((r) => r.id)).toEqual(['b']);
    expect(filterRounds(rounds, {})).toHaveLength(2);
  });
});

describe('playedOnDayMs', () => {
  it('sums only the rounds finished on that local day', () => {
    const day = new Date(2026, 8, 25, 12);
    const rounds = [
      round({ finishedAt: new Date(2026, 8, 25, 0, 5).getTime(), durationMs: 60_000 }),
      round({ finishedAt: new Date(2026, 8, 25, 23, 55).getTime(), durationMs: 30_000 }),
      round({ finishedAt: new Date(2026, 8, 24, 23, 59).getTime(), durationMs: 90_000 }),
      round({ finishedAt: new Date(2026, 8, 26, 0, 1).getTime(), durationMs: 90_000 }),
    ];
    expect(playedOnDayMs(rounds, day)).toBe(90_000);
  });
});

describe('aggregateStreams', () => {
  it("counts every trial of a stopped round as wrong, so its good answers don't lift the totals", () => {
    const played = [hitTrial(0, 'position', 400), trial({ index: 1, outcome: { position: 'correctRejection' } })];
    const [position] = aggregateStreams([round({ trials: played, stopped: true })]);
    expect(position).toMatchObject({ stream: 'position', hits: 0, correctRejections: 0, misses: 1, falseAlarms: 1 });
    expect(position.accuracy).toBe(0);
  });
});
