import { useCallback, useEffect, useEffectEvent, useState } from 'react';

import { RoundView } from '@/play/round-view';
import { StartScreen } from '@/play/start-screen';
import { useGameEngine } from '@/game/engine';
import type { GameSettings, RoundResult } from '@/game/types';
import { STREAM_IDS } from '@/game/types';
import { normalizeKey } from '@/lib/prefs';
import { useSettingsStore } from '@/stores/settings';
import { primeSpeech } from '@/lib/speech';
import { playedOnDayMs, roundDurationMs } from '@/lib/stats';
import {
  appendRound,
  clearRoundInProgress,
  loadRounds,
  onRoundsChanged,
  recoverRoundInProgress,
  saveRoundInProgress,
} from '@/lib/storage';

/** Where the Play screen is: the start screen, or a round (running or paused). */
export type PlayStage = 'start' | 'playing' | 'paused';

/**
 * `onReady` fires once the saved rounds (for the daily target) have loaded and are shown. `onStageChange`
 * tells the app when a round starts, pauses, resumes and ends, so it can hide the tab bar during a round.
 */
export function PlayScreen({
  active,
  onReady,
  onStageChange,
}: {
  active: boolean;
  onReady?: () => void;
  onStageChange?: (stage: PlayStage) => void;
}) {
  const settings = useSettingsStore((s) => s.settings);
  const prefs = useSettingsStore((s) => s.prefs);
  const [sessionRounds, setSessionRounds] = useState<RoundResult[]>([]);
  // Null until the saved rounds have loaded, so the daily target doesn't flash 0% on start.
  const [savedRounds, setSavedRounds] = useState<RoundResult[] | null>(null);
  // The round just finished, until it shows up in savedRounds, so the daily target doesn't dip meanwhile.
  const [pendingRound, setPendingRound] = useState<RoundResult | null>(null);
  // Tutorial rounds aren't saved and don't count towards the daily target.
  const [tutorial, setTutorial] = useState(false);
  // The settings the round was started with: the Settings tab can still be opened while a round is paused,
  // and a change there mustn't change the round on screen.
  const [roundSettings, setRoundSettings] = useState<GameSettings>(settings);
  // Counts round starts, so the trial timer restarts even when a new round begins at the same trial index.
  const [roundCount, setRoundCount] = useState(0);

  useEffect(() => {
    if (savedRounds) {
      onReady?.();
    }
  }, [savedRounds, onReady]);

  // Load at startup and after any change to the saved rounds (a round saved, an import on the Settings
  // tab, a clear), so the daily target is ready as soon as the startup screen fades.
  useEffect(() => {
    // A round the app closed in the middle of last time is recorded (as stopped) before the rounds load.
    recoverRoundInProgress().then(() => loadRounds().then(setSavedRounds));
    return onRoundsChanged(() => loadRounds().then(setSavedRounds));
  }, []);

  const handleFinish = useCallback(
    (result: RoundResult) => {
      setSessionRounds((prev) => [result, ...prev]);
      if (!tutorial) {
        setPendingRound(result);
        appendRound(result).then(clearRoundInProgress);
      }
    },
    [tutorial],
  );

  const handleProgress = useCallback(
    (partial: RoundResult) => {
      if (!tutorial) {
        saveRoundInProgress(partial);
      }
    },
    [tutorial],
  );

  const { state, startRound, stopRound, respond, pauseRound, resumeRound, currentPlayedMs } = useGameEngine(
    handleFinish,
    handleProgress,
  );

  // TODO: Rename to something else, busy is very generic
  const busy = state.phase === 'running';
  const stage: PlayStage = busy ? (state.paused ? 'paused' : 'playing') : 'start';
  useEffect(() => {
    onStageChange?.(stage);
  }, [stage, onStageChange]);

  // Today's play counts the round in progress live (it re-renders every trial), unless it's a tutorial,
  // which isn't saved.
  const pendingMs =
    pendingRound && !savedRounds?.some((r) => r.id === pendingRound.id) ? roundDurationMs(pendingRound) : 0;
  const liveMs = tutorial ? 0 : currentPlayedMs();
  const todayMs = playedOnDayMs(savedRounds ?? [], new Date()) + pendingMs + liveMs;
  // False until the saved rounds have loaded, so the chip shows –% rather than a wrong 0%.
  const loaded = savedRounds !== null;

  // During a round everything follows the settings it started with.
  const shown = busy ? roundSettings : settings;
  const activeStreams = STREAM_IDS.filter((s) => shown.activeStreams[s]);
  const n = shown.nLevel;
  // The first N trials have nothing N back to compare with, so they can't be answered.
  const warmingUp = state.trialIndex < n;
  const respondDisabled = !busy || state.paused || warmingUp;

  const onMain = () => {
    if (state.paused) {
      resumeRound();
    } else if (busy) {
      pauseRound();
    } else {
      // A button left focused (e.g. by keyboard navigation) would react to the answer keys.
      if (document.activeElement instanceof HTMLButtonElement) {
        document.activeElement.blur();
      }
      primeSpeech();
      setRoundCount((c) => c + 1);
      setRoundSettings(settings);
      startRound(settings);
    }
  };

  // What each key does: Space plays or pauses, Esc stops, and the answer keys answer.
  // useEffectEvent makes sure it always uses the current round and key bindings.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) {
      return;
    }
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      onMain();
    } else if (e.key === 'Escape') {
      if (busy) {
        stopRound();
      }
    } else {
      const stream = STREAM_IDS.find((s) => prefs.keyBindings[s] === normalizeKey(e.key));
      // During a round, an answer key prevents its default behaviour, like an arrow key scrolling the
      // screen or jumping to a button. This holds even when it can't answer yet (the first trials, or paused).
      if (stream && (busy || !respondDisabled)) {
        e.preventDefault();
      }
      if (stream && !respondDisabled) {
        respond(stream);
      }
    }
  });

  // Listen for key presses whenever the Play tab is on screen (the start screen and during a round),
  // and stop when another tab is opened.
  useEffect(() => {
    if (!active) {
      return;
    }
    const listener = (e: KeyboardEvent) => onKey(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [active]);

  // Pause the round when the app goes to the background. Phones and browsers slow down timers there,
  // which would make the trial timing wrong.
  const onVisibility = useEffectEvent(() => {
    if (document.hidden && busy && !state.paused) {
      pauseRound();
    }
  });

  // Listen for the app going to the background.
  useEffect(() => {
    const listener = () => onVisibility();
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  }, []);

  if (busy) {
    return (
      <RoundView
        state={state}
        shown={shown}
        n={n}
        activeStreams={activeStreams}
        warmingUp={warmingUp}
        respondDisabled={respondDisabled}
        tutorial={tutorial}
        prefs={prefs}
        roundCount={roundCount}
        todayMs={todayMs}
        loaded={loaded}
        onMain={onMain}
        stopRound={stopRound}
        respond={respond}
      />
    );
  }

  return (
    <StartScreen
      settings={settings}
      activeStreams={activeStreams}
      phase={state.phase}
      sessionRounds={sessionRounds}
      tutorial={tutorial}
      setTutorial={setTutorial}
      todayMs={todayMs}
      loaded={loaded}
      onMain={onMain}
    />
  );
}
