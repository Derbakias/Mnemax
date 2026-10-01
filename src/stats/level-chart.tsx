import { useMemo, useState } from 'react';
import type uPlot from 'uplot';

import { ChartLegend } from './chart-legend';
import { modeLabel } from './mode-badge';
import {
  RangeChips,
  UPlotChart,
  axisStyle,
  dotSeries,
  fittedRange,
  lineSeries,
  roundChartInteraction,
  roundDateAxis,
  tooltipPlugin,
  withAlpha,
  type ChartZoom,
} from '../components/charts/uplot-chart';
import { LEVEL_CHART_HEIGHT } from '@/config/charts';
import { DATE_LOCALE, LEVEL_WINDOW } from '@/config/stats';
import { roundMode, type LevelPoint } from '@/stats/levels';
import { exponentialAverage } from '@/lib/stats';
import { useTheme } from '@/lib/theme';

/**
 * Round scores (dots) and their trend, an exponential moving average of LEVEL_WINDOW (line), over the rounds
 * in the picked time range. The trend still counts the rounds before the range.
 * `zoom` comes from the parent (`useChartZoom`), which shows the crosshair switch and Reset zoom in the
 * section header.
 */
export function LevelChart({ history: allHistory, zoom }: { history: LevelPoint[]; zoom: ChartZoom }) {
  const theme = useTheme();
  const [days, setDays] = useState<number | null>(null);
  // The range is worked out when the history or range change (not once at mount), so it doesn't go stale.
  // The trend over every round ever played (it starts at the LEVEL_WINDOW-th, so the first rounds don't
  // show an average of fewer), cut to the range below.
  const allTrend = useMemo(
    () =>
      exponentialAverage(
        allHistory.map((p) => p.score),
        LEVEL_WINDOW,
      ),
    [allHistory],
  );
  const { history, trend } = useMemo(() => {
    const now = Date.now();
    const cutoff = days == null ? -Infinity : now - days * 86400000;
    // History is oldest first, so the range is its tail.
    const start = allHistory.findIndex((p) => p.finishedAt >= cutoff);
    const from = start === -1 ? allHistory.length : start;
    return {
      history: allHistory.slice(from),
      trend: allTrend.slice(from),
    };
  }, [allHistory, allTrend, days]);

  const data = useMemo<uPlot.AlignedData>(
    () => [history.map((_, i) => i + 1), history.map((p) => p.score), trend],
    [history, trend],
  );

  const options = useMemo<Omit<uPlot.Options, 'width' | 'height'>>(() => {
    const interaction = roundChartInteraction(history.length, fittedRange(0.25, 0), zoom.setZoomed, zoom.reset, {
      min: 0,
    });
    return {
      legend: { show: false },
      scales: interaction.scales,
      axes: [
        roundDateAxis(
          theme,
          history.map((p) => p.finishedAt),
        ),
        axisStyle(theme, { size: 34 }),
      ],
      cursor: interaction.cursor,
      series: [
        {},
        dotSeries('Round score', theme.accent, undefined, history.length),
        lineSeries(`Level (avg of ${LEVEL_WINDOW})`, theme.accent, undefined),
      ],
      plugins: [
        interaction.plugin,
        tooltipPlugin((idx) => {
          const point = history[idx];
          if (!point) {
            return null;
          }
          const title = new Date(point.finishedAt).toLocaleString(DATE_LOCALE, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          });
          return {
            title,
            rows: [
              ['Mode', modeLabel(roundMode(point.round))],
              ['Round score', point.score.toFixed(2)],
              // Like the line: no trend until there are LEVEL_WINDOW rounds.
              ...(trend[idx] != null
                ? [[`Level (avg of ${LEVEL_WINDOW})`, (trend[idx] as number).toFixed(2)] as [string, string]]
                : []),
            ],
          };
        }),
      ],
    };
    // chartKey: a reset rebuilds the chart, and the rebuilt one needs fresh zoom state.
  }, [history, trend, theme, zoom.setZoomed, zoom.reset, zoom.chartKey]);

  return (
    <div className="stack-8">
      <RangeChips days={days} zoom={zoom} onPick={setDays} />
      {history.length > 0 ? (
        <UPlotChart key={zoom.chartKey} options={options} data={data} height={LEVEL_CHART_HEIGHT} zoom={zoom} />
      ) : (
        <div className="chart-box" style={{ height: LEVEL_CHART_HEIGHT }}>
          <span className="t-small secondary">No rounds in this time range.</span>
        </div>
      )}
      <ChartLegend
        items={[
          { label: 'Round score', color: withAlpha(theme.accent, 0.5), mark: 'dot' },
          { label: `Level (avg of ${LEVEL_WINDOW})`, color: theme.accent, mark: 'line' },
        ]}
      />
    </div>
  );
}
