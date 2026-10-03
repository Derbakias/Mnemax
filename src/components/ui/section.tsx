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
    // `section` is still styled in index.css: the Play screen's sections share that rule, and the Play and Stats
    // screens' CSS points at the name.
    <section className="section">
      {/* The title with its ⓘ note, and an optional action on the right. When they don't all fit (a long title
          with a chart's crosshair switch and Reset zoom), the action moves under them, starting at the left
          (space-between puts a line's only item at the start), rather than the title or the buttons breaking.
          relative: the ⓘ note opens under this whole header (not the icon), so it always fits the content width.
          data-section-header: InfoTip lines its icon up with the heading when it's in here. */}
      <div className="relative flex flex-wrap items-center justify-between gap-1" data-section-header>
        <div className="flex items-center gap-1">
          <h2 className="t-heading">{title}</h2>
          {info && <InfoTip label={title}>{info}</InfoTip>}
        </div>
        {action && <div className="flex items-center gap-1.5 whitespace-nowrap">{action}</div>}
      </div>
      {children}
    </section>
  );
}
