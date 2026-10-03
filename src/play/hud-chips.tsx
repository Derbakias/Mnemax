import { useMemo, type ReactNode } from 'react';

import { Icon } from '@/components/ui/icon';
import { chipStyles, HudDropdown } from '@/components/ui/hud-dropdown';
import { playCopy } from '@/copy/play';
import { SPEED_PRESETS } from '@/config/game';
import { speedPreset } from '@/game/rules';
import type { SpeedId } from '@/game/types';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import { useSettingsStore } from '@/stores/settings';

/** The Play HUD's row and round buttons, shared by the start screen and the round. */
export const hudStyles = {
  // One line at every width: gaps and icons scale with the window (full size from about 420px wide), so
  // everything fits even on a 320px phone. One height for all (--hud-h, set on the stage), so the chips, the
  // round buttons and the tutorial history line up. relative: the chips' panels open from this row.
  row: [
    'relative flex h-(--hud-h) flex-none flex-nowrap justify-center gap-[clamp(4px,1.4vw,8px)]',
    // As wide as the answer buttons below, the chips sharing the extra room.
    'self-stretch [&_.hud-chip]:grow [&_.hud-chip]:justify-center',
    '[&_.hud-chip]:py-0 [&_.hud-chip]:shadow-(--shadow-chip)',
    // Icons in the chips, the speed bolts a little smaller. `!`: Icon sets its own size, which this replaces.
    '[--hud-icon:clamp(12px,4vw,18px)] [--hud-bolt:clamp(10px,3.4vw,16px)]',
    '[&_.hud-chip_.icon]:size-(--hud-icon)! [&_.hud-chip_.speed-bolts_.icon]:size-(--hud-bolt)!',
  ],
  // Round icon buttons at the end of the HUD: pause and stop in a round, tutorial mode on the start screen.
  // Tinted in their colour: pause blue (an action), stop orange (the round's second colour).
  iconButton: [
    'flex size-(--hud-h) flex-none items-center justify-center rounded-full',
    'bg-accent-soft text-accent shadow-(--shadow-chip)',
    '[transition:transform_0.1s,background-color_0.15s] motion-reduce:transition-none',
    'active:transform-[scale(0.94)] hover:brightness-96',
  ],
  // A chip's number centred on its icon by the digits themselves: the line keeps room below the baseline that
  // digits never use, which left them about 2px above the icon's middle. Trimmed to the height of the capitals
  // where the browser can; elsewhere moved down by that room instead.
  chipText: [
    'relative top-[0.15em]',
    'supports-[text-box:trim-both_cap_alphabetic]:top-0',
    'supports-[text-box:trim-both_cap_alphabetic]:[text-box:trim-both_cap_alphabetic]',
  ],
};

const styles = {
  // Played on the left, Left in the middle, Goal on the right.
  targetStat: [
    'flex flex-col gap-0.5 whitespace-nowrap',
    'nth-2:items-center nth-2:text-center last:items-end last:text-right',
  ],
  // Hovering a bolt previews that speed: it and the bolts before it light gold, the rest go faint, as a click
  // would set them. Only the bolts that are buttons (the start screen's) do this; in a round they just show
  // the speed, which can't change then.
  bolts: [
    'inline-flex gap-0.5',
    '[@media(hover:hover)]:[&:has(>button:hover)>button]:text-inherit',
    '[@media(hover:hover)]:[&:has(>button:hover)>button]:opacity-15',
    '[@media(hover:hover)]:[&:has(>button:hover)>button:is(:hover,:has(~button:hover))]:text-gold',
    '[@media(hover:hover)]:[&:has(>button:hover)>button:is(:hover,:has(~button:hover))]:opacity-100',
  ],
  // Lit bolts are gold; the unlit ones stay faint, so the lit ones read at a glance. The negative margin
  // gives each bolt a bigger area to click without spacing them out.
  bolt: [
    '-mx-0.5 -my-1 inline-flex rounded-[6px] px-0.5 py-1',
    'opacity-15 data-[on=true]:text-gold data-[on=true]:opacity-100',
  ],
};

// The daily target chip, with today's play against the goal (from Settings) in its panel.
export function DailyTargetChip({ loaded, todayMs }: { loaded: boolean; todayMs: number }) {
  const minutes = useSettingsStore((s) => s.prefs.dailyTargetMinutes);
  const targetMs = minutes * 60_000;
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
          <span className="inline-flex text-teal">
            <Icon name="target" size={18} />
          </span>
          <span className={cn(hudStyles.chipText)}>{loaded ? `${percent}%` : '–%'}</span>
        </>
      }
    >
      <div className="flex w-[min(260px,calc(100vw-64px))] flex-col gap-2">
        <div className="row-between">
          <span className="t-small secondary">{playCopy.hud.dailyTarget.title}</span>
          <span className={reached ? 't-small good' : 't-small'}>{percent}%</span>
        </div>
        <div
          className="h-2.5 overflow-hidden rounded-[5px] bg-background-element"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, percent)}
        >
          <div
            className="h-full rounded-[5px] bg-accent data-[reached=true]:bg-success"
            data-reached={reached}
            style={{ width: `${Math.min(100, percent)}%` }}
          />
        </div>
        <div className="mt-0.5 grid grid-cols-[repeat(3,1fr)] gap-2">
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
      <span className={cn('hud-chip', chipStyles.base)} title={title}>
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
      className={cn('hud-chip', chipStyles.base, chipStyles.interactive)}
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
    // `speed-bolts` has no look of its own: it's the name the HUD row sizes the bolts by (hudStyles.row).
    <span className={cn('speed-bolts', styles.bolts)}>
      {SPEED_PRESETS.map((_, i) => {
        const preset = SPEED_PRESETS[SPEED_PRESETS.length - 1 - i];
        const on = i < level;
        if (!onSelect) {
          return (
            <span key={preset.id} className={cn(styles.bolt)} data-on={on}>
              <Icon name="flash" size={16} />
            </span>
          );
        }
        return (
          <button
            key={preset.id}
            type="button"
            className={cn(styles.bolt)}
            data-on={on}
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
    <div className={cn(styles.targetStat)}>
      <span className="t-small secondary">{label}</span>
      <span className={good ? 't-default good' : 't-default'}>{value}</span>
    </div>
  );
}

export function Chip({ className, title, children }: { className?: string; title?: string; children: ReactNode }) {
  return (
    <span className={cn('hud-chip', chipStyles.base, className)} title={title}>
      {children}
    </span>
  );
}
