import { useEffect, useState } from 'react';

import type { RoundResult } from './types';
import { createRoundRunner } from './runner';
import { useRoundStore } from '@/stores/round';

/**
 * The Play screen's handle on the round. The round itself runs in src/game/runner.ts; this keeps one runner
 * for as long as the screen is there and hands it the latest `onFinish` and `onProgress` (see the runner for
 * what they get).
 */
export function useGameEngine(onFinish: (result: RoundResult) => void, onProgress?: (partial: RoundResult) => void) {
  // Made once. The runner only starts timers when a round starts, so making it has no side effects.
  const [runner] = useState(() => createRoundRunner());
  const state = useRoundStore();

  useEffect(() => {
    runner.setCallbacks(onFinish, onProgress);
  }, [runner, onFinish, onProgress]);

  // When the screen goes away: stop the timers and the voice, and clear the round. In development React
  // also does this once right after the screen first appears, as a check; the runner still works after it.
  useEffect(() => {
    return () => runner.dispose();
  }, [runner]);

  const { startRound, stopRound, respond, pauseRound, resumeRound, currentPlayedMs } = runner;
  return { state, startRound, stopRound, respond, pauseRound, resumeRound, currentPlayedMs };
}
