import type { Dispatch, SetStateAction } from 'react';

import { Icon } from '@/components/ui/icon';
import { HudDropdown } from '@/components/ui/hud-dropdown';
import { DailyTargetChip, hudStyles, SpeedChip } from '@/play/hud-chips';
import { STREAM_ICONS } from '@/config/ui';
import { RoundDetailTable } from '@/components/rounds/round-detail-table';
import { RoundHistoryList } from '@/components/rounds/round-history-list';
import { RoundSummaryCard } from '@/components/rounds/round-summary-card';
import { Stepper } from '@/components/ui/stepper';
import { playCopy } from '@/copy/play';
import { MAX_N, MIN_N } from '@/config/game';
import type { GamePhase } from '@/stores/round';
import type { GameSettings, RoundResult, StreamId } from '@/game/types';
import { STREAM_IDS, STREAM_LABELS } from '@/game/types';
import { cn } from '@/lib/cn';
import { useSettingsStore } from '@/stores/settings';

const styles = {
  // The HUD's height (--hud-h) is set here, for the HUD row.
  stage: ['flex w-full max-w-[480px] flex-col gap-3 self-center', '[--hud-h:clamp(36px,calc(100cqw*0.1),46px)]'],
  // Tutorial mode is grey when off, and blue when on like the picked streams, with white on it.
  tutorial: [
    'bg-background-element text-text-secondary',
    'aria-pressed:[background:linear-gradient(135deg,var(--color-accent-fill),var(--color-accent-strong))]',
    'aria-pressed:text-on-accent aria-pressed:shadow-[0_6px_14px_-6px_var(--color-accent-fill)]',
  ],
  card: [
    'group relative flex aspect-[1.1] flex-col items-center justify-center gap-2.5',
    'rounded-[20px] border border-background-selected text-text-secondary',
    // Frosted glass: see-through over the screen's colour wash, with a soft sheen from the top left. Nothing
    // colourful sits behind the cards, so every picked card gets the same blue.
    '[background:linear-gradient(160deg,var(--color-glass-sheen),transparent_55%),var(--color-glass-bg)]',
    'backdrop-blur-[16px] backdrop-saturate-[140%] shadow-[0_6px_18px_-12px_var(--color-glass-shadow)]',
    '[transition:background-color_0.15s,border-color_0.15s,box-shadow_0.15s,color_0.15s,transform_0.1s]',
    'motion-reduce:transition-none active:transform-[scale(0.98)]',
    // Picked: the same glass tinted light blue, with a faint blue edge. The tint is a layer of its own (only
    // the last background layer can be a plain colour).
    'aria-pressed:[background:linear-gradient(160deg,var(--color-glass-sheen),transparent_55%),linear-gradient(var(--color-accent-soft),var(--color-accent-soft)),var(--color-glass-bg)]',
    'aria-pressed:border-accent-fill/18 aria-pressed:text-text aria-pressed:shadow-accent-fill/45',
    // A bluer edge under the mouse, picked or not.
    'hover:border-accent-fill/25 aria-pressed:hover:border-accent-fill/25',
  ],
  // The screen's one main action: a blue button with a soft glow of its colour. A press shrinks it a little
  // and tightens the glow; under the mouse the glow grows, and stays grown while the mouse presses it.
  play: [
    'mt-2 flex h-16 items-center justify-center rounded-2xl',
    'bg-accent-fill text-on-accent shadow-[0_10px_24px_-10px_var(--color-accent-fill)]',
    '[transition:transform_0.1s,box-shadow_0.15s] motion-reduce:transition-none',
    'active:transform-[scale(0.98)] active:shadow-[0_4px_12px_-6px_var(--color-accent)]',
    'hover:shadow-[0_14px_28px_-10px_var(--color-accent)]',
    'hover:active:shadow-[0_14px_28px_-10px_var(--color-accent)]',
  ],
};

/**
 * The screen between rounds: the HUD (daily target, N level, speed, tutorial mode), the streams to play,
 * the play button and, once rounds have been played, the last round and this session's rounds.
 */
export function StartScreen({
  settings,
  activeStreams,
  phase,
  sessionRounds,
  tutorial,
  setTutorial,
  todayMs,
  loaded,
  onMain,
}: {
  settings: GameSettings;
  activeStreams: StreamId[];
  phase: GamePhase;
  sessionRounds: RoundResult[];
  tutorial: boolean;
  setTutorial: Dispatch<SetStateAction<boolean>>;
  todayMs: number;
  loaded: boolean;
  onMain: () => void;
}) {
  const setNLevel = useSettingsStore((s) => s.setNLevel);
  const setSpeed = useSettingsStore((s) => s.setSpeed);
  const toggleStream = useSettingsStore((s) => s.toggleStream);
  const showLatest = phase === 'finished' && sessionRounds.length > 0;

  return (
    <div className="content play">
      <div className={cn(styles.stage)}>
        <div className={cn(hudStyles.row)}>
          <DailyTargetChip loaded={loaded} todayMs={todayMs} />
          <HudDropdown
            underChip
            label={`N-back level: ${settings.nLevel}`}
            title={playCopy.hud.nLevel.chipTitle(settings.nLevel)}
            chip={
              <>
                <span className="inline-flex text-accent">
                  <Icon name="counter-clockwise" size={18} />
                </span>
                <span className={cn(hudStyles.chipText)}>{settings.nLevel}</span>
              </>
            }
          >
            <span className="t-small secondary">{playCopy.hud.nLevel.title}</span>
            <Stepper value={settings.nLevel} min={MIN_N} max={MAX_N} onChange={setNLevel} />
          </HudDropdown>
          <SpeedChip speed={settings.speed} onSelect={setSpeed} />
          <button
            type="button"
            className={cn(hudStyles.iconButton, styles.tutorial)}
            aria-label="Tutorial mode"
            aria-pressed={tutorial}
            title={playCopy.hud.tutorialTitle}
            onClick={() => setTutorial((v) => !v)}
          >
            <Icon name={tutorial ? 'school' : 'school-outline'} size={22} />
          </button>
        </div>

        {/* t-small's size, but bolder: t-small's own weight would win over font-semibold, so its size is written
            out here instead. */}
        <p className="mt-1 text-center text-[14px]/5 font-semibold tracking-[0.02em] text-accent">
          {playCopy.start.streamsLabel}
        </p>
        <div className="grid grid-cols-[1fr_1fr] gap-3">
          {STREAM_IDS.map((stream) => {
            const on = settings.activeStreams[stream];
            return (
              <button
                key={stream}
                type="button"
                className={cn(styles.card)}
                aria-pressed={on}
                // At least one stays on: turning off the last one does nothing (see toggleStream).
                title={on && activeStreams.length === 1 ? playCopy.start.lastStreamTitle : undefined}
                onClick={() => toggleStream(stream, !on)}
              >
                {/* A tick on the ones picked, so it isn't told by colour alone. */}
                {on && (
                  <span className="absolute top-2.5 right-2.5 flex text-accent">
                    <Icon name="checkmark-circle" size={20} />
                  </span>
                )}
                {/* The stream's icon: grey when off, blue when picked. */}
                <span className="flex text-text-secondary [transition:color_0.15s] motion-reduce:transition-none group-aria-pressed:text-accent">
                  <Icon name={STREAM_ICONS[stream]} size={28} />
                </span>
                <span className="t-small">{STREAM_LABELS[stream]}</span>
              </button>
            );
          })}
        </div>

        <button type="button" className={cn(styles.play)} aria-label="Play" title="Play (Space)" onClick={onMain}>
          <Icon name="play" size={26} />
        </button>
        {/* One block, so the two lines sit together rather than getting the start screen's gap between them.
            Always there, only invisible outside tutorial mode, so turning it on doesn't push the results down. */}
        <div className="t-small secondary text-center aria-hidden:invisible" aria-hidden={!tutorial}>
          {playCopy.start.tutorialNote}
        </div>
      </div>

      {showLatest && (
        <section className="section">
          <h2 className="t-heading">{playCopy.results.lastRound}</h2>
          <RoundSummaryCard result={sessionRounds[0]} />
          <RoundDetailTable result={sessionRounds[0]} />
        </section>
      )}

      {sessionRounds.length > 0 && (
        <section className="section">
          <h2 className="t-heading">{playCopy.results.thisSession}</h2>
          <RoundHistoryList
            rounds={showLatest ? sessionRounds.slice(1) : sessionRounds}
            emptyLabel={playCopy.results.sessionEmpty}
            // The last round's table just above already shows the key.
            legend={!showLatest}
          />
        </section>
      )}
    </div>
  );
}
