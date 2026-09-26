// TODO: !IMPORTANT! This one also needs to be broken down
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { Icon } from '@/components/icon';
import { HudDropdown } from '@/components/hud-dropdown';
import { ButtonRoomFiller, ResponseButtons, STREAM_ICONS } from '@/components/response-buttons';
import { RoundDetailTable } from '@/components/round-detail-table';
import { RoundHistoryList } from '@/components/round-history-list';
import { RoundSummaryCard } from '@/components/round-summary-card';
import { Stepper } from '@/components/stepper';
import { StimulusGrid } from '@/components/stimulus-grid';
import { TrialHistory } from '@/components/trial-history';
import { MAX_N, MIN_N, SPEED_PRESETS, TRIALS_PER_ROUND, speedPresetFor } from '@/game/config';
import { useGameEngine } from '@/game/engine';
import type { RoundResult } from '@/game/types';
import { STREAM_IDS, STREAM_LABELS } from '@/game/types';
import { normalizeKey } from '@/prefs';
import { useSettings } from '@/settings-context';
import { primeSpeech } from '@/speech';
import { formatDuration, playedOnDayMs, roundDurationMs } from '@/stats';
import {
  appendRound,
  clearRoundInProgress,
  loadRounds,
  onRoundsChanged,
  recoverRoundInProgress,
  saveRoundInProgress,
} from '@/storage';

/** `onReady` fires once the saved rounds (for the daily target) have loaded and are shown. */
export function PlayScreen({ active, onReady }: { active: boolean; onReady?: () => void }) {
  const { settings, prefs, setNLevel, setTrialDurationMs, toggleStream } = useSettings();
  const [sessionRounds, setSessionRounds] = useState<RoundResult[]>([]);
  // Null until the saved rounds have loaded, so the daily target doesn't flash 0% on start.
  const [savedRounds, setSavedRounds] = useState<RoundResult[] | null>(null);
  // The round just finished, until it shows up in savedRounds, so the daily target doesn't dip meanwhile.
  const [pendingRound, setPendingRound] = useState<RoundResult | null>(null);
  const [practiceMode, setPracticeMode] = useState(false);
  // Counts round starts, so the trial timer restarts even when a new round begins at the same trial index.
  const [roundCount, setRoundCount] = useState(0);

  useEffect(() => {
    if (savedRounds) onReady?.();
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
      if (!practiceMode) {
        setPendingRound(result);
        appendRound(result).then(clearRoundInProgress);
      }
    },
    [practiceMode],
  );

  const handleProgress = useCallback(
    (partial: RoundResult) => {
      if (!practiceMode) saveRoundInProgress(partial);
    },
    [practiceMode],
  );

  const { state, startRound, stopRound, respond, pauseRound, resumeRound, currentPlayedMs } = useGameEngine(
    handleFinish,
    handleProgress,
  );

  const activeStreams = STREAM_IDS.filter((s) => settings.activeStreams[s]);
  // Today's play counts the round in progress live (it re-renders every trial), unless it's practice,
  // which isn't saved.
  const pendingMs =
    pendingRound && !savedRounds?.some((r) => r.id === pendingRound.id) ? roundDurationMs(pendingRound) : 0;
  const liveMs = practiceMode ? 0 : currentPlayedMs();
  const todayMs = playedOnDayMs(savedRounds ?? [], new Date()) + pendingMs + liveMs;
  const targetMs = prefs.dailyTargetMinutes * 60_000;
  const targetPercent = Math.floor((todayMs / targetMs) * 100);
  const targetReached = todayMs >= targetMs;
  const busy = state.phase === 'running';
  const showLatest = !busy && state.phase !== 'idle' && sessionRounds.length > 0;
  // The first N trials have nothing N back to compare with, so they can't be answered (settings can't
  // change mid-round, so settings.nLevel is the round's N).
  const warmingUp = state.trialIndex < settings.nLevel;
  const respondDisabled = !busy || state.paused || warmingUp;
  const historyItems = (
    state.trialIndex >= state.history.length && state.stimulus
      ? [...state.history, { index: state.trialIndex, stimulus: state.stimulus }]
      : state.history
  ).slice(-(settings.nLevel + 1));

  const onMain = () => {
    if (state.paused) resumeRound();
    else if (busy) pauseRound();
    else {
      // A button left focused (e.g. by keyboard navigation) would react to the answer keys.
      if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
      primeSpeech();
      setRoundCount((n) => n + 1);
      startRound(settings);
    }
  };

  // Keyboard and visibility listeners are attached once; they read the latest render's values.
  const keys = prefs.keyBindings;
  const latest = useRef({ onMain, stopRound, respond, respondDisabled, busy, paused: state.paused, pauseRound, keys });
  latest.current = { onMain, stopRound, respond, respondDisabled, busy, paused: state.paused, pauseRound, keys };

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const l = latest.current;
      if (e.key === ' ') {
        e.preventDefault();
        l.onMain();
      } else if (e.key === 'Escape') {
        if (l.busy) l.stopRound();
      } else {
        const stream = STREAM_IDS.find((s) => l.keys[s] === normalizeKey(e.key));
        // During a round an answer key is always ours, even while it can't answer (first trial, paused):
        // otherwise an arrow key would scroll the page or move focus.
        if (stream && (l.busy || !l.respondDisabled)) e.preventDefault();
        if (stream && !l.respondDisabled) l.respond(stream);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  // Background tabs / apps throttle timers, which would corrupt trial timing.
  useEffect(() => {
    const onVisibility = () => {
      const l = latest.current;
      if (document.hidden && l.busy && !l.paused) l.pauseRound();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  return (
    <div className="content play">
      {/* The game itself: on a phone it fills the screen, with the answer buttons and controls at the bottom
          in thumb reach and the grid centred above them. The round details below scroll into view. */}
      <div className={`play-stage ${prefs.buttonLayout}${practiceMode ? ' practice' : ''}`}>
      {/* TODO: The hud should be outside of the dom on mobile and maybe use a drag down arrow 
          to display and hide just to get more space for the grid box  */}
        <div className="hud-row">
          <HudDropdown
            label="Daily target"
            title="Daily target"
            chipClassName={targetReached ? 'good' : undefined}
            chip={
              <>
                <Icon name="target" size={18} />
                {savedRounds ? `${targetPercent}%` : '–%'}
              </>
            }>
            <div className="target-panel">
              <div className="row-between">
                <span className="t-small secondary">Daily target</span>
                <span className={targetReached ? 't-small good' : 't-small'}>{targetPercent}%</span>
              </div>
              <div
                className="target-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.min(100, targetPercent)}>
                <div
                  className={targetReached ? 'target-fill reached' : 'target-fill'}
                  style={{ width: `${Math.min(100, targetPercent)}%` }}
                />
              </div>
              <div className="target-stats">
                <TargetStat label="Played" value={formatDuration(todayMs)} />
                <TargetStat
                  label="Left"
                  value={targetReached ? 'Done' : formatDuration(targetMs - todayMs)}
                  good={targetReached}
                />
                <TargetStat label="Goal" value={`${prefs.dailyTargetMinutes}m`} />
              </div>
            </div>
          </HudDropdown>
          <HudDropdown
            label={`N-back level: ${settings.nLevel}`}
            title={`N-back level: ${settings.nLevel}`}
            disabled={busy}
            chip={
              <>
                <Icon name="counter-clockwise" size={18} />
                {settings.nLevel}
              </>
            }>
            <span className="t-small secondary">N-back level</span>
            <Stepper value={settings.nLevel} min={MIN_N} max={MAX_N} onChange={setNLevel} />
          </HudDropdown>
          {busy ? (
            <Chip>
              Trial {state.trialIndex + 1}/{TRIALS_PER_ROUND}
            </Chip>
          ) : (
            <SpeedChip ms={settings.trialDurationMs} onSelect={setTrialDurationMs} />
          )}
          <span className="hud-chip t-code" title="Streams: tap to turn on or off">
            {STREAM_IDS.map((stream) => {
              const on = settings.activeStreams[stream];
              return (
                <button
                  key={stream}
                  type="button"
                  className={on ? 'hud-toggle on' : 'hud-toggle'}
                  aria-label={STREAM_LABELS[stream]}
                  aria-pressed={on}
                  title={`${STREAM_LABELS[stream]}: ${on ? 'on' : 'off'}`}
                  // Streams can't change mid-round, and at least one has to stay on.
                  disabled={busy || (on && activeStreams.length === 1)}
                  onClick={() => toggleStream(stream, !on)}>
                  <Icon name={STREAM_ICONS[stream]} size={18} />
                </button>
              );
            })}
          </span>
        </div>

        {practiceMode && (
          <div className="history-area">
            {historyItems.length > 0 && (
              <TrialHistory
                trials={historyItems}
                highlightIndex={state.trialIndex - settings.nLevel}
                showPosition={settings.activeStreams.position}
                showColor={settings.activeStreams.color}
                showNumbers={settings.activeStreams.number}
                showLetters={settings.activeStreams.audio}
              />
            )}
          </div>
        )}

        <div className="grid-area">
          <StimulusGrid
            stimulus={state.stimulus}
            visible={state.stimulusVisible}
            varyColor={settings.activeStreams.color}
            showNumbers={settings.activeStreams.number}
            showPosition={settings.activeStreams.position}
          />
          {prefs.showTrialTimer && (
            // Stays in the DOM so the layout doesn't shift, but the empty track is hidden until it counts.
            <div className={`trial-timer${busy && !warmingUp ? '' : ' idle'}`} aria-hidden>
              {busy && !warmingUp && (
                // Starts at the first trial that can be answered; re-keyed per trial so the fill animation
                // restarts, and it pauses with the round.
                <div
                  key={`${roundCount}-${state.trialIndex}`}
                  className="trial-timer-fill"
                  style={{
                    animationDuration: `${settings.trialDurationMs}ms`,
                    animationPlayState: state.paused ? 'paused' : 'running',
                  }}
                />
              )}
            </div>
          )}
          {state.paused && (
            <div className="blur-overlay">
              <span className="t-title">Paused</span>
            </div>
          )}
        </div>

        <ResponseButtons
          streams={activeStreams}
          responded={state.responded}
          disabled={respondDisabled}
          layout={prefs.buttonLayout}
          keys={prefs.keyBindings}
          onPress={respond}
        />

        <div className="main-row">
          <button
            type="button"
            className={practiceMode ? 'control-button practice on' : 'control-button practice'}
            aria-label="Practice mode"
            title="Practice mode (rounds aren't saved)"
            disabled={busy}
            onClick={() => setPracticeMode((v) => !v)}>
            <Icon name={practiceMode ? 'school' : 'school-outline'} size={22} />
          </button>
          <button
            type="button"
            className="control-button start"
            aria-label={busy && !state.paused ? 'Pause' : 'Play'}
            title={busy && !state.paused ? 'Pause (Space)' : 'Play (Space)'}
            onClick={onMain}>
            <Icon name={busy && !state.paused ? 'pause' : 'play'} size={22} />
          </button>
          <button
            type="button"
            className="control-button stop"
            aria-label="Stop"
            title="Stop (Esc)"
            disabled={!busy}
            onClick={stopRound}>
            <Icon name="stop" size={22} />
          </button>
        </div>
        <ButtonRoomFiller layout={prefs.buttonLayout} count={activeStreams.length} />
      </div>

      {showLatest && (
        <section className="section">
          <h2 className="t-heading">Last round</h2>
          <RoundSummaryCard result={sessionRounds[0]} />
          <RoundDetailTable result={sessionRounds[0]} />
        </section>
      )}

      {sessionRounds.length > 0 && (
        <section className="section">
          <h2 className="t-heading">This session</h2>
          <RoundHistoryList
            rounds={busy ? [] : showLatest ? sessionRounds.slice(1) : sessionRounds}
            emptyLabel="Earlier rounds from this session will appear here."
            // The last round's table just above already shows the key.
            legend={!showLatest}
          />
        </section>
      )}
    </div>
  );
}

// The speed chip. With a mouse, each bolt picks its speed. On a touch screen the bolts are too small to aim
// at, so the whole chip is one button: each tap goes one speed faster, and after the fastest it starts over
// from the slowest.
function SpeedChip({ ms, onSelect }: { ms: number; onSelect: (ms: number) => void }) {
  const touch = useMemo(() => window.matchMedia?.('(hover: none)').matches ?? false, []);
  const speed = speedPresetFor(ms);
  const title = `Speed: ${speed.label} (${speed.ms} ms per trial)`;
  if (!touch) {
    return (
      <span className="hud-chip t-code" title={title}>
        <SpeedBolts ms={speed.ms} onSelect={onSelect} />
      </span>
    );
  }
  // Presets run fastest first, so one faster is the one before; before the fastest comes the slowest.
  const index = SPEED_PRESETS.findIndex((p) => p.ms === speed.ms);
  const next = SPEED_PRESETS[index === 0 ? SPEED_PRESETS.length - 1 : index - 1];
  return (
    <button
      type="button"
      className="hud-chip t-code interactive"
      aria-label={`Speed: ${speed.label}. Tap for ${next.label.toLowerCase()}.`}
      title={title}
      onClick={() => onSelect(next.ms)}>
      <SpeedBolts ms={speed.ms} />
    </button>
  );
}

// Five bolts, lit from the left: all five for the fastest preset, one for the slowest. With `onSelect`,
// tapping a bolt sets the speed to that level; without, they only show it.
function SpeedBolts({ ms, onSelect }: { ms: number; onSelect?: (ms: number) => void }) {
  const level = SPEED_PRESETS.length - SPEED_PRESETS.findIndex((p) => p.ms === ms);
  return (
    <span className="speed-bolts">
      {SPEED_PRESETS.map((_, i) => {
        const preset = SPEED_PRESETS[SPEED_PRESETS.length - 1 - i];
        const className = i < level ? 'hud-toggle speed-bolt on' : 'hud-toggle speed-bolt';
        if (!onSelect) {
          return (
            <span key={preset.ms} className={className}>
              <Icon name="flash" size={16} />
            </span>
          );
        }
        return (
          <button
            key={preset.ms}
            type="button"
            className={className}
            aria-label={`Speed: ${preset.label}`}
            aria-pressed={preset.ms === ms}
            title={`${preset.label} (${preset.ms} ms)`}
            onClick={() => onSelect(preset.ms)}>
            <Icon name="flash" size={16} />
          </button>
        );
      })}
    </span>
  );
}

function TargetStat({ label, value, good = false }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="target-stat">
      <span className="t-small secondary">{label}</span>
      <span className={good ? 't-default good' : 't-default'}>{value}</span>
    </div>
  );
}

function Chip({ className, title, children }: { className?: string; title?: string; children: ReactNode }) {
  return (
    <span className={className ? `hud-chip t-code ${className}` : 'hud-chip t-code'} title={title}>
      {children}
    </span>
  );
}
