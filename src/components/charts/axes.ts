import uPlot from 'uplot';

import { AXIS_FONT, AXIS_VALUE_PAD, DATE_LABEL_SPACE } from '@/config/charts';
import { DATE_LOCALE } from '@/config/stats';
import type { Theme } from '@/lib/theme';

/** Axis styling shared by all charts. */
export function axisStyle(theme: Theme, extra: Partial<uPlot.Axis> = {}): uPlot.Axis {
  return {
    stroke: theme.textSecondary,
    font: AXIS_FONT,
    grid: { stroke: theme.backgroundSelected, width: 1 },
    ticks: { show: false },
    gap: 4,
    ...extra,
  };
}

let measureContext: CanvasRenderingContext2D | null = null;

/**
 * An axis `size` just wide enough for its widest value, so the axis title sits close to the numbers
 * however many digits they have (a fixed size left a wide gap beside short ones).
 */
export function fitAxisSize(min = 16): uPlot.Axis.Size {
  return (_u, values) => {
    if (!values?.length) {
      return min;
    }
    measureContext ??= document.createElement('canvas').getContext('2d');
    if (!measureContext) {
      return min;
    }
    measureContext.font = AXIS_FONT;
    const widest = Math.max(...values.map((v) => measureContext!.measureText(String(v)).width));
    return Math.max(min, Math.ceil(widest) + 4 + AXIS_VALUE_PAD);
  };
}

/**
 * X axis for charts that place rounds one after another (x = 1, 2, 3…, one per round, like Monkeytype's
 * tests): instead of round numbers it labels the first round of each day with its date, thinned out to fit
 * the width. When every round is from the same day, each round is labelled with its time instead.
 */
export function roundDateAxis(theme: Theme, times: number[]): uPlot.Axis {
  const dayOf = (x: number) => new Date(times[x - 1]).toDateString();
  return axisStyle(theme, {
    grid: { show: false },
    // Only the rounds in view (the chart may be zoomed in).
    splits: (u, _axis, min, max) => {
      const visible = times.map((_, i) => i + 1).filter((x) => x >= min && x <= max);
      const firsts = visible.filter((x, j) => j === 0 || dayOf(x) !== dayOf(visible[j - 1]));
      const candidates = firsts.length === 1 ? visible : firsts;
      // Rounds aren't spread evenly over days, so thin by on-screen distance rather than by count,
      // starting from the newest so the latest day always has a label. None sticks out past the plot's
      // left end, where it would run into the lowest value.
      const plotWidth = u.bbox.width / uPlot.pxRatio;
      const pos = (x: number) => ((x - min) / (max - min || 1)) * plotWidth;
      const kept: number[] = [];
      let lastPos = Infinity;
      for (let j = candidates.length - 1; j >= 0; j--) {
        const p = pos(candidates[j]);
        if (p < DATE_LABEL_SPACE / 2) {
          break;
        }
        if (lastPos - p >= DATE_LABEL_SPACE) {
          kept.unshift(candidates[j]);
          lastPos = p;
        }
      }
      return kept;
    },
    values: (_u, splits) => {
      const oneDay = splits.length > 1 && splits.every((x) => dayOf(x) === dayOf(splits[0]));
      return splits.map((x) => {
        const time = times[x - 1];
        if (time == null) {
          return '';
        }
        const date = new Date(time);
        return oneDay
          ? date.toLocaleTimeString(DATE_LOCALE, { hour: '2-digit', minute: '2-digit' })
          : date.toLocaleDateString(DATE_LOCALE, { month: 'short', day: 'numeric' });
      });
    },
  });
}

/**
 * X axis for charts with one x step per calendar day (x in seconds, each day's value at its midnight): labels
 * days in the same format as `roundDateAxis` ("27 Aug" in the reader's language, not uPlot's own "8/27"),
 * thinned to fit the width the same way.
 */
export function dayDateAxis(theme: Theme): uPlot.Axis {
  return axisStyle(theme, {
    grid: { show: false },
    splits: (u, _axis, min, max) => {
      const days: number[] = [];
      const day = new Date(min * 1000);
      day.setHours(0, 0, 0, 0);
      if (day.getTime() / 1000 < min) {
        day.setDate(day.getDate() + 1);
      }
      for (; day.getTime() / 1000 <= max; day.setDate(day.getDate() + 1)) {
        days.push(day.getTime() / 1000);
      }
      // As on the round axis: from the newest day back, so the latest has a label, and none sticking out
      // past the plot's left end.
      const plotWidth = u.bbox.width / uPlot.pxRatio;
      const pos = (x: number) => ((x - min) / (max - min || 1)) * plotWidth;
      const kept: number[] = [];
      let lastPos = Infinity;
      for (let j = days.length - 1; j >= 0; j--) {
        const p = pos(days[j]);
        if (p < DATE_LABEL_SPACE / 2) {
          break;
        }
        if (lastPos - p >= DATE_LABEL_SPACE) {
          kept.unshift(days[j]);
          lastPos = p;
        }
      }
      return kept;
    },
    values: (_u, splits) =>
      splits.map((x) => new Date(x * 1000).toLocaleDateString(DATE_LOCALE, { month: 'short', day: 'numeric' })),
  });
}
