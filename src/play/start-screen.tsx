import type { Dispatch, ReactNode, SetStateAction } from 'react';

import { Icon } from '@/components/ui/icon';
import { HudDropdown } from '@/components/ui/hud-dropdown';
import { SpeedChip } from '@/play/hud-chips';
import { STREAM_ICONS } from '@/config/ui';
import { RoundDetailTable } from '@/components/rounds/round-detail-table';
import { RoundHistoryList } from '@/components/rounds/round-history-list';
import { RoundSummaryCard } from '@/components/rounds/round-summary-card';
import { Stepper } from '@/components/ui/stepper';
import { playCopy } from '@/copy/play';
import { MAX_N, MIN_N } from '@/config/game';
import type { GamePhase } from '@/game/engine';
import type { GameSettings, RoundResult, StreamId } from '@/game/types';
import { STREAM_IDS, STREAM_LABELS } from '@/game/types';
import { useSettings } from '@/stores/settings-context';

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
  targetChip,
  onMain,
}: {
  settings: GameSettings;
  activeStreams: StreamId[];
  phase: GamePhase;
  sessionRounds: RoundResult[];
  tutorial: boolean;
  setTutorial: Dispatch<SetStateAction<boolean>>;
  targetChip: ReactNode;
  onMain: () => void;
}) {
  const { setNLevel, setSpeed, toggleStream } = useSettings();
  const showLatest = phase === 'finished' && sessionRounds.length > 0;

  return (
    <div className="content play">
      <div className="start-stage">
        <div className="hud-row">
          {targetChip}
          <HudDropdown
            underChip
            label={`N-back level: ${settings.nLevel}`}
            title={playCopy.hud.nLevel.chipTitle(settings.nLevel)}
            chip={
              <>
                <span className="chip-icon-blue">
                  <Icon name="counter-clockwise" size={18} />
                </span>
                <span className="chip-text">{settings.nLevel}</span>
              </>
            }
          >
            <span className="t-small secondary">{playCopy.hud.nLevel.title}</span>
            <Stepper value={settings.nLevel} min={MIN_N} max={MAX_N} onChange={setNLevel} />
          </HudDropdown>
          <SpeedChip speed={settings.speed} onSelect={setSpeed} />
          <button
            type="button"
            className={tutorial ? 'hud-icon-button tutorial on' : 'hud-icon-button tutorial'}
            aria-label="Tutorial mode"
            aria-pressed={tutorial}
            title={playCopy.hud.tutorialTitle}
            onClick={() => setTutorial((v) => !v)}
          >
            <Icon name={tutorial ? 'school' : 'school-outline'} size={22} />
          </button>
        </div>

        <p className="t-small start-label">{playCopy.start.streamsLabel}</p>
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
                title={on && activeStreams.length === 1 ? playCopy.start.lastStreamTitle : undefined}
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
