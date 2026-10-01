import { TRIALS_PER_ROUND } from '../config';
import { generateRound } from '../generator';
import { computeStreamScore, evaluateTrial, summarizeRound } from '../scoring';
import type { GameSettings, RoundResult, StreamId, TrialRecord } from '../types';
import { STREAM_IDS } from '../types';

function makeSettings(overrides: Partial<GameSettings> = {}): GameSettings {
  return {
    activeStreams: { position: true, color: true, number: false, audio: true },
    nLevel: 2,
    speed: 'normal',
    trialDurationMs: 2000,
    matchCounts: { position: 6, color: 6, number: 6, audio: 6 },
    ...overrides,
  };
}

function simulateRound(settings: GameSettings, pressProbability: number): RoundResult {
  const { stimuli, isMatch } = generateRound(settings);
  const trials: TrialRecord[] = [];
  for (let i = 0; i < TRIALS_PER_ROUND; i++) {
    const row = {} as Record<StreamId, boolean>;
    for (const stream of STREAM_IDS) row[stream] = isMatch[stream][i];
    const responded: Partial<Record<StreamId, boolean>> = {};
    for (const stream of STREAM_IDS) {
      if (settings.activeStreams[stream] && Math.random() < pressProbability) {
        responded[stream] = true;
      }
    }
    trials.push({
      index: i,
      stimulus: stimuli[i],
      isMatch: row,
      responded,
      outcome: evaluateTrial(settings.activeStreams, row, responded),
    });
  }
  return { id: `sim-${Math.random()}`, finishedAt: Date.now(), settings, trials };
}

describe('full round simulation', () => {
  it('produces every outcome type including false alarms', () => {
    let totalFalseAlarms = 0;
    let totalHits = 0;
    let totalMisses = 0;
    let totalCorrectRejections = 0;

    for (let r = 0; r < 200; r++) {
      const result = simulateRound(makeSettings(), 0.4);
      const summary = summarizeRound(result);
      expect(summary.scores.length).toBe(3);
      for (const score of summary.scores) {
        const expectedMatches = Math.min(6, TRIALS_PER_ROUND - result.settings.nLevel);
        expect(score.hits + score.misses).toBe(expectedMatches);
        totalFalseAlarms += score.falseAlarms;
        totalHits += score.hits;
        totalMisses += score.misses;
        totalCorrectRejections += score.correctRejections;
      }
    }

    expect(totalHits).toBeGreaterThan(0);
    expect(totalFalseAlarms).toBeGreaterThan(100);
    expect(totalMisses).toBeGreaterThan(0);
    expect(totalCorrectRejections).toBeGreaterThan(0);
  });

  it('never scores a false alarm on a true match', () => {
    for (let r = 0; r < 50; r++) {
      const result = simulateRound(makeSettings(), 0.9);
      for (const trial of result.trials) {
        for (const stream of STREAM_IDS) {
          if (!result.settings.activeStreams[stream]) continue;
          if (trial.isMatch[stream]) {
            expect(trial.outcome[stream]).not.toBe('falseAlarm');
          } else {
            expect(trial.outcome[stream]).not.toBe('hit');
            expect(trial.outcome[stream]).not.toBe('miss');
          }
        }
      }
    }
  });

  it('keeps per-stream totals equal to the number of active trials', () => {
    const result = simulateRound(makeSettings({ nLevel: 5 }), 0.5);
    for (const stream of ['position', 'color', 'audio'] as StreamId[]) {
      const score = computeStreamScore(result.trials, stream);
      expect(score.hits + score.misses + score.falseAlarms + score.correctRejections).toBe(TRIALS_PER_ROUND);
    }
  });
});
