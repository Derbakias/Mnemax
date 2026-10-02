// Runs a round: shows each trial, takes the answers, keeps the time, and reports the round when it ends.
// What the screen shows goes to the round store (src/stores/round.ts).

import type { GameSettings, RoundResult, StreamId, TrialRecord, TrialStimulus } from './types';
import { TRIALS_PER_ROUND } from '@/config/game';
import { stimulusVisibleMs } from './rules';
import { generateRound } from './generator';
import { evaluateTrial } from './scoring';
import { speakLetter, stopSpeech } from '@/lib/speech';
import { emptyResponses, useRoundStore } from '@/stores/round';
import { STREAM_IDS } from './types';

interface RoundSequence {
  stimuli: TrialStimulus[];
  isMatch: Record<StreamId, boolean[]>;
  settings: GameSettings;
}

/**
 * `now` is the clock, so tests can use a pretend one.
 *
 * `onFinish` gets every round that ends: played to the last trial, or stopped (`stopped: true`, scored 0).
 * `onProgress` gets the round so far as it starts and after each trial, already marked stopped, so it can
 * be saved and recorded as a stopped round if the app closes before the round ends.
 */
export function createRoundRunner({ now = Date.now }: { now?: () => number } = {}) {
  const setState = useRoundStore.setState;

  let round: RoundSequence | null = null;
  let records: TrialRecord[] = [];
  let timers: ReturnType<typeof setTimeout>[] = [];
  let respondedSet = new Set<StreamId>();
  let trialRts: Partial<Record<StreamId, number>> = {};
  /** Whether a press counts: only while the box is lit, not in the blank before the next trial. */
  let trialActive = false;
  let paused = false;
  let trialStart = 0;
  let playedSoFarMs = 0;
  let segmentStart = 0;
  let remainingVisibleMs = 0;
  let remainingTrialMs = 0;
  let pauseSnapshot: { trialIndex: number } | null = null;
  let roundId = '';
  let onFinish: (result: RoundResult) => void = () => {};
  let onProgress: ((partial: RoundResult) => void) | undefined;

  /** Sets who hears about the round: when it ends, and as it goes. */
  function setCallbacks(finish: (result: RoundResult) => void, progress?: (partial: RoundResult) => void) {
    onFinish = finish;
    onProgress = progress;
  }

  function clearTimers() {
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers = [];
  }

  function later(fn: () => void, ms: number) {
    timers.push(setTimeout(fn, ms));
  }

  /** Play time so far, pauses excluded. */
  function playedMs(): number {
    return playedSoFarMs + (paused ? 0 : now() - segmentStart);
  }

  /** The round as it stands: the trials played so far. */
  function roundResult(current: RoundSequence, stopped: boolean): RoundResult {
    return {
      id: roundId,
      finishedAt: now(),
      settings: { ...current.settings },
      trials: [...records],
      durationMs: playedMs(),
      ...(stopped ? { stopped: true } : {}),
    };
  }

  function finishRound() {
    const current = round;
    if (!current) {
      return;
    }
    stopSpeech();
    trialActive = false;
    setState((prev) => ({ ...prev, phase: 'finished', history: [...records] }));
    onFinish(roundResult(current, false));
  }

  function endTrial(index: number) {
    const current = round;
    if (!current) {
      return;
    }
    trialActive = false;

    const isMatchRow = {} as Record<StreamId, boolean>;
    for (const stream of STREAM_IDS) {
      isMatchRow[stream] = current.isMatch[stream][index];
    }
    const responded = emptyResponses();
    for (const stream of STREAM_IDS) {
      responded[stream] = respondedSet.has(stream);
    }

    records.push({
      index,
      stimulus: current.stimuli[index],
      isMatch: isMatchRow,
      responded,
      outcome: evaluateTrial(current.settings.activeStreams, isMatchRow, responded),
      responseTimesMs: { ...trialRts },
    });

    if (index + 1 < TRIALS_PER_ROUND) {
      onProgress?.(roundResult(current, true));
      runTrial(index + 1);
    } else {
      finishRound();
    }
  }

  function hideStimulus(index: number) {
    // The answer window closes with the box: a press in the blank would be a guess at a box no longer shown.
    trialActive = false;
    setState((prev) =>
      prev.trialIndex === index ? { ...prev, stimulusVisible: false, responded: emptyResponses() } : prev,
    );
  }

  function runTrial(index: number) {
    const current = round;
    if (!current) {
      return;
    }
    respondedSet = new Set();
    trialRts = {};
    trialActive = true;
    trialStart = now();
    remainingVisibleMs = 0;
    remainingTrialMs = 0;
    const match = emptyResponses();
    for (const stream of STREAM_IDS) {
      match[stream] = current.settings.activeStreams[stream] && current.isMatch[stream][index];
    }
    setState({
      phase: 'running',
      trialIndex: index,
      stimulus: current.stimuli[index],
      stimulusVisible: true,
      responded: emptyResponses(),
      match,
      paused: false,
      history: [...records],
    });

    if (current.settings.activeStreams.audio) {
      stopSpeech();
      speakLetter(current.stimuli[index].letter);
    }

    later(() => hideStimulus(index), stimulusVisibleMs(current.settings.trialDurationMs));
    later(() => endTrial(index), current.settings.trialDurationMs);
  }

  function startRound(settings: GameSettings) {
    clearTimers();
    stopSpeech();
    records = [];
    respondedSet = new Set();
    trialRts = {};
    trialActive = false;
    paused = false;
    pauseSnapshot = null;
    playedSoFarMs = 0;
    segmentStart = now();
    roundId = `round-${now()}`;
    round = { ...generateRound(settings), settings: { ...settings } };
    onProgress?.(roundResult(round, true));
    runTrial(0);
  }

  function pauseRound() {
    const current = round;
    if (!current || paused) {
      return;
    }
    const state = useRoundStore.getState();
    if (state.phase !== 'running') {
      return;
    }
    clearTimers();
    stopSpeech();

    const elapsed = now() - trialStart;
    remainingVisibleMs = Math.max(0, stimulusVisibleMs(current.settings.trialDurationMs) - elapsed);
    remainingTrialMs = Math.max(0, current.settings.trialDurationMs - elapsed);
    pauseSnapshot = { trialIndex: state.trialIndex };
    playedSoFarMs += now() - segmentStart;
    paused = true;
    setState((prev) => ({ ...prev, paused: true }));
  }

  function resumeRound() {
    const snapshot = pauseSnapshot;
    const current = round;
    if (!paused || !snapshot || !current) {
      return;
    }
    paused = false;
    pauseSnapshot = null;

    const index = snapshot.trialIndex;
    // Paused in the blank: answers stay closed until the next trial.
    trialActive = remainingVisibleMs > 0;
    // The trial "started" as long ago as it has been played, so a later pause and the answer times skip the pause.
    trialStart = now() - (current.settings.trialDurationMs - remainingTrialMs);
    segmentStart = now();
    setState((prev) => ({ ...prev, paused: false }));

    if (remainingVisibleMs > 0) {
      if (current.settings.activeStreams.audio) {
        stopSpeech();
        speakLetter(current.stimuli[index].letter);
      }
      later(() => hideStimulus(index), remainingVisibleMs);
    }
    later(() => endTrial(index), Math.max(0, remainingTrialMs));
    remainingVisibleMs = 0;
    remainingTrialMs = 0;
  }

  /**
   * Ends the round early. It still counts: it's recorded as stopped (scored 0) with the trials played so
   * far, so stopping can't be used to keep a bad round out of the stats. The trial in progress is dropped.
   */
  function stopRound() {
    const current = round;
    if (!current || useRoundStore.getState().phase !== 'running') {
      return;
    }
    const result = roundResult(current, true);
    resetRound();
    setState({ ...useRoundStore.getInitialState(), phase: 'finished', history: result.trials });
    onFinish(result);
  }

  function resetRound() {
    clearTimers();
    stopSpeech();
    trialActive = false;
    paused = false;
    pauseSnapshot = null;
    playedSoFarMs = 0;
    segmentStart = 0;
    remainingVisibleMs = 0;
    remainingTrialMs = 0;
    round = null;
    records = [];
    trialRts = {};
  }

  function respond(stream: StreamId) {
    const current = round;
    if (!current || !trialActive || paused) {
      return;
    }
    if (!current.settings.activeStreams[stream]) {
      return;
    }
    if (respondedSet.has(stream)) {
      return;
    }
    respondedSet.add(stream);
    trialRts[stream] = Math.max(0, now() - trialStart);
    setState((prev) => ({ ...prev, responded: { ...prev.responded, [stream]: true } }));
  }

  /** Play time of the running round so far (0 when none), counted like the durationMs it's saved with. */
  function currentPlayedMs(): number {
    if (useRoundStore.getState().phase !== 'running' || !round) {
      return 0;
    }
    return playedMs();
  }

  /**
   * For when the Play screen goes away: drops any round in progress (not reported, as before) and puts the
   * screen back to the start. The runner can still start a new round afterwards.
   */
  function dispose() {
    resetRound();
    setState(useRoundStore.getInitialState(), true);
  }

  return { setCallbacks, startRound, stopRound, respond, pauseRound, resumeRound, currentPlayedMs, dispose };
}
