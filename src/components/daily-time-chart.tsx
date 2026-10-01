import { useMemo, useState } from 'react';
import uPlot from 'uplot';

import { ChartLegend } from './chart-legend';
import {
  RangeChips,
  UPlotChart,
  axisStyle,
  chartInteraction,
  dayDateAxis,
  fitAxisSize,
  fittedRange,
  tooltipPlugin,
  withAlpha,
  type ChartZoom,
} from './uplot-chart';
import type { RoundResult } from '@/game/types';
import { dailyStats, startOfDay, type DayStats } from '@/levels';
import { DATE_LOCALE, formatDuration } from '@/stats';
import { useTheme } from '@/theme';

const HEIGHT = 240;
const DAY_MS = 86400000;
/** Zooming in stops at this many days across. */
const MIN_ZOOM_DAYS = 3;

/** Top of the minutes axis: the next of these above the longest day (then whole hours). */
const MINUTE_STEPS = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120];

function minutesCeiling(maxMinutes: number): number {
  const target = maxMinutes * 1.15;
  return MINUTE_STEPS.find((step) => step >= target) ?? Math.ceil(target / 60) * 60;
}

/** "all" still spans at least this many days, so a short history isn't stretched across the chart. */
const MIN_ALL_DAYS = 7;

/**
 * Least-squares line through (x, y) points, evaluated at each x in `at` between the first and last point
 * (no extrapolating into days before or after); null elsewhere and with fewer than 2 points.
 */
function trendLine(points: { x: number; y: number }[], at: number[]): (number | null)[] {
  if (points.length < 2) return at.map(() => null);
  const firstX = points[0].x;
  const lastX = points[points.length - 1].x;
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.x - mx) * (p.y - my);
    den += (p.x - mx) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  return at.map((x) => (x < firstX || x > lastX ? null : Math.max(0, my + slope * (x - mx))));
}

/**
 * Time played per day (bars, with its trend dotted) against that day's average level (line), like
 * Monkeytype's activity chart: it shows whether longer or more regular practice goes with better rounds.
 * Days without play leave a gap. Hover or tap a day for its details. Zooms and pans like the other charts.
 */
/** `zoom` comes from the parent (`useChartZoom`), which shows the crosshair switch and Reset zoom in the section header. */
export function DailyTimeChart({ rounds, zoom }: { rounds: RoundResult[]; zoom: ChartZoom }) {
  const theme = useTheme();
  const [rangeDays, setRangeDays] = useState<number | null>(30);
  // Read on every render (the Stats screen stays mounted), so the chart moves on past midnight.
  const today = startOfDay(Date.now());

  const allDays = useMemo(() => dailyStats(rounds), [rounds]);

  // Every calendar day of the range, ending today (so gaps show), each with its stats if played. A fixed
  // range always covers its full length, played or not.
  const days = useMemo(() => {
    const span = rangeDays ?? Math.max(MIN_ALL_DAYS, Math.round((today - (allDays[0]?.day ?? today)) / DAY_MS) + 1);
    const start = new Date(today);
    start.setDate(start.getDate() - (span - 1));
    const first = start.getTime();
    const byDay = new Map(allDays.map((d) => [d.day, d]));
    const out: { day: number; stats: DayStats | null }[] = [];
    // Step by calendar date, not by 24h, so daylight-saving changes don't skip or repeat a day.
    for (let d = new Date(first); d.getTime() <= today; d.setDate(d.getDate() + 1)) {
      const day = startOfDay(d.getTime());
      out.push({ day, stats: byDay.get(day) ?? null });
    }
    return out;
  }, [allDays, rangeDays, today]);

  const played = days.filter((d) => d.stats);
  const avgMinutes = played.length
    ? played.reduce((sum, d) => sum + (d.stats as DayStats).playedMs, 0) / played.length / 60000
    : 0;

  const data = useMemo<uPlot.AlignedData>(() => {
    const xs = days.map((d) => d.day / 1000);
    const minutes = days.map((d) => (d.stats ? d.stats.playedMs / 60000 : null));
    const trendPoints = days.flatMap((d, i) => (d.stats ? [{ x: i, y: d.stats.playedMs / 60000 }] : []));
    return [
      xs,
      minutes,
      trendLine(
        trendPoints,
        days.map((_, i) => i),
      ),
      days.map((d) => (d.stats ? d.stats.avgLevel : null)),
    ];
  }, [days]);

  const options = useMemo<Omit<uPlot.Options, 'width' | 'height'>>(() => {
    const maxMinutes = Math.max(0, ...days.map((d) => (d.stats ? d.stats.playedMs / 60000 : 0)));
    const barColor = theme.warning;
    const interaction = chartInteraction({
      // Pinned to the range (half a day of margin for the bars); uPlot's auto range would stretch a
      // single day across years.
      xFull: [days[0].day / 1000 - 43200, days[days.length - 1].day / 1000 + 43200],
      xTime: true,
      minXSpan: (MIN_ZOOM_DAYS * DAY_MS) / 1000,
      // Zooming and panning move the days only; the axes refit to the days in view, so bars keep their
      // baseline.
      panZoomY: false,
      // Both fitted to the data in view, so a few short days still fill the height.
      yScales: [
        { key: 'min', fit: (_u, _min, max) => [0, minutesCeiling(max ?? maxMinutes)], bounds: { min: 0 } },
        { key: 'lvl', fit: fittedRange(0.25, 0), bounds: { min: 0 }, side: 'right' },
      ],
      onZoomed: zoom.setZoomed,
      onReset: zoom.reset,
    });
    return {
      legend: { show: false },
      cursor: { ...interaction.cursor, points: { show: false } },
      scales: interaction.scales,
      axes: [
        dayDateAxis(theme),
        axisStyle(theme, {
          scale: 'min',
          size: fitAxisSize(),
          label: 'Minutes',
          labelSize: 14,
          labelFont: '11px sans-serif',
        }),
        axisStyle(theme, {
          scale: 'lvl',
          side: 1,
          size: fitAxisSize(),
          grid: { show: false },
          label: 'Level',
          labelSize: 14,
          labelFont: '11px sans-serif',
        }),
      ],
      series: [
        {},
        {
          label: 'Minutes',
          scale: 'min',
          fill: withAlpha(barColor, 0.55),
          stroke: withAlpha(barColor, 0.55),
          width: 0,
          paths: uPlot.paths.bars!({ size: [0.7, 14] }),
          points: { show: false },
        },
        { label: 'Time trend', scale: 'min', stroke: barColor, width: 1.5, dash: [2, 4], points: { show: false } },
        {
          label: 'Level',
          scale: 'lvl',
          stroke: theme.accent,
          width: 2,
          spanGaps: true,
          points: { show: true, size: 5, fill: theme.accent },
        },
      ],
      plugins: [
        interaction.plugin,
        tooltipPlugin((idx) => {
          const entry = days[idx];
          if (!entry) return null;
          const title = new Date(entry.day).toLocaleDateString(DATE_LOCALE, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          });
          const s = entry.stats;
          if (!s) return { title, rows: [['Time played', 'none']] };
          return {
            title,
            rows: [
              ['Time played', formatDuration(s.playedMs)],
              ['Rounds', String(s.rounds)],
              ['Avg level', s.avgLevel.toFixed(2)],
              ['Best round', s.bestLevel.toFixed(2)],
              ['Avg accuracy', `${Math.round(s.avgAccuracy)}%`],
              ['Modes', String(s.modes)],
            ],
          };
        }),
      ],
    };
    // chartKey: a reset rebuilds the chart, and the rebuilt one needs fresh zoom state.
  }, [days, theme, zoom.setZoomed, zoom.reset, zoom.chartKey]);

  return (
    <div className="stack-10">
      <RangeChips days={rangeDays} zoom={zoom} onPick={setRangeDays} />

      {played.length === 0 ? (
        <div className="chart-box" style={{ height: HEIGHT }}>
          <span className="t-small secondary">No play time in this range.</span>
        </div>
      ) : (
        <UPlotChart key={zoom.chartKey} options={options} data={data} height={HEIGHT} zoom={zoom} />
      )}

      <ChartLegend
        items={[
          { label: 'Minutes per day', color: withAlpha(theme.warning, 0.55), mark: 'bar' },
          { label: 'Time trend', color: theme.warning, mark: 'dotted' },
          { label: 'Avg level', color: theme.accent, mark: 'line' },
        ]}
      />
      <div className="chart-stats t-small secondary">
        <span>
          <strong>{played.length}</strong> {played.length === 1 ? 'day' : 'days'} played
        </span>
        <span>
          <strong>{formatDuration(avgMinutes * 60000)}</strong> avg per day played
        </span>
      </div>
    </div>
  );
}
