import { useEffect, useRef, useState } from 'react';

import type { GameSettings, RoundResult, StreamId, TrialRecord, TrialStimulus } from './types';
import { TRIALS_PER_ROUND, stimulusVisibleMs } from './config';
import { generateRound } from './generator';
import { evaluateTrial } from './scoring';
import { speakLetter, stopSpeech } from '@/speech';
import { STREAM_IDS } from './types';

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

function emptyResponses(): Record<StreamId, boolean> {
  return { position: false, color: false, number: false, audio: false };
}

function now(): number {
  return Date.now();
}

const INITIAL_STATE: GameEngineState = {
  phase: 'idle',
  trialIndex: -1,
  stimulus: null,
  stimulusVisible: false,
  responded: emptyResponses(),
  match: emptyResponses(),
  paused: false,
  history: [],
};

interface RoundSequence {
  stimuli: TrialStimulus[];
  isMatch: Record<StreamId, boolean[]>;
  settings: GameSettings;
}

/**
 * `onFinish` gets every round that ends: played to the last trial, or stopped (`stopped: true`, scored 0).
 * `onProgress` gets the round so far as it starts and after each trial, already marked stopped, so it can
 * be saved and recorded as a stopped round if the app closes before the round ends.
 */
export function useGameEngine(onFinish: (result: RoundResult) => void, onProgress?: (partial: RoundResult) => void) {
  // TODO: Replace with zustand and check if there is a different way around all thse useRef
  const [state, setState] = useState<GameEngineState>(INITIAL_STATE);

  const roundRef = useRef<RoundSequence | null>(null);
  const recordsRef = useRef<TrialRecord[]>([]);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const respondedRef = useRef<Set<StreamId>>(new Set());
  const trialRtsRef = useRef<Partial<Record<StreamId, number>>>({});
  /** Whether a press counts: only while the box is lit, not in the blank before the next trial. */
  const trialActiveRef = useRef(false);
  const pausedRef = useRef(false);
  const trialStartRef = useRef(0);
  const playedMsRef = useRef(0);
  const segmentStartRef = useRef(0);
  const remainingVisibleMsRef = useRef(0);
  const remainingTrialMsRef = useRef(0);
  const pauseSnapshotRef = useRef<{ trialIndex: number } | null>(null);
  const roundIdRef = useRef('');
  const onFinishRef = useRef(onFinish);
  const onProgressRef = useRef(onProgress);

  useEffect(() => {
    onFinishRef.current = onFinish;
    onProgressRef.current = onProgress;
  }, [onFinish, onProgress]);

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current) {
        clearTimeout(timer);
      }
      timersRef.current = [];
      stopSpeech();
    };
  }, []);

  function clearTimers() {
    for (const timer of timersRef.current) {
      clearTimeout(timer);
    }
    timersRef.current = [];
  }

  function later(fn: () => void, ms: number) {
    timersRef.current.push(setTimeout(fn, ms));
  }

  /** Play time so far, pauses excluded. */
  function playedMs(): number {
    return playedMsRef.current + (pausedRef.current ? 0 : now() - segmentStartRef.current);
  }

  /** The round as it stands: the trials played so far. */
  function roundResult(round: RoundSequence, stopped: boolean): RoundResult {
    return {
      id: roundIdRef.current,
      finishedAt: now(),
      settings: { ...round.settings },
      trials: [...recordsRef.current],
      durationMs: playedMs(),
      ...(stopped ? { stopped: true } : {}),
    };
  }

  function finishRound() {
    const round = roundRef.current;
    if (!round) {
      return;
    }
    stopSpeech();
    trialActiveRef.current = false;
    setState((prev) => ({ ...prev, phase: 'finished', history: [...recordsRef.current] }));
    onFinishRef.current(roundResult(round, false));
  }

  function endTrial(index: number) {
    const round = roundRef.current;
    if (!round) {
      return;
    }
    trialActiveRef.current = false;

    const isMatchRow = {} as Record<StreamId, boolean>;
    for (const stream of STREAM_IDS) {
      isMatchRow[stream] = round.isMatch[stream][index];
    }
    const responded = emptyResponses();
    for (const stream of STREAM_IDS) {
      responded[stream] = respondedRef.current.has(stream);
    }

    recordsRef.current.push({
      index,
      stimulus: round.stimuli[index],
      isMatch: isMatchRow,
      responded,
      outcome: evaluateTrial(round.settings.activeStreams, isMatchRow, responded),
      responseTimesMs: { ...trialRtsRef.current },
    });

    if (index + 1 < TRIALS_PER_ROUND) {
      onProgressRef.current?.(roundResult(round, true));
      runTrial(index + 1);
    } else {
      finishRound();
    }
  }

  function hideStimulus(index: number) {
    // The answer window closes with the box: a press in the blank would be a guess at a box no longer shown.
    trialActiveRef.current = false;
    setState((prev) =>
      prev.trialIndex === index ? { ...prev, stimulusVisible: false, responded: emptyResponses() } : prev,
    );
  }

  function runTrial(index: number) {
    const round = roundRef.current;
    if (!round) {
      return;
    }
    respondedRef.current = new Set();
    trialRtsRef.current = {};
    trialActiveRef.current = true;
    trialStartRef.current = now();
    remainingVisibleMsRef.current = 0;
    remainingTrialMsRef.current = 0;
    const match = emptyResponses();
    for (const stream of STREAM_IDS) {
      match[stream] = round.settings.activeStreams[stream] && round.isMatch[stream][index];
    }
    setState({
      phase: 'running',
      trialIndex: index,
      stimulus: round.stimuli[index],
      stimulusVisible: true,
      responded: emptyResponses(),
      match,
      paused: false,
      history: [...recordsRef.current],
    });

    if (round.settings.activeStreams.audio) {
      stopSpeech();
      speakLetter(round.stimuli[index].letter);
    }

    later(() => hideStimulus(index), stimulusVisibleMs(round.settings.trialDurationMs));

    later(() => endTrial(index), round.settings.trialDurationMs);
  }

  function startRound(settings: GameSettings) {
    clearTimers();
    stopSpeech();
    recordsRef.current = [];
    respondedRef.current = new Set();
    trialRtsRef.current = {};
    trialActiveRef.current = false;
    pausedRef.current = false;
    pauseSnapshotRef.current = null;
    playedMsRef.current = 0;
    segmentStartRef.current = now();
    roundIdRef.current = `round-${now()}`;
    roundRef.current = { ...generateRound(settings), settings: { ...settings } };
    onProgressRef.current?.(roundResult(roundRef.current, true));
    runTrial(0);
  }

  function pauseRound() {
    const round = roundRef.current;
    if (!round || pausedRef.current) {
      return;
    }
    if (state.phase !== 'running') {
      return;
    }
    clearTimers();
    stopSpeech();

    const elapsed = now() - trialStartRef.current;
    remainingVisibleMsRef.current = Math.max(0, stimulusVisibleMs(round.settings.trialDurationMs) - elapsed);
    remainingTrialMsRef.current = Math.max(0, round.settings.trialDurationMs - elapsed);
    pauseSnapshotRef.current = { trialIndex: state.trialIndex };
    playedMsRef.current += now() - segmentStartRef.current;
    pausedRef.current = true;
    setState((prev) => ({ ...prev, paused: true }));
  }

  function resumeRound() {
    const snapshot = pauseSnapshotRef.current;
    const round = roundRef.current;
    if (!pausedRef.current || !snapshot || !round) {
      return;
    }
    pausedRef.current = false;
    pauseSnapshotRef.current = null;

    const index = snapshot.trialIndex;
    // Paused in the blank: answers stay closed until the next trial.
    trialActiveRef.current = remainingVisibleMsRef.current > 0;
    trialStartRef.current = now();
    segmentStartRef.current = now();
    setState((prev) => ({ ...prev, paused: false }));

    if (remainingVisibleMsRef.current > 0) {
      if (round.settings.activeStreams.audio) {
        stopSpeech();
        speakLetter(round.stimuli[index].letter);
      }
      later(() => hideStimulus(index), remainingVisibleMsRef.current);
    }
    later(() => endTrial(index), Math.max(0, remainingTrialMsRef.current));
    remainingVisibleMsRef.current = 0;
    remainingTrialMsRef.current = 0;
  }

  /**
   * Ends the round early. It still counts: it's recorded as stopped (scored 0) with the trials played so
   * far, so stopping can't be used to keep a bad round out of the stats. The trial in progress is dropped.
   */
  function stopRound() {
    const round = roundRef.current;
    if (!round || state.phase !== 'running') {
      return;
    }
    const result = roundResult(round, true);
    resetRound();
    setState({ ...INITIAL_STATE, phase: 'finished', history: result.trials });
    onFinishRef.current(result);
  }

  function resetRound() {
    clearTimers();
    stopSpeech();
    trialActiveRef.current = false;
    pausedRef.current = false;
    pauseSnapshotRef.current = null;
    playedMsRef.current = 0;
    segmentStartRef.current = 0;
    remainingVisibleMsRef.current = 0;
    remainingTrialMsRef.current = 0;
    roundRef.current = null;
    recordsRef.current = [];
    trialRtsRef.current = {};
  }

  function respond(stream: StreamId) {
    const round = roundRef.current;
    if (!round || !trialActiveRef.current || pausedRef.current) {
      return;
    }
    if (!round.settings.activeStreams[stream]) {
      return;
    }
    if (respondedRef.current.has(stream)) {
      return;
    }
    respondedRef.current.add(stream);
    trialRtsRef.current[stream] = Math.max(0, now() - trialStartRef.current);
    setState((prev) => ({ ...prev, responded: { ...prev.responded, [stream]: true } }));
  }

  /** Play time of the running round so far (0 when none), counted like the durationMs it's saved with. */
  function currentPlayedMs(): number {
    if (state.phase !== 'running' || !roundRef.current) {
      return 0;
    }
    return playedMs();
  }

  return { state, startRound, stopRound, respond, pauseRound, resumeRound, currentPlayedMs };
}
