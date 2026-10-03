import type { CSSProperties } from 'react';

import { Icon } from '@/components/ui/icon';
import { Chip, DailyTargetChip, hudStyles, SpeedBolts } from '@/play/hud-chips';
import { ResponseButtons } from '@/play/response-buttons/buttons';
import { playCopy } from '@/copy/play';
import { TrialGrid } from '@/play/trial-grid';
import { TrialHistory } from '@/play/trial-history';
import { TRIALS_PER_ROUND } from '@/config/game';
import { speedOf, stimulusVisibleMs } from '@/game/rules';
import type { GameEngineState } from '@/stores/round';
import type { GameSettings, StreamId } from '@/game/types';
import { STREAM_IDS } from '@/game/types';
import { cn } from '@/lib/cn';
import type { AppPrefs } from '@/lib/prefs';

/**
 * The screen during a round (running or paused): the HUD, the round's progress, the grid and the answer
 * buttons. `shown` is the settings the round started with. The Play screen works out `n`, `warmingUp` and
 * `respondDisabled` (its answer keys need them too) and hands them over.
 */
export function RoundView({
  state,
  shown,
  n,
  activeStreams,
  warmingUp,
  respondDisabled,
  tutorial,
  prefs,
  roundCount,
  todayMs,
  loaded,
  onMain,
  stopRound,
  respond,
}: {
  state: GameEngineState;
  shown: GameSettings;
  n: number;
  activeStreams: StreamId[];
  warmingUp: boolean;
  respondDisabled: boolean;
  tutorial: boolean;
  prefs: AppPrefs;
  roundCount: number;
  todayMs: number;
  loaded: boolean;
  onMain: () => void;
  stopRound: () => void;
  respond: (stream: StreamId) => void;
}) {
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
  const trial = Math.max(0, state.trialIndex) + 1;
  return (
    <div className="content play in-round">
      {/* The round fills the screen: the HUD and round progress at the top, the grid, and the answer
          buttons sharing whatever height is left, in thumb reach. */}
      <div className={`play-stage ${prefs.buttonLayout}${showHistory ? ' with-history' : ''}`}>
        {/* Lined up with the grid's edges (the full width on phones), but never narrower than it needs to stay
            on one line. */}
        <div className={cn(hudStyles.row, 'w-(--stage-grid) min-w-max self-center max-[600px]:w-full')}>
          {/* Tutorial rounds don't count towards it. */}
          {!tutorial && <DailyTargetChip loaded={loaded} todayMs={todayMs} />}
          <Chip title={playCopy.hud.nLevel.chipTitle(n)}>
            <span className="inline-flex text-accent">
              <Icon name="counter-clockwise" size={18} />
            </span>
            <span className={cn(hudStyles.chipText)}>{n}</span>
          </Chip>
          <Chip title={playCopy.hud.speed.chipTitle(speedOf(shown).label)}>
            <SpeedBolts speed={speedOf(shown).id} />
          </Chip>
          <button
            type="button"
            className={cn(hudStyles.iconButton)}
            aria-label={state.paused ? 'Resume' : 'Pause'}
            title={state.paused ? 'Resume (Space)' : 'Pause (Space)'}
            onClick={onMain}
          >
            <Icon name={state.paused ? 'play' : 'pause'} size={22} />
          </button>
          <button
            type="button"
            className={cn(hudStyles.iconButton, 'bg-orange-soft text-orange-ink')}
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
          <TrialGrid
            stimulus={state.stimulus}
            visible={state.stimulusVisible}
            varyColor={shown.activeStreams.color}
            showNumbers={shown.activeStreams.number}
            showPosition={shown.activeStreams.position}
          />
          {state.paused && (
            <div className="blur-overlay">
              <span className="t-title">{playCopy.paused}</span>
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
