import type { ReactNode } from 'react';

import { InfoTip } from './info-tip';

/** A screen section: its heading, an optional ⓘ note beside it and an optional action on the right. */
export function Section({
  title,
  info,
  action,
  children,
}: {
  title: string;
  /** What the section is for, behind an ⓘ next to the title. */
  info?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section">
      <div className="section-header">
        <div className="section-heading">
          <h2 className="t-heading section-title">{title}</h2>
          {info && <InfoTip label={title}>{info}</InfoTip>}
        </div>
        {action && <div className="section-action">{action}</div>}
      </div>
      {children}
    </section>
  );
}
