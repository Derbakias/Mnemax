import { useEffect, useRef, type RefObject } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

import { Icon } from '../ui/icon';
import { CHART_RANGES } from '@/config/charts';
import { useElementWidth } from '@/hooks/use-element-width';
import type { ChartZoom } from './zoom';

interface UPlotChartProps {
  /** Memoize these: a new object rebuilds the chart. */
  options: Omit<uPlot.Options, 'width' | 'height'>;
  data: uPlot.AlignedData;
  height: number;
  /** Receives the live chart, e.g. to show or hide series without rebuilding it. */
  plotRef?: RefObject<uPlot | null>;
  /** For a chart built with `chartInteraction`: its crosshair switch (see CrosshairToggle) applies. */
  zoom?: ChartZoom;
}

// uPlot draws on a canvas, so it can't follow CSS: the chart is rebuilt whenever its options or data
// change (theme colors come in through the options), and only resized when the width changes.
export function UPlotChart({ options, data, height, plotRef: externalRef, zoom }: UPlotChartProps) {
  const [boxRef, width] = useElementWidth<HTMLDivElement>();
  const plotRef = useRef<uPlot | null>(null);
  const externalRefRef = useRef(externalRef);
  externalRefRef.current = externalRef;
  const widthRef = useRef(width);
  widthRef.current = width;
  const hasWidth = width > 0;

  useEffect(() => {
    const el = boxRef.current;
    if (!el || !hasWidth) {
      return;
    }
    const plot = new uPlot({ ...options, width: widthRef.current, height }, data, el);
    plotRef.current = plot;
    if (externalRefRef.current) {
      externalRefRef.current.current = plot;
    }
    return () => {
      plot.destroy();
      plotRef.current = null;
      if (externalRefRef.current) {
        externalRefRef.current.current = null;
      }
    };
  }, [boxRef, options, data, height, hasWidth]);

  useEffect(() => {
    if (width > 0) {
      plotRef.current?.setSize({ width, height });
    }
  }, [width, height]);

  // Turning the crosshair off takes it (and the tooltip) away at once.
  const crosshair = zoom?.crosshair ?? false;
  useEffect(() => {
    if (!crosshair) {
      plotRef.current?.setCursor({ left: -10, top: -10 });
    }
  }, [crosshair]);

  // The box holds the chart's height before uPlot has drawn into it (a new chart waits a render for its
  // width), so rebuilding one, like picking another mode, doesn't move the page under it.
  const box = <div ref={boxRef} className="uplot-box" style={{ minHeight: height }} />;
  if (!zoom) {
    return box;
  }
  // The touch gestures read the switch from `data-crosshair` (see addTouchControls), so flipping it
  // doesn't rebuild the chart.
  return (
    <div className="uplot-frame" data-crosshair={crosshair ? 'on' : 'off'}>
      {box}
    </div>
  );
}

/**
 * The time range chips every chart has (the last `days` days, or all of them for null). While zoomed the
 * view is no range in particular, so none is shown as picked; picking one (even the same) starts unzoomed.
 */
export function RangeChips({
  days,
  zoom,
  onPick,
}: {
  days: number | null;
  zoom: ChartZoom;
  onPick: (days: number | null) => void;
}) {
  return (
    <div className="chip-row">
      {CHART_RANGES.map((range) => (
        <button
          key={range.label}
          type="button"
          className={days === range.days && !zoom.zoomed ? 'filter-chip t-code on' : 'filter-chip t-code'}
          onClick={() => {
            onPick(range.days);
            zoom.reset();
          }}
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}

/**
 * What goes in the header of a section with a chart built with `chartInteraction`: the crosshair switch, and
 * Reset zoom beside it while zoomed.
 */
export function ChartZoomActions({ zoom }: { zoom: ChartZoom }) {
  return (
    <>
      <CrosshairToggle zoom={zoom} />
      {zoom.zoomed && (
        <button type="button" className="filter-chip t-code" onClick={zoom.reset}>
          Reset zoom
        </button>
      )}
    </>
  );
}

/**
 * The crosshair switch, shown on touch screens only (with a mouse, the crosshair simply follows the pointer).
 * One finger moves the crosshair while it's on, and the chart while it's off.
 */
function CrosshairToggle({ zoom }: { zoom: ChartZoom }) {
  return (
    <button
      type="button"
      className={zoom.crosshair ? 'crosshair-toggle on' : 'crosshair-toggle'}
      aria-label="Crosshair"
      aria-pressed={zoom.crosshair}
      title={zoom.crosshair ? 'Crosshair on: one finger reads values' : 'Crosshair off: one finger moves the chart'}
      onClick={() => zoom.setCrosshair((v) => !v)}
    >
      <Icon name="locate-outline" size={22} />
    </button>
  );
}
