import type { Mock } from 'vitest';

import { TRIALS_PER_ROUND } from '@/config/game';
import { speakLetter } from '@/lib/speech';
import { useRoundStore } from '@/stores/round';
import { stimulusVisibleMs } from '../rules';
import { createRoundRunner } from '../runner';
import type { GameSettings, RoundResult } from '../types';

vi.mock('@/lib/speech', () => ({
  speakLetter: vi.fn(),
  stopSpeech: vi.fn(),
}));

const TRIAL_MS = 2000;
const VISIBLE_MS = stimulusVisibleMs(TRIAL_MS);

function makeSettings(): GameSettings {
  return {
    activeStreams: { position: true, color: false, number: false, audio: true },
    nLevel: 2,
    speed: 'normal',
    trialDurationMs: TRIAL_MS,
    matchCounts: { position: 6, color: 6, number: 6, audio: 6 },
  };
}

// The store as it starts, put back before each test.
const initial = useRoundStore.getState();

describe('round runner', () => {
  let runner: ReturnType<typeof createRoundRunner>;
  let onFinish: Mock<(result: RoundResult) => void>;
  let onProgress: Mock<(partial: RoundResult) => void>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(speakLetter).mockClear();
    useRoundStore.setState(initial, true);
    // Made after the fake timers are on, so its clock is the pretend one.
    runner = createRoundRunner();
    onFinish = vi.fn<(result: RoundResult) => void>();
    onProgress = vi.fn<(partial: RoundResult) => void>();
    runner.setCallbacks(onFinish, onProgress);
  });

  afterEach(() => {
    runner.dispose();
    vi.useRealTimers();
  });

  it('plays every trial and reports the round once at the end', () => {
    runner.startRound(makeSettings());
    expect(useRoundStore.getState().phase).toBe('running');
    expect(speakLetter).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(TRIAL_MS * TRIALS_PER_ROUND);

    expect(onFinish).toHaveBeenCalledTimes(1);
    const result = onFinish.mock.calls[0][0];
    expect(result.trials).toHaveLength(TRIALS_PER_ROUND);
    expect(result.stopped).toBeUndefined();
    expect(result.durationMs).toBe(TRIAL_MS * TRIALS_PER_ROUND);
    expect(useRoundStore.getState().phase).toBe('finished');
  });

  it('records a correct answer with its response time', () => {
    runner.startRound(makeSettings());
    // Skip ahead to the first trial that's a position match.
    while (!useRoundStore.getState().match.position) {
      vi.advanceTimersByTime(TRIAL_MS);
    }
    const index = useRoundStore.getState().trialIndex;

    vi.advanceTimersByTime(500);
    runner.respond('position');
    expect(useRoundStore.getState().responded.position).toBe(true);

    vi.advanceTimersByTime(TRIAL_MS * TRIALS_PER_ROUND);
    const trial = onFinish.mock.calls[0][0].trials[index];
    expect(trial.outcome.position).toBe('hit');
    expect(trial.responseTimesMs?.position).toBe(500);
  });

  it('ignores a press in the blank after the box goes off', () => {
    runner.startRound(makeSettings());
    vi.advanceTimersByTime(VISIBLE_MS + 100);
    expect(useRoundStore.getState().stimulusVisible).toBe(false);

    runner.respond('position');
    expect(useRoundStore.getState().responded.position).toBe(false);

    vi.advanceTimersByTime(TRIAL_MS * TRIALS_PER_ROUND);
    const first = onFinish.mock.calls[0][0].trials[0];
    expect(first.responded.position).toBe(false);
    expect(first.responseTimesMs?.position).toBeUndefined();
  });

  it('keeps the timing across a pause, and leaves the pause out of the play time', () => {
    runner.startRound(makeSettings());
    vi.advanceTimersByTime(500);
    runner.pauseRound();
    expect(useRoundStore.getState().paused).toBe(true);

    // Nothing moves while paused.
    vi.advanceTimersByTime(10_000);
    expect(useRoundStore.getState().trialIndex).toBe(0);
    expect(runner.currentPlayedMs()).toBe(500);

    runner.resumeRound();
    expect(useRoundStore.getState().paused).toBe(false);
    // Still lit, so the letter is said again.
    expect(speakLetter).toHaveBeenCalledTimes(2);

    // The trial ends after the time it had left, not a whole trial.
    vi.advanceTimersByTime(TRIAL_MS - 500 - 1);
    expect(useRoundStore.getState().trialIndex).toBe(0);
    vi.advanceTimersByTime(1);
    expect(useRoundStore.getState().trialIndex).toBe(1);

    vi.advanceTimersByTime(TRIAL_MS * TRIALS_PER_ROUND);
    expect(onFinish.mock.calls[0][0].durationMs).toBe(TRIAL_MS * TRIALS_PER_ROUND);
  });

  it('reports a stopped round with only the trials already finished', () => {
    runner.startRound(makeSettings());
    vi.advanceTimersByTime(TRIAL_MS * 3 + 500);
    runner.stopRound();

    expect(onFinish).toHaveBeenCalledTimes(1);
    const result = onFinish.mock.calls[0][0];
    expect(result.stopped).toBe(true);
    expect(result.trials).toHaveLength(3);
    expect(useRoundStore.getState().phase).toBe('finished');
    expect(useRoundStore.getState().history).toHaveLength(3);

    // No timers left running after the stop.
    vi.advanceTimersByTime(TRIAL_MS * TRIALS_PER_ROUND);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('reports progress at the start and after each trial but the last', () => {
    runner.startRound(makeSettings());
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress.mock.calls[0][0].trials).toHaveLength(0);
    expect(onProgress.mock.calls[0][0].stopped).toBe(true);

    vi.advanceTimersByTime(TRIAL_MS);
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress.mock.calls[1][0].trials).toHaveLength(1);

    vi.advanceTimersByTime(TRIAL_MS * TRIALS_PER_ROUND);
    expect(onProgress).toHaveBeenCalledTimes(TRIALS_PER_ROUND);
    expect(onProgress.mock.calls.every((call) => call[0].id === onFinish.mock.calls[0][0].id)).toBe(true);
  });
});
