import { Count } from '@/stats/count';
import { Icon } from '@/components/ui/icon';
import { ModeBadge } from '@/stats/mode-badge';
import type { ModeSummary } from '@/stats/levels';
import { accuracyColor, type Theme } from '@/lib/theme';

export function ModesTable({
  modes,
  selectedKey,
  onSelect,
  theme,
}: {
  modes: ModeSummary[];
  selectedKey: string;
  onSelect: (key: string) => void;
  theme: Theme;
}) {
  return (
    <div className="panel mode-table">
      <div className="mode-row header t-code">
        <span>N</span>
        <span>Streams</span>
        <span>Speed</span>
        <span>Rounds</span>
        <span>Recent</span>
        <span />
        <span className="best">Best</span>
      </div>
      {modes.map((m) => (
        <button
          key={m.mode.key}
          type="button"
          className={m.mode.key === selectedKey ? 'mode-row on' : 'mode-row'}
          onClick={() => onSelect(m.mode.key)}
        >
          <ModeBadge mode={m.mode} aligned />
          <Count className="t-code" value={m.rounds.length} label="rounds" />
          <span className="t-code" style={{ color: accuracyColor(m.recentAccuracy, theme) }}>
            {Math.round(m.recentAccuracy)}%
          </span>
          <span className="t-code mastered" title={m.mastered ? 'Mastered' : undefined}>
            {m.mastered && <Icon name="star-tight" />}
          </span>
          <span className="t-code best">{Math.round(m.bestAccuracy)}%</span>
        </button>
      ))}
    </div>
  );
}
