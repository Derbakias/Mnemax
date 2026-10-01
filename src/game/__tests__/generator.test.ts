import { COLOR_PALETTE, DIGITS, LETTERS, POSITION_CELLS, TRIALS_PER_ROUND } from '@/config/game';
import { generateRound } from '../generator';
import type { GameSettings, StreamId, TrialStimulus } from '../types';
import { STREAM_IDS } from '../types';

function makeSettings(overrides: Partial<GameSettings> = {}): GameSettings {
  return {
    activeStreams: { position: true, color: true, number: true, audio: true },
    nLevel: 2,
    speed: 'normal',
    trialDurationMs: 2000,
    matchCounts: { position: 5, color: 5, number: 5, audio: 5 },
    ...overrides,
  };
}

const STIMULUS_FIELD: Record<StreamId, keyof TrialStimulus> = {
  position: 'position',
  color: 'color',
  number: 'number',
  audio: 'letter',
};

function valueOf(stimulus: TrialStimulus, stream: StreamId): string | number {
  return stimulus[STIMULUS_FIELD[stream]];
}

describe('generateRound', () => {
  it('produces exactly the requested number of true matches per stream', () => {
    for (let iteration = 0; iteration < 50; iteration++) {
      for (const n of [1, 2, 5, 10]) {
        const settings = makeSettings({
          nLevel: n,
          matchCounts: { position: 6, color: 4, number: 8, audio: 2 },
        });
        const round = generateRound(settings);
        expect(round.stimuli.length).toBe(TRIALS_PER_ROUND);
        for (const stream of STREAM_IDS) {
          const matches = round.isMatch[stream].filter(Boolean).length;
          const expected = Math.min(settings.matchCounts[stream], TRIALS_PER_ROUND - n);
          expect(matches).toBe(expected);
        }
      }
    }
  });

  it('marks a trial as match iff the stimulus equals the one n steps back', () => {
    for (let iteration = 0; iteration < 30; iteration++) {
      const settings = makeSettings({ nLevel: 3 });
      const round = generateRound(settings);
      for (const stream of STREAM_IDS) {
        for (let i = 0; i < TRIALS_PER_ROUND; i++) {
          if (i < settings.nLevel) {
            expect(round.isMatch[stream][i]).toBe(false);
            continue;
          }
          const same = valueOf(round.stimuli[i], stream) === valueOf(round.stimuli[i - settings.nLevel], stream);
          expect(round.isMatch[stream][i]).toBe(same);
        }
      }
    }
  });

  it('never creates accidental matches at non-match positions', () => {
    for (let iteration = 0; iteration < 30; iteration++) {
      const settings = makeSettings({ nLevel: 1 });
      const round = generateRound(settings);
      for (const stream of STREAM_IDS) {
        for (let i = settings.nLevel; i < TRIALS_PER_ROUND; i++) {
          if (!round.isMatch[stream][i]) {
            expect(valueOf(round.stimuli[i], stream)).not.toBe(valueOf(round.stimuli[i - settings.nLevel], stream));
          }
        }
      }
    }
  });

  it('keeps every stimulus value inside its valid range', () => {
    const round = generateRound(makeSettings());
    for (const stimulus of round.stimuli) {
      expect(POSITION_CELLS).toContain(stimulus.position);
      expect(stimulus.color).toBeGreaterThanOrEqual(0);
      expect(stimulus.color).toBeLessThan(COLOR_PALETTE.length);
      expect(DIGITS).toContain(stimulus.number);
      expect(LETTERS).toContain(stimulus.letter);
    }
  });

  it('clamps impossible match counts to the maximum available', () => {
    const settings = makeSettings({ nLevel: 10, matchCounts: { position: 20, color: 20, number: 20, audio: 20 } });
    const round = generateRound(settings);
    for (const stream of STREAM_IDS) {
      expect(round.isMatch[stream].filter(Boolean).length).toBe(10);
    }
  });
});
