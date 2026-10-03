import type uPlot from 'uplot';

/** A y range fitted to the data in view: padded, snapped to `step`, and kept within [floor, ceiling]. */
export function fittedRange(step: number, floor: number, ceiling = Infinity): uPlot.Range.Function {
  return (_u, min, max) => {
    if (min == null || max == null) {
      return [floor, Math.min(ceiling, floor + step * 4)];
    }
    const pad = Math.max(step / 2, (max - min) * 0.1);
    const lo = Math.max(floor, Math.floor((min - pad) / step) * step);
    const hi = Math.min(ceiling, Math.ceil((max + pad) / step) * step);
    return [lo, Math.max(hi, lo + step)];
  };
}

/** Gives a hex colour see-through-ness (alpha 0 to 1). The colours come from the CSS, where the build may write
 *  #ffaa00 short as #fa0, so the short forms are written out in full first. A colour that has its own alpha
 *  gets this one instead. */
export function withAlpha(hex: string, alpha: number): string {
  let digits = hex.trim().replace(/^#/, '');
  if (digits.length === 3 || digits.length === 4) {
    digits = [...digits].map((d) => d + d).join('');
  }
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(digits)) {
    // Not a hex colour (rgb(), a name): left as it is rather than broken.
    return hex;
  }
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${digits.slice(0, 6)}${a}`;
}

/** A series drawn as dots only (one per round); smaller once there are many, so they don't merge into a band. */
export function dotSeries(label: string, color: string, value: uPlot.Series['value'], count = 0): uPlot.Series {
  return {
    label,
    stroke: withAlpha(color, 0.5),
    fill: withAlpha(color, 0.5),
    paths: () => null,
    points: { show: true, size: count > 60 ? 4 : 6, width: 0, fill: withAlpha(color, 0.45) },
    value,
  };
}

/**
 * Draws a trend line through every point, as a monotone cubic curve: it bends smoothly but never
 * overshoots, so it doesn't show values that aren't there, and it shows the same values at every zoom.
 * Gaps (nulls) are bridged.
 */
const smoothLinePaths: uPlot.Series.PathBuilder = (u, seriesIdx, idx0, idx1) => {
  const xs = u.data[0];
  const ys = u.data[seriesIdx] as (number | null | undefined)[];
  const scale = u.series[seriesIdx].scale ?? 'y';
  // One point either side of the view too, so the line runs off the edges instead of stopping short.
  const from = Math.max(0, idx0 - 1);
  const to = Math.min(xs.length - 1, idx1 + 1);
  const px: number[] = [];
  const py: number[] = [];
  for (let i = from; i <= to; i++) {
    const y = ys[i];
    if (y == null) {
      continue;
    }
    px.push(u.valToPos(xs[i], 'x', true));
    py.push(u.valToPos(y, scale, true));
  }

  const stroke = new Path2D();
  const n = px.length;
  if (n > 0) {
    stroke.moveTo(px[0], py[0]);
  }
  if (n === 2) {
    stroke.lineTo(px[1], py[1]);
  }
  if (n > 2) {
    // Fritsch–Carlson tangents: the curve stays monotone between points, so it can't overshoot.
    const slope = px.slice(1).map((x, i) => (py[i + 1] - py[i]) / (x - px[i] || 1));
    const tangent = px.map((_, i) =>
      i === 0
        ? slope[0]
        : i === n - 1
          ? slope[n - 2]
          : slope[i - 1] * slope[i] <= 0
            ? 0
            : (slope[i - 1] + slope[i]) / 2,
    );
    for (let i = 0; i < n - 1; i++) {
      if (slope[i] === 0) {
        tangent[i] = tangent[i + 1] = 0;
        continue;
      }
      const a = tangent[i] / slope[i];
      const b = tangent[i + 1] / slope[i];
      const h = a * a + b * b;
      if (h > 9) {
        const t = 3 / Math.sqrt(h);
        tangent[i] = t * a * slope[i];
        tangent[i + 1] = t * b * slope[i];
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const third = (px[i + 1] - px[i]) / 3;
      stroke.bezierCurveTo(
        px[i] + third,
        py[i] + tangent[i] * third,
        px[i + 1] - third,
        py[i + 1] - tangent[i + 1] * third,
        px[i + 1],
        py[i + 1],
      );
    }
  }
  // Kept inside the plot, as the line now reaches past the view's edges.
  const clip = new Path2D();
  clip.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height);
  return { stroke, fill: null, clip, flags: 0 };
};

/** A smooth trend line (a rolling average), bridging gaps where there is no data; see `smoothLinePaths`. */
export function lineSeries(
  label: string,
  color: string,
  value: uPlot.Series['value'],
  extra: Partial<uPlot.Series> = {},
): uPlot.Series {
  return {
    label,
    stroke: color,
    width: 2,
    points: { show: false },
    spanGaps: true,
    paths: smoothLinePaths,
    value,
    ...extra,
  };
}
