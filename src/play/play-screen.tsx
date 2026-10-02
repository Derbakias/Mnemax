import { useCallback, useEffect, useRef, useState } from 'react';

import { DailyTargetChip } from '@/play/hud-chips';
import { RoundView } from '@/play/round-view';
import { StartScreen } from '@/play/start-screen';
import { useGameEngine } from '@/game/engine';
import type { GameSettings, RoundResult } from '@/game/types';
import { STREAM_IDS } from '@/game/types';
import { normalizeKey } from '@/lib/prefs';
import { useSettings } from '@/stores/settings-context';
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
  const { settings, prefs } = useSettings();
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
  const targetChip = (
    <DailyTargetChip
      loaded={savedRounds !== null}
      todayMs={todayMs}
      targetMs={prefs.dailyTargetMinutes * 60_000}
      minutes={prefs.dailyTargetMinutes}
    />
  );

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

  // Keyboard and visibility listeners are attached once; they read the latest render's values.
  const keys = prefs.keyBindings;
  const latest = useRef({ onMain, stopRound, respond, respondDisabled, busy, paused: state.paused, pauseRound, keys });
  latest.current = { onMain, stopRound, respond, respondDisabled, busy, paused: state.paused, pauseRound, keys };

  useEffect(() => {
    if (!active) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
        return;
      }
      const l = latest.current;
      if (e.key === ' ') {
        e.preventDefault();
        l.onMain();
      } else if (e.key === 'Escape') {
        if (l.busy) {
          l.stopRound();
        }
      } else {
        const stream = STREAM_IDS.find((s) => l.keys[s] === normalizeKey(e.key));
        // During a round an answer key is always ours, even while it can't answer (first trial, paused):
        // otherwise an arrow key would scroll the page or move focus.
        if (stream && (l.busy || !l.respondDisabled)) {
          e.preventDefault();
        }
        if (stream && !l.respondDisabled) {
          l.respond(stream);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  // Background tabs / apps throttle timers, which would corrupt trial timing.
  useEffect(() => {
    const onVisibility = () => {
      const l = latest.current;
      if (document.hidden && l.busy && !l.paused) {
        l.pauseRound();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
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
        targetChip={targetChip}
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
      targetChip={targetChip}
      onMain={onMain}
    />
  );
}
