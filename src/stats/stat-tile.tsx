import type { ReactNode } from 'react';

import { Icon, type IconName } from '@/components/ui/icon';

/** A headline number, with an icon beside its label. */
export function StatTile({
  icon,
  label,
  value,
  sub,
}: {
  icon: IconName;
  label: string;
  value: string;
  sub?: ReactNode;
}) {
  return (
    <div className="panel stat-tile">
      <div className="stat-tile-head">
        <span className="stat-tile-icon">
          <Icon name={icon} size={18} />
        </span>
        <span className="t-small secondary stat-tile-label">{label}</span>
      </div>
      <span className="stat-tile-value">{value}</span>
      <span className="t-small secondary stat-tile-sub">{sub}</span>
    </div>
  );
}
