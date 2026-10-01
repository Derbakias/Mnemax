export interface LegendItem {
  label: string;
  color: string;
  mark: 'dot' | 'bar' | 'line' | 'dashed' | 'dotted';
  /** Toggleable items show or hide their series. */
  shown?: boolean;
  onToggle?: () => void;
}

/** A compact, centred key under a chart; toggleable items are buttons. */
export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <div className="chart-legend t-small secondary">
      {items.map((item) => {
        const swatch = <i className={`legend-swatch ${item.mark}`} style={swatchStyle(item)} />;
        if (!item.onToggle) {
          return (
            <span key={item.label}>
              {swatch}
              {item.label}
            </span>
          );
        }
        return (
          <button
            key={item.label}
            type="button"
            className={item.shown === false ? 'legend-toggle off' : 'legend-toggle'}
            aria-pressed={item.shown !== false}
            title={item.shown === false ? `Show ${item.label}` : `Hide ${item.label}`}
            onClick={item.onToggle}
          >
            {swatch}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function swatchStyle(item: LegendItem) {
  return item.mark === 'dashed' || item.mark === 'dotted' ? { borderColor: item.color } : { background: item.color };
}
