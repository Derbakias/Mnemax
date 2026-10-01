import { checkRound } from '../game/round-check';
import type { RoundResult, TrialRecord } from '../game/types';

const NOW = Date.UTC(2026, 8, 30, 12);

function trial(index: number): TrialRecord {
  return {
    index,
    stimulus: { position: 8, color: 5, number: 9, letter: 'K' },
    isMatch: { position: true, color: false, number: false, audio: false },
    responded: { position: true },
    outcome: { position: 'hit', audio: 'correctRejection' },
    responseTimesMs: { position: 612.5 },
  };
}

function round(): RoundResult {
  return {
    id: 'round-1759233600000',
    finishedAt: NOW - 60_000,
    settings: {
      activeStreams: { position: true, color: false, number: false, audio: true },
      nLevel: 2,
      speed: 'normal',
      trialDurationMs: 2900,
      matchCounts: { position: 6, color: 6, number: 6, audio: 6 },
    },
    trials: [trial(0), trial(1)],
    durationMs: 58_000,
  };
}

/** The round as JSON would give it back, with `change` applied to it. */
function withChange(change: (r: Record<string, any>) => void): unknown {
  const raw = JSON.parse(JSON.stringify(round()));
  change(raw);
  return raw;
}

describe('checkRound', () => {
  it('keeps a round the app saved, unchanged', () => {
    expect(checkRound(round(), NOW)).toEqual(round());
    const stopped = { ...round(), stopped: true, trials: [] };
    expect(checkRound(stopped, NOW)).toEqual(stopped);
  });

  it('keeps a round saved before the speed level was', () => {
    const old = withChange((r) => delete r.settings.speed);
    expect(checkRound(old, NOW)?.settings.speed).toBeUndefined();
  });

  it('drops fields the app does not know', () => {
    const extra = withChange((r) => {
      r.note = 'x';
      r.settings.theme = 'dark';
      r.trials[0].stimulus.sound = 'beep';
      r.trials[0].outcome.smell = 'hit';
    });
    expect(checkRound(extra, NOW)).toEqual(round());
  });

  it('turns down anything that is not a round', () => {
    for (const value of [null, undefined, 1, 'round', [], [round()]]) {
      expect(checkRound(value, NOW)).toBeNull();
    }
  });

  it.each<[string, (r: Record<string, any>) => void]>([
    ['no id', (r) => delete r.id],
    ['an empty id', (r) => (r.id = '')],
    ['an id with other characters', (r) => (r.id = 'round 1<script>')],
    ['a very long id', (r) => (r.id = 'r'.repeat(65))],
    ['a finish time as text', (r) => (r.finishedAt = String(r.finishedAt))],
    ['a finish time before 2020', (r) => (r.finishedAt = Date.UTC(2019, 11, 31))],
    ['a finish time over a day ahead', (r) => (r.finishedAt = NOW + 25 * 60 * 60 * 1000)],
    ['a fractional finish time', (r) => (r.finishedAt += 0.5)],
    ['a negative duration', (r) => (r.durationMs = -1)],
    ['a duration over a day', (r) => (r.durationMs = 25 * 60 * 60 * 1000)],
    ['stopped as text', (r) => (r.stopped = 'yes')],
    ['no settings', (r) => delete r.settings],
    ['a level too high', (r) => (r.settings.nLevel = 11)],
    ['a level too low', (r) => (r.settings.nLevel = 0)],
    ['a fractional level', (r) => (r.settings.nLevel = 2.5)],
    ['an unknown speed', (r) => (r.settings.speed = 'warp')],
    ['no trial length', (r) => delete r.settings.trialDurationMs],
    ['an endless trial length', (r) => (r.settings.trialDurationMs = Infinity)],
    [
      'no stream on',
      (r) => (r.settings.activeStreams = { position: false, color: false, number: false, audio: false }),
    ],
    ['a stream missing', (r) => delete r.settings.activeStreams.color],
    ['a match count too high', (r) => (r.settings.matchCounts.audio = 21)],
    ['trials that are not a list', (r) => (r.trials = {})],
    ['too many trials', (r) => (r.trials = Array.from({ length: 21 }, (_, i) => trial(i % 20)))],
    ['two trials with one index', (r) => (r.trials[1].index = 0)],
    ['a trial index past the round', (r) => (r.trials[1].index = 20)],
    ['a cell off the grid', (r) => (r.trials[0].stimulus.position = 9)],
    ['a colour off the palette', (r) => (r.trials[0].stimulus.color = 6)],
    ['a digit that is not 1-9', (r) => (r.trials[0].stimulus.number = 0)],
    ['a letter that is not a letter', (r) => (r.trials[0].stimulus.letter = '<b>')],
    ['a match missing a stream', (r) => delete r.trials[0].isMatch.audio],
    ['an answer as text', (r) => (r.trials[0].responded.position = 'true')],
    ['an unknown outcome', (r) => (r.trials[0].outcome.position = 'win')],
    ['a negative response time', (r) => (r.trials[0].responseTimesMs.position = -5)],
    ['response times that are not a map', (r) => (r.trials[0].responseTimesMs = [1])],
  ])('turns down a round with %s', (_, change) => {
    expect(checkRound(withChange(change), NOW)).toBeNull();
  });

  it('returns a copy, not the object it was given', () => {
    const raw = round();
    const checked = checkRound(raw, NOW)!;
    expect(checked).not.toBe(raw);
    expect(checked.trials[0]).not.toBe(raw.trials[0]);
    expect(checked.settings.activeStreams).not.toBe(raw.settings.activeStreams);
  });

  it('ignores a __proto__ key in the JSON', () => {
    const raw = JSON.parse(JSON.stringify(round()).replace('"id":', '"__proto__":{"polluted":true},"id":'));
    const checked = checkRound(raw, NOW)!;
    expect(checked).toEqual(round());
    expect(Object.getPrototypeOf(checked)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
