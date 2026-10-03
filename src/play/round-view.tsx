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

// Lined up with the grid's edges (the full width on phones). The answer buttons do the same (ResponseButtons).
const alignedToGrid = 'w-(--stage-grid) self-center max-[600px]:w-full';

const styles = {
  stage: [
    'flex min-h-0 flex-1 flex-col items-center gap-3 self-stretch',
    // The HUD's height, shared by the HUD row and the tutorial history.
    '[--hud-h:clamp(36px,calc(100cqw*0.1),46px)]',
    // The grid's size (--stage-grid): the content width, or the height left after everything else, whichever is
    // smaller. The height counted (--stage-taken) is the page's top and bottom padding (32px), the HUD, the
    // tutorial history when it shows, the round status (16px), the three 12px gaps, and the least room the answer
    // buttons need with all four streams (two rows of two, or four rows), so the grid keeps its size as streams
    // are turned on and off; with fewer streams the buttons get taller instead. The grid is never under 130px.
    '[--buttons-min:150px] data-[layout=rows]:[--buttons-min:222px]',
    // The tutorial history: a row of chips as tall as the HUD, and the gap after it.
    '[--history-room:0px] data-[history=true]:[--history-room:calc(var(--hud-h)_+_12px)]',
    '[--stage-taken:calc(32px_+_var(--hud-h)_+_var(--history-room)_+_16px_+_3_*_12px_+_var(--buttons-min))]',
    '[--stage-fit:calc(100cqh_-_var(--stage-taken))] [--stage-grid:min(608px,calc(100cqw_-_32px),max(130px,var(--stage-fit)))]',
    // Where the browser can, rounded down so each of the three boxes (after the two 8px gaps) is a whole number
    // of pixels, and all come out the same size.
    'supports-[width:round(down,10px,3px)]:[--stage-grid:calc(round(down,min(608px,calc(100cqw_-_32px),max(130px,var(--stage-fit)))_-_16px,3px)_+_16px)]',
  ],
  // Over the grid, and 8px past its edges, so it also covers the lit tile, which stands up and out of the grid
  // (see TrialGrid), and its shadow. Its corners are the tiles' (14px), grown by those 8px.
  overlay: [
    'absolute -top-2 -left-2 size-[calc(var(--stage-grid)_+_16px)] rounded-[22px]',
    'pointer-events-none flex items-center justify-center',
    'bg-pause-veil text-light backdrop-blur-[14px]',
  ],
};

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
      <div className={cn(styles.stage)} data-layout={prefs.buttonLayout} data-history={showHistory}>
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

        {/* Under the HUD: the trial count, the round's progress and, under it, the trial timer (the pair centred
            on the count when the timer is off). A fixed height, counted in --stage-taken. */}
        <div className={cn('flex h-4 flex-none items-center gap-2', alignedToGrid)}>
          {/* Room for "20/20", so the bars don't move as the count grows. */}
          <span className="t-code min-w-[5ch] flex-none leading-4 text-text-secondary tabular-nums" aria-hidden>
            <span className="font-bold text-accent">{trial}</span>/{TRIALS_PER_ROUND}
          </span>
          {/* The progress and the trial timer touch, so they read as one bar in two colours: only the pair's
              outer corners are rounded. The progress is alone, all corners rounded, while the timer is off or
              still hidden. */}
          <div className="flex flex-1 flex-col">
            <div
              className="h-2 overflow-hidden rounded-t-[4px] bg-background-element data-[alone=true]:rounded-[4px]"
              data-alone={!prefs.showTrialTimer || warmingUp}
              role="progressbar"
              aria-label="Round progress"
              aria-valuemin={0}
              aria-valuemax={TRIALS_PER_ROUND}
              aria-valuenow={trial}
              aria-valuetext={`Trial ${trial} of ${TRIALS_PER_ROUND}`}
            >
              <div
                className="h-full bg-[linear-gradient(90deg,var(--color-progress),var(--color-accent))] [transition:width_0.2s]"
                style={{ width: `${(trial / TRIALS_PER_ROUND) * 100}%` }}
              />
            </div>
            {prefs.showTrialTimer && (
              // Stays in the DOM so the layout doesn't shift, but the empty track is hidden until it counts.
              <div
                className="h-1.5 overflow-hidden rounded-b-[4px] bg-background-element data-[idle=true]:invisible"
                data-idle={warmingUp}
                aria-hidden
              >
                {!warmingUp && (
                  // Starts at the first trial that can be answered; re-keyed per trial so the fill animation
                  // restarts, and it pauses with the round. Fills while answers are open (the box is lit) and
                  // stays full through the blank. Its colour fade is laid out over the whole track and uncovered
                  // from the left, so each part keeps its colour: light at the start of the answer time, dark at
                  // its end.
                  <div
                    key={`${roundCount}-${state.trialIndex}`}
                    className="size-full animate-trial-timer bg-[linear-gradient(90deg,var(--color-timer-start),var(--color-timer-end))]"
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
            className={cn('h-(--hud-h) flex-none', alignedToGrid)}
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

        <div className="relative flex-none self-center">
          <TrialGrid
            stimulus={state.stimulus}
            visible={state.stimulusVisible}
            varyColor={shown.activeStreams.color}
            showNumbers={shown.activeStreams.number}
            showPosition={shown.activeStreams.position}
          />
          {state.paused && (
            <div className={cn(styles.overlay)}>
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
