import { Icon } from '../components/ui/icon';
import { STREAM_ICONS } from '../play/response-buttons';
import { SPEED_PRESETS, speedPreset } from '@/game/config';
import { STREAM_IDS, STREAM_LABELS } from '@/game/types';
import type { Mode } from '@/stats/levels';

/**
 * A mode in the same symbols as the Play screen chips: ↺N, the active stream icons, the speed bolts.
 * `aligned` (for lists) gives every stream a fixed slot, left empty when it's off, so rows line up.
 */
export function ModeBadge({ mode, aligned = false }: { mode: Mode; aligned?: boolean }) {
  const level = SPEED_PRESETS.length - SPEED_PRESETS.findIndex((p) => p.id === mode.speed);
  return (
    <span className={aligned ? 'mode-badge t-code aligned' : 'mode-badge t-code'} title={modeLabel(mode)}>
      <span className="mode-badge-part n">
        <Icon name="counter-clockwise" size={14} />
        {mode.nLevel}
      </span>
      <span className="mode-badge-part">
        {/* Aligned: a slot per stream, with a dash for the ones this mode doesn't use. */}
        {(aligned ? STREAM_IDS : mode.streams).map((s) =>
          mode.streams.includes(s) ? (
            <span key={s} className="stream-slot">
              <Icon name={STREAM_ICONS[s]} size={14} />
            </span>
          ) : (
            <span key={s} className="stream-slot off" aria-hidden>
              –
            </span>
          ),
        )}
      </span>
      <span className="mode-badge-part bolts">
        {SPEED_PRESETS.map((p, i) => (
          <span key={p.ms} className={i < level ? 'on' : undefined}>
            <Icon name="flash" size={11} />
          </span>
        ))}
      </span>
    </span>
  );
}

/** The same mode in words, for tooltips and chart legends. */
export function modeLabel(mode: Mode): string {
  const streams = mode.streams.map((s) => STREAM_LABELS[s]).join(' + ');
  return `N=${mode.nLevel} · ${streams} · ${speedPreset(mode.speed).label}`;
}
