// TODO: !IMPORTANT! This one also needs to be broken down (the round view and the start screen)
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { Icon } from '@/components/ui/icon';
import { HudDropdown } from '@/components/ui/hud-dropdown';
import { ResponseButtons, STREAM_ICONS } from '@/play/response-buttons';
import { RoundDetailTable } from '@/components/rounds/round-detail-table';
import { RoundHistoryList } from '@/components/rounds/round-history-list';
import { RoundSummaryCard } from '@/components/rounds/round-summary-card';
import { Stepper } from '@/components/ui/stepper';
import { BoxGrid } from '@/play/box-grid';
import { TrialHistory } from '@/play/trial-history';
import { MAX_N, MIN_N, SPEED_PRESETS, TRIALS_PER_ROUND, speedOf, speedPreset, stimulusVisibleMs } from '@/game/config';
import { useGameEngine } from '@/game/engine';
import type { GameSettings, RoundResult, SpeedId } from '@/game/types';
import { STREAM_IDS, STREAM_LABELS } from '@/game/types';
import { normalizeKey } from '@/lib/prefs';
import { useSettings } from '@/stores/settings-context';
import { primeSpeech } from '@/lib/speech';
import { formatDuration, playedOnDayMs, roundDurationMs } from '@/lib/stats';
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
  const { settings, prefs, setNLevel, setSpeed, toggleStream } = useSettings();
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
  const showLatest = state.phase === 'finished' && sessionRounds.length > 0;

  // During a round everything follows the settings it started with.
  const shown = busy ? roundSettings : settings;
  const activeStreams = STREAM_IDS.filter((s) => shown.activeStreams[s]);
  const n = shown.nLevel;
  // The first N trials have nothing N back to compare with, so they can't be answered.
  const warmingUp = state.trialIndex < n;
  const respondDisabled = !busy || state.paused || warmingUp;
  const showHistory = tutorial && prefs.tutorialHistory;
  const showSolution = tutorial && prefs.tutorialSolution;
  // Tutorial history: every trial from the one N back (the one to compare with) to the current one.
  const historyItems = (
    state.trialIndex >= state.history.length && state.stimulus
      ? [...state.history, { index: state.trialIndex, stimulus: state.stimulus }]
      : state.history
  ).filter((t) => t.index >= state.trialIndex - n && t.index <= state.trialIndex);
  // Outlined only when it's a match with the current trial, on any stream in play.
  const historyHighlight = STREAM_IDS.some((s) => state.match[s]) ? state.trialIndex - n : undefined;

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
    const trial = Math.max(0, state.trialIndex) + 1;
    return (
      <div className="content play in-round">
        {/* The round fills the screen: the HUD and round progress at the top, the grid, and the answer
            buttons sharing whatever height is left, in thumb reach. */}
        <div className={`play-stage ${prefs.buttonLayout}${showHistory ? ' with-history' : ''}`}>
          <div className="hud-row">
            {/* Tutorial rounds don't count towards it. */}
            {!tutorial && targetChip}
            <Chip title={`N-back level: ${n}`}>
              <span className="chip-icon-blue">
                <Icon name="counter-clockwise" size={18} />
              </span>
              <span className="chip-text">{n}</span>
            </Chip>
            <Chip title={`Speed: ${speedOf(shown).label}`}>
              <SpeedBolts speed={speedOf(shown).id} />
            </Chip>
            <button
              type="button"
              className="hud-icon-button"
              aria-label={state.paused ? 'Resume' : 'Pause'}
              title={state.paused ? 'Resume (Space)' : 'Pause (Space)'}
              onClick={onMain}
            >
              <Icon name={state.paused ? 'play' : 'pause'} size={22} />
            </button>
            <button
              type="button"
              className="hud-icon-button stop"
              aria-label="Stop"
              title="Stop (Esc)"
              onClick={stopRound}
            >
              <Icon name="stop" size={20} />
            </button>
          </div>

          {/* Under the HUD: the trial count, the round's progress and, under it, the trial timer. */}
          <div className="round-status">
            <span className="t-code round-count" aria-hidden>
              <span className="current">{trial}</span>/{TRIALS_PER_ROUND}
            </span>
            <div className="round-bars">
              <div
                className="round-progress"
                role="progressbar"
                aria-label="Round progress"
                aria-valuemin={0}
                aria-valuemax={TRIALS_PER_ROUND}
                aria-valuenow={trial}
                aria-valuetext={`Trial ${trial} of ${TRIALS_PER_ROUND}`}
              >
                <div className="round-progress-fill" style={{ width: `${(trial / TRIALS_PER_ROUND) * 100}%` }} />
              </div>
              {prefs.showTrialTimer && (
                // Stays in the DOM so the layout doesn't shift, but the empty track is hidden until it counts.
                <div className={`trial-timer${warmingUp ? ' idle' : ''}`} aria-hidden>
                  {!warmingUp && (
                    // Starts at the first trial that can be answered; re-keyed per trial so the fill animation
                    // restarts, and it pauses with the round. Fills while answers are open (the box is lit) and
                    // stays full through the blank.
                    <div
                      key={`${roundCount}-${state.trialIndex}`}
                      className="trial-timer-fill"
                      style={{
                        animationDuration: `${stimulusVisibleMs(shown.trialDurationMs)}ms`,
                        animationPlayState: state.paused ? 'paused' : 'running',
                      }}
                    />
                  )}
                </div>
              )}
            </div>
          </div>

          {showHistory && (
            // A slot per trial from N back to the current one, so the chips keep their place as they fill in.
            <div
              className="tutorial-history"
              aria-label="Last trials"
              style={{ '--history-slots': n + 1 } as CSSProperties}
            >
              <TrialHistory
                trials={historyItems}
                highlightIndex={historyHighlight}
                showPosition={shown.activeStreams.position}
                showColor={shown.activeStreams.color}
                showNumbers={shown.activeStreams.number}
                showLetters={shown.activeStreams.audio}
              />
            </div>
          )}

          <div className="grid-area">
            <BoxGrid
              stimulus={state.stimulus}
              visible={state.stimulusVisible}
              varyColor={shown.activeStreams.color}
              showNumbers={shown.activeStreams.number}
              showPosition={shown.activeStreams.position}
            />
            {state.paused && (
              <div className="blur-overlay">
                <span className="t-title">Paused</span>
              </div>
            )}
          </div>

          <ResponseButtons
            streams={activeStreams}
            responded={state.responded}
            match={state.match}
            // Only while the box is lit, like the answer colours: the outline belongs to this box, not the blank.
            showSolution={showSolution && state.stimulusVisible}
            disabled={respondDisabled}
            layout={prefs.buttonLayout}
            swipe={prefs.buttonLayout === 'grid' && prefs.swipeAnswers}
            trial={state.trialIndex}
            keys={prefs.keyBindings}
            onPress={respond}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="content play">
      <div className="start-stage">
        <div className="hud-row">
          {targetChip}
          <HudDropdown
            underChip
            label={`N-back level: ${settings.nLevel}`}
            title={`N-back level: ${settings.nLevel}`}
            chip={
              <>
                <span className="chip-icon-blue">
                  <Icon name="counter-clockwise" size={18} />
                </span>
                <span className="chip-text">{settings.nLevel}</span>
              </>
            }
          >
            <span className="t-small secondary">N-back level</span>
            <Stepper value={settings.nLevel} min={MIN_N} max={MAX_N} onChange={setNLevel} />
          </HudDropdown>
          <SpeedChip speed={settings.speed} onSelect={setSpeed} />
          <button
            type="button"
            className={tutorial ? 'hud-icon-button tutorial on' : 'hud-icon-button tutorial'}
            aria-label="Tutorial mode"
            aria-pressed={tutorial}
            title="Tutorial mode (rounds aren't saved)"
            onClick={() => setTutorial((v) => !v)}
          >
            <Icon name={tutorial ? 'school' : 'school-outline'} size={22} />
          </button>
        </div>

        <p className="t-small start-label">Select active streams</p>
        <div className="stream-picker">
          {STREAM_IDS.map((stream) => {
            const on = settings.activeStreams[stream];
            return (
              <button
                key={stream}
                type="button"
                className={on ? 'stream-card on' : 'stream-card'}
                aria-pressed={on}
                // At least one stays on: turning off the last one does nothing (see toggleStream).
                title={on && activeStreams.length === 1 ? 'At least one stream stays on' : undefined}
                onClick={() => toggleStream(stream, !on)}
              >
                {on && (
                  <span className="stream-check">
                    <Icon name="checkmark-circle" size={20} />
                  </span>
                )}
                <span className="stream-icon">
                  <Icon name={STREAM_ICONS[stream]} size={28} />
                </span>
                <span className="t-small">{STREAM_LABELS[stream]}</span>
              </button>
            );
          })}
        </div>

        <button type="button" className="start-button" aria-label="Play" title="Play (Space)" onClick={onMain}>
          <Icon name="play" size={26} />
        </button>
        {/* One block, so the two lines sit together rather than getting the start screen's gap between them.
            Always there, only invisible outside tutorial mode, so turning it on doesn't push the results down. */}
        <div
          className={tutorial ? 't-small secondary start-note' : 't-small secondary start-note off'}
          aria-hidden={!tutorial}
        >
          <p>Just for practice.</p>
          <p>This round won&apos;t count in the stats.</p>
        </div>
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
            rounds={showLatest ? sessionRounds.slice(1) : sessionRounds}
            emptyLabel="Earlier rounds from this session will appear here."
            // The last round's table just above already shows the key.
            legend={!showLatest}
          />
        </section>
      )}
    </div>
  );
}

// The daily target chip, with today's play against the goal in its panel.
function DailyTargetChip({
  loaded,
  todayMs,
  targetMs,
  minutes,
}: {
  loaded: boolean;
  todayMs: number;
  targetMs: number;
  minutes: number;
}) {
  const percent = Math.floor((todayMs / targetMs) * 100);
  const reached = todayMs >= targetMs;
  return (
    <HudDropdown
      underChip
      label="Daily target"
      title="Daily target"
      chipClassName={reached ? 'good' : undefined}
      chip={
        <>
          <span className="chip-icon-teal">
            <Icon name="target" size={18} />
          </span>
          <span className="chip-text">{loaded ? `${percent}%` : '–%'}</span>
        </>
      }
    >
      <div className="target-panel">
        <div className="row-between">
          <span className="t-small secondary">Daily target</span>
          <span className={reached ? 't-small good' : 't-small'}>{percent}%</span>
        </div>
        <div
          className="target-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, percent)}
        >
          <div
            className={reached ? 'target-fill reached' : 'target-fill'}
            style={{ width: `${Math.min(100, percent)}%` }}
          />
        </div>
        <div className="target-stats">
          <TargetStat label="Played" value={formatDuration(todayMs)} />
          <TargetStat label="Left" value={reached ? 'Done' : formatDuration(targetMs - todayMs)} good={reached} />
          <TargetStat label="Goal" value={`${minutes}m`} />
        </div>
      </div>
    </HudDropdown>
  );
}

// The speed chip. With a mouse, each bolt picks its speed. On a touch screen the bolts are too small to aim
// at, so the whole chip is one button: each tap goes one speed faster, and after the fastest it starts over
// from the slowest.
function SpeedChip({ speed: id, onSelect }: { speed: SpeedId; onSelect: (speed: SpeedId) => void }) {
  const touch = useMemo(() => window.matchMedia?.('(hover: none)').matches ?? false, []);
  const speed = speedPreset(id);
  const title = `Speed: ${speed.label} (${speed.answerMs} ms to answer)`;
  if (!touch) {
    return (
      <span className="hud-chip t-code" title={title}>
        <SpeedBolts speed={speed.id} onSelect={onSelect} />
      </span>
    );
  }
  // Presets run fastest first, so one faster is the one before; before the fastest comes the slowest.
  const index = SPEED_PRESETS.findIndex((p) => p.id === speed.id);
  const next = SPEED_PRESETS[index === 0 ? SPEED_PRESETS.length - 1 : index - 1];
  return (
    <button
      type="button"
      className="hud-chip t-code interactive"
      aria-label={`Speed: ${speed.label}. Tap for ${next.label.toLowerCase()}.`}
      title={title}
      onClick={() => onSelect(next.id)}
    >
      <SpeedBolts speed={speed.id} />
    </button>
  );
}

// Five bolts, lit from the left: all five for the fastest preset, one for the slowest. With `onSelect`,
// tapping a bolt sets the speed to that level; without, they only show it.
function SpeedBolts({ speed, onSelect }: { speed: SpeedId; onSelect?: (speed: SpeedId) => void }) {
  const level = SPEED_PRESETS.length - SPEED_PRESETS.findIndex((p) => p.id === speed);
  return (
    <span className="speed-bolts">
      {SPEED_PRESETS.map((_, i) => {
        const preset = SPEED_PRESETS[SPEED_PRESETS.length - 1 - i];
        const className = i < level ? 'hud-toggle speed-bolt on' : 'hud-toggle speed-bolt';
        if (!onSelect) {
          return (
            <span key={preset.id} className={className}>
              <Icon name="flash" size={16} />
            </span>
          );
        }
        return (
          <button
            key={preset.id}
            type="button"
            className={className}
            aria-label={`Speed: ${preset.label}`}
            aria-pressed={preset.id === speed}
            title={`${preset.label} (${preset.answerMs} ms to answer)`}
            onClick={() => onSelect(preset.id)}
          >
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
