import { useHoverOrTap } from './info-tip';
import { formatCount } from '@/stats';

/**
 * A count kept short for a narrow column (1.2K, 12K…). When shortened, hovering or tapping it shows the
 * exact number, e.g. "1,202 matched".
 */
export function Count({ value, label, className }: { value: number; label: string; className?: string }) {
  const short = formatCount(value);
  const { rootRef, open, toggle, hoverHandlers } = useHoverOrTap<HTMLSpanElement>();
  if (short === String(value)) {
    return <span className={className}>{short}</span>;
  }

  const exact = `${value.toLocaleString()} ${label}`;
  // Not a <button>: in the modes table it sits inside a row that is one. A tap here shouldn't pick the row.
  return (
    <span className="count-tip" ref={rootRef} {...hoverHandlers}>
      <span
        role="button"
        tabIndex={0}
        className={className ? `count-tip-value ${className}` : 'count-tip-value'}
        aria-label={exact}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          toggle();
        }}
      >
        {short}
      </span>
      {open && (
        <span className="count-tip-panel t-small" role="tooltip">
          {exact}
        </span>
      )}
    </span>
  );
}
