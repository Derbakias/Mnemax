// The round being played, as the Play screen shows it. Only what's on screen lives here; the timing and the
// rules that move the round along are in src/game/runner.ts, which writes here.

import { create } from 'zustand';

import type { StreamId, TrialRecord, TrialStimulus } from '@/game/types';

export type GamePhase = 'idle' | 'running' | 'finished';

export interface GameEngineState {
  phase: GamePhase;
  trialIndex: number;
  stimulus: TrialStimulus | null;
  stimulusVisible: boolean;
  /** Which answer buttons show their colour. Cleared when the box goes off, so an answer's colour doesn't
   *  carry through the blank into the next trial. */
  responded: Record<StreamId, boolean>;
  /** Which streams the current trial is a match on (all false before the first N trials are past). */
  match: Record<StreamId, boolean>;
  paused: boolean;
  history: TrialRecord[];
}

export function emptyResponses(): Record<StreamId, boolean> {
  return { position: false, color: false, number: false, audio: false };
}

export const useRoundStore = create<GameEngineState>()(() => ({
  phase: 'idle',
  trialIndex: -1,
  stimulus: null,
  stimulusVisible: false,
  responded: emptyResponses(),
  match: emptyResponses(),
  paused: false,
  history: [],
}));
