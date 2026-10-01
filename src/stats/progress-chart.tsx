import { useMemo, useRef, useState } from 'react';
import type uPlot from 'uplot';

import { ChartLegend } from './chart-legend';
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
import {
  MAX_ESTIMATE_HOURS,
  PROGRESS_CHART_HEIGHT,
  PROGRESS_ROLLING_WINDOW,
  RATE_MIN_ROUNDS,
  STREAM_CHART_COLORS,
} from '@/config/charts';
import { statsCopy } from '@/copy/stats';
import type { RoundResult, StreamId } from '@/game/types';
import { STREAM_LABELS } from '@/game/types';
import { DATE_LOCALE } from '@/config/stats';
import { computeRoundPoints, exponentialAverage, improvementRate, type PerfectEstimate } from '@/lib/stats';
import { useTheme } from '@/lib/theme';

type Metric = 'accuracy' | 'reaction';
/** Every line in the legend can be hidden: the round dots, the overall average and each stream. */
type SeriesKey = 'round' | 'avg' | StreamId;

/**
 * Accuracy or reaction time over the rounds of one mode (all played with the same N, streams and speed,
 * so they're directly comparable). Dots are rounds; lines are their trends (exponential moving averages), overall and per stream.
 * Hover or tap for a round's values; tap a stream in the legend to hide or show its line.
 */
/** `zoom` comes from the parent (`useChartZoom`), which shows the crosshair switch and Reset zoom in the section header. */
export function ProgressChart({
  rounds,
  streams,
  zoom,
}: {
  rounds: RoundResult[];
  streams: StreamId[];
  zoom: ChartZoom;
}) {
  const theme = useTheme();
  const [metric, setMetric] = useState<Metric>('accuracy');
  const [days, setDays] = useState<number | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<SeriesKey>>(new Set());
  // Read by the chart options and tooltip, so toggling a stream doesn't rebuild the chart (or undo a zoom).
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  const plotRef = useRef<uPlot | null>(null);

  // Every round of the mode, oldest first: the averages count rounds from before the range too.
  const allPoints = useMemo(() => computeRoundPoints(rounds), [rounds]);
  // The range is worked out when the rounds or range change (not once at mount), so it doesn't go stale.
  // `start`: the first round in it.
  const start = useMemo(() => {
    const cutoff = days == null ? -Infinity : Date.now() - days * 86400000;
    const first = allPoints.findIndex((p) => p.finishedAt >= cutoff);
    return first === -1 ? allPoints.length : first;
  }, [allPoints, days]);
  const points = useMemo(() => allPoints.slice(start), [allPoints, start]);

  // Values and their trends (exponential moving averages of PROGRESS_ROLLING_WINDOW) for every round, then cut
  // to the range. A trend only starts once there are PROGRESS_ROLLING_WINDOW rounds, so the first rounds ever
  // played don't show an average of fewer.
  const { perRound, averages } = useMemo(() => {
    const value = (p: (typeof allPoints)[number], s?: StreamId) =>
      metric === 'accuracy'
        ? s
          ? (p.streamAccuracy[s] ?? null)
          : p.accuracy
        : s
          ? (p.streamSpeedMs[s] ?? null)
          : p.speedMs;
    const average = (values: (number | null)[]) => exponentialAverage(values, PROGRESS_ROLLING_WINDOW).slice(start);
    return {
      perRound: allPoints.slice(start).map((p) => value(p)),
      averages: [
        average(allPoints.map((p) => value(p))),
        ...streams.map((s) => average(allPoints.map((p) => value(p, s)))),
      ],
    };
  }, [allPoints, start, streams, metric]);
  const hasData = perRound.some((v) => v != null);
  const rate = useMemo(() => improvementRate(points), [points]);
  const unit = metric === 'accuracy' ? '%' : ' ms';
  const mainColor = metric === 'accuracy' ? theme.accent : theme.warning;

  const data = useMemo<uPlot.AlignedData>(
    () => [points.map((_, i) => i + 1), perRound, ...averages],
    [points, perRound, averages],
  );

  const options = useMemo<Omit<uPlot.Options, 'width' | 'height'>>(() => {
    const fmt = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v)}${unit}`);
    // Fitted to the rounds in view, so a cluster at 80–100% isn't squeezed into the top of a 0–100% axis.
    const yRange = metric === 'accuracy' ? fittedRange(10, 0, 100) : fittedRange(50, 0);
    const yBounds = metric === 'accuracy' ? { min: 0, max: 100 } : { min: 0 };
    const interaction = roundChartInteraction(points.length, yRange, zoom.setZoomed, zoom.reset, yBounds);
    return {
      legend: { show: false },
      scales: interaction.scales,
      axes: [
        roundDateAxis(
          theme,
          points.map((p) => p.finishedAt),
        ),
        axisStyle(theme, { size: 44, values: (_u, ticks) => ticks.map((t) => `${t}${unit}`) }),
      ],
      cursor: interaction.cursor,
      series: [
        {},
        { ...dotSeries('This round', mainColor, undefined, points.length), show: !hiddenRef.current.has('round') },
        lineSeries(`Avg of ${PROGRESS_ROLLING_WINDOW}`, mainColor, undefined, {
          width: 2.5,
          show: !hiddenRef.current.has('avg'),
        }),
        ...streams.map((s) =>
          lineSeries(STREAM_LABELS[s], withAlpha(theme[STREAM_CHART_COLORS[s]], 0.8), undefined, {
            width: 1.5,
            dash: [4, 3],
            show: !hiddenRef.current.has(s),
          }),
        ),
      ],
      plugins: [
        interaction.plugin,
        tooltipPlugin((idx) => {
          const point = points[idx];
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
              ['round', 'This round', perRound[idx]] as const,
              ['avg', `Avg of ${PROGRESS_ROLLING_WINDOW}`, averages[0][idx]] as const,
              ...streams.map((s, i) => [s, `${STREAM_LABELS[s]} avg`, averages[1 + i][idx]] as const),
            ]
              .filter(([key]) => !hiddenRef.current.has(key))
              .map(([, label, value]): [string, string] => [label, fmt(value)]),
          };
        }),
      ],
    };
    // chartKey: a reset rebuilds the chart, and the rebuilt one needs fresh zoom state.
  }, [theme, metric, unit, mainColor, points, streams, perRound, averages, zoom.setZoomed, zoom.reset, zoom.chartKey]);

  const toggleSeries = (key: SeriesKey) => {
    const next = new Set(hidden);
    const show = next.has(key);
    if (show) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setHidden(next);
    const index = key === 'round' ? 1 : key === 'avg' ? 2 : 3 + streams.indexOf(key);
    plotRef.current?.setSeries(index, { show });
  };

  return (
    <div className="stack-10">
      <div className="chip-row">
        <FilterChip label="Accuracy" active={metric === 'accuracy'} onPress={() => setMetric('accuracy')} />
        <FilterChip label="Reaction time" active={metric === 'reaction'} onPress={() => setMetric('reaction')} />
      </div>
      <RangeChips days={days} zoom={zoom} onPick={setDays} />

      {hasData ? (
        <UPlotChart
          key={zoom.chartKey}
          options={options}
          data={data}
          height={PROGRESS_CHART_HEIGHT}
          plotRef={plotRef}
          zoom={zoom}
        />
      ) : (
        <div className="chart-box" style={{ height: PROGRESS_CHART_HEIGHT }}>
          <span className="t-small secondary">
            {metric === 'reaction' && points.length > 0 ? statsCopy.byMode.noReactionTimes : statsCopy.noRoundsInRange}
          </span>
        </div>
      )}

      <div className="progress-legend">
        {hasData && (
          <ChartLegend
            items={[
              {
                label: 'Round',
                color: withAlpha(mainColor, 0.5),
                mark: 'dot',
                shown: !hidden.has('round'),
                onToggle: () => toggleSeries('round'),
              },
              {
                label: `Avg of ${PROGRESS_ROLLING_WINDOW}`,
                color: mainColor,
                mark: 'line',
                shown: !hidden.has('avg'),
                onToggle: () => toggleSeries('avg'),
              },
              ...streams.map((s) => ({
                label: STREAM_LABELS[s],
                color: theme[STREAM_CHART_COLORS[s]],
                mark: 'dashed' as const,
                shown: !hidden.has(s),
                onToggle: () => toggleSeries(s),
              })),
            ]}
          />
        )}
      </div>

      <div className="chart-footer">
        {points.length >= RATE_MIN_ROUNDS && metric === 'accuracy' && rate.toPerfect && (
          <PerfectEstimateLabel estimate={rate.toPerfect} />
        )}
        {points.length >= RATE_MIN_ROUNDS && metric === 'reaction' && rate.speedMsPerHour != null && (
          <span className={rate.speedMsPerHour <= 0 ? 't-small good' : 't-small bad'}>
            {statsCopy.byMode.reactionTrend(`${rate.speedMsPerHour <= 0 ? '' : '+'}${Math.round(rate.speedMsPerHour)}`)}
          </span>
        )}
      </div>
    </div>
  );
}

function PerfectEstimateLabel({ estimate }: { estimate: PerfectEstimate }) {
  if (estimate.kind === 'reached') {
    return <span className="t-small good">{statsCopy.byMode.reached}</span>;
  }
  if (estimate.kind === 'noProgress') {
    return <span className="t-small secondary">{statsCopy.byMode.noProgress}</span>;
  }
  return <span className="t-small good">{statsCopy.byMode.toPerfect(formatPlayTime(estimate.hours))}</span>;
}

/** Whole minutes under an hour, hours and minutes above. */
function formatPlayTime(hours: number): string {
  if (hours >= MAX_ESTIMATE_HOURS) {
    return `${MAX_ESTIMATE_HOURS}h+`;
  }
  const minutes = Math.max(1, Math.round(hours * 60));
  if (minutes < 60) {
    return `${minutes}m`;
  }
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <button type="button" className={active ? 'filter-chip t-code on' : 'filter-chip t-code'} onClick={onPress}>
      {label}
    </button>
  );
}
