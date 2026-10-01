import { buildStatsJson, parseStatsPayload } from '../stats-io';
import type { RoundResult } from '../game/types';

function round(id: string): RoundResult {
  return {
    id,
    finishedAt: Date.UTC(2026, 8, 29),
    settings: {
      activeStreams: { position: true, color: false, number: false, audio: true },
      nLevel: 2,
      speed: 'normal',
      trialDurationMs: 2900,
      matchCounts: { position: 6, color: 6, number: 6, audio: 6 },
    },
    trials: [],
  };
}

describe('parseStatsPayload', () => {
  it('reads back what export writes', () => {
    const rounds = [round('a'), round('b')];
    expect(parseStatsPayload(buildStatsJson(rounds))).toEqual({ rounds, skipped: 0 });
  });

  it('reads a bare list of rounds', () => {
    expect(parseStatsPayload(JSON.stringify([round('a')]))).toEqual({ rounds: [round('a')], skipped: 0 });
  });

  it('keeps the good rounds and counts the broken ones', () => {
    const text = JSON.stringify({ rounds: [round('a'), { ...round('b'), finishedAt: 'soon' }, 42] });
    expect(parseStatsPayload(text)).toEqual({ rounds: [round('a')], skipped: 2 });
  });

  it('explains a file it cannot use', () => {
    expect(() => parseStatsPayload('{')).toThrow('not valid JSON');
    expect(() => parseStatsPayload('{"games": []}')).toThrow('No "rounds" array');
    expect(() => parseStatsPayload('{"rounds": [{}]}')).toThrow('No valid rounds');
  });

  it('turns down a file far bigger than an export', () => {
    const huge = `{"rounds": [], "pad": "${'x'.repeat(32 * 1024 * 1024)}"}`;
    expect(() => parseStatsPayload(huge)).toThrow('too big');
  });
});
