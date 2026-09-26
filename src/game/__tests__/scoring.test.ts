import { computeStreamScore, evaluateTrial, summarizeRound } from '../scoring';
import type { RoundResult, StreamId, TrialRecord } from '../types';

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

describe('evaluateTrial', () => {
  it('maps responses and matches to the correct outcomes', () => {
    const active: Record<StreamId, boolean> = { position: true, color: true, number: true, audio: true };
    const isMatch: Record<StreamId, boolean> = { position: true, color: true, number: false, audio: false };
    const responded: Partial<Record<StreamId, boolean>> = { position: true, number: true };

    expect(evaluateTrial(active, isMatch, responded)).toEqual({
      position: 'hit',
      color: 'miss',
      number: 'falseAlarm',
      audio: 'correctRejection',
    });
  });

  it('skips inactive streams', () => {
    const active: Record<StreamId, boolean> = { position: true, color: false, number: false, audio: false };
    const isMatch: Record<StreamId, boolean> = { position: false, color: true, number: false, audio: false };
    const outcome = evaluateTrial(active, isMatch, {});
    expect(Object.keys(outcome)).toEqual(['position']);
  });
});

describe('computeStreamScore', () => {
  it('computes chance-corrected balanced accuracy', () => {
    const trials = [
      trial({ outcome: { position: 'hit' } }),
      trial({ outcome: { position: 'hit' } }),
      trial({ outcome: { position: 'miss' } }),
      trial({ outcome: { position: 'falseAlarm' } }),
      trial({ outcome: { position: 'correctRejection' } }),
    ];
    const score = computeStreamScore(trials, 'position');
    expect(score.hits).toBe(2);
    expect(score.misses).toBe(1);
    expect(score.falseAlarms).toBe(1);
    expect(score.correctRejections).toBe(1);
    expect(score.accuracy).toBeCloseTo(2 / 3 + 1 / 2 - 1);
  });

  it('scores zero accuracy when the player never responds', () => {
    const trials = [
      ...Array.from({ length: 6 }, (_, i) => trial({ index: i, outcome: { position: 'miss' } })),
      ...Array.from({ length: 14 }, (_, i) =>
        trial({ index: 6 + i, outcome: { position: 'correctRejection' } }),
      ),
    ];
    const score = computeStreamScore(trials, 'position');
    expect(score.hits).toBe(0);
    expect(score.accuracy).toBe(0);
  });

  it('scores perfect accuracy only with all hits and no false alarms', () => {
    const trials = [
      trial({ outcome: { position: 'hit' } }),
      trial({ outcome: { position: 'hit' } }),
      trial({ outcome: { position: 'correctRejection' } }),
      trial({ outcome: { position: 'correctRejection' } }),
    ];
    const score = computeStreamScore(trials, 'position');
    expect(score.accuracy).toBe(1);
  });

  it('clamps to zero when false alarms outweigh correct rejections', () => {
    const trials = [
      trial({ outcome: { position: 'hit' } }),
      trial({ outcome: { position: 'miss' } }),
      trial({ outcome: { position: 'falseAlarm' } }),
      trial({ outcome: { position: 'falseAlarm' } }),
      trial({ outcome: { position: 'falseAlarm' } }),
    ];
    const score = computeStreamScore(trials, 'position');
    expect(score.accuracy).toBe(0);
  });
});

describe('summarizeRound', () => {
  it('averages accuracy across active streams only', () => {
    const result: RoundResult = {
      id: 'r1',
      finishedAt: 0,
      settings: {
        activeStreams: { position: true, color: true, number: false, audio: false },
        nLevel: 2,
        trialDurationMs: 2000,
        matchCounts: { position: 5, color: 5, number: 5, audio: 5 },
      },
      trials: [
        trial({ index: 0, outcome: { position: 'hit', color: 'miss' } }),
        trial({ index: 1, outcome: { position: 'correctRejection', color: 'correctRejection' } }),
      ],
    };
    const summary = summarizeRound(result);
    expect(summary.scores.length).toBe(2);
    expect(summary.overallAccuracy).toBeCloseTo((1 + 0) / 2);
  });

  it('scores a stopped round 0, keeping its counts', () => {
    const result: RoundResult = {
      id: 'r2',
      finishedAt: 0,
      settings: {
        activeStreams: { position: true, color: false, number: false, audio: false },
        nLevel: 2,
        trialDurationMs: 2000,
        matchCounts: { position: 5, color: 5, number: 5, audio: 5 },
      },
      trials: [
        trial({ index: 0, outcome: { position: 'hit' } }),
        trial({ index: 1, outcome: { position: 'correctRejection' } }),
      ],
      stopped: true,
    };
    const summary = summarizeRound(result);
    expect(summary.overallAccuracy).toBe(0);
    expect(summary.scores[0]).toMatchObject({ hits: 1, correctRejections: 1, accuracy: 0 });
  });
});
