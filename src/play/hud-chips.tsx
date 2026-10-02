import { useMemo, type ReactNode } from 'react';

import { Icon } from '@/components/ui/icon';
import { HudDropdown } from '@/components/ui/hud-dropdown';
import { playCopy } from '@/copy/play';
import { SPEED_PRESETS } from '@/config/game';
import { speedPreset } from '@/game/rules';
import type { SpeedId } from '@/game/types';
import { formatDuration } from '@/lib/stats';

// The daily target chip, with today's play against the goal in its panel.
export function DailyTargetChip({
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
      title={playCopy.hud.dailyTarget.title}
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
          <span className="t-small secondary">{playCopy.hud.dailyTarget.title}</span>
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
export function SpeedChip({ speed: id, onSelect }: { speed: SpeedId; onSelect: (speed: SpeedId) => void }) {
  const touch = useMemo(() => window.matchMedia?.('(hover: none)').matches ?? false, []);
  const speed = speedPreset(id);
  const title = playCopy.hud.speed.pickerTitle(speed.label, speed.answerMs);
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
export function SpeedBolts({ speed, onSelect }: { speed: SpeedId; onSelect?: (speed: SpeedId) => void }) {
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
            title={playCopy.hud.speed.boltTitle(preset.label, preset.answerMs)}
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

export function Chip({ className, title, children }: { className?: string; title?: string; children: ReactNode }) {
  return (
    <span className={className ? `hud-chip t-code ${className}` : 'hud-chip t-code'} title={title}>
      {children}
    </span>
  );
}
