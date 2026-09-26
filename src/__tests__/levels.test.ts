import {
  LEVEL_WINDOW,
  dailyStats,
  levelHistory,
  levelSummary,
  modeDifficulty,
  modeOf,
  roundLevel,
  speedFactor,
  streamFactor,
  summarizeModes,
} from '../levels';
import type { GameSettings, RoundResult, StreamId, TrialRecord } from '../game/types';

const DAY = 86400000;
const NOW = new Date(2026, 8, 25, 12).getTime();

function settings(nLevel: number, streams: StreamId[], trialDurationMs: number): GameSettings {
  return {
    activeStreams: {
      position: streams.includes('position'),
      color: streams.includes('color'),
      number: streams.includes('number'),
      audio: streams.includes('audio'),
    },
    nLevel,
    trialDurationMs,
    matchCounts: { position: 6, color: 6, number: 6, audio: 6 },
  };
}

// A round with the given chance-corrected accuracy on every active stream: 10 match trials and
// 10 non-match trials per stream, with `accuracy` controlling how many of each are answered right.
// Only multiples of 0.2 come out exact.
function round(s: GameSettings, accuracy: number, finishedAt: number): RoundResult {
  const streams = (Object.keys(s.activeStreams) as StreamId[]).filter((k) => s.activeStreams[k]);
  // balanced = (hitRate + crRate) / 2, accuracy = 2 * balanced - 1  =>  both rates = (accuracy + 1) / 2
  const right = Math.round(((accuracy + 1) / 2) * 10);
  const trials: TrialRecord[] = [];
  for (let i = 0; i < 20; i++) {
    const isMatch = i < 10;
    const correct = (isMatch ? i : i - 10) < right;
    const outcome: TrialRecord['outcome'] = {};
    for (const stream of streams) {
      outcome[stream] = isMatch ? (correct ? 'hit' : 'miss') : correct ? 'correctRejection' : 'falseAlarm';
    }
    trials.push({
      index: i,
      stimulus: { position: 0, color: 0, number: 1, letter: 'C' },
      isMatch: { position: isMatch, color: isMatch, number: isMatch, audio: isMatch },
      responded: {},
      outcome,
    });
  }
  return { id: `r-${finishedAt}-${Math.random()}`, finishedAt, settings: s, trials };
}

describe('modes', () => {
  it('groups by N, active streams and speed preset', () => {
    const a = modeOf(settings(1, ['position', 'color'], 2000));
    expect(a.key).toBe('1|position+color|2000');
    // An old free-form duration snaps to its nearest preset.
    expect(modeOf(settings(1, ['position', 'color'], 1900)).key).toBe(a.key);
    expect(modeOf(settings(1, ['position', 'audio'], 2000)).key).not.toBe(a.key);
    expect(modeOf(settings(2, ['position', 'color'], 2000)).key).not.toBe(a.key);
  });
});

describe('difficulty', () => {
  it('uses dual N-back at Normal speed as the unit', () => {
    expect(streamFactor(2)).toBe(1);
    expect(speedFactor(1200)).toBe(1);
    expect(modeDifficulty(modeOf(settings(2, ['position', 'audio'], 1200)))).toBeCloseTo(2);
  });

  it('rises with more streams and faster trials', () => {
    expect(streamFactor(1)).toBeLessThan(streamFactor(2));
    expect(streamFactor(4)).toBeGreaterThan(streamFactor(3));
    expect(speedFactor(800)).toBeGreaterThan(speedFactor(1200));
    expect(speedFactor(3000)).toBeLessThan(speedFactor(2000));
  });

  it('scales a round by its accuracy', () => {
    const s = settings(2, ['position', 'audio'], 1200);
    expect(roundLevel(round(s, 1, NOW))).toBeCloseTo(2);
    expect(roundLevel(round(s, 0.6, NOW))).toBeCloseTo(1.2);
    expect(roundLevel(round(s, 0, NOW))).toBeCloseTo(0);
  });
});

describe('levelHistory / levelSummary', () => {
  const s = settings(2, ['position', 'audio'], 1200);

  it('averages the last LEVEL_WINDOW rounds, oldest first', () => {
    // Stored newest first: 12 rounds, the older 6 perfect, the newer 6 at 60%.
    const rounds = Array.from({ length: 12 }, (_, i) => round(s, i < 6 ? 0.6 : 1, NOW - i * 1000));
    const history = levelHistory(rounds);
    expect(history[0].finishedAt).toBeLessThan(history[11].finishedAt);
    expect(history[0].level).toBeCloseTo(2);
    const last = history[11];
    expect(last.windowSize).toBe(LEVEL_WINDOW);
    expect(last.level).toBeCloseTo((4 * 2 + 6 * 1.2) / 10);
  });

  it('reports the change since a week ago and the best full-window level', () => {
    const rounds = [
      round(s, 1, NOW - 1000),
      round(s, 1, NOW - 2000),
      round(s, 0.6, NOW - 8 * DAY),
      round(s, 0.6, NOW - 9 * DAY),
    ];
    const summary = levelSummary(levelHistory(rounds), NOW)!;
    expect(summary.current).toBeCloseTo((2 + 2 + 1.2 + 1.2) / 4);
    // 8 days ago the level was the average of the two 60% rounds.
    expect(summary.weekChange).toBeCloseTo(1.6 - 1.2);
    // Fewer than LEVEL_WINDOW rounds: only the window over all four counts for "best".
    expect(summary.best).toBeCloseTo(1.6);
  });

  it('has no week change without rounds that old', () => {
    expect(levelSummary(levelHistory([round(s, 1, NOW)]), NOW)!.weekChange).toBeNull();
    expect(levelSummary([], NOW)).toBeNull();
  });
});

describe('summarizeModes', () => {
  it('summarizes each mode, most recently played first', () => {
    const easy = settings(1, ['position', 'color'], 2000);
    const hard = settings(2, ['position', 'audio'], 1200);
    const rounds = [
      round(hard, 0.4, NOW - 1000),
      round(easy, 0.8, NOW - 2000),
      round(easy, 1, NOW - 3000),
      round(easy, 1, NOW - 4000),
    ];
    const [first, second] = summarizeModes(rounds);
    expect(first.mode.key).toBe(modeOf(hard).key);
    expect(first.mastered).toBe(false);
    expect(second.rounds).toHaveLength(3);
    expect(second.recentAccuracy).toBeCloseTo((80 + 100 + 100) / 3);
    expect(second.bestAccuracy).toBeCloseTo(100);
    expect(second.mastered).toBe(true);
  });
});

describe('dailyStats', () => {
  it('totals each local day, oldest first', () => {
    const dual = settings(2, ['position', 'audio'], 1200);
    const single = settings(1, ['position'], 1200);
    const today = new Date(2026, 8, 25, 9).getTime();
    const rounds = [
      { ...round(dual, 1, today + 2 * 3600000), durationMs: 60_000 },
      { ...round(single, 0.6, today), durationMs: 30_000 },
      { ...round(dual, 0.6, today - DAY), durationMs: 45_000 },
    ];
    const [yesterday, day] = dailyStats(rounds);
    expect(yesterday.rounds).toBe(1);
    expect(yesterday.playedMs).toBe(45_000);
    expect(day.day).toBe(new Date(2026, 8, 25).getTime());
    expect(day.rounds).toBe(2);
    expect(day.playedMs).toBe(90_000);
    expect(day.modes).toBe(2);
    // Dual 2-back perfect = 2; single 1-back at 60% = 1 × 2/3 × 0.6 = 0.4.
    expect(day.bestLevel).toBeCloseTo(2);
    expect(day.avgLevel).toBeCloseTo((2 + 0.4) / 2);
    expect(day.avgAccuracy).toBeCloseTo(80);
  });
});
